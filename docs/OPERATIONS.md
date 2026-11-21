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
