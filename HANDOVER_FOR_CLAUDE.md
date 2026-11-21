# NirmaanCRM — Claude Handover Document

## Project Overview
NirmaanCRM is a modular CRM + project-management website for a Mumbai real-estate developer, built per the **NirmaanCRM_Claude_Build_Guide_v1.3.md** specification. It runs on Cloudflare's free tier (₹0/month), files live in Google Drive (Mode G), and uses vanilla HTML/CSS/JS with no framework.

## Live Deployment
- **Production URL:** `https://nirmaan-crm.savai-dhaval.workers.dev`
- **Worker Version:** `dfddd4b0-46ce-41ec-b2dc-0d4a4629bee5`
- **Cron Triggers Active:** 4 triggers (`30 2 * * *`, `30 13 * * *`, `30 * * * *`, `30 20 * * *`)

## Local Working Directory
`D:\Opencode\nirmaan-crm\`

## Git Status
- Local git repo initialized, 2 commits made
- **GitHub remote NOT yet configured** — repo `https://github.com/savaidhaval/Nirmaan-crm` needs to be created on GitHub first
- Commands to push after repo creation:
  ```
  git remote add origin https://github.com/savaidhaval/Nirmaan-crm.git
  git branch -M main
  git push -u origin main
  ```

## Secrets Set (Cloudflare Workers)
Set via `wrangler secret put` (never in code):
- `SESSION_SECRET`
- `APP_KEY`
- `OWNER_EMAIL` = `savai.dhaval@gmail.com`
- `OWNER_PASSWORD` = (temporary; the Owner is forced to choose their own at first login)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

## Databases (Cloudflare D1)
- Production: `nirmaan-db` (ID: `8883b3cf-8ba3-49a1-b31e-72d7776b7e60`)
- Staging: `nirmaan-db-staging` (ID: `faea2f40-32a7-40b9-8d2e-57bfcf20da03`)
- All 9 migrations applied (0001–0009)

## File Structure
```
nirmaan-crm/
├── wrangler.toml              # Cloudflare config (4 crons, D1 binding, assets)
├── package.json               # wrangler dev-only
├── .gitignore                 # node_modules, package-lock.json, .dev.vars
├── migrations/                # 0001_core.sql – 0009_branding.sql
├── src/
│   ├── index.js               # Worker entry + all API routes
│   ├── core/
│   │   ├── router.js          # Tiny method+path router
│   │   ├── auth.js            # PBKDF2 sessions, OTP, bootstrap owner
│   │   ├── db.js              # D1 helpers (query, queryOne, run, batch)
│   │   ├── settings.js        # Settings get/set + AES-GCM encrypt
│   │   ├── permissions.js     # Role matrix (VCEAX), visibleProjectIds
│   │   ├── audit.js           # Audit log writer
│   │   ├── events.js          # In-process event bus
│   │   ├── gdrive.js          # Google Drive OAuth + API client
│   │   ├── mail.js            # SMTP/Brevo provider switch, digest composer
│   │   ├── smtp.js            # SMTP client over cloudflare:sockets
│   │   └── util.js            # IDs, paise money, IST dates, CSV BOM
│   └── modules/
│       ├── index.js           # Static module import list
│       ├── projects/api.js    # Projects CRUD
│       ├── users/api.js       # User management (roles, temp passwords)
│       └── documents/api.js   # Documents vault
└── public/                    # Static frontend
    ├── index.html             # App shell (topbar, bottom nav)
    ├── login.html             # Login page
    ├── app.css                # Design tokens (18px base, 48px buttons)
    ├── app.js                 # Frontend router + all page renders
    ├── ui.js                  # Shared helpers (api, toast, moneyP, dateIST)
    ├── manifest.json          # PWA manifest
    ├── sw.js                  # Service worker (shell cache only)
    ├── print.css              # Print stylesheet for letters/POs
    ├── s.html                 # Customer share link landing page
    ├── _headers               # CSP, nosniff, frame-ancestors
    └── _header                # (old file, can be deleted)
```

## Status (latest session)
Fixed: blank page (duplicate `API_BASE` declaration in `ui.js`/`app.js`), `api()` not JSON-encoding bodies, broken SQL in
dashboard / receivables / branding / approvals / documents / share links, uploads and downloads returning garbage (D1 BLOBs),
`/s/*` and `/brand/*` never reaching the Worker, OTP login that could never verify, SMTP client rewritten (tested against a
scripted server, not a real mailbox), settings encryption helper, wrangler 4 config.

Built: forced password change, users admin (add / edit / reset / deactivate / log out, owner safeguards), Mumbai approvals
template + event timeline, drawing revisions with atomic supersede (site sees latest IFC only), milestones, PO maker-checker
approval with PM limit, sales inventory / payment plan / bookings (paise-exact) / receipts / cancellation, milestone.done →
demands ready, documents upload + links, customer share links with revoke, Email settings screen + OTP login + digest,
notification bell, CSP (no inline scripts), XSS-safe rendering.

## Still to do
1. **Google Drive** — needs your OAuth client: add redirect URI `https://nirmaan-crm.savai-dhaval.workers.dev/api/storage/google/callback`,
   then Settings → Storage → Connect. Upload/download routing to Drive is NOT wired yet; files go to the database (1.5 MB cap).
2. **Email** — More → Email settings: enter SMTP (465/SSL), Save, "Send test email". OTP login switches on after a successful test.
3. Not built yet: offline DPR queue, RFQ quote comparison, GRN + bills, print views on letterhead (PO / demand letter / receipt),
   Hindi/Marathi dictionaries, reports CSV export, nightly backup job, people/HR module screens, Phase 13 drills.
4. Deploy: `npm install` (wrangler 4), `npx wrangler deploy`. No new migrations in this session.

## How to Run Locally
```powershell
cd D:\Opencode\nirmaan-crm
npm install --save-dev wrangler
npx wrangler login
copy .dev.vars.example .dev.vars   # then edit
npx wrangler d1 migrations apply nirmaan-db --local
npx wrangler dev
```

## How to Deploy
```powershell
npx wrangler deploy
```

## How to Apply Migrations
```powershell
npx wrangler d1 migrations apply nirmaan-db --remote
npx wrangler d1 migrations apply nirmaan-db-staging --remote --env staging
```

## Owner Login Credentials
- **Email:** `savai.dhaval@gmail.com`
- **Password:** the temporary `OWNER_PASSWORD` secret (forced change at first login)

## Next Steps for Claude
1. Create GitHub repo at `https://github.com/savaidhaval/Nirmaan-crm` (user will do this)
2. Push code: `git remote add origin <url> && git push -u origin main`
3. Fix frontend JS errors (check browser console)
4. Connect Google Drive via Settings → Storage
5. Configure SMTP email (Phase 11)
6. Build remaining frontend pages for Approvals, Drawings, Site, Procurement, Sales
7. Phase 13: Security audit, restore drill, UAT, go-live checklist

## Guide Reference
- Full specification: `D:\Downloads\Nirmaan CRM\NirmaanCRM_Claude_Build_Guide_v1.3.md`
- PDF runbook (could not be read by this model): `D:\Downloads\Nirmaan CRM\NirmaanCRM_Setup_and_Run_Runbook_v1.3.pdf`
