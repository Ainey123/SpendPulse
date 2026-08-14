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
            "status", "progress_pct", "employee_id", "id"
        ]
        ws_tx = sh.add_worksheet(title="transactions", rows=1000, cols=len(tx_headers))
        ws_tx.append_row(tx_headers)

    # Check and upgrade headers if existing sheet has old columns
    try:
        headers = ws_tx.row_values(1)
        needed = ["status", "progress_pct", "employee_id", "id"]
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
        # Seed default admin & employee
        ws_users.append_row(["usr_admin", "admin", "System Admin", "1234", "admin123", "admin", datetime.now().strftime("%Y-%m-%d")])
        ws_users.append_row(["usr_emp1", "employee", "John Employee", "5555", "emp123", "employee", datetime.now().strftime("%Y-%m-%d")])

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

    amt_match = re.search(r'(?:PKR|RS|EUR|USD|\$)\s*([\d,]+(?:\.\d{2})?)', text, re.IGNORECASE) or \
                re.search(r'\b([\d,]{3,}(?:\.\d{2})?)\b', text)
    if amt_match:
        data["amount"] = amt_match.group(1).replace(",", "")

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

    lines = [line.strip() for line in text.splitlines() if line.strip()]
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

def app(environ, start_response):
    path = environ.get("PATH_INFO", "/")
    method = environ.get("REQUEST_METHOD", "GET")

    # Options preflight
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

            if not username or (not pin_code and not password):
                status, headers, res = _json(400, {"error": "Username/Name and PIN or Password are required"})
                start_response(status, headers)
                return res

            ws_tx, ws_users, sid = get_google_sheet_tabs()
            user_rows = ws_users.get_all_values()

            found_user = None
            if len(user_rows) > 1:
                for r in user_rows[1:]:
                    if len(r) < 6:
                        continue
                    u_id, u_uname, u_name, u_pin, u_pass, u_role = r[0], r[1].strip().lower(), r[2], r[3].strip(), r[4].strip(), r[5].strip().lower()
                    
                    # Match username or name
                    if username == u_uname or username == u_name.lower():
                        if (pin_code and pin_code == u_pin) or (password and password == u_pass):
                            found_user = {
                                "user_id": u_id,
                                "username": u_uname,
                                "name": u_name,
                                "role": u_role,
                                "token": f"token_{u_id}_{uuid.uuid4().hex[:8]}"
                            }
                            break

            if found_user:
                status, headers, res = _json(200, found_user)
            else:
                status, headers, res = _json(400, {"error": "Invalid login credentials or PIN code."})
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # 2. Get Users (Employees list for Admin)
    if path == "/api/users" and method == "GET":
        try:
            ws_tx, ws_users, sid = get_google_sheet_tabs()
            rows = ws_users.get_all_values()
            users = []
            if len(rows) > 1:
                for r in rows[1:]:
                    if len(r) >= 6:
                        users.append({
                            "user_id": r[0],
                            "username": r[1],
                            "name": r[2],
                            "pin_code": r[3],
                            "password": r[4] if len(r) > 4 else "****",
                            "role": r[5]
                        })
            status, headers, res = _json(200, {"users": users})
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # 3. Create User (Admin Only)
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
                status, headers, res = _json(400, {"error": "Username, Name, and PIN code are required."})
                start_response(status, headers)
                return res

            u_id = f"usr_{uuid.uuid4().hex[:8]}"
            ws_tx, ws_users, sid = get_google_sheet_tabs()
            ws_users.append_row([u_id, uname, name, pin, pwd or "123456", role, datetime.now().strftime("%Y-%m-%d")])

            status, headers, res = _json(200, {"message": "User created successfully", "user_id": u_id})
            start_response(status, headers)
            return res
        except Exception as e:
            status, headers, res = _json(500, {"error": str(e)})
            start_response(status, headers)
            return res

    # Delete User (Admin Only)
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
                        ws_users.delete_rows(idx)
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

    # 4. Get Dashboard Stats (Admin Only)
    if path == "/api/dashboard-stats" and method == "GET":
        try:
            ws_tx, ws_users, sid = get_google_sheet_tabs()
            tx_rows = ws_tx.get_all_values()
            u_rows = ws_users.get_all_values()

            total_employees = max(0, len(u_rows) - 1)
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

    # 5. Get Transactions List (Filtered by Role)
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
                    if len(r) < 11:
                        continue
                    r_id = r[16] if len(r) > 16 and r[16] else f"tx_{uuid.uuid4().hex[:6]}"
                    r_emp_id = r[15] if len(r) > 15 and r[15] else ""
                    r_logged = r[12] if len(r) > 12 and r[12] else ""
                    r_status = r[13] if len(r) > 13 and r[13] else "Pending"
                    r_progress = r[14] if len(r) > 14 and r[14] else "0%"
                    r_imgs = r[11] if len(r) > 11 and r[11] else "[]"

                    item = {
                        "id": r_id,
                        "reference_number": r[0],
                        "date": r[1],
                        "time": r[2],
                        "amount": r[3],
                        "currency": r[4] if r[4] else "PKR",
                        "sender_name": r[5],
                        "sender_account": r[6],
                        "receiver_name": r[7],
                        "receiver_account": r[8],
                        "purpose": r[9],
                        "transaction_type": r[10],
                        "images_json": r_imgs,
                        "logged_by": r_logged,
                        "status": r_status,
                        "progress_pct": r_progress,
                        "employee_id": r_emp_id
                    }

                    if role == "employee":
                        if emp_id and r_emp_id and emp_id == r_emp_id:
                            tx_list.append(item)
                        elif emp_name and (emp_name.lower() in r_logged.lower() or emp_name.lower() in r[5].lower() or emp_name.lower() in r[7].lower()):
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

    # 6. Update Status & Progress (Admin Only)
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
                    r_id = r[16] if len(r) > 16 and r[16] else ""
                    if (tx_id and r_id == tx_id) or (tx_id and r[0] == tx_id):
                        ws_tx.update_cell(idx, 14, new_status)  # status column
                        ws_tx.update_cell(idx, 15, new_progress) # progress_pct column
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
                tx_id
            ]
            
            force_save = data.get("force_save", False)
            ws_tx, ws_users, sid = get_google_sheet_tabs()
            sheet_url = f"https://docs.google.com/spreadsheets/d/{sid}"
            extracted["sheet_url"] = sheet_url
            extracted["id"] = tx_id
            extracted["status"] = initial_status
            extracted["progress_pct"] = initial_progress

            # Duplicate Payment Check
            if not force_save:
                try:
                    all_rows = ws_tx.get_all_values()
                    target_amt = str(extracted.get("amount", "")).replace(",", "").strip()
                    target_rec = str(extracted.get("receiver_name", "")).strip().lower()
                    target_ref = str(extracted.get("reference_number", "")).strip()

                    if len(all_rows) > 1:
                        for r in all_rows[1:]:
                            if len(r) < 8:
                                continue
                            r_ref, r_date, r_time, r_amt, r_rec = str(r[0]).strip(), str(r[1]).strip(), str(r[2]).strip(), str(r[3]).replace(",", "").strip(), str(r[7]).strip().lower()
                            if (target_ref and r_ref and target_ref == r_ref) or (target_amt and r_amt and target_amt == r_amt and target_rec and target_rec in r_rec):
                                status, headers, res = _json(200, {
                                    "is_duplicate": True,
                                    "saved": False,
                                    "duplicate_info": {"date": r_date, "time": r_time, "amount": r[3], "receiver_name": r[7], "reference_number": r_ref},
                                    "extracted_data": extracted
                                })
                                start_response(status, headers)
                                return res
                except Exception as check_err:
                    print("Duplicate check warning:", check_err)

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

    status, headers, res = _json(404, {"error": "Not found"})
    start_response(status, headers)
    return res
