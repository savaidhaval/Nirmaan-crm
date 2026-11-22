# NirmaanCRM — operations notes

## Daily / weekly
- Morning email (08:00 IST) goes to every active Owner. "Send morning report now" is under More → Email settings.
- 19:00 IST: in-app nudge to Owner/PM for projects with no site report that day.
- Hourly: failed emails retry (max 3 tries). Failures show with a plain reason under Email settings.
- Weekly: More → Audit log; More → Shared links (cancel anything stale).

## Troubleshooting
| Symptom | Fix |
|---|---|
| Blank page after deploy | Hard refresh (service worker is network-first, so a normal reload is usually enough). Open the browser console. |
| "Please choose your own password first" on every call | Normal until the temporary password is changed. |
| Locked out as Owner | Set a new `OWNER_PASSWORD` secret, then clear the owner's `password_hash` in D1 (`UPDATE users SET password_hash=NULL WHERE is_primary_owner=1`) and sign in. |
| Test email fails "refused the username or password" | Gmail/Zoho/Outlook need an app password. |
| Test email fails "Could not connect" | Use host + port 465 with SSL/TLS, or 587 with STARTTLS. Port 25 is blocked. |
| Upload says file too big | Database storage caps files at 1.5 MB. Photos shrink automatically. Use Add link for big PDFs. |

## Secrets (set with `npx wrangler secret put NAME`)
`SESSION_SECRET`, `APP_KEY` (base64, 32 bytes: `openssl rand -base64 32`), `OWNER_EMAIL`, `OWNER_PASSWORD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
Do not change `APP_KEY` after saving an SMTP password — saved secrets would become unreadable.

## Deploy
```
npm install
npx wrangler d1 migrations apply nirmaan-db --remote
npx wrangler deploy
```
Test on staging first: `npx wrangler deploy --env staging`.


## Website enquiry form (WP-24)
1. In the Cloudflare dashboard open Turnstile and add a widget for crm.mysociety.tech (free). Copy the Site key and the Secret key.
2. Set the Secret as a Worker secret named TURNSTILE_SECRET (wrangler secret put TURNSTILE_SECRET) and the Site key as TURNSTILE_SITE_KEY (a plain variable). Never type either into a chat or a file in the repository.
3. Open "Website form" in the Sales group to copy the link or the embed code. Until both values are set the form shows "not switched on" and accepts nothing.
Troubleshooting: "We could not confirm you are a person" means the Turnstile check failed (ad blocker, wrong site key, or a bot). "Too many enquiries" is the per-connection limit (5 an hour).

## Installing the app
NirmaanCRM installs from the browser as a web app: Chrome or Edge (Windows, Mac, Android) show Install; Safari on iPhone/iPad uses Share, Add to Home Screen; Safari 17 on Mac uses File, Add to Dock. There is no app-store listing or download file, so no store account or fee is needed.


## Troubleshooting: modules added in 2026
| What you see | Likely cause | What to do |
|---|---|---|
| Bulk demand letters stop with "daily limit" | `sales.bulk_daily_limit` reached | Raise it in Settings (check your email provider's own daily limit first) or continue tomorrow. |
| Bulk send says "Email is not set up" | SMTP / Brevo not configured | More → Email settings. Failed letters keep a Retry button. |
| Bank import: "date could not be read" | Wrong "Date looks like" choice | Pick the format that matches the first date in the file. |
| Bank line has no suggestion | Amount differs or name not in the narration | Use "Choose a customer", or Ignore and record the receipt by hand. |
| Tally: voucher "held back" | A ledger name is blank or does not balance | Fill the ledger name on the Tally screen; check the record if it says it does not balance. |
| Redevelopment: "not a redevelopment project" | Project type is New build | Projects → edit → Type: Redevelopment. |
| Dashboard budget line looks old | Snapshot refreshes one project per hour | Wait; it catches up within a few hours. |
| Phone shows an orange bar | Offline, or entries waiting | Tap it. "Send now" retries. Red = the server refused an entry: read the reason, then Discard. |
| Website form says "not switched on" | TURNSTILE_SECRET / TURNSTILE_SITE_KEY missing | See "Website enquiry form" above. |
| Install button does nothing on iPhone | iOS has no install prompt | Safari → Share → Add to Home Screen (the dialog shows the steps). |
| A page says "Only the Owner can delete" | Delete is Owner-only | Ask the Owner; money is reversed, not deleted. |
Checks you can run any time (developer): `node scripts/check-tables.mjs` (every table is backed up), `node scripts/restore-drill.mjs` (backup restores into an empty database and every table matches), `node scripts/query-report.mjs dev.log` (busiest requests against the 50-statement cap).
