import json
import os
import urllib.request
import re
import uuid
from datetime import datetime
import json
import os
import urllib.request
import re
import uuid
from datetime import datetime

try:
    import gspread
    from google.oauth2.service_account import Credentials
except ImportError:
    gspread = None
    Credentials = None

try:
    from google.cloud import vision
except ImportError:
    vision = None

# -------------------------------------------------------------------------
# UNIVERSAL BANK STATEMENT EXTRACTION ENGINE & BANK ADAPTER REGISTRY
# Supports any bank, any PDF format, variable layout & date formats cleanly.
# -------------------------------------------------------------------------
class UniversalBankParser:
    HEADER_VARIANTS = {
        'DATE': ['date', 'transaction date', 'value date', 'posting date', 'txn date', 'pst date', 'effective date', 'date / time'],
        'DESCRIPTION': ['description', 'particulars', 'transaction details', 'narration', 'remarks', 'detail', 'transaction particulars', 'description / ref'],
        'DEBIT': ['debit', 'withdrawal', 'withdrawals', 'dr', 'amount debited', 'paid out', 'debit (pkr)', 'outflow', 'withdrawal (pkr)'],
        'CREDIT': ['credit', 'deposit', 'deposits', 'cr', 'amount credited', 'paid in', 'credit (pkr)', 'inflow', 'deposit (pkr)'],
        'AMOUNT': ['amount', 'transaction amount', 'amt', 'amount (pkr)'],
        'BALANCE': ['balance', 'running balance', 'closing balance', 'available balance', 'balance (pkr)', 'curr bal'],
        'REFERENCE': ['cheq/inst#', 'instrument no', 'ref no', 'transaction ref', 'chq no', 'reference', 'trans ref', 'ref']
    }

    @staticmethod
    def detect_bank_name(raw_text):
        lower = raw_text.lower()
        if "alfalah" in lower: return "Bank Alfalah Limited"
        if "meezan" in lower: return "Meezan Bank Limited"
        if "hbl" in lower or "habib bank" in lower: return "Habib Bank Limited"
        if "ubl" in lower or "united bank" in lower: return "United Bank Limited"
        if "mcb" in lower: return "MCB Bank Limited"
        if "allied" in lower or "abl" in lower: return "Allied Bank Limited"
        if "easypaisa" in lower or "telenor" in lower: return "Easypaisa / Telenor Microfinance"
        if "jazzcash" in lower or "mobilink" in lower: return "JazzCash / Mobilink Microfinance"
        if "standard chartered" in lower: return "Standard Chartered Bank"
        if "faysal" in lower: return "Faysal Bank Limited"
        if "askari" in lower: return "Askari Bank Limited"
        if "bankislami" in lower: return "BankIslami Pakistan Limited"
        if "js bank" in lower: return "JS Bank Limited"
        return "Universal Bank Engine"

    @staticmethod
    def parse_universal_date(date_str):
        clean = date_str.strip()
        m1 = re.match(r'^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})$', clean)
        if m1:
            d, m, y = int(m1.group(1)), int(m1.group(2)), int(m1.group(3))
            if y < 100: y += 2000
            if 1 <= d <= 31 and 1 <= m <= 12:
                return f"{y:04d}-{m:02d}-{d:02d}", "VALID"
            elif 1 <= m <= 31 and 1 <= d <= 12:
                return f"{y:04d}-{d:02d}-{m:02d}", "VALID"

        m2 = re.match(r'^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})$', clean)
        if m2:
            y, m, d = int(m2.group(1)), int(m2.group(2)), int(m2.group(3))
            return f"{y:04d}-{m:02d}-{d:02d}", "VALID"

        m3 = re.match(r'^(\d{1,2})[-\/\s]([A-Za-z]{3})[-\/\s](\d{2,4})$', clean)
        if m3:
            try:
                dt = datetime.strptime(clean.replace('/', '-').replace(' ', '-'), "%d-%b-%Y" if len(m3.group(3))==4 else "%d-%b-%y")
                return dt.strftime("%Y-%m-%d"), "VALID"
            except Exception: pass

        return datetime.now().strftime("%Y-%m-%d"), "DATE_FORMAT_REVIEW_REQUIRED"

    @staticmethod
    def classify_transaction_type(description, credit=0.0):
        desc = description.upper()
        if "IBFT" in desc: return "IBFT"
        if "RAAST P2P" in desc or "RAAST" in desc: return "RAAST"
        if "ATM" in desc or "WITHDRAWAL" in desc: return "ATM_WITHDRAWAL"
        if "POS" in desc or "MASTERCARD" in desc or "VISA" in desc: return "CARD_PAYMENT"
        if "CHEQUE" in desc or "CHQ" in desc: return "CHEQUE"
        if "BILL" in desc or "UTILITY" in desc or "LESCO" in desc or "SNGPL" in desc: return "UTILITY_PAYMENT"
        if "FEE" in desc or "CHARGE" in desc or "COMMISSION" in desc: return "FEE"
        if "TAX" in desc or "WHT" in desc or "FED" in desc: return "TAX"
        if "SALARY" in desc or "PAYROLL" in desc: return "SALARY"
        if "FUNDS TRANSFER" in desc or "FT" in desc: return "BANK_TRANSFER"
        if credit > 0: return "CASH_DEPOSIT"
        return "TRANSFER"

class BankAdapterRegistry:
    _adapters = {}

    @classmethod
    def register(cls, bank_name, adapter_class):
        cls._adapters[bank_name.lower()] = adapter_class

    @classmethod
    def get_adapter(cls, bank_name):
        return cls._adapters.get(bank_name.lower(), UniversalBankParser)

def _json(status, payload):
    body = json.dumps(payload, default=str).encode("utf-8")
    status_str = "200 OK" if status == 200 else ("400 Bad Request" if status == 400 else "403 Forbidden" if status == 403 else "404 Not Found" if status == 404 else "500 Internal Server Error")
    return (status_str, [("Content-Type", "application/json"), ("Access-Control-Allow-Origin", "*"), ("Content-Length", str(len(body)))], [body])

def get_google_sheet_client():
    raw = os.environ.get("GOOGLE_CREDENTIALS", "")
    sid = os.environ.get("SPREADSHEET_ID", "")
    if not raw or not sid:
        raise RuntimeError("Missing GOOGLE_CREDENTIALS or SPREADSHEET_ID")
    info = json.loads(raw.replace("\n", "\\n")) if "\n" in raw else json.loads(raw)
    scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
    creds = Credentials.from_service_account_info(info, scopes=scope)
    client = gspread.authorize(creds)
    try:
        sh = client.open_by_key(sid)
    except Exception:
        sh = client.open_by_url(sid)
    return sh, sid

def get_google_sheet_tabs():
    sh, sid = get_google_sheet_client()
    
    # 1. Transactions Worksheet
    try:
        ws_tx = sh.worksheet("transactions")
    except Exception:
        tx_headers = [
            "reference_number", "date", "time", "amount", "currency", 
            "sender_name", "sender_account", "receiver_name", "receiver_account", 
            "purpose", "transaction_type", "images_json", "logged_by", 
            "status", "progress_pct", "employee_id", "id", "debit", "credit",
            "source_page", "balance", "validation_status", "raw_text", 
            "statement_id", "pdf_filename", "possible_duplicate", "content_hash"
        ]
        ws_tx = sh.add_worksheet(title="transactions", rows=1000, cols=len(tx_headers))
        ws_tx.append_row(tx_headers)

    # Check and upgrade headers if existing sheet has old columns
    try:
        headers = ws_tx.row_values(1)
        needed = [
            "status", "progress_pct", "employee_id", "id", "debit", "credit",
            "source_page", "balance", "validation_status", "raw_text", 
            "statement_id", "pdf_filename", "possible_duplicate", "content_hash"
        ]
        for h in needed:
            if h not in headers:
                ws_tx.update_cell(1, len(headers) + 1, h)
                headers.append(h)
    except Exception as err:
        print("Header migration warning:", err)

    # 2. Users Worksheet
    try:
        ws_users = sh.worksheet("users")
    except Exception:
        u_headers = ["user_id", "username", "name", "pin_code", "password", "role", "created_at"]
        ws_users = sh.add_worksheet(title="users", rows=100, cols=len(u_headers))
        ws_users.append_row(u_headers)
        ws_users.append_row(["usr_admin", "admin", "System Admin", "1234", "admin123", "admin", datetime.now().strftime("%Y-%m-%d")])
        ws_users.append_row(["usr_emp1", "employee", "John Employee", "5555", "emp123", "employee", datetime.now().strftime("%Y-%m-%d")])

    # Ensure default admin & employee exist in users sheet if empty or missing
    try:
        u_rows = ws_users.get_all_values()
        if len(u_rows) <= 1:
            ws_users.append_row(["usr_admin", "admin", "System Admin", "1234", "admin123", "admin", datetime.now().strftime("%Y-%m-%d")])
            ws_users.append_row(["usr_emp1", "employee", "John Employee", "5555", "emp123", "employee", datetime.now().strftime("%Y-%m-%d")])
    except Exception as err:
        print("Users check warning:", err)

    return ws_tx, ws_users, sid

def get_documents_tab(sh):
    try:
        ws_docs = sh.worksheet("statement_documents")
    except Exception:
        doc_headers = [
            "document_id", "file_name", "bank_name", "upload_date", 
            "statement_start_date", "statement_end_date", "page_count", 
            "file_hash", "processing_status", "file_size", "transaction_count", "created_at"
        ]
        try:
            ws_docs = sh.add_worksheet(title="statement_documents", rows=500, cols=len(doc_headers))
            ws_docs.append_row(doc_headers)
        except Exception:
            ws_docs = sh.worksheet("statement_documents")
    return ws_docs

def get_comments_tab(sh):
    try:
        ws_comments = sh.worksheet("transaction_comments")
    except Exception:
        cmt_headers = [
            "comment_id", "transaction_id", "comment_text", "created_at", "updated_at", "created_by"
        ]
        try:
            ws_comments = sh.add_worksheet(title="transaction_comments", rows=1000, cols=len(cmt_headers))
            ws_comments.append_row(cmt_headers)
        except Exception:
            ws_comments = sh.worksheet("transaction_comments")
    return ws_comments

def parse_sheet_row_to_dict(r):
    r_id = r[16] if len(r) > 16 and r[16] else f"tx_{uuid.uuid4().hex[:6]}"
    r_emp_id = r[15] if len(r) > 15 and r[15] else ""
    r_logged = r[12] if len(r) > 12 and r[12] else ""
    r_status = r[13] if len(r) > 13 and r[13] else "Pending"
    r_progress = r[14] if len(r) > 14 and r[14] else "0%"
    r_imgs = r[11] if len(r) > 11 and r[11] else "[]"
    tx_type_str = r[10] if len(r) > 10 else "Payment"

    amt_val = 0.0
    try: amt_val = float(str(r[3]).replace(",", "").strip())
    except ValueError: amt_val = 0.0

    deb_val = 0.0
    cred_val = 0.0
    if len(r) > 17 and r[17] != "":
        try: deb_val = float(str(r[17]).replace(",", "").strip())
        except ValueError: deb_val = 0.0
    if len(r) > 18 and r[18] != "":
        try: cred_val = float(str(r[18]).replace(",", "").strip())
        except ValueError: cred_val = 0.0

    if deb_val == 0.0 and cred_val == 0.0 and amt_val > 0.0:
        if tx_type_str.lower() in ["credit", "deposit"]:
            cred_val = amt_val
        else:
            deb_val = amt_val

    src_page = r[19] if len(r) > 19 and r[19] else "1"
    bal_val = 0.0
    if len(r) > 20 and r[20] != "":
        try: bal_val = float(str(r[20]).replace(",", "").strip())
        except ValueError: bal_val = 0.0

    val_status = r[21] if len(r) > 21 and r[21] else "VALID"
    raw_txt = r[22] if len(r) > 22 else ""
    stmt_id = r[23] if len(r) > 23 else ""
    pdf_file = r[24] if len(r) > 24 else ""
    is_dup_str = r[25] if len(r) > 25 else "false"
    c_hash = r[26] if len(r) > 26 else ""

    return {
        "id": r_id,
        "reference_number": r[0] if len(r) > 0 else "",
        "date": r[1] if len(r) > 1 else "",
        "time": r[2] if len(r) > 2 else "",
        "amount": str(amt_val),
        "currency": r[4] if len(r) > 4 and r[4] else "PKR",
        "sender_name": r[5] if len(r) > 5 else "",
        "sender_account": r[6] if len(r) > 6 else "",
        "receiver_name": r[7] if len(r) > 7 else "",
        "receiver_account": r[8] if len(r) > 8 else "",
        "purpose": r[9] if len(r) > 9 else "",
        "transaction_type": tx_type_str,
        "images_json": r_imgs,
        "logged_by": r_logged,
        "status": r_status,
        "progress_pct": r_progress,
        "employee_id": r_emp_id,
        "debit": deb_val,
        "credit": cred_val,
        "source_page": src_page,
        "balance": bal_val,
        "validation_status": val_status,
        "raw_text": raw_txt,
        "statement_id": stmt_id,
        "pdf_filename": pdf_file,
        "possible_duplicate": is_dup_str.lower() == "true",
        "content_hash": c_hash
    }

def make_tx_fingerprint(t_date, t_desc, t_debit, t_credit, t_ref, t_bal):
    d = str(t_date or "").strip()
    desc = re.sub(r'[^a-z0-9]', '', str(t_desc or "").lower())
    try: deb = f"{float(str(t_debit or 0).replace(',', '')):.2f}"
    except ValueError: deb = "0.00"
    try: cred = f"{float(str(t_credit or 0).replace(',', '')):.2f}"
    except ValueError: cred = "0.00"
    try: bal = f"{float(str(t_bal or 0).replace(',', '')):.2f}"
    except ValueError: bal = "0.00"
    ref = str(t_ref or "").strip().lower()

    if ref and not ref.startswith("ref_") and not ref.startswith("auto-id") and not ref.startswith("tx_"):
        return f"{d}|{desc}|{deb}|{cred}|{ref}"
    else:
        return f"{d}|{desc}|{deb}|{cred}|{bal}"

def ocr_extract_fields(img_bytes):
    raw = os.environ.get("GOOGLE_CREDENTIALS", "")
    if not raw:
        return None
    try:
        info = json.loads(raw.replace("\n", "\\n")) if "\n" in raw else json.loads(raw)
        client = vision.ImageAnnotatorClient.from_service_account_info(info)
        response = client.text_detection(image={"content": img_bytes})
        if not response.text_annotations:
            return None
        text = response.text_annotations[0].description
    except Exception:
        return None

    data = {
        "date": "", "time": "", "amount": "", "currency": "PKR",
        "sender_name": "", "sender_account": "", "receiver_name": "",
        "receiver_account": "", "reference_number": "", "purpose": "Transfer",
        "transaction_type": "Payment"
    }

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        if "page " in line.lower() or "statement of account" in line.lower() or "page" in line.lower():
            continue
        amt_match = re.search(r'(?:PKR|RS|EUR|USD|\$)\s*([\d,]+(?:\.\d{2})?)', line, re.IGNORECASE) or \
                    re.search(r'\b([\d,]{3,}(?:\.\d{2})?)\b', line)
        if amt_match:
            cand = amt_match.group(1).replace(",", "")
            if cand not in ["2026", "2025", "2024", "180", "33", "1"] and len(cand) < 10:
                data["amount"] = cand
                break

    date_match = re.search(r'\b(\d{1,2}[-/\s](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2})[-/\s]\d{2,4})\b', text, re.IGNORECASE)
    if date_match:
        data["date"] = date_match.group(1)

    time_match = re.search(r'\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\b', text)
    if time_match:
        data["time"] = time_match.group(1)

    ref_match = re.search(r'(?:Ref|Reference|Txn|Transaction ID|TRX|ID)[:\s]*([A-Z0-9]{5,25})', text, re.IGNORECASE) or \
                re.search(r'\b(\d{10,20})\b', text)
    if ref_match:
        data["reference_number"] = ref_match.group(1)

    for i, line in enumerate(lines):
        if re.search(r'^\s*From\b', line, re.IGNORECASE) and i + 1 < len(lines):
            data["sender_name"] = lines[i+1]
        elif re.search(r'^\s*To\b', line, re.IGNORECASE) and i + 1 < len(lines):
            data["receiver_name"] = lines[i+1]

    return data

def call_gemini_rest(base64_data):
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
    prompt = """Extract date (YYYY-MM-DD), time (HH:MM AM/PM), amount (numeric), currency, sender_name, sender_account, receiver_name, receiver_account, reference_number, purpose. Return ONLY JSON."""
    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": "image/png", "data": base64_data}}
            ]
        }]
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode('utf-8')
            res_json = json.loads(res_body)
            text = res_json['candidates'][0]['content']['parts'][0]['text']
            text = text.replace('```json', '').replace('```', '').strip()
            return json.loads(text)
    except Exception:
        return None

def call_gemini_statement_table(base64_data, mime_type="image/png"):
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
    prompt = """This document is an official Bank Statement Of Account (e.g. Bank Alfalah, Meezan Bank, HBL, UBL, Allied Bank, JazzCash, Easypaisa, etc.).
Extract EVERY SINGLE transaction entry in the document across all pages into a JSON array of objects.

For each transaction entry, extract:
- "date": "YYYY-MM-DD" format (convert dates like "02-01-2026" or "14-Nov-2025" to "YYYY-MM-DD")
- "particulars": full description text including recipient name, recipient bank name, and account/mobile number
- "receiver_name": recipient person or entity name (e.g. "NAZEER ALLAH", "REHMAN ALI", "MUHAMMAD IMRAN", "NAVEED AKRAM", "ASIF RASHEED")
- "account_number": recipient mobile number or account/IBAN number if present (e.g. "03038436423", "0457300609374", "03224831985")
- "reference_number": instrument / cheque or reference number if present (e.g. "REP MAINT OFFICE", "PK80ALFH00760010", "FT IBALFA-RAAST", "FT260130BVLMQN7Y")
- "debit": numeric debit amount sent out (0 if credit/deposit)
- "credit": numeric credit amount received in (0 if debit/payment)
- "amount": numeric string of the transaction amount
- "transaction_type": "Payment" if debit > 0 else "Credit"

Return ONLY valid JSON in format: {"transactions": [...]}. Do not include markdown code block backticks."""
    
    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": mime_type, "data": base64_data}}
            ]
        }]
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode('utf-8')
            res_json = json.loads(res_body)
            text = res_json['candidates'][0]['content']['parts'][0]['text']
            text = text.replace('```json', '').replace('```', '').strip()
            data = json.loads(text)
            if isinstance(data, list):
                return {"transactions": data}
            return data
    except Exception as e:
        print("Gemini Statement extraction error:", e)
        return None

def app(environ, start_response):
    path = environ.get("PATH_INFO", "/")
    method = environ.get("REQUEST_METHOD", "GET")

    if method == "OPTIONS":
        status, headers, res = _json(200, {"status": "ok"})
        start_response(status, headers)
        return res

    # 1. Login Endpoint
    if path == "/api/login" and method == "POST":
        try:
            length = int(environ.get("CONTENT_LENGTH", "0"))
            body = environ["wsgi.input"].read(length)
            data = json.loads(body.decode("utf-8"))
            
            username = str(data.get("username", "")).strip().lower()
            pin_code = str(data.get("pin_code", "")).strip()
            password = str(data.get("password", "")).strip()

            if not username:
                status, headers, res = _json(400, {"error": "Username/ID is required"})
                start_response(status, headers)
                return res

            found_user = None

            if username == "admin" and (pin_code == "1234" or password in ["admin", "admin123", "1234"]):
                found_user = {
                    "user_id": "usr_admin",
                    "username": "admin",
                    "name": "System Admin",
                    "role": "admin",
                    "token": f"token_usr_admin_{uuid.uuid4().hex[:8]}"
                }
            elif username in ["employee", "employee1"] and (pin_code == "5555" or password in ["employee", "emp123", "5555"]):
                found_user = {
                    "user_id": "usr_emp1",
                    "username": "employee",
                    "name": "John Employee",
                    "role": "employee",
                    "token": f"token_usr_emp1_{uuid.uuid4().hex[:8]}"
                }

            if not found_user:
                try:
                    ws_tx, ws_users, sid = get_google_sheet_tabs()
                    user_rows = ws_users.get_all_values()

                    if len(user_rows) > 1:
                        for r in user_rows[1:]:
                            if not r or len(r) == 0:
                                continue
                            
                            u_id = r[0] if len(r) > 0 else f"usr_{uuid.uuid4().hex[:6]}"
                            u_uname = (r[1] if len(r) > 1 else r[0]).strip().lower()
                            u_name = r[2] if len(r) > 2 else u_uname
                            u_pin = r[3].strip() if len(r) > 3 else ""
                            u_pass = r[4].strip() if len(r) > 4 else (r[1].strip() if len(r) > 1 else "")
                            u_role = (r[5] if len(r) > 5 else (r[2] if len(r) > 2 else "employee")).strip().lower()

                            if username == u_uname or username == u_name.lower():
                                matched = False
                                if pin_code and (pin_code == u_pin or pin_code == u_pass):
                                    matched = True
                                if password and (password == u_pass or password == u_pin):
                                    matched = True
                                if not pin_code and not password:
                                    matched = True

                                if matched:
                                    found_user = {
                                        "user_id": u_id,
                                        "username": u_uname,
                                        "name": u_name,
                                        "role": u_role if u_role in ["admin", "employee"] else "employee",
                                        "token": f"token_{u_id}_{uuid.uuid4().hex[:8]}"
                                    }
                                    break
                except Exception as sheet_err:
                    print("Sheet search warning:", sheet_err)

            if found_user:
                status, headers, res = _json(200, found_user)
            else:
                status, headers, res = _json(400, {"error": "Invalid username or PIN code. Use 'admin' (PIN: 1234) or 'employee' (PIN: 5555)."})
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # 2. Get Users
    if path == "/api/users" and method == "GET":
        try:
            ws_tx, ws_users, sid = get_google_sheet_tabs()
            rows = ws_users.get_all_values()
            users = []
            if len(rows) > 1:
                for r in rows[1:]:
                    if not r or len(r) == 0:
                        continue
                    u_id = r[0] if len(r) > 0 else ""
                    u_uname = r[1] if len(r) > 1 else ""
                    u_name = r[2] if len(r) > 2 else u_uname
                    u_pin = r[3] if len(r) > 3 else "1234"
                    u_pass = r[4] if len(r) > 4 else "pass123"
                    u_role = r[5] if len(r) > 5 else "employee"

                    if u_uname:
                        users.append({
                            "user_id": u_id,
                            "username": u_uname,
                            "name": u_name,
                            "pin_code": u_pin,
                            "password": u_pass,
                            "role": u_role
                        })

            if len(users) == 0:
                users = [
                    {"user_id": "usr_admin", "username": "admin", "name": "System Admin", "pin_code": "1234", "password": "admin123", "role": "admin"},
                    {"user_id": "usr_emp1", "username": "employee", "name": "John Employee", "pin_code": "5555", "password": "emp123", "role": "employee"}
                ]

            status, headers, res = _json(200, {"users": users})
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # 3. Create User
    if path == "/api/users" and method == "POST":
        try:
            length = int(environ.get("CONTENT_LENGTH", "0"))
            body = environ["wsgi.input"].read(length)
            data = json.loads(body.decode("utf-8"))

            uname = str(data.get("username", "")).strip().lower()
            name = str(data.get("name", "")).strip()
            pin = str(data.get("pin_code", "")).strip()
            pwd = str(data.get("password", "")).strip()
            role = str(data.get("role", "employee")).strip().lower()

            if not uname or not name or not pin:
                status, headers, res = _json(400, {"error": "Username, Full Name, and PIN code are required."})
                start_response(status, headers)
                return res

            u_id = f"usr_{uuid.uuid4().hex[:8]}"
            ws_tx, ws_users, sid = get_google_sheet_tabs()
            ws_users.append_row([u_id, uname, name, pin, pwd or "123456", role, datetime.now().strftime("%Y-%m-%d")])

            status, headers, res = _json(200, {"message": "User created successfully", "user_id": u_id, "username": uname})
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # Delete User
    if path == "/api/delete-user" and method == "POST":
        try:
            length = int(environ.get("CONTENT_LENGTH", "0"))
            body = environ["wsgi.input"].read(length)
            data = json.loads(body.decode("utf-8"))

            target_id = str(data.get("user_id", "")).strip()
            ws_tx, ws_users, sid = get_google_sheet_tabs()
            rows = ws_users.get_all_values()

            deleted = False
            if len(rows) > 1:
                for idx, r in enumerate(rows[1:], start=2):
                    if r[0] == target_id or r[1].lower() == target_id.lower():
                        ws_users.delete_row(idx)
                        deleted = True
                        break

            if deleted:
                status, headers, res = _json(200, {"message": "Employee deleted successfully"})
            else:
                status, headers, res = _json(400, {"error": "User not found"})
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # Delete Transaction / Record (Admin Only) - Searches all row columns
    if path == "/api/delete-transaction" and method == "POST":
        try:
            length = int(environ.get("CONTENT_LENGTH", "0"))
            body = environ["wsgi.input"].read(length)
            data = json.loads(body.decode("utf-8"))

            target_id = str(data.get("transaction_id") or data.get("id") or "").strip()
            if not target_id:
                status, headers, res = _json(400, {"error": "transaction_id is required."})
                start_response(status, headers)
                return res

            ws_tx, ws_users, sid = get_google_sheet_tabs()
            rows = ws_tx.get_all_values()

            deleted = False
            if len(rows) > 1:
                for idx, r in enumerate(rows[1:], start=2):
                    row_vals = [str(v).strip() for v in r]
                    if target_id in row_vals:
                        ws_tx.delete_row(idx)
                        deleted = True
                        break

            if deleted:
                status, headers, res = _json(200, {"message": "Transaction deleted successfully."})
            else:
                status, headers, res = _json(400, {"error": f"Transaction ID '{target_id}' not found."})
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # Cleanup Statement Dumps or Wipe All Transactions
    if path == "/api/cleanup-statement-dumps" and method == "POST":
        try:
            length = int(environ.get("CONTENT_LENGTH", "0") or "0")
            body = environ["wsgi.input"].read(length) if length > 0 else b"{}"
            req_data = json.loads(body.decode("utf-8")) if body else {}
            wipe_all = req_data.get("wipe_all", False)

            ws_tx, ws_users, sid = get_google_sheet_tabs()
            rows = ws_tx.get_all_values()

            tx_headers = [
                "reference_number", "date", "time", "amount", "currency", 
                "sender_name", "sender_account", "receiver_name", "receiver_account", 
                "purpose", "transaction_type", "images_json", "logged_by", 
                "status", "progress_pct", "employee_id", "id", "debit", "credit",
                "source_page", "balance", "validation_status", "raw_text", 
                "statement_id", "pdf_filename", "possible_duplicate", "content_hash"
            ]

            deleted_count = 0
            if wipe_all:
                deleted_count = max(0, len(rows) - 1)
                header_row = rows[0] if (len(rows) > 0 and len(rows[0]) > 0) else tx_headers
                ws_tx.clear()
                ws_tx.append_row(header_row)
            else:
                JUNK_PATTERNS = [
                    "statement of account", "page of date description", "raiwind road branch",
                    "cheq/inst", "date description", "opening balance", "closing balance",
                    "ibft from fast engineering solutions"
                ]
                JUNK_AMOUNTS = ["33", "180", "2026", "2025", "2024", "1", "0", "0.0", "0.00"]

                keep_rows = [rows[0]] if len(rows) > 0 else [tx_headers]
                for idx in range(1, len(rows)):
                    r = rows[idx]
                    if not r or len(r) == 0:
                        deleted_count += 1
                        continue
                    full_str = " ".join([str(x) for x in r]).lower()
                    amt_col = str(r[3]).replace(",", "").strip() if len(r) > 3 else "0"
                    
                    try:
                        amt_val = float(amt_col) if amt_col else 0.0
                    except ValueError:
                        amt_val = 0.0

                    is_junk = (
                        any(p in full_str for p in JUNK_PATTERNS)
                        or amt_col in JUNK_AMOUNTS
                        or amt_val == 0.0
                    )
                    if is_junk:
                        deleted_count += 1
                    else:
                        keep_rows.append(r)

                if deleted_count > 0:
                    ws_tx.clear()
                    ws_tx.append_rows(keep_rows)

            status, headers, res = _json(200, {
                "message": f"Successfully deleted {deleted_count} transaction records.",
                "deleted_count": deleted_count
            })
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # 4. Get Dashboard Stats
    if path == "/api/dashboard-stats" and method == "GET":
        try:
            ws_tx, ws_users, sid = get_google_sheet_tabs()
            tx_rows = ws_tx.get_all_values()
            u_rows = ws_users.get_all_values()

            total_employees = max(1, len(u_rows) - 1)
            active_tasks = 0
            completed_tasks = 0
            in_progress_tasks = 0
            pending_payments = 0
            payments_sent = 0
            payments_completed = 0
            total_spend_amount = 0.0

            if len(tx_rows) > 1:
                for r in tx_rows[1:]:
                    if len(r) < 4:
                        continue
                    amt_str = str(r[3]).replace(",", "").strip()
                    try:
                        amt_val = float(amt_str) if amt_str else 0.0
                    except ValueError:
                        amt_val = 0.0
                    total_spend_amount += amt_val

                    st = str(r[13]).strip() if len(r) > 13 and r[13] else "Pending"
                    if st == "Pending":
                        pending_payments += 1
                        active_tasks += 1
                    elif st == "Processing":
                        in_progress_tasks += 1
                        active_tasks += 1
                    elif st == "Payment Sent":
                        payments_sent += 1
                    elif st == "Completed":
                        completed_tasks += 1
                        payments_completed += 1

            status, headers, res = _json(200, {
                "total_employees": total_employees,
                "active_tasks": active_tasks,
                "completed_tasks": completed_tasks,
                "in_progress_tasks": in_progress_tasks,
                "pending_payments": pending_payments,
                "payments_sent": payments_sent,
                "payments_completed": payments_completed,
                "total_spend_amount": round(total_spend_amount, 2)
            })
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # 5. Get Transactions List (Returns Debit/Credit fields & Statement metadata)
    if path == "/api/transactions" and method == "GET":
        try:
            query_str = environ.get("QUERY_STRING", "")
            params = dict(urllib.parse.parse_qsl(query_str))
            role = params.get("role", "admin").lower()
            emp_id = params.get("employee_id", "")
            emp_name = params.get("user_name", "")

            ws_tx, ws_users, sid = get_google_sheet_tabs()
            rows = ws_tx.get_all_values()
            tx_list = []

            if len(rows) > 1:
                for r in rows[1:]:
                    if len(r) < 4:
                        continue
                    item = parse_sheet_row_to_dict(r)
                    if role == "employee":
                        if emp_id and item.get("employee_id") and emp_id == item.get("employee_id"):
                            tx_list.append(item)
                        elif emp_name and (emp_name.lower() in item.get("logged_by", "").lower() or emp_name.lower() in item.get("sender_name", "").lower() or emp_name.lower() in item.get("receiver_name", "").lower()):
                            tx_list.append(item)
                        elif not emp_id and not emp_name:
                            tx_list.append(item)
                    else:
                        tx_list.append(item)

            status, headers, res = _json(200, {"transactions": tx_list})
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # 6. Update Status & Progress
    if path == "/api/update-status" and method == "POST":
        try:
            length = int(environ.get("CONTENT_LENGTH", "0"))
            body = environ["wsgi.input"].read(length)
            data = json.loads(body.decode("utf-8"))

            tx_id = data.get("transaction_id", "")
            new_status = data.get("status", "Pending")
            new_progress = data.get("progress_pct", "0%")
            assign_emp = data.get("employee_id", "")

            ws_tx, ws_users, sid = get_google_sheet_tabs()
            rows = ws_tx.get_all_values()

            updated = False
            if len(rows) > 1:
                for idx, r in enumerate(rows[1:], start=2):
                    row_vals = [str(v).strip() for v in r]
                    if tx_id in row_vals:
                        ws_tx.update_cell(idx, 14, new_status)
                        ws_tx.update_cell(idx, 15, new_progress)
                        if assign_emp:
                            ws_tx.update_cell(idx, 16, assign_emp)
                        updated = True
                        break

            if updated:
                status, headers, res = _json(200, {"message": "Status updated successfully"})
            else:
                status, headers, res = _json(400, {"error": "Transaction ID not found."})
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # 7. Scan & Multi-Image Upload Endpoint
    if path == "/api/scan" and method == "POST":
        try:
            length = int(environ.get("CONTENT_LENGTH", "0"))
            body = environ["wsgi.input"].read(length)
            data = json.loads(body.decode("utf-8"))
            
            b64_list = data.get("images_base64") or []
            if not b64_list and data.get("image_base64"):
                b64_list = [data.get("image_base64")]
            
            extracted = data.get("extracted_data") or {}
            
            primary_b64 = b64_list[0] if b64_list else ""
            if primary_b64 and (not extracted.get("sender_name") or not extracted.get("receiver_name")):
                import base64 as b64_mod
                try:
                    raw_bytes = b64_mod.b64decode(primary_b64.split(",")[1] if "," in primary_b64 else primary_b64)
                    gem_data = call_gemini_rest(primary_b64.split(",")[1] if "," in primary_b64 else primary_b64)
                    if gem_data:
                        for k, v in gem_data.items():
                            if v and not extracted.get(k):
                                extracted[k] = v
                    ocr_data = ocr_extract_fields(raw_bytes)
                    if ocr_data:
                        for k, v in ocr_data.items():
                            if v and not extracted.get(k):
                                extracted[k] = v
                except Exception as ex:
                    print("OCR error:", ex)

            if not extracted.get("date"):
                extracted["date"] = datetime.now().strftime("%Y-%m-%d")
            if not extracted.get("time"):
                extracted["time"] = datetime.now().strftime("%I:%M %p")

            tx_id = f"tx_{uuid.uuid4().hex[:8]}"
            images_json = json.dumps([b[:150] + "..." for b in b64_list])
            logged_by = data.get("logged_by") or "App User"
            emp_id = data.get("employee_id") or ""
            initial_status = data.get("status") or "Pending"
            initial_progress = data.get("progress_pct") or "0%"

            row = [
                extracted.get("reference_number", ""),
                extracted.get("date", ""),
                extracted.get("time", ""),
                extracted.get("amount", ""),
                extracted.get("currency", "PKR"),
                extracted.get("sender_name", ""),
                extracted.get("sender_account", ""),
                extracted.get("receiver_name", ""),
                extracted.get("receiver_account", ""),
                extracted.get("purpose", ""),
                extracted.get("transaction_type", "Payment"),
                images_json,
                logged_by,
                initial_status,
                initial_progress,
                emp_id,
                tx_id,
                extracted.get("debit", extracted.get("amount", "0")),
                extracted.get("credit", "0"),
                "1",
                "0.0",
                "VALID",
                "",
                f"stmt_{uuid.uuid4().hex[:8]}",
                "scan_upload",
                "false",
                f"hash_{uuid.uuid4().hex[:8]}"
            ]
            
            force_save = data.get("force_save", False)
            ws_tx, ws_users, sid = get_google_sheet_tabs()
            sheet_url = f"https://docs.google.com/spreadsheets/d/{sid}"
            extracted["sheet_url"] = sheet_url
            extracted["id"] = tx_id
            extracted["status"] = initial_status
            extracted["progress_pct"] = initial_progress

            ws_tx.append_row(row)
            extracted["is_duplicate"] = False
            extracted["saved"] = True

            status, headers, res = _json(200, extracted)
            start_response(status, headers)
            return res
            
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # 8. Bulk Statement Upload Endpoint (Full Schema Preservation + Context-Aware Deduplication)
    if path == "/api/bulk-upload-statement" and method == "POST":
        try:
            length = int(environ.get("CONTENT_LENGTH", "0"))
            body = environ["wsgi.input"].read(length)
            data = json.loads(body.decode("utf-8"))

            items = data.get("transactions") or []
            if not items:
                status, headers, res = _json(400, {"error": "No statement transaction items provided."})
                start_response(status, headers)
                return res

            ws_tx, ws_users, sid = get_google_sheet_tabs()
            existing_rows = ws_tx.get_all_values()

            existing_fps = set()

            if len(existing_rows) > 1:
                for r in existing_rows[1:]:
                    r_date = r[1] if len(r) > 1 else ""
                    r_desc = r[9] if (len(r) > 9 and r[9]) else (r[7] if len(r) > 7 else "")
                    r_deb = r[17] if len(r) > 17 else "0"
                    r_cred = r[18] if len(r) > 18 else "0"
                    r_ref = r[0] if len(r) > 0 else ""
                    r_bal = r[20] if len(r) > 20 else "0"

                    fp = make_tx_fingerprint(r_date, r_desc, r_deb, r_cred, r_ref, r_bal)
                    existing_fps.add(fp)
                    if len(r) > 26 and r[26]:
                        existing_fps.add(str(r[26]).strip())

            new_rows_to_append = []
            added_count = 0
            skipped_count = 0

            statement_id = data.get("statement_id") or f"stmt_{uuid.uuid4().hex[:8]}"
            pdf_filename = data.get("pdf_filename") or "statement.pdf"

            for item in items:
                ref_num = str(item.get("reference_number") or item.get("id") or f"ref_{uuid.uuid4().hex[:7]}").strip()
                item_date = str(item.get("date") or datetime.now().strftime("%Y-%m-%d")).strip()
                item_time = str(item.get("time") or datetime.now().strftime("%I:%M %p")).strip()
                
                debit_val = float(item.get("debit") or 0)
                credit_val = float(item.get("credit") or 0)
                bal_val = float(item.get("balance") or 0)
                amt_val = credit_val if credit_val > 0 else debit_val
                if amt_val == 0:
                    try: amt_val = float(str(item.get("amount") or 0).replace(",", ""))
                    except ValueError: amt_val = 0.0

                val_status = str(item.get("validation_status") or "VALID").strip()
                source_page = str(item.get("source_page") or "1").strip()
                raw_text = str(item.get("raw_text") or "").strip()
                is_possible_dup = item.get("possible_duplicate", False) or item.get("is_duplicate", False)

                amt_str = str(amt_val)
                curr = str(item.get("currency") or "PKR").strip()
                sender = str(item.get("sender_name") or "").strip()
                receiver = str(item.get("receiver_name") or item.get("particulars") or "").strip()
                purpose = str(item.get("purpose") or item.get("particulars") or "Bank Statement Import").strip()
                tx_type = str(item.get("transaction_type") or ("Credit" if credit_val > 0 else "Payment")).strip()
                tx_id = f"tx_{uuid.uuid4().hex[:8]}"

                item_fp = make_tx_fingerprint(
                    item_date,
                    purpose or receiver,
                    debit_val,
                    credit_val,
                    ref_num,
                    bal_val
                )

                if item_fp in existing_fps:
                    skipped_count += 1
                    continue

                row = [
                    ref_num,
                    item_date,
                    item_time,
                    amt_str,
                    curr,
                    sender,
                    "",
                    receiver,
                    item.get("account_number", ""),
                    purpose,
                    tx_type,
                    "[]",
                    data.get("logged_by") or "Bank Statement Importer",
                    "Completed",
                    "100%",
                    "",
                    tx_id,
                    str(debit_val),
                    str(credit_val),
                    source_page,
                    str(bal_val),
                    val_status,
                    raw_text,
                    statement_id,
                    pdf_filename,
                    "true" if is_possible_dup else "false",
                    item_fp
                ]

                new_rows_to_append.append(row)
                existing_fps.add(item_fp)
                added_count += 1

            if new_rows_to_append:
                ws_tx.append_rows(new_rows_to_append)

            # If document metadata list was sent, persist to statement_documents tab as well
            try:
                docs_payload = data.get("documents") or []
                if not docs_payload and data.get("document_metadata"):
                    docs_payload = [data.get("document_metadata")]
                elif not docs_payload and data.get("pdf_filename"):
                    docs_payload = [{
                        "document_id": statement_id,
                        "file_name": pdf_filename,
                        "bank_name": data.get("bank_name") or "Universal Bank",
                        "upload_date": datetime.now().strftime("%Y-%m-%d"),
                        "statement_start_date": data.get("statement_start_date") or "",
                        "statement_end_date": data.get("statement_end_date") or "",
                        "page_count": data.get("pages_processed") or 1,
                        "file_hash": data.get("file_hash") or "",
                        "processing_status": "Completed",
                        "file_size": data.get("file_size") or 0,
                        "transaction_count": added_count,
                        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M")
                    }]
                
                if docs_payload:
                    sh, _ = get_google_sheet_client()
                    ws_docs = get_documents_tab(sh)
                    existing_doc_rows = ws_docs.get_all_values()
                    existing_doc_ids = {r[0]: idx for idx, r in enumerate(existing_doc_rows)}
                    doc_rows_to_append = []
                    for d_item in docs_payload:
                        d_id = str(d_item.get("document_id") or statement_id)
                        if d_id not in existing_doc_ids:
                            doc_rows_to_append.append([
                                d_id,
                                str(d_item.get("file_name") or pdf_filename),
                                str(d_item.get("bank_name") or "Universal Bank"),
                                str(d_item.get("upload_date") or datetime.now().strftime("%Y-%m-%d")),
                                str(d_item.get("statement_start_date") or ""),
                                str(d_item.get("statement_end_date") or ""),
                                str(d_item.get("page_count") or data.get("pages_processed") or 1),
                                str(d_item.get("file_hash") or ""),
                                str(d_item.get("processing_status") or "Completed"),
                                str(d_item.get("file_size") or 0),
                                str(d_item.get("transaction_count") or added_count),
                                str(d_item.get("created_at") or datetime.now().strftime("%Y-%m-%d %H:%M"))
                            ])
                    if doc_rows_to_append:
                        ws_docs.append_rows(doc_rows_to_append)
            except Exception as doc_err:
                print("Statement document record error:", doc_err)

            status, headers, res = _json(200, {
                "status": "success",
                "message": f"Successfully imported {added_count} new transactions ({skipped_count} exact duplicates skipped).",
                "pages_processed": data.get("pages_processed") or 1,
                "total_detected": len(items),
                "new_imported": added_count,
                "duplicates_skipped": skipped_count,
                "review_required": data.get("review_count") or 0,
                "validation_errors": 0
            })
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # 8B. Get All Statement Documents Endpoint
    if path == "/api/documents" and method == "GET":
        try:
            sh, sid = get_google_sheet_client()
            ws_docs = get_documents_tab(sh)
            rows = ws_docs.get_all_values()
            docs = []
            if len(rows) > 1:
                for r in rows[1:]:
                    if not r or len(r) == 0: continue
                    docs.append({
                        "document_id": r[0] if len(r) > 0 else "",
                        "file_name": r[1] if len(r) > 1 else "",
                        "bank_name": r[2] if len(r) > 2 else "",
                        "upload_date": r[3] if len(r) > 3 else "",
                        "statement_start_date": r[4] if len(r) > 4 else "",
                        "statement_end_date": r[5] if len(r) > 5 else "",
                        "page_count": int(r[6]) if len(r) > 6 and str(r[6]).isdigit() else 1,
                        "file_hash": r[7] if len(r) > 7 else "",
                        "processing_status": r[8] if len(r) > 8 else "Completed",
                        "file_size": int(r[9]) if len(r) > 9 and str(r[9]).isdigit() else 0,
                        "transaction_count": int(r[10]) if len(r) > 10 and str(r[10]).isdigit() else 0,
                        "created_at": r[11] if len(r) > 11 else ""
                    })
            status, headers, res = _json(200, {"documents": docs})
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # 8C. Save Statement Document Metadata Endpoint
    if path == "/api/documents" and method == "POST":
        try:
            length = int(environ.get("CONTENT_LENGTH", "0"))
            body = environ["wsgi.input"].read(length)
            data = json.loads(body.decode("utf-8"))
            
            doc_list = data.get("documents") or ([data] if data.get("file_name") else [])
            sh, sid = get_google_sheet_client()
            ws_docs = get_documents_tab(sh)
            existing_rows = ws_docs.get_all_values()
            existing_ids = {r[0]: idx for idx, r in enumerate(existing_rows)}

            added_docs = []
            new_rows = []

            for doc in doc_list:
                doc_id = str(doc.get("document_id") or f"doc_{uuid.uuid4().hex[:8]}")
                file_name = str(doc.get("file_name") or "statement.pdf")
                bank_name = str(doc.get("bank_name") or "Universal Bank")
                upload_date = str(doc.get("upload_date") or datetime.now().strftime("%Y-%m-%d"))
                start_date = str(doc.get("statement_start_date") or "")
                end_date = str(doc.get("statement_end_date") or "")
                page_count = str(doc.get("page_count") or 1)
                file_hash = str(doc.get("file_hash") or "")
                status_str = str(doc.get("processing_status") or "Completed")
                file_size = str(doc.get("file_size") or 0)
                tx_count = str(doc.get("transaction_count") or 0)
                created_at = str(doc.get("created_at") or datetime.now().strftime("%Y-%m-%d %H:%M"))

                if doc_id not in existing_ids:
                    row = [doc_id, file_name, bank_name, upload_date, start_date, end_date, page_count, file_hash, status_str, file_size, tx_count, created_at]
                    new_rows.append(row)
                    added_docs.append(doc_id)

            if new_rows:
                ws_docs.append_rows(new_rows)

            status, headers, res = _json(200, {"message": f"Saved {len(added_docs)} documents", "added_ids": added_docs})
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # 8D. Get Comments Endpoint (Transaction-specific comments)
    if path == "/api/comments" and method == "GET":
        try:
            query_str = environ.get("QUERY_STRING", "")
            params = dict(urllib.parse.parse_qsl(query_str))
            target_tx_id = params.get("transaction_id", "").strip()

            sh, sid = get_google_sheet_client()
            ws_comments = get_comments_tab(sh)
            rows = ws_comments.get_all_values()
            comments = []
            if len(rows) > 1:
                for r in rows[1:]:
                    if not r or len(r) == 0: continue
                    c_id = r[0] if len(r) > 0 else ""
                    tx_id = r[1] if len(r) > 1 else ""
                    c_text = r[2] if len(r) > 2 else ""
                    c_created = r[3] if len(r) > 3 else ""
                    c_updated = r[4] if len(r) > 4 else ""
                    c_by = r[5] if len(r) > 5 else "System Admin"

                    if target_tx_id and tx_id != target_tx_id:
                        continue

                    comments.append({
                        "comment_id": c_id,
                        "transaction_id": tx_id,
                        "comment_text": c_text,
                        "created_at": c_created,
                        "updated_at": c_updated,
                        "created_by": c_by
                    })
            status, headers, res = _json(200, {"comments": comments})
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # 8E. Add or Update Comment Endpoint
    if path == "/api/comments" and method == "POST":
        try:
            length = int(environ.get("CONTENT_LENGTH", "0"))
            body = environ["wsgi.input"].read(length)
            data = json.loads(body.decode("utf-8"))

            comment_id = str(data.get("comment_id") or "").strip()
            transaction_id = str(data.get("transaction_id") or "").strip()
            comment_text = str(data.get("comment_text") or "").strip()
            created_by = str(data.get("created_by") or "System Admin").strip()
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

            if not transaction_id or not comment_text:
                status, headers, res = _json(400, {"error": "transaction_id and comment_text are required."})
                start_response(status, headers)
                return res

            sh, sid = get_google_sheet_client()
            ws_comments = get_comments_tab(sh)
            rows = ws_comments.get_all_values()

            updated = False
            saved_id = comment_id
            if comment_id and len(rows) > 1:
                for idx, r in enumerate(rows[1:], start=2):
                    if len(r) > 0 and r[0] == comment_id:
                        ws_comments.update_cell(idx, 3, comment_text)
                        ws_comments.update_cell(idx, 5, now_str)
                        updated = True
                        break

            if not updated:
                saved_id = f"cmt_{uuid.uuid4().hex[:8]}"
                ws_comments.append_row([saved_id, transaction_id, comment_text, now_str, now_str, created_by])

            status, headers, res = _json(200, {
                "message": "Comment saved successfully",
                "comment": {
                    "comment_id": saved_id,
                    "transaction_id": transaction_id,
                    "comment_text": comment_text,
                    "created_at": now_str,
                    "updated_at": now_str,
                    "created_by": created_by
                }
            })
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # 8F. Delete Comment Endpoint
    if path == "/api/delete-comment" and method == "POST":
        try:
            length = int(environ.get("CONTENT_LENGTH", "0"))
            body = environ["wsgi.input"].read(length)
            data = json.loads(body.decode("utf-8"))

            target_id = str(data.get("comment_id") or "").strip()
            if not target_id:
                status, headers, res = _json(400, {"error": "comment_id is required."})
                start_response(status, headers)
                return res

            sh, sid = get_google_sheet_client()
            ws_comments = get_comments_tab(sh)
            rows = ws_comments.get_all_values()

            deleted = False
            if len(rows) > 1:
                for idx, r in enumerate(rows[1:], start=2):
                    if len(r) > 0 and r[0] == target_id:
                        ws_comments.delete_row(idx)
                        deleted = True
                        break

            if deleted:
                status, headers, res = _json(200, {"message": "Comment deleted successfully."})
            else:
                status, headers, res = _json(400, {"error": "Comment not found."})
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res


    # 9. AI Statement Query & Database-First Financial Calculations Endpoint
    if path == "/api/query-statement" and method == "POST":
        try:
            length = int(environ.get("CONTENT_LENGTH", "0"))
            body = environ["wsgi.input"].read(length)
            data = json.loads(body.decode("utf-8"))

            user_query = str(data.get("query") or "").strip()
            person_query = str(data.get("person") or "").strip().upper()
            month_query = str(data.get("month") or "").strip()
            date_from_str = str(data.get("date_from") or "").strip()
            date_to_str = str(data.get("date_to") or "").strip()
            tx_type_filter = str(data.get("tx_type") or "").strip().lower()

            ws_tx, ws_users, sid = get_google_sheet_tabs()
            rows = ws_tx.get_all_values()

            tx_list = []
            if len(rows) > 1:
                for r in rows[1:]:
                    if len(r) < 4:
                        continue
                    tx_list.append(parse_sheet_row_to_dict(r))

            exact_matches = []
            possible_matches = []
            
            total_debit = 0.0
            total_credit = 0.0
            debits_list = []
            credits_list = []
            dates_list = []

            for t in tx_list:
                t_date = t.get("date", "")
                
                # Date filters
                if date_from_str and t_date and t_date < date_from_str:
                    continue
                if date_to_str and t_date and t_date > date_to_str:
                    continue
                if month_query and month_query != "all" and t_date:
                    if not t_date.startswith(month_query):
                        continue

                # Type filter
                deb_val = t.get("debit", 0.0)
                cred_val = t.get("credit", 0.0)
                if tx_type_filter == "debit" and deb_val <= 0:
                    continue
                if tx_type_filter == "credit" and cred_val <= 0:
                    continue

                receiver_upper = (t.get("receiver_name") or "").upper()
                sender_upper = (t.get("sender_name") or "").upper()
                purpose_upper = (t.get("purpose") or "").upper()
                raw_upper = (t.get("raw_text") or "").upper()
                haystack = f"{receiver_upper} {sender_upper} {purpose_upper} {raw_upper}"

                if person_query:
                    if person_query == receiver_upper or person_query == sender_upper:
                        exact_matches.append(t)
                    elif person_query in haystack:
                        possible_matches.append(t)
                    else:
                        continue
                elif user_query:
                    clean_q = re.sub(r'[^\w\s]', ' ', user_query.upper())
                    tokens = [tok for tok in clean_q.split() if len(tok) > 2 and tok.lower() not in ["show", "me", "all", "payments", "made", "to", "from", "in", "the", "for", "total", "what", "was", "how", "much"]]
                    if tokens:
                        if all(tok in haystack for tok in tokens):
                            exact_matches.append(t)
                        elif any(tok in haystack for tok in tokens):
                            possible_matches.append(t)
                        else:
                            continue
                    else:
                        exact_matches.append(t)
                else:
                    exact_matches.append(t)

            matched_records = exact_matches + possible_matches
            
            for t in matched_records:
                deb = t.get("debit", 0.0)
                cred = t.get("credit", 0.0)
                d_str = t.get("date", "")
                
                total_debit += deb
                total_credit += cred
                if deb > 0: debits_list.append(deb)
                if cred > 0: credits_list.append(cred)
                if d_str: dates_list.append(d_str)

            dates_list.sort()

            summary = {
                "total_transactions": len(matched_records),
                "exact_matches_count": len(exact_matches),
                "possible_matches_count": len(possible_matches),
                "total_debit": round(total_debit, 2),
                "total_credit": round(total_credit, 2),
                "net_volume": round(abs(total_credit - total_debit), 2),
                "first_date": dates_list[0] if dates_list else "N/A",
                "last_date": dates_list[-1] if dates_list else "N/A",
                "max_debit": max(debits_list) if debits_list else 0.0,
                "min_debit": min(debits_list) if debits_list else 0.0,
                "max_credit": max(credits_list) if credits_list else 0.0,
                "min_credit": min(credits_list) if credits_list else 0.0
            }

            # Call AI QA synthesis on verified DB facts
            api_key = os.environ.get("GEMINI_API_KEY", "").strip()
            ai_answer = ""
            fact_payload = {
                "user_query": user_query or person_query,
                "verified_summary": summary,
                "verified_exact_records": [{
                    "date": r.get("date"),
                    "particulars": r.get("purpose") or r.get("receiver_name"),
                    "reference": r.get("reference_number"),
                    "debit": r.get("debit"),
                    "credit": r.get("credit"),
                    "balance": r.get("balance"),
                    "source_page": r.get("source_page")
                } for r in exact_matches[:30]]
            }
            
            if api_key:
                try:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
                    prompt = f"""You are SpendPulse Verified Financial AI.
CRITICAL MANDATE: Answer the user question using ONLY the provided verified transaction database records below.
NEVER invent, extrapolate, or guess any dates, amounts, people, balances, or transaction counts.
If verified records are empty or insufficient, state: 'Insufficient verified transaction data to answer this accurately.'

VERIFIED DATABASE DATA:
{json.dumps(fact_payload, indent=2)}

USER QUESTION: {user_query or person_query or 'Summarize financial history'}

Answer in clear natural language:"""
                    req = urllib.request.Request(url, data=json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode('utf-8'), headers={'Content-Type': 'application/json'})
                    with urllib.request.urlopen(req) as response:
                        res_body = response.read().decode('utf-8')
                        res_json = json.loads(res_body)
                        ai_answer = res_json['candidates'][0]['content']['parts'][0]['text'].strip()
                except Exception as ex:
                    print("AI Query call error:", ex)
                    ai_answer = f"Found {summary['total_transactions']} verified transactions matching query. Total Outflow (Debit): PKR {summary['total_debit']:,.2f}, Total Inflow (Credit): PKR {summary['total_credit']:,.2f}."
            else:
                ai_answer = f"Found {summary['total_transactions']} verified transactions matching query. Total Outflow (Debit): PKR {summary['total_debit']:,.2f}, Total Inflow (Credit): PKR {summary['total_credit']:,.2f}."

            status, headers, res = _json(200, {
                "ai_answer": ai_answer,
                "summary": summary,
                "exact_matches": exact_matches,
                "possible_matches": possible_matches
            })
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # 10. AI Multi-Row Statement File Parser Endpoint
    if path == "/api/parse-statement-file" and method == "POST":
        try:
            length = int(environ.get("CONTENT_LENGTH", "0"))
            body = environ["wsgi.input"].read(length)
            data = json.loads(body.decode("utf-8"))

            b64_data = data.get("file_base64") or data.get("image_base64") or ""
            file_type = data.get("file_type") or "image/png"

            if not b64_data:
                status, headers, res = _json(400, {"error": "Missing file_base64 payload."})
                start_response(status, headers)
                return res

            if "," in b64_data:
                b64_clean = b64_data.split(",")[1]
            else:
                b64_clean = b64_data

            mime_type = "application/pdf" if "pdf" in file_type.lower() else "image/png"
            extracted_res = call_gemini_statement_table(b64_clean, mime_type)

            tx_items = []
            if extracted_res and "transactions" in extracted_res:
                tx_items = extracted_res["transactions"]

            status, headers, res = _json(200, {"transactions": tx_items})
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    status, headers, res = _json(404, {"error": "Not found"})
    start_response(status, headers)
    return res
