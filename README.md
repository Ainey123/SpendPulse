# SpendPulse — Multi-User Financial Ledger (Vercel-ready)

A secure, multi-user financial ledger web app optimized for **Vercel's free tier**.

- **Frontend:** static HTML5 + Tailwind CSS + vanilla JS (PWA-capable, installable)
- **Backend:** Python serverless functions in `/api` (Vercel native Python runtime)
- **Database:** Google Sheets (permanent storage, read/written via `gspread`)

## Features
- 🔐 Secure login; session tokens; RBAC (admin sees all, users see only their own)
- 📝 Transaction form with receipt image → Base64 stored directly in the sheet
- 📊 Dashboard: Day / Month / Custom / All filters + summary cards
- 👑 Admin: create users; filter by `logged_by`
- 👤 Profile: reset your own password
- 📥 CSV export of the currently filtered transactions
- 📱 PWA: `manifest.json` + service worker → "Install App" / "Add to Home Screen"

## Project layout
```
public/
  index.html      # SPA markup (login + dashboard)
  app.js          # frontend logic (auth, filters, CSV, base64 upload, PWA)
  manifest.json   # PWA manifest
  sw.js           # service worker
api/
  index.py        # WSGI app dispatching to /api/* handlers (gspread + Google Sheets)
vercel.json
requirements.txt  # gspread, oauth2client
ENV_SETUP.md      # how to configure SPREADSHEET_ID + GOOGLE_CREDENTIALS
```

## Setup
1. Create a Google Sheet with two tabs: `users` and `transactions` using the column
   headers listed in `ENV_SETUP.md`.
2. Create a Google service account, enable Sheets + Drive APIs, share the sheet with
   the service-account email as Editor.
3. In Vercel (Project → Settings → Environment Variables) set:
   - `SPREADSHEET_ID` = your sheet ID or URL
   - `GOOGLE_CREDENTIALS` = the service-account JSON (see `ENV_SETUP.md`)
4. Deploy — import the GitHub repo in Vercel, or `vercel --prod`.

Default admin on first run: `admin` / `admin123` (change it immediately).

## Local dev
`vercel dev` runs both the static frontend and the `/api` functions. Set the same
env vars in your shell (or a local `.env`) first.
