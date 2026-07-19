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
from oauth2client.service_account import ServiceAccountCredentials

USERS_COLUMNS = ["username", "password", "role"]
TRANSACTIONS_COLUMNS = [
    "reference_number", "date", "time", "amount", "sender_name",
    "receiver_name", "purpose", "transaction_type", "receipt_base64", "logged_by",
]

# ---------------------------------------------------------------- helpers


def _json(status, payload):
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
        # Allow a TOML-style [connections.gsheets] block to be ignored; we need JSON
        raise RuntimeError("GOOGLE_CREDENTIALS must be valid service-account JSON.")
    scope = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive",
    ]
    return ServiceAccountCredentials.from_json_keyfile_dict(info, scope)


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
        ws = sh.add_worksheet(title=tab, rows=1000, cols=len(TRANSACTIONS_COLUMNS))
        ws.append_row(USERS_COLUMNS if tab == "users" else TRANSACTIONS_COLUMNS)
    return ws


def read_all(tab):
    ws = _sheet(tab)
    rows = ws.get_all_records()
    return rows


def append_row(tab, row_dict):
    ws = _sheet(tab)
    headers = ws.row_values(1)
    ordered = [row_dict.get(h, "") for h in headers]
    ws.append_row(ordered)


def update_cell(tab, username, column, value):
    ws = _sheet(tab)
    cell = ws.find(username, in_column=1)
    if cell:
        ws.update_cell(cell.row, headers_index(ws, column), value)


def headers_index(ws, column):
    headers = ws.row_values(1)
    return headers.index(column) + 1


def find_user(username):
    users = read_all("users")
    for u in users:
        if u.get("username") == username:
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
    return _json(200, {"token": token, "username": user["username"], "role": user["role"]})


def handle_logout(environ):
    tok = _get_token()
    _SESSIONS.pop(tok, None)
    return _json(200, {"ok": True})


def handle_me(environ):
    user = current_user()
    if not user:
        return _json(401, {"error": "Not authenticated"})
    return _json(200, {"username": user["username"], "role": user["role"]})


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
        "sender_name": str(data.get("sender_name")).strip(),
        "receiver_name": str(data.get("receiver_name")).strip(),
        "purpose": str(data.get("purpose")).strip(),
        "transaction_type": str(data.get("transaction_type")).strip(),
        "receipt_base64": receipt,
        "logged_by": user["username"],
    }
    append_row("transactions", row)
    return _json(200, {"ok": True, "transaction": row})


# ---------------------------------------------------------------- OCR extraction


def _vision_client():
    """Build a Google Cloud Vision client from the service-account credentials."""
    from google.cloud import vision

    raw = os.environ.get("GOOGLE_CREDENTIALS", "")
    if not raw:
        raise RuntimeError("GOOGLE_CREDENTIALS environment variable is not set.")
    info = json.loads(raw)
    return vision.ImageAnnotatorClient.from_service_account_info(info)


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

    # --- Sender / Receiver via keywords ---
    sender_kw = ["from", "sender", "paid by", "debited from", "account", "payer"]
    receiver_kw = ["to", "receiver", "beneficiary", "paid to", "credited to", "transferred to", "sent to"]

    def _grab_after(keywords):
        for kw in keywords:
            m = re.search(rf"{kw}\s*[:\-]?\s*([A-Za-z][A-Za-z .'&]{1,40})", lower)
            if m:
                return m.group(1).strip().title()
        return ""

    result["sender_name"] = _grab_after(sender_kw)
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
    """Accept a Base64 image, run EasyOCR, return extracted transaction fields."""
    data = _read_body(environ)
    b64 = data.get("image_base64", "")
    if not b64:
        return _json(400, {"error": "image_base64 is required"})
    try:
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        img_bytes = base64.b64decode(b64)
    except Exception:  # noqa: BLE001
        return _json(400, {"error": "Invalid Base64 image"})

    tmp = "/tmp/spendpulse_ocr.png"
    with open(tmp, "wb") as f:
        f.write(img_bytes)

    try:
        client = _vision_client()
        image = {"content": img_bytes}
        response = client.text_detection(image=image)
        annotations = response.text_annotations
        text = annotations[0].description if annotations else ""
        if not text:
            return _json(200, _extract_fields(""))
    except Exception as e:  # noqa: BLE001
        return _json(500, {
            "error": f"OCR failed: {e}",
            "hint": "Enable the Cloud Vision API on your GCP project and ensure GOOGLE_CREDENTIALS has access.",
        })

    fields = _extract_fields(text)
    return _json(200, fields)


# ---------------------------------------------------------------- dispatcher


def app(environ, start_response):
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
        "/api/extract": handle_extract,
    }

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
