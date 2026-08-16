import json
import os
import urllib.request
import re
import uuid
from datetime import datetime
import gspread
from google.oauth2.service_account import Credentials
from google.cloud import vision

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
            "status", "progress_pct", "employee_id", "id", "debit", "credit"
        ]
        ws_tx = sh.add_worksheet(title="transactions", rows=1000, cols=len(tx_headers))
        ws_tx.append_row(tx_headers)

    # Check and upgrade headers if existing sheet has old columns
    try:
        headers = ws_tx.row_values(1)
        needed = ["status", "progress_pct", "employee_id", "id", "debit", "credit"]
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

            deleted_count = 0
            if wipe_all:
                # Nuke ALL transaction rows except the header row
                if len(rows) > 1:
                    for idx in range(len(rows), 1, -1):
                        ws_tx.delete_row(idx)
                        deleted_count += 1
            else:
                # Delete junk/dump rows or rows with 0 amount
                JUNK_PATTERNS = [
                    "statement of account", "page of date description", "raiwind road branch",
                    "cheq/inst", "date description", "opening balance", "closing balance",
                    "ibft from fast engineering solutions"
                ]
                JUNK_AMOUNTS = ["33", "180", "2026", "2025", "2024", "1", "0", "0.0", "0.00"]

                for idx in range(len(rows), 1, -1):
                    r = rows[idx - 1]
                    if not r or len(r) == 0:
                        ws_tx.delete_row(idx)
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
                        ws_tx.delete_row(idx)
                        deleted_count += 1

            status, headers, res = _json(200, {
                "message": f"Cleaned up {deleted_count} rows {'(ALL transactions wiped)' if wipe_all else '(junk & zero-amount rows removed)'}.",
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

    # 5. Get Transactions List (Returns Debit/Credit fields)
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
                    r_id = r[16] if len(r) > 16 and r[16] else f"tx_{uuid.uuid4().hex[:6]}"
                    r_emp_id = r[15] if len(r) > 15 and r[15] else ""
                    r_logged = r[12] if len(r) > 12 and r[12] else ""
                    r_status = r[13] if len(r) > 13 and r[13] else "Pending"
                    r_progress = r[14] if len(r) > 14 and r[14] else "0%"
                    r_imgs = r[11] if len(r) > 11 and r[11] else "[]"
                    tx_type_str = r[10] if len(r) > 10 else "Payment"

                    amt_val = 0.0
                    try:
                        amt_val = float(str(r[3]).replace(",", "").strip())
                    except ValueError:
                        amt_val = 0.0

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

                    item = {
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
                        "credit": cred_val
                    }

                    if role == "employee":
                        if emp_id and r_emp_id and emp_id == r_emp_id:
                            tx_list.append(item)
                        elif emp_name and (emp_name.lower() in r_logged.lower() or emp_name.lower() in item["sender_name"].lower() or emp_name.lower() in item["receiver_name"].lower()):
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
                extracted.get("credit", "0")
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

    # 8. Bulk Statement Upload Endpoint (Saves Debit & Credit explicitly)
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

            existing_refs = set()
            existing_signatures = set()

            if len(existing_rows) > 1:
                for r in existing_rows[1:]:
                    if len(r) > 0 and r[0]:
                        existing_refs.add(str(r[0]).strip().lower())
                    if len(r) >= 8:
                        sig = f"{str(r[1]).strip()}_{str(r[3]).replace(',', '').strip()}_{str(r[7]).strip().lower()}"
                        existing_signatures.add(sig)

            new_rows_to_append = []
            added_count = 0
            skipped_count = 0

            for item in items:
                ref_num = str(item.get("reference_number") or item.get("id") or f"ref_{uuid.uuid4().hex[:7]}").strip()
                item_date = str(item.get("date") or datetime.now().strftime("%Y-%m-%d")).strip()
                item_time = str(item.get("time") or datetime.now().strftime("%I:%M %p")).strip()
                
                debit_val = float(item.get("debit") or 0)
                credit_val = float(item.get("credit") or 0)
                amt_val = credit_val if credit_val > 0 else debit_val
                if amt_val == 0:
                    try: amt_val = float(str(item.get("amount") or 0).replace(",", ""))
                    except ValueError: amt_val = 0.0

                if amt_val == 0.0:
                    continue  # Ignore zero amount junk rows!

                amt_str = str(amt_val)
                curr = str(item.get("currency") or "PKR").strip()
                sender = str(item.get("sender_name") or "").strip()
                receiver = str(item.get("receiver_name") or item.get("particulars") or "").strip()
                purpose = str(item.get("purpose") or item.get("particulars") or "Bank Statement Import").strip()
                tx_type = str(item.get("transaction_type") or ("Credit" if credit_val > 0 else "Payment")).strip()
                tx_id = f"tx_{uuid.uuid4().hex[:8]}"

                sig_key = f"{item_date}_{amt_str}_{receiver.lower()}"
                if (ref_num.lower() in existing_refs and ref_num != "") or sig_key in existing_signatures:
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
                    str(credit_val)
                ]

                new_rows_to_append.append(row)
                existing_refs.add(ref_num.lower())
                existing_signatures.add(sig_key)
                added_count += 1

            if new_rows_to_append:
                ws_tx.append_rows(new_rows_to_append)

            status, headers, res = _json(200, {
                "message": f"Successfully imported {added_count} statement transactions ({skipped_count} duplicates skipped).",
                "added_count": added_count,
                "skipped_count": skipped_count
            })
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # 9. AI Multi-Row Statement File Parser Endpoint
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
