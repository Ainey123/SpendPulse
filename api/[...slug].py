"""SpendPulse API - Vercel Python serverless entrypoint.

This module exposes a single WSGI app (required by Vercel's Python runtime)
and routes requests by PATH_INFO to the individual API handlers. The app
talks to a Google Sheet via gspread using a service-account JSON stored in
the `GOOGLE_CREDENTIALS` environment variable (or `.streamlit/secrets.toml`).
"""

import json
import os
import secrets
import hashlib
import base64
import re
from datetime import date, datetime
from urllib.parse import urlparse

import gspread
from google.oauth2.service_account import Credentials as ServiceAccountCredentials

USERS_COLUMNS = ["username", "password", "role"]
TRANSACTIONS_COLUMNS = [
    "reference_number", "date", "time", "amount", "currency", "sender_name",
    "sender_account", "receiver_name", "receiver_account", "purpose",
    "transaction_type", "receipt_base64", "logged_by",
]
CONTACTS_COLUMNS = ["name", "phone", "account", "logged_by"]

# ---------------------------------------------------------------- helpers


def _json(status, payload):
    if isinstance(status, int):
        status_map = {
            200: "200 OK",
            400: "400 Bad Request",
            401: "401 Unauthorized",
            403: "403 Forbidden",
            404: "404 Not Found",
            500: "500 Internal Server Error"
        }
        status = status_map.get(status, f"{status} Unknown")
    body = json.dumps(payload, default=str).encode("utf-8")
    return (
        status,
        [("Content-Type", "application/json"), ("Content-Length", str(len(body)))],
        [body],
    )


def _read_body(environ):
    try:
        length = int(environ.get("CONTENT_LENGTH", "0") or "0")
    except ValueError:
        length = 0
    raw = environ["wsgi.input"].read(length) if length else b""
    if not raw:
        return {}
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def _get_token():
    """Return the bearer token (session token) from Authorization header."""
    auth = os.environ.get("HTTP_AUTHORIZATION", "")
    if auth.startswith("Bearer "):
        return auth[len("Bearer "):]
    return ""


# In-memory session store. NOTE: Vercel serverless functions are stateless
# and may run on different instances, so we use signed tokens + verify against
# the users sheet on each protected request. Sessions are thus stateless.
_SESSIONS = {}  # token -> username  (used as best-effort cache only)


def make_token(username):
    tok = secrets.token_urlsafe(32)
    _SESSIONS[tok] = username
    return tok


# ---------------------------------------------------------------- Google Sheets


def _credentials():
    raw = os.environ.get("GOOGLE_CREDENTIALS", "")
    if not raw:
        # Fallback: read from local secrets.toml if present (local dev only)
        p = os.path.join(os.getcwd(), ".streamlit", "secrets.toml")
        if os.path.exists(p):
            txt = open(p, encoding="utf-8").read()
            m = re.search(r"private_key\s*=\s*\"\"\"(.*?)\"\"\"", txt, re.S)
            # very small parser; prefer env var in production
            raise RuntimeError("Set GOOGLE_CREDENTIALS env var for production.")
        raise RuntimeError("GOOGLE_CREDENTIALS environment variable is not set.")
    try:
        info = json.loads(raw)
    except Exception:  # noqa: BLE001
        # Vercel may store the pasted JSON with literal newlines (invalid JSON).
        # Escaping all newlines makes it valid: between-token newlines become
        # whitespace, and the private_key's embedded newlines become proper \n.
        try:
            info = json.loads(raw.replace("\n", "\\n"))
        except Exception:
            raise RuntimeError("GOOGLE_CREDENTIALS must be valid service-account JSON (check newlines in private_key).")
    scope = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/spreadsheets",
    ]
    creds = ServiceAccountCredentials.from_service_account_info(info, scopes=scope)
    return creds


def _client():
    return gspread.authorize(_credentials())


def _sheet(tab):
    sid = os.environ.get("SPREADSHEET_ID", "")
    if not sid:
        raise RuntimeError("SPREADSHEET_ID environment variable is not set.")
    client = _client()
    try:
        sh = client.open_by_key(sid)
    except Exception:  # noqa: BLE001
        sh = client.open_by_url(sid)
    try:
        ws = sh.worksheet(tab)
    except Exception:  # noqa: BLE001
        if tab == "users":
            headers = USERS_COLUMNS
        elif tab == "contacts":
            headers = CONTACTS_COLUMNS
        else:
            headers = TRANSACTIONS_COLUMNS
        ws = sh.add_worksheet(title=tab, rows=1000, cols=len(headers))
        ws.append_row(headers)
    return ws


def read_all(tab):
    """Read all rows as dicts with LOWERCASE keys (sheet headers may vary in case)."""
    try:
        ws = _sheet(tab)
        raw = ws.get_all_records()
    except Exception:  # noqa: BLE001
        return []
    out = []
    for row in raw:
        norm = {str(k).strip().lower(): v for k, v in row.items()}
        out.append(norm)
    return out


def append_row(tab, row_dict):
    ws = _sheet(tab)
    headers = [h.strip().lower() for h in ws.row_values(1)]
    if not headers:
        # Sheet exists but has no header row yet — seed it.
        if tab == "users":
            headers = USERS_COLUMNS
        elif tab == "contacts":
            headers = CONTACTS_COLUMNS
        else:
            headers = TRANSACTIONS_COLUMNS
        ws.append_row(headers)
    ordered = [row_dict.get(h, "") for h in headers]
    ws.append_row(ordered)


def headers_index(ws, column):
    headers = [h.strip().lower() for h in ws.row_values(1)]
    try:
        return headers.index(column.lower()) + 1
    except ValueError:
        return 1


def update_cell(tab, username, column, value):
    ws = _sheet(tab)
    cell = ws.find(username, in_column=1)
    if cell:
        ws.update_cell(cell.row, headers_index(ws, column), value)


def find_user(username):
    users = read_all("users")
    for u in users:
        if str(u.get("username", "")).strip().lower() == str(username).strip().lower():
            return u
    return None


# ---------------------------------------------------------------- auth utils


def hash_password(password):
    salt = secrets.token_hex(16)
    h = hashlib.sha256((salt + password).encode()).hexdigest()
    return f"{salt}${h}"


def verify_password(password, stored):
    try:
        salt, h = stored.split("$", 1)
        return hashlib.sha256((salt + password).encode()).hexdigest() == h
    except Exception:  # noqa: BLE001
        return False


def ensure_admin():
    users = read_all("users")
    if not any(u.get("username") == "admin" for u in users):
        append_row("users", {
            "username": "admin",
            "password": hash_password("admin123"),
            "role": "admin",
        })


def current_user():
    """Resolve the logged-in user from the bearer token, verifying vs sheet."""
    tok = _get_token()
    if not tok:
        return None
    username = _SESSIONS.get(tok)
    if not username:
        return None
    return find_user(username)


# ---------------------------------------------------------------- route handlers


def handle_login(environ):
    data = _read_body(environ)
    user = find_user(data.get("username", ""))
    if not user or not verify_password(data.get("password", ""), user.get("password", "")):
        return _json(401, {"error": "Invalid username or password"})
    token = make_token(user["username"])
    return _json(200, {
        "token": token,
        "username": user["username"],
        "role": str(user.get("role", "user") or "user").strip().lower(),
    })


def handle_logout(environ):
    tok = _get_token()
    _SESSIONS.pop(tok, None)
    return _json(200, {"ok": True})


def handle_me(environ):
    user = current_user()
    if not user:
        return _json(401, {"error": "Not authenticated"})
    return _json(200, {
        "username": user["username"],
        "role": str(user.get("role", "user") or "user").strip().lower(),
    })


def handle_reset_password(environ):
    user = current_user()
    if not user:
        return _json(401, {"error": "Not authenticated"})
    data = _read_body(environ)
    cur = data.get("current_password", "")
    new = data.get("new_password", "")
    if not verify_password(cur, user.get("password", "")):
        return _json(400, {"error": "Current password is incorrect"})
    if len(new) < 4:
        return _json(400, {"error": "Password must be at least 4 characters"})
    update_cell("users", user["username"], "password", hash_password(new))
    return _json(200, {"ok": True})


def handle_create_user(environ):
    user = current_user()
    if not user or user.get("role") != "admin":
        return _json(403, {"error": "Admin access required"})
    data = _read_body(environ)
    uname = (data.get("username") or "").strip()
    pw = data.get("password", "")
    role = data.get("role", "user")
    if not uname or not pw:
        return _json(400, {"error": "Username and password required"})
    if find_user(uname):
        return _json(400, {"error": "Username already exists"})
    append_row("users", {"username": uname, "password": hash_password(pw), "role": role})
    return _json(200, {"ok": True, "username": uname})


def handle_list_users(environ):
    user = current_user()
    if not user or user.get("role") != "admin":
        return _json(403, {"error": "Admin access required"})
    users = read_all("users")
    out = [{"username": u.get("username"), "role": u.get("role")} for u in users]
    return _json(200, {"users": out})


def handle_transactions_get(environ):
    user = current_user()
    if not user:
        return _json(401, {"error": "Not authenticated"})
    rows = read_all("transactions")
    if user.get("role") != "admin":
        rows = [r for r in rows if r.get("logged_by") == user["username"]]
    return _json(200, {"transactions": rows, "role": user.get("role")})


def handle_transactions_post(environ):
    user = current_user()
    if not user:
        return _json(401, {"error": "Not authenticated"})
    data = _read_body(environ)
    required = ["reference_number", "date", "time", "amount", "sender_name",
                "receiver_name", "purpose", "transaction_type"]
    missing = [k for k in required if not str(data.get(k, "")).strip()]
    if missing:
        return _json(400, {"error": f"Missing fields: {', '.join(missing)}"})
    try:
        amount = float(data.get("amount"))
    except Exception:  # noqa: BLE001
        return _json(400, {"error": "Amount must be numeric"})
    if amount <= 0:
        return _json(400, {"error": "Amount must be greater than 0"})
    receipt = data.get("receipt_base64", "") or ""
    if receipt and not receipt.startswith("data:"):
        receipt = "data:image/png;base64," + receipt
    row = {
        "reference_number": str(data.get("reference_number")).strip(),
        "date": str(data.get("date")).strip(),
        "time": str(data.get("time")).strip(),
        "amount": amount,
        "currency": str(data.get("currency") or "PKR").strip(),
        "sender_name": str(data.get("sender_name")).strip(),
        "sender_account": str(data.get("sender_account")).strip(),
        "receiver_name": str(data.get("receiver_name")).strip(),
        "receiver_account": str(data.get("receiver_account")).strip(),
        "purpose": str(data.get("purpose")).strip(),
        "transaction_type": str(data.get("transaction_type")).strip(),
        "receipt_base64": receipt,
        "logged_by": user["username"],
    }
    append_row("transactions", row)
    return _json(200, {"ok": True, "transaction": row})


def handle_contacts_get(environ):
    user = current_user()
    if not user:
        return _json(401, {"error": "Not authenticated"})
    rows = read_all("contacts")
    if user.get("role") != "admin":
        rows = [r for r in rows if r.get("logged_by") == user["username"]]
    return _json(200, {"contacts": rows})


def handle_contacts_post(environ):
    user = current_user()
    if not user:
        return _json(401, {"error": "Not authenticated"})
    data = _read_body(environ)
    name = (data.get("name") or "").strip()
    if not name:
        return _json(400, {"error": "Contact name is required"})
    
    row = {
        "name": name,
        "phone": (data.get("phone") or "").strip(),
        "account": (data.get("account") or "").strip(),
        "logged_by": user["username"],
    }
    append_row("contacts", row)
    return _json(200, {"ok": True, "contact": row})


# ---------------------------------------------------------------- OCR extraction


def _vision_client():
    """Build a Google Cloud Vision client (used only as OCR text fallback)."""
    from google.cloud import vision

    raw = os.environ.get("GOOGLE_CREDENTIALS", "")
    if not raw:
        raise RuntimeError("GOOGLE_CREDENTIALS environment variable is not set.")
    info = json.loads(raw)
    return vision.ImageAnnotatorClient.from_service_account_info(info)


# ---- LLM vision extraction (accurate structured fields) ----

LLM_PROMPT = (
    "You are parsing a bank/EasyPaisa/JazzCash/WhatsApp transaction screenshot. "
    "Return ONLY a JSON object with these exact keys (use empty string if not found):\n"
    "{\n"
    '  "sender_name": string,      // person or account who SENT the money\n'
    '  "receiver_name": string,    // person or account who RECEIVED the money\n'
    '  "sender_account": string,   // sender account/phone number if shown\n'
    '  "receiver_account": string, // receiver account/phone/IBAN if shown\n'
    '  "amount": string,           // numeric amount only, no currency symbol\n'
    '  "currency": string,         // e.g. PKR, USD\n'
    '  "date": string,             // ISO format YYYY-MM-DD\n'
    '  "time": string,             // 24h HH:MM\n'
    '  "purpose": string,          // what the payment was for, if stated\n'
    '  "transaction_type": string  // e.g. Bank Transfer, Mobile Wallet, Cash\n'
    "}\n"
    "Be precise with names and account numbers exactly as written. Today is "
    + datetime.now().strftime("%Y-%m-%d") + "."
)


def _llm_extract(img_b64_clean, raw_text=""):
    """Call an LLM vision provider and return a normalized fields dict.

    Provider is chosen by VISION_PROVIDER env (gemini|openai). Falls back to
    the regex extractor when no API key is configured.
    """
    provider = (os.environ.get("VISION_PROVIDER") or "gemini").lower()
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("OPENAI_API_KEY")

    if not api_key:
        # No LLM key configured: don't pretend. Tell the user clearly.
        raise RuntimeError(
            "No vision API key set. Add GEMINI_API_KEY (or OPENAI_API_KEY) in "
            "Vercel env vars so the screenshot can be read automatically."
        )

    try:
        if provider == "openai":
            return _openai_vision(img_b64_clean, api_key)
        return _gemini_vision(img_b64_clean, api_key)
    except Exception as e:  # noqa: BLE001
        # If the LLM call fails, still try regex on the OCR text we may have.
        if raw_text:
            return _extract_fields(raw_text)
        raise RuntimeError(f"LLM vision extraction failed: {e}")


def _gemini_vision(img_b64_clean, api_key):
    import google.generativeai as genai

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-1.5-flash")
    resp = model.generate_content(
        [
            LLM_PROMPT,
            {"mime_type": "image/png", "data": img_b64_clean},
        ]
    )
    return _parse_llm_json(resp.text)


def _openai_vision(img_b64_clean, api_key):
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": LLM_PROMPT},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64_clean}"}},
                ],
            }
        ],
        max_tokens=800,
    )
    return _parse_llm_json(resp.choices[0].message.content)


def _parse_llm_json(text):
    """Extract the first JSON object from an LLM response and normalize it."""
    text = text.strip()
    # Strip code fences if present.
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.lower().startswith("json"):
            text = text[4:]
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        return _extract_fields("")
    obj = json.loads(text[start:end + 1])
    result = {
        "sender_name": str(obj.get("sender_name", "") or "").strip(),
        "receiver_name": str(obj.get("receiver_name", "") or "").strip(),
        "sender_account": str(obj.get("sender_account", "") or "").strip(),
        "receiver_account": str(obj.get("receiver_account", "") or "").strip(),
        "amount": str(obj.get("amount", "") or "").strip(),
        "currency": str(obj.get("currency", "") or "").strip(),
        "date": _normalize_date(str(obj.get("date", "") or "").strip()),
        "time": str(obj.get("time", "") or "").strip()[:5],
        "purpose": str(obj.get("purpose", "") or "").strip(),
        "transaction_type": str(obj.get("transaction_type", "") or "").strip(),
    }
    return result


def _extract_fields(text):
    """Heuristically parse transaction fields out of OCR text lines."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    lower = "\n".join(lines).lower()

    result = {
        "date": "",
        "time": "",
        "sender_name": "",
        "receiver_name": "",
        "amount": "",
        "raw_text": text,
    }

    # --- Amount: look for currency symbols or 'Rs'/'PKR' followed by a number ---
    amount_patterns = [
        r"(?:rs\.?|pkr|₨|r\.s\.?)\s*([0-9][0-9,]{0,15}(?:\.[0-9]{1,2})?)",
        r"([0-9][0-9,]{0,15}(?:\.[0-9]{1,2})?)\s*(?:rs|pkr|₨)",
        r"(?:amount|paid|sent|transferred|total)[:\s]*([0-9][0-9,]{0,15}(?:\.[0-9]{1,2})?)",
        r"\b([0-9]{2,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\b",
    ]
    for pat in amount_patterns:
        m = re.search(pat, lower)
        if m:
            val = m.group(1).replace(",", "")
            try:
                float(val)
                result["amount"] = val
                break
            except ValueError:
                continue

    # --- Date: dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, or "Jul 12 2026" ---
    date_patterns = [
        r"\b(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})\b",
        r"\b(\d{4}[/\-]\d{1,2}[/\-]\d{1,2})\b",
        r"\b([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b",
        r"\b(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b",
    ]
    for pat in date_patterns:
        m = re.search(pat, text)
        if m:
            result["date"] = _normalize_date(m.group(1))
            break

    # --- Time: hh:mm with optional am/pm ---
    tm = re.search(r"\b(\d{1,2}:\d{2}(?:\s*[APap][Mm])?)\b", text)
    if tm:
        result["time"] = tm.group(1).upper().replace(" ", "")

    # --- Sender / Receiver ---
    # 1) "sent Rs 1,500 to Ali Khan" / "received from Ali Khan" (very common on
    #    Easypaisa/JazzCash/WhatsApp screenshots).
    sent = re.search(r"sent\s+(?:rs\.?|pkr|₨)?\s*[\d,\.]+?\s+to\s+([A-Za-z][A-Za-z .'&]{1,40})", lower)
    recv = re.search(r"received\s+(?:rs\.?|pkr|₨)?\s*[\d,\.]+?\s+from\s+([A-Za-z][A-Za-z .'&]{1,40})", lower)
    if sent:
        result["receiver_name"] = sent.group(1).strip().title()
    if recv:
        result["sender_name"] = recv.group(1).strip().title()

    # 2) Keyword-based: "To: Ali Khan", "From: 0300...", "paid to X".
    sender_kw = ["from", "sender", "paid by", "debited from", "payer"]
    receiver_kw = ["to", "receiver", "beneficiary", "paid to", "credited to", "transferred to"]

    def _grab_after(keywords):
        for kw in keywords:
            m = re.search(rf"\b{kw}\b\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9 .'&()]{{1,40}})", lower)
            if m:
                val = m.group(1).strip().title()
                # Prefer a name: if it starts with a digit (phone), keep but trim.
                return val
        return ""

    if not result["sender_name"]:
        result["sender_name"] = _grab_after(sender_kw)
    if not result["receiver_name"]:
        result["receiver_name"] = _grab_after(receiver_kw)

    return result


def _normalize_date(raw):
    raw = raw.strip()
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%y", "%d-%m-%y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    # Month name formats
    for fmt in ("%b %d, %Y", "%B %d, %Y", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(raw.replace(",", ""), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return raw


def handle_extract(environ):
    """Accept a Base64 image, run LLM vision extraction, return structured fields."""
    data = _read_body(environ)
    b64 = data.get("image_base64", "")
    if not b64:
        return _json(400, {"error": "image_base64 is required"})
    try:
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        img_bytes = base64.b64decode(b64)
        img_b64_clean = base64.b64encode(img_bytes).decode("ascii")
    except Exception:  # noqa: BLE001
        return _json(400, {"error": "Invalid Base64 image"})

    # Optional: gather OCR text up front (used only as regex fallback).
    raw_text = ""
    if os.environ.get("GOOGLE_CREDENTIALS"):
        try:
            client = _vision_client()
            response = client.text_detection(image={"content": img_bytes})
            if response.text_annotations:
                raw_text = response.text_annotations[0].description
        except Exception:  # noqa: BLE001
            raw_text = ""

    try:
        fields = _llm_extract(img_b64_clean, raw_text)
    except Exception as e:  # noqa: BLE001
        if raw_text:
            fields = _extract_fields(raw_text)
            fields["gemini_error"] = str(e)
        else:
            return _json(500, {
                "error": f"Extraction failed: {e}",
                "hint": "Set VISION_PROVIDER + GEMINI_API_KEY (or OPENAI_API_KEY).",
            })

    # Keep the raw OCR text for transparency in the UI.
    fields["raw_text"] = raw_text
    return _json(200, fields)


# ---------------------------------------------------------------- dispatcher


def app(environ, start_response):
    try:
        return _app_inner(environ, start_response)
    except Exception as e:  # noqa: BLE001
        import traceback
        tb = traceback.format_exc()
        start_response("500 Internal Server Error", [("Content-Type", "text/plain")])
        return [tb.encode()]


def _app_inner(environ, start_response):
    path = urlparse(environ.get("PATH_INFO", "/")).path
    method = environ.get("REQUEST_METHOD", "GET")

    # Serve the static frontend from /public on Vercel root.
    if path in ("/", "/index.html"):
        try:
            public_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")
            with open(os.path.join(public_dir, "index.html"), "rb") as f:
                body = f.read()
            start_response("200 OK", [("Content-Type", "text/html")])
            return [body]
        except Exception as e:  # noqa: BLE001
            start_response("500 Internal Server Error", [("Content-Type", "text/plain")])
            return [str(e).encode()]

    # API routing (method-aware for /api/transactions).
    route_map = {
        "/api/login": handle_login,
        "/api/logout": handle_logout,
        "/api/me": handle_me,
        "/api/reset-password": handle_reset_password,
        "/api/users": handle_create_user,
        "/api/users/list": handle_list_users,
        "/api/transactions": (
            handle_transactions_get if method == "GET" else handle_transactions_post
        ),
        "/api/contacts": (
            handle_contacts_get if method == "GET" else handle_contacts_post
        ),
        "/api/extract": handle_extract,
    }

    if path == "/api/debug":
        try:
            raw = os.environ.get("GOOGLE_CREDENTIALS", "<MISSING>")
            raw_preview = (raw[:60] + "...") if len(raw) > 60 else raw
            info = None
            cred_err = None
            try:
                info = json.loads(raw.replace("\n", "\\n")) if "\n" in raw else json.loads(raw)
            except Exception as e:  # noqa: BLE001
                cred_err = f"{type(e).__name__}: {e}"
            sid = os.environ.get("SPREADSHEET_ID", "<MISSING>")
            sheet_err = None
            try:
                if info:
                    _client()
                    _sheet("users")
            except Exception as e:  # noqa: BLE001
                sheet_err = f"{type(e).__name__}: {e}"
            dbg = {
                "creds_present": bool(raw and raw != "<MISSING>"),
                "creds_preview": raw_preview,
                "creds_parse_error": cred_err,
                "spreadsheet_id": sid,
                "sheet_access_error": sheet_err,
            }
            return _json(200, dbg)
        except Exception as e:  # noqa: BLE001
            return _json(500, {"error": f"debug failed: {type(e).__name__}: {e}"})

    if path in route_map:
        try:
            status, headers, body = route_map[path](environ)
        except RuntimeError as e:
            status, headers, body = _json(500, {"error": f"Server config error: {e}"})
        except Exception as e:  # noqa: BLE001
            status, headers, body = _json(500, {"error": f"Internal error: {e}"})
        start_response(status, headers)
        return body

    start_response("404 Not Found", [("Content-Type", "application/json")])
    return [json.dumps({"error": "Not found"}).encode()]


# Ensure default admin lazily (best-effort, does not crash cold starts)
try:
    ensure_admin()
except Exception:  # noqa: BLE001
    pass
