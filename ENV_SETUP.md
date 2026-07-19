# ============================================================
# SpendPulse — Vercel Environment Variables
# ============================================================
# Set these in the Vercel dashboard (Project > Settings > Environment Variables)
# for the Production environment. DO NOT commit real values.
#
# SPREADSHEET_ID
#   The Google Sheet ID (the long string in the URL between /d/ and /edit),
#   OR the full sheet URL. The sheet must contain two tabs:
#     - users        (columns: username, password, role)
#     - transactions (columns: reference_number, date, time, amount,
#                     sender_name, receiver_name, purpose, transaction_type,
#                     receipt_base64, logged_by)
#   Share the sheet with the service-account email (from GOOGLE_CREDENTIALS)
#   using "Editor" access.
#
# GOOGLE_CREDENTIALS
#   The full JSON of a Google service account, WITHIN a TOML wrapper so it can
#   be pasted as a single env value. Example (paste the whole block):
#
#   GOOGLE_CREDENTIALS = """{
#     "type": "service_account",
#     "project_id": "your-project",
#     "private_key_id": "...",
#     "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
#     "client_email": "spendpulse@your-project.iam.gserviceaccount.com",
#     "client_id": "...",
#     "auth_uri": "https://accounts.google.com/o/oauth2/auth",
#     "token_uri": "https://oauth2.googleapis.com/token",
#     "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
#     "client_x509_cert_url": "..."
#   }"""
#
# To create the service account:
#   1. Google Cloud Console > IAM & Admin > Service Accounts > Create
#   2. Create a JSON key, download it
#   3. Enable "Google Sheets API" and "Google Drive API" for the project
#   4. Share your Google Sheet with the service account's email as Editor
