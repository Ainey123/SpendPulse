import json
import os
import urllib.request
import re
from datetime import datetime
import gspread
from google.oauth2.service_account import Credentials
from google.cloud import vision

def _json(status, payload):
    body = json.dumps(payload, default=str).encode("utf-8")
    status_str = "200 OK" if status == 200 else ("400 Bad Request" if status == 400 else "500 Internal Server Error")
    return (status_str, [("Content-Type", "application/json"), ("Content-Length", str(len(body)))], [body])

def get_google_sheet():
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
    
    try:
        ws = sh.worksheet("transactions")
    except Exception:
        headers = ["reference_number", "date", "time", "amount", "currency", "sender_name", "sender_account", "receiver_name", "receiver_account", "purpose", "transaction_type", "receipt_base64", "bill_pdf_base64", "logged_by"]
        ws = sh.add_worksheet(title="transactions", rows=1000, cols=len(headers))
        ws.append_row(headers)
    return ws, sid

def ocr_extract_fields(img_bytes):
    """Extract fields using Google Cloud Vision OCR."""
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
        "date": "",
        "time": "",
        "amount": "",
        "currency": "PKR",
        "sender_name": "",
        "sender_account": "",
        "receiver_name": "",
        "receiver_account": "",
        "reference_number": "",
        "purpose": "Transfer",
        "transaction_type": "Payment"
    }

    # Extract Amount
    amt_match = re.search(r'(?:PKR|RS|EUR|USD|\$)\s*([\d,]+(?:\.\d{2})?)', text, re.IGNORECASE) or \
                re.search(r'\b([\d,]{3,}(?:\.\d{2})?)\b', text)
    if amt_match:
        data["amount"] = amt_match.group(1).replace(",", "")

    # Date
    date_match = re.search(r'\b(\d{1,2}[-/\s](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2})[-/\s]\d{2,4})\b', text, re.IGNORECASE)
    if date_match:
        data["date"] = date_match.group(1)

    # Time
    time_match = re.search(r'\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\b', text)
    if time_match:
        data["time"] = time_match.group(1)

    # Reference Number
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
    prompt = """
    Extract from this receipt:
    - date (YYYY-MM-DD)
    - time (HH:MM AM/PM)
    - amount (number only)
    - currency (e.g. PKR, USD)
    - sender_name
    - sender_account
    - receiver_name
    - receiver_account
    - reference_number
    - purpose
    - transaction_type
    
    Return ONLY a JSON object with exactly these keys, no markdown, no other text. Leave empty strings if not found.
    """
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
    
    if path == "/api/scan":
        # ... existing scan handler ...
        try:
            length = int(environ.get("CONTENT_LENGTH", "0"))
            body = environ["wsgi.input"].read(length)
            data = json.loads(body.decode("utf-8"))
            
            b64 = data.get("image_base64", "")
            extracted = data.get("extracted_data") or {}
            if not b64 and not extracted:
                status, headers, res = _json(400, {"error": "Missing image_base64 or extracted_data"})
                start_response(status, headers)
                return res
            
            import base64 as b64_module
            
            # Only decode image if we have one (for PDF case, skip OCR)
            img_bytes = b64_module.b64decode(b64) if b64 else None

            # 1. Use client-side extracted data if provided!
            extracted = data.get("extracted_data") or {}

            # 2. Try Gemini REST API if client extracted incomplete data AND we have an image
            if img_bytes and (not extracted.get("sender_name") or not extracted.get("receiver_name")):
                gemini_data = call_gemini_rest(b64)
                if gemini_data:
                    for k, v in gemini_data.items():
                        if v and not extracted.get(k):
                            extracted[k] = v

            # 3. Try Google Cloud Vision OCR if we have an image and data is incomplete
            if img_bytes and (not extracted.get("sender_name") or not extracted.get("receiver_name")):
                ocr_data = ocr_extract_fields(img_bytes)
                if ocr_data:
                    for k, v in ocr_data.items():
                        if v and not extracted.get(k):
                            extracted[k] = v

            # Fill soft defaults if still blank
            if not extracted.get("date"):
                extracted["date"] = datetime.now().strftime("%Y-%m-%d")
            if not extracted.get("time"):
                extracted["time"] = datetime.now().strftime("%I:%M %p")

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
                extracted.get("transaction_type", ""),
                "",
                "",
                "Auto-Scanner"
            ]
            
            ws, sid = get_google_sheet()
            ws.append_row(row)

            sheet_url = f"https://docs.google.com/spreadsheets/d/{sid}"
            extracted["sheet_url"] = sheet_url
            
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
