# NirmaanCRM — Build-It-Yourself Guide
## A custom, modular CRM + project-management website for a Mumbai real-estate developer
### Built with Claude + Cloudflare free tiers + your own Google Drive · ₹0/month running cost · Simple enough for a 55-year-old site engineer

**Version 1.3 · 21 November 2026** (Google Drive storage edition)

> **Revision notes v1.2 → v1.3**
> - **Your files live in your own Google Drive (new Mode G, §3.4) — now the default.** Drawings, site photos, challans, brochures and backups go into tidy project folders in a *dedicated company Google account*. Staff open them only through the CRM (role-checked); customers only through expiring links; nothing is ever "anyone with the link" in Drive. R2 (Mode A) and database+links (Mode B) remain as options.
> - **Facts checked 21 Nov 2026 and built in:** a service account cannot store files in a normal My Drive (it has no storage of its own), so the **Owner's own Google sign-in (OAuth)** is used; Google makes sign-ins expire after **7 days** for apps left in *Testing* status, so Phase 0/1 now choose the setting that does not expire (a **Personal**-type Google Cloud app, with the alternatives spelled out); the narrow `drive.file` permission means the CRM sees only files it created; the free Worker takes a request body of up to 100 MB, so uploads are **streamed straight through** with a 90 MB ceiling.
> - **Database:** migration `0009_branding.sql` gains Drive columns on `documents` (`store`, `drive_file_id`, …) plus `drive_folders` and `oauth_states`. Branding pictures stay in the database in every mode so the login page never depends on Drive.
> - **Build steps:** Phase 0 (dedicated Google account, Cloud project, Drive API), a new *Phase 1 add-on* (consent screen + sign-in key + secrets), Phase 2 (storage layer with a slot for the Drive driver), Phase 4 (the Drive driver, Connect Google Drive, quota meter, reconnect banner), Phase 13 (Drive drills). New template §10.8 to change the store or Google account.

> **Revision notes v1.1 → v1.2**
> - **Your brand (new §7.10):** logo, colours, signatory, signature/stamp and bank details are set once; a letterhead (generated, header + footer bands, or full-page image) is used on every PO, demand letter and receipt; any project can override it.
> - **Brochure library + customer sharing (new §7.10):** per-project brochures, floor plans and price lists with versions; customers get **expiring, revocable links** — never a public file.
> - **People & access (new §4.6):** one login per person, 8 plain-English roles, you as Owner with server-enforced safeguards (never locked out, never demoted), optional project-wise access, forced password change at first login.
> - **Database:** new migration `0009_branding.sql` (0001–0008 are unchanged). New build phase **4B**.
> - **Cloudflare setup corrected (checked 21 Nov 2026):** the config file is now `wrangler.jsonc` (Cloudflare's recommendation for new projects); staging must switch its cron jobs off (they are inherited); only `/api`, `/files`, `/s`, `/brand` run the Worker so ordinary pages stay free.

> **Revision notes v1.0 → v1.1** (full list in the separate *Errors & Changes Report* PDF)
> - **Structure:** backend module folders, an event bus and a static module list added, so modules truly plug in (§4.1–4.2); new plain-language intro (§0) and expansion roadmap (§1.1).
> - **Database (§5):** double-booking and duplicate-drawing guards, paise/basis-point money maths, TDS and partial payments, brokerage payments, rate-limit/backup/counter tables, missing columns and indexes. *Migrations had not been applied yet, so editing them now is safe.*
> - **Free-plan reality (§3.2, §7.8, §11.1):** Cloudflare's 10 ms CPU and 50-queries-per-run caps are now designed for; backups, ZIP exports and photo queue redesigned to fit.
> - **Facts re-checked 21 Nov 2026:** Cloudflare limits, budget-alert path, Access, Microsoft 365 SMTP, GST, TDS, RERA, DPDP — wording corrected or marked "confirm with your CA".

> **What this file is:** A complete, step-by-step specification and build plan. Upload this file to Claude (claude.ai or Claude Code), paste the **Master Prompt** below, and Claude will build the software with you, one phase at a time. You do not need to know coding. You need patience, a free Cloudflare account, a free Google account for the company's files, and this document.

---

## 0. START HERE (read this first — 3 minutes)

### The idea in 60 seconds (no jargon)

**NirmaanCRM is one shared notebook for your whole company, kept on the internet, opened on any phone.** Instead of ten WhatsApp groups and Excel sheets, every fact is written once, in one place, and everyone sees only what their job needs.

```
                 ┌─────────────────────────────────────────────┐
   THE SPINE     │  Projects · Users & roles · Documents vault │   ← shared by everything,
   (always on)   │  Notifications · Audit trail · Settings     │     never changes shape
                 └──────┬─────────┬─────────┬─────────┬────────┘
                        │         │         │         │
   BRICKS        ┌──────┴──┐ ┌────┴────┐ ┌──┴─────┐ ┌─┴───────┐ ┌─────────┐
   (modules —    │Approvals│ │Drawings │ │ Site   │ │Purchase │ │ Sales   │  … + any future brick
   switch each   └─────────┘ └─────────┘ └────────┘ └─────────┘ └─────────┘
   ON or OFF)         bricks talk by short "events", e.g. site says "5th slab done",
                      sales hears it and prepares the payment demand
```

- **What is a module?** One self-contained box of features (e.g. *Purchase*). It has its own screens, its own tables and its own on/off switch. Switching it off hides it; your data stays.
- **How does it run in the cloud?** The website and the database live in your own free Cloudflare account; the files (drawings, photos, brochures) live in your own Google Drive. Nothing is installed on anyone's phone or on a server you maintain. Everyone opens one web address. You pay ₹0 a month inside the free limits (§3.2).
- **How do I add something new later?** Describe it to Claude with the template in §10.3. A new module plugs into the spine; nothing that already works is touched. Ideas for future bricks are in §1.1.

### What you will end up with
One website (e.g. `https://nirmaan-crm.yourname.workers.dev`) that your whole team opens on their phone or laptop. It covers:

| Your daily headache | What the software does |
|---|---|
| Approvals stuck, expiry missed | Approvals & RERA compliance tracker with Mumbai (MCGM) checklist templates and email reminders |
| Site built from an old drawing | Drawing register with revision control — site always sees only the latest "Issued for Construction" drawing |
| "What happened at site today?" | Photo-first Daily Progress Report (DPR) that works even with no network in the basement |
| Procurement chaos, no rate comparison | Vendor master → 3-quote comparison → PO with your approval → GRN at site → bill tracking |
| Leads forgotten, follow-ups missed | Sales CRM: leads → site visits → booking → agreement → registration, with construction-linked demand letters |
| Hiring and staff records in WhatsApp | Light Team & Hiring module (optional) |
| No single picture of the business | Owner dashboard + an 8:00 AM daily digest email to you |
| Letters that look different every time; brochures lost in WhatsApp | Set your logo, colours and letterhead once — every PO, demand letter and receipt prints on it. A brochure library per project; customers get a link that expires by itself |
| Everyone sharing one password, everyone seeing everything | A separate login for each person, 8 simple roles, you as Owner (admin), and optional "this person sees only these projects" |

### What it costs
- **Running cost: ₹0/month** on Cloudflare free tiers plus a free Google account for the files (limits checked on 21 Nov 2026 — vendors change them, so recheck Cloudflare's pricing pages once a year; see §3.2).
- **Optional:** a custom domain like `nirmaanyourcompany.in` (~₹700–1,100/year). Not required — the free `workers.dev` web address works fine.
- **No card is needed for the default setup.** Files go to a free **Google account** (15 GB, shared with that account's Gmail and Photos) through a free **Google Cloud project** used only to create the sign-in key — per Google's pages reviewed on 21 Nov 2026 the Drive API needs no billing account, so skip any "free trial" offer; if Google ever demands a card for these steps, stop and ask Claude. Cloudflare R2 (Mode A) is the only option that asks for a payment method (once, free inside 10 GB) and it is now optional. §3.4 compares the three modes and gives built-in guards so you never cross a free limit.
- Claude itself: building ~13 phases means many long code outputs. The free claude.ai tier may stall on usage limits (one phase per session, using the Resume Prompt); Claude Code or a paid Claude plan is **strongly recommended** because it writes the files and runs the commands for you. **No new paid tool, subscription, or per-user fee is required to *run* the CRM.**

### How long it takes
Roughly **3–5 weekends** of focused work (Phase 0 ≈ 1½ hours including the Google account; each module phase ≈ 1–3 hours with Claude writing the code). You can stop after any phase and still have a working, useful system.

### What you need before starting
1. A laptop (Windows/Mac/Linux) with internet.
2. A free Cloudflare account **and a dedicated Google account for the company's files** (e.g. `yourcompany.crm@gmail.com`; §8, Phase 0).
3. A free GitHub account (for saving your code safely — optional but strongly recommended).
4. Your company email's SMTP details (ask your email/hosting provider — §7.8 has presets), or a free Brevo account as fallback.
5. This document.
6. *(Optional now — needed at Phase 4B)* your **logo** (PNG or JPG; an SVG also works), your **letterhead** as an image if you have one, and one **project brochure** PDF. No letterhead? The software builds a good one from your logo and details.

### Assumptions this guide makes (tell Claude if any differ)
- Team of **5–20 people**, **1–5 live projects**, Mumbai (MCGM jurisdiction typical; templates are editable).
- Roles: Owner (you), Project Manager, Site Engineer, Sales/CRM executive, Accounts, Purchase officer, HR/Admin. One person can hold several roles.
- Everyone has a smartphone; site network is sometimes poor.
- English default, with **Hindi/Marathi** label toggle for site staff.
- You are **not** replacing Tally/accounting — you will export data to your accountant (§7.9).

> ⚠️ **Compliance note:** The Mumbai approvals checklist and RERA reminder rules in this guide are an *indicative starting template*, not legal advice. Verify the current sequence, fees, and deadlines with your architect and CA, then edit the checklist in the software (it is fully editable by design).

---

### MASTER PROMPT — paste this into Claude after uploading this file

```text
You are my senior full-stack engineer and patient teacher. I am a Mumbai real-estate
developer with a small team. I am NOT a programmer. I have uploaded
"NirmaanCRM_Claude_Build_Guide_v1.2.md" — treat it as the binding specification.

Rules for you:
1. Follow the guide's contracts exactly: §2 Golden Rules, §3 Stack, §4 Module
   Contract, §5 Database Schema, §6 UX Contract, §7 Module Specs.
2. We build ONE phase at a time (§8). Never jump ahead. At the end of each phase,
   give me the "Done when" checklist so I can verify by clicking, not by reading code.
3. Output COMPLETE file contents with full file paths. No placeholders, no "// rest
   of code here", no snippets I must assemble myself.
4. Use only the free stack in §3: Cloudflare Workers + Static Assets + D1 + Google
   Drive for files (Mode G, default; R2 or D1-blob storage only if I choose them),
   vanilla HTML/CSS/JS. No frameworks, no build step, no paid service, no npm
   runtime dependency (the Drive API is called with plain fetch).
5. Give me exact commands to run and exact dashboard clicks, one numbered list,
   assuming Windows or Mac. Explain any term a 55-year-old site engineer would not know.
6. If anything in the guide is ambiguous or technically impossible, STOP and ask me
   before deviating. Propose the simplest alternative that keeps ₹0 cost.
7. After every phase, update docs/CHANGELOG.md and docs/DATA_DICTIONARY.md.
8. Migrations are additive-only (§10). Never rewrite an applied migration.
9. Respect the Cloudflare free-plan caps in §3.2 (10 ms CPU per request or cron run,
   50 database queries per request, 50 sub-requests). Use db.batch(), small pages and
   chunked jobs. Warn me BEFORE writing code that could break a cap.
10. Modules never import each other. Backend per module lives in src/modules/<key>/
    (api.js, service.js, hooks.js); cross-module reactions go through core/events.js (§4.2).
11. Branding, letterhead, brochures and customer share links follow §7.10 exactly:
    never store an SVG, never expose a public file URL (only expiring, revocable /s/<token>
    links), signature and stamp images stay private.
12. Users, the Owner (admin) and project access follow §4.6: server-enforced Owner
    safeguards, forced password change, project assignment checked on every query.
13. If I chose Mode G (default), files live in Google Drive (§3.4): ONE private folder tree in the company's
    dedicated Google account, signed in with OAuth and ONLY the narrow drive.file
    permission; tokens encrypted with APP_KEY; uploads and downloads streamed through
    the Worker (never buffered, never made public, never given to customers as a Google
    address); every Drive failure answered in plain words and queued on the phone.
    Branding pictures stay in the database (D1) in every mode (§7.10).

I have completed Phase 0 (accounts and tools). Begin Phase 1 now: give me the full
project skeleton and the exact steps to deploy it live.
```

*(If Phase 0 is not done yet, replace the last line with: "Walk me through Phase 0 first, one step at a time, waiting for my confirmation after each step.")*

Lost your chat or hit a session limit? Use the **Resume Prompt** in Appendix E.

---

## 1. Your business, and why this software is shaped this way

You run a development firm in Mumbai. Today your "system" is WhatsApp groups, Excel sheets, a diary, and memory. The pain is not lack of effort — it is that **information lives in ten places and none of them talk to each other**:

- The architect issues Revision R3 of a slab drawing, but the site engineer's WhatsApp still shows R1.
- A lead from 99acres gets a call after 4 days — the broker next door called in 4 minutes.
- The CC condition compliance date passes quietly; the renewal reminder existed only in the liaisoning consultant's head.
- A cement PO is approved on a phone call; three months later nobody remembers the agreed rate.
- A slab is cast on Tuesday, but the construction-linked demand letter goes out three weeks later — cash flow suffers.
- You ask "what's pending?" and get five different answers from five people.

**The fix is one shared spine:** every record belongs to a **Project**, every file lives in one **Document vault**, every reminder flows through one **Notification engine**, every change is written to one **Audit log**. Modules plug into this spine. That is what makes it *modular*: you can switch a module off, change it, or add a new one without touching the others.

### The flagship automations (why custom beats a generic CRM)
1. **Slab done → money asked.** When the site engineer marks "Wing A – 5th slab" complete, the system marks the matching demand of every booked flat on the construction-linked plan as **Ready**, for your team to review and send. (§7.6 + §7.4)
2. **New drawing revision → site alerted.** Issuing R3 automatically marks R2 "Superseded" and emails/notify-links R3 to the site team. Site can never open an old revision by accident. (§7.3)
3. **8 AM owner digest.** One email every morning: yesterday's site progress, today's follow-ups, approvals expiring, POs awaiting your approval, overdue receivables. (§7.8)
4. **No-network DPR.** The daily report saves on the phone even in the basement with zero signal, and syncs when the engineer walks out. (§7.4)
5. **Everything shareable to WhatsApp** with one tap (free `wa.me` links — no WhatsApp Business API subscription). (§6)

### What we deliberately do NOT build (scope discipline)
Full accounting (use Tally + exports), payroll, native Android/iOS apps (a PWA website is enough), WhatsApp Business API automation (paid), BI dashboards with 30 charts, multi-company/multi-branch. Keeping these out is what keeps the software simple and free.

### 1.1 Module expansion roadmap (all plug in with **no change to the core**)

| Future brick | What it adds | How it plugs in |
|---|---|---|
| Rentals / Facility | Tenants, rent due, maintenance tickets for your retained flats | New `ren_` tables + `src/modules/rentals/` + registry entry; reuses Documents, Notifications, Projects |
| Site Attendance | Daily labour attendance by contractor | New `att_` tables; feeds the DPR labour count through a `service.js` call |
| Customer portal | Buyers see their demands, receipts, construction photos | New module + a customer role; read-only views of Sales data via `sales/service.js` |
| Vendor portal | Vendors see POs and bill status | Same pattern with a vendor role |
| WhatsApp Business API | Automatic WhatsApp instead of one-tap share | Only a new transport inside `core/notify.js` (like Brevo for email); paid, so optional |
| Accounting export / Tally XML | Direct voucher export for your accountant | New `reports` exporter; no new tables needed |

Rule of thumb: if a new idea needs more than *one folder, one migration, one registry line and one import line*, it is being built wrongly — ask Claude to re-shape it (§10.3).

---

## 2. Golden Rules (binding on Claude for every line of code)

1. **The 55-year-old rule.** Any user must complete any daily task in **≤ 3 taps/clicks** from their home screen, with **no jargon**, **18px+ text**, **48px+ buttons**, and plain-language errors ("Photo is too big — try again, we will shrink it for you" — never "Error 413").
2. **Role-based home screens.** A site engineer sees 3 big buttons, not a dashboard. The owner gets the dashboard. Nobody sees modules they don't use.
3. **Mobile-first.** Every screen works on a ₹10,000 Android phone on 4G. Desktop is the same pages, wider.
4. **Photo-first, typing-last.** Dropdowns, defaults, date pickers, voice-to-text via the phone keyboard. A DPR is 3 photos + 2 lines, not a form with 20 fields.
5. **Modular contract (§4).** Each module = its own folder + its own migration + its own registry entry + a feature flag. Core never imports module internals; modules only use core helpers.
6. **₹0 contract.** Only §3 services. No service that "starts free then bills". No trial-ware. If a limit is near, the software warns the owner *inside the app* (§3.2).
7. **Data ownership.** All records in your Cloudflare account (D1 = plain SQLite); all files in your own Google Drive (or R2 = S3-compatible, if you chose it). One-click full export (§11). No lock-in, ever.
8. **Additive-only changes.** Database migrations only add tables/columns; never drop or rewrite (§10). Old data is sacred.
9. **Server-side permissions.** Hiding a button is not security. Every API call checks the role matrix (§4.5) on the server.
10. **Audit everything that matters.** Create/edit/approve/delete writes one audit row: who, what, when, summary.
11. **Soft delete.** Ordinary records get `deleted_at`, never hard-deleted from the UI. Owner can purge later. **Money records (receipts, bills, demands, POs) are never deleted** — they are *cancelled* or *reversed* with a reason, so totals always reconcile.
12. **Plain Indian conventions.** ₹ with Indian grouping (₹12,50,000), dates DD/MM/YYYY, phone +91, money stored in **paise** (integer) and percentages in **basis points** (1% = 100; integers) to avoid rounding bugs; timestamps stored in **UTC** (`YYYY-MM-DD HH:MM:SS`, SQLite's own format) and always *shown* in IST; date-only fields (`YYYY-MM-DD`) are IST calendar dates; phone numbers stored as `+91XXXXXXXXXX` so duplicate checks work.
13. **No dead ends.** Every empty screen says what to do next and shows one big button ("No leads yet → + New Lead").
14. **Autosave & undo.** Long forms autosave locally; destructive actions ask once, in plain words, with the record name shown.
15. **Customers never get a login and never a raw file address.** Anything a customer sees (a brochure, later a statement) reaches them through a *branded, expiring, revocable link* (§7.10). Your letterhead, signature and stamp are part of your identity: signature and stamp are never served publicly.

---

## 3. The stack — Cloudflare free tiers + your Google Drive for files

### 3.1 Components

| Piece | Service (all free) | What it does here | Free allowance |
|---|---|---|---|
| Website + API | **Cloudflare Workers + Static Assets** | Serves the pages and the `/api/*` backend from ONE deployment, one URL | 100,000 requests/day · **10 ms CPU per request** · 128 MB memory · 50 subrequests per request |
| Database | **Cloudflare D1** (SQLite) | All records: leads, DPRs, POs, approvals… | 5 GB storage · 5 million rows read/day · 100,000 rows written/day · 10 databases · 2 MB per row · **50 queries per request** · 100 bound parameters per query |
| Files | **Google Drive** (Mode G, default) via the Drive API *or* Cloudflare R2 (Mode A) *or* D1 blobs (Mode B) | Drawings, photos, challans, letters, brochures, nightly backups | Drive: 15 GB free per Google account (shared with Gmail/Photos), up to 750 GB/day of uploads · R2: 10 GB storage, free downloads |
| File sign-in | **Google OAuth 2.0**, `drive.file` scope only | One-time "Connect Google Drive" by the Owner; the Worker then uploads/downloads for everyone | Free · needs a free Google Cloud project (no billing account — §3.4) |
| Login | **Built-in** (password + email OTP) | No passwords to remember once email works: "Email me a code" | Free (uses your SMTP). Password hashing must be load-tested on the free CPU cap (Phase 3) |
| Email | **Your company SMTP** via Workers TCP sockets; **Brevo free** fallback | OTP codes, reminders, demand letters, 8 AM digest | Your email plan; Brevo free = 300 emails/day |
| Scheduled jobs | **Workers Cron Triggers** | Hourly reminders, 8 AM digest, 7 PM DPR nudge, 2:00 AM backup | Free · 5 cron triggers per account (we use 4) · 10 ms CPU per run |
| Optional 2nd lock | **Cloudflare Access (Zero Trust)** | Extra email-OTP gate in front of the whole site | Free up to 50 users |
| Code safety | **GitHub** (free) | Version history; roll back any change | Free |

**Why this and not the alternatives:** Zoho/Salesforce charge per user per month forever. Supabase's free tier pauses inactive projects. WordPress needs hosting + plugin updates + security babysitting. AppSheet charges per user. Cloudflare's free tier does not pause, does not charge per user, serves pages from edge locations close to India (fast on Indian mobile networks; create the D1 database with an Asia-Pacific location hint so data is nearby), and your data stays exportable as plain SQLite + ordinary files in a Drive folder you can open yourself.

**Why no React/Next.js/framework:** a framework adds a build toolchain that breaks, needs updates, and makes "ask Claude to change one screen" harder. Plain HTML + one shared CSS + one shared `ui.js` is slower to write for a Silicon Valley team but *perfect* for a Claude-maintained small-business app: every page is a self-contained file Claude can rewrite safely. No build step = deploy is just `npx wrangler deploy`.

### 3.2 Will 15 users ever cross the free limits? (headroom math)

| Limit | Free allowance | Realistic usage (15 users, 3 projects) | Headroom |
|---|---|---|---|
| Worker requests | 100,000/day | ~15 users × 300 = 4,500/day | ~22× |
| D1 rows read | 5,000,000/day | ~150,000/day (list pages, dashboards) | ~33× |
| D1 rows written | 100,000/day | ~1,500/day (DPRs, leads, audit) | ~66× |
| D1 storage | 5 GB | Text rows are tiny: ~50 MB/year | ~100× |
| Google Drive storage (Mode G) | 15 GB per Google account, shared with that account's Gmail/Photos (more via Google One) | 30 photos/day × 350 KB + 30 previews × 25 KB ≈ 4.1 GB/year + drawings/brochures | ~2–3 years in a dedicated account; then archive or buy storage |
| Google Drive API | 325,000 quota units/min per user; 750 GB uploads/day per user; 5 TB per file | A few hundred calls/day | Enormous; our own cap is 90 MB/file |
| R2 storage (Mode A only) | 10 GB | Same photos ≈ 3.8 GB/year + drawings | Archive yearly (bullets below; built in Phase 12) |
| Email | Your SMTP quota / Brevo 300/day | ~40–80/day (reminders + digest + OTP) | Comfortable |

The **only** limit you could realistically approach over years is **file storage** (your Google account's 15 GB — or R2's 10 GB in Mode A). Mitigations are built in:
- Photos are **compressed on the phone before upload** (max 1600 px, ~200–400 KB each — a 4 MB camera photo becomes ~300 KB).
- The owner dashboard shows a **storage meter**. In Mode G it asks Google (`about.get`) and shows both numbers: *"Files in NirmaanCRM 4.1 GB · Whole Google account 9.8 of 15 GB (Gmail and Photos count too)"*; you are warned at 80% and 95%. In Mode A: "Files: 6.2 GB of 10 GB free".
- A built-in **"Archive old project"** tool downloads a project's files as a ZIP to your laptop and removes them from cloud storage, keeping all records and thumbnails-of-reference (file name, size, date) intact. **The ZIP is built inside your browser** (a small store-only ZIP writer in `ui.js`, no library): the Worker only streams one file at a time and deletes a file from storage *after* the browser confirms it was saved. A Worker cannot assemble a multi-GB ZIP itself. **In Mode G the everyday "Archive project" is simpler and instant:** the project's Drive folder is moved into `NirmaanCRM/_archive/` and the project becomes read-only — nothing leaves Drive, and files still open through the CRM. The ZIP route becomes the optional **"Free up space"** button (download, confirm, then delete from Drive).
- If you ever *choose* to outgrow free, Cloudflare's paid plan is ~US$5/month (~₹420) — still cheaper than one user of any commercial CRM. Likewise Google storage can be enlarged with a Google One plan (check one.google.com for current India prices) without any change to the CRM. Both are future choices, never a requirement.

**Three design rules that keep a free account safe (checked against Cloudflare's docs, 21 Nov 2026):**
1. **Few queries per click.** A free Worker may make only **50 database queries per request**. Pages must load with a handful of queries (use `db.batch()` and joins, never one query per row). Cron jobs get the same cap, so long jobs (backup, digest) are written to *continue on the next tick* instead of finishing in one go (§7.8 note 6, §11.1).
2. **Index what you filter on.** D1 counts rows *scanned*, not rows returned. A search without an index on a 20,000-row table costs 20,000 reads. Every `WHERE` column used by a list, reminder or report has an index in §5; global search uses indexed prefix matching (name/phone/code `LIKE 'abc%'`), upgrading to SQLite FTS5 only if needed.
3. **Keep CPU tiny.** The free plan allows ~10 ms of *computing* per request or cron run (waiting for the database does not count). Heavy work — building ZIPs, dumping big tables, anything long — is done in the user's browser or in small chunks, never in one big Worker run. If a feature genuinely needs more, Claude must tell you *before* building it; the paid plan lifts this cap.

### 3.3 Architecture (one Worker does everything)

```
 Team phones/laptops (browser, installable PWA)
        │  HTTPS
        ▼
 ┌────────────────────────────────────────────────────┐
 │  Cloudflare Worker  "nirmaan-crm"                  │
 │                                                    │
 │  /            → Static Assets (HTML/CSS/JS pages)  │
 │  /api/*       → JSON API (auth + role checks)      │
 │  /files/*     → Private file download (auth check) │
 │  /s/<token>   → Customer share links (expiring)    │
 │  /brand/*     → Logo, icons, theme (public pictures)│
 │  Cron handler → reminders · digest · DPR nudge ·   │
 │                 nightly backup                     │
 └───────┬───────────────┬───────────────┬────────────┘
         ▼               ▼               ▼
     D1 (SQLite)     GOOGLE DRIVE     SMTP socket → your company email
     all records +   private folders: (fallback: Brevo free relay/API)
     branding        drawings, photos,
     pictures        brochures, backups   [R2 or D1-blobs in Mode A / B]
```

No separate frontend server, no CORS, no second deployment. One `wrangler deploy` publishes everything.

**The Worker is the only place that holds the Google key.** Phones and browsers never talk to Drive directly: they send files to `/api/files` and receive them from `/files/:id`, so every upload and download passes the role check and the audit log, and the key never reaches a browser.

**Keep ordinary pages free:** in `wrangler.jsonc` set `assets.run_worker_first` to `["/api/*", "/files/*", "/s/*", "/brand/*", "/manifest.webmanifest"]`. Only those routes start the Worker; every HTML, CSS and script file is a *static asset*, which Cloudflare serves free and unlimited, so pages never use up the 100,000 daily Worker requests (Cloudflare docs, checked 21 Nov 2026). The side effect, by design: pages are public *shells* with no data in them — every piece of data arrives through `/api/*`, which checks the login on every call.

### 3.4 File storage: three modes (choose in Phase 0) — Mode G, your Google Drive, is the default

- **Mode G — Google Drive (default; your choice).** Every drawing, site photo, challan, brochure and backup is a real file in a private folder tree in **one dedicated company Google account** (for example `yourcompany.crm@gmail.com` — not anyone's personal Gmail):

  ```text
  NirmaanCRM/
    01_Shivneri Heights/   Drawings · Site photos · Challans · Approvals · Brochures · Letters · Other
    02_<next project>/     (created by the CRM the first time a file is saved for that project)
    _company/              letterhead reference PDFs, RERA certificates, company documents
    _backups/              nightly backup parts (§11.1)
    _archive/              projects you have archived (§3.2)
  ```

  **How it works (plain words).** You press **Connect Google Drive** once (Phase 4, Settings → Storage). Google asks the Drive account to allow *NirmaanCRM*; you agree. The CRM keeps the permission slip (a "refresh token") **encrypted** with `APP_KEY`, and uses it to get a one-hour pass whenever it needs to save or fetch a file. Nobody else ever sees the slip; no staff member needs a Google account; no folder is ever shared.

  **The narrow permission.** The CRM asks only for Google's `drive.file` permission: it can see and change **only the files and folders it created itself** — never the rest of that Drive. This permission is on Google's *non-sensitive* list, so no Google review is needed. The trade-off, which is a feature: a file you drop into a folder by hand in the Drive website is invisible to the CRM, and a file the CRM created stays reachable from your own Drive login for ever, even if the CRM were switched off.

  **Why your own sign-in and not a "robot" account.** Google's robot accounts (*service accounts*) have **no storage of their own**, so they can write only into a *Shared Drive*, which needs a paid Google Workspace plan; they cannot save into an ordinary free Drive. The Owner's sign-in (OAuth) works with a free account. If you later move to Google Workspace, a service-account driver can be added without touching the rest of the CRM.

  > **Why Drive, and what to watch (checked 21 Nov 2026).**
  > 1. **The sign-in must not expire.** In a Google Cloud project whose consent screen is *External* and left in *Testing* status, Google ends the sign-in after **7 days** and the CRM would lose its files weekly. Phase 1 add-on therefore chooses the **Personal** audience type (a single-account app: no 7-day expiry, no verification, not public). If your Google Cloud console does not offer *Personal*, the Phase 1 add-on has a short decision box (custom domain, or Workspace *Internal*, or fall back to Mode A/B) — never leave the app in *Testing*.
  > 2. **15 GB is shared** with that account's Gmail and Photos (the meter shows both numbers). A dedicated account keeps it clean. Roughly 4 GB of photos a year means 2–3 years before you archive or buy a Google One plan.
  > 3. **One upload = one request, at most 100 MB.** The free Worker cannot hold a big file in memory (128 MB) or spend CPU on it (about 10 ms), so every upload and download is **streamed straight through** (§3.4 below); our own ceiling is 90 MB per file, default 25 MB.
  > 4. **The Google account is now critical.** Turn on 2-step verification, keep its recovery phone and email current, and write the account name in the same safe place as your Cloudflare login. If Google ever suspended that account, files and nightly backups in it would go together — so §11.1 also keeps the weekly database copy on *your laptop*.
  > 5. **No card needed.** A Google Cloud project is only the place where the sign-in key is made; per Google's pages reviewed on 21 Nov 2026 the Drive API itself needs no billing account. Decline any "free trial / add a card" screen. If Google insists on a card for the *Drive API* or *Credentials* steps, stop and tell Claude.

  **How a file travels (so Claude builds it the safe way).**
  - *Save:* phone compresses the photo → sends the bytes to `POST /api/files` (the Worker checks login, role, project access and size) → the Worker asks Drive to start a **resumable upload** (`uploadType=resumable`, metadata = file name, parent folder, our document number), then forwards the incoming body **as a stream** in one `PUT` to the session address Drive returns, using a `FixedLengthStream` with the exact length — nothing is held in memory → Drive answers with the file id and `md5Checksum`; the Worker stores `store='gdrive'`, `drive_file_id`, `md5` in `documents` and writes the audit sentence. A failure at any step leaves **no half-document**: the row is written only after Drive confirms.
  - *Open:* `GET /files/:id` → permission and project check → the Worker fetches `files/<id>?alt=media` from Drive (passing the browser's `Range` header so video and big PDFs can seek) and streams the answer back with the saved file name and type, `Cache-Control: private, no-store`. **The browser never receives a Google address**, so a forwarded link opens nothing.
  - *Customers:* only through the expiring `/s/<token>` link (§7.10), which streams the same way. Nothing in Drive is ever set to "anyone with the link"; the CRM never calls Drive's permission-sharing functions.
  - *Folders:* created on first need and remembered in `drive_folders`, so a save costs one extra Drive call at most.
  - *If Drive says no:* sign-in rejected (`invalid_grant`) → status becomes **Needs reconnect**, the Owner sees a red banner and gets one email, phones keep new photos in their offline queue and retry after reconnect, downloads show "Files are paused — ask the Owner to reconnect Google Drive"; records, login, DPR text and branding keep working. Google "slow down" answers (403/429 rate-limit, or 5xx) are retried up to three times with growing pauses; the wait costs no CPU.
  - *Nightly check:* a small slice of documents (about 20 per run, oldest-checked first) is verified against Drive (`trashed`, missing, changed `md5Checksum`) and `drive_status` is set to `ok`, `missing` or `trashed`. The Owner sees *"3 files need attention"* with a **Restore / Re-upload / Mark lost** choice — a file someone deleted by hand in Drive is never silently gone.
  - *Mixed stores are fine:* every document records its own `store`, so old files stay where they were when you change `storage.driver`; new files go to the new place.

- **Mode A — Cloudflare R2 (optional; choose it instead of Drive if you prefer files inside Cloudflare).** Activate R2 in the Cloudflare dashboard (one-time payment-method verification; free inside 10 GB). Set a **budget alert** in Cloudflare (Manage Account → Billing → Billable Usage → *Create budget alert*, $1, your email; offered to pay-as-you-go accounts; if you cannot find it, use Mode G or B or ask Claude for the current path) so you'd hear about any anomaly. It only *emails* you; it does not stop usage, so the in-app storage meter and archive tool remain the real guard. R2 can be added later *alongside* Drive (new `storage.driver`, same screens).
- **Mode B — strictly no card.** Files are stored as **BLOBs inside D1** (hard limit: 2 MB per row, so the app caps uploads at 1.8 MB and compresses photos to fit). For large drawing PDFs, use the **"Link" document type**: paste a Google Drive / architect's share link instead of uploading. You can switch Mode B → Mode G (or A) later with one settings change and a Claude-run copy script — the storage layer is an abstraction (`core/storage.js`), which is exactly the modularity you asked for.

Claude must implement `core/storage.js` with drivers `gdrive`, `r2` and `d1` (each exposing the same four functions: `put(stream, meta)`, `get(doc, range)`, `remove(doc)`, `usage()`), selected by the `storage.driver` setting and recorded per document in `documents.store`. The Drive calls live in one file, `core/gdrive.js` (OAuth, token refresh, folders, resumable upload, download, quota, verification) using plain `fetch` — no Google library. The UI must adapt: Mode B shows the size cap and the Link option prominently; Mode G shows the connection status and the quota meter.

**What this means for brochures and branding (§7.10):** Mode G and Mode A accept files up to the `files.brochure_max_mb` setting (default **25 MB**; hard ceiling **90 MB**, because a free-plan request body may be up to 100 MB — Cloudflare docs, checked 21 Nov 2026). Mode B cannot hold a real brochure (1.8 MB cap), so brochures, price lists and videos are **Link** items (Google Drive, Dropbox, YouTube); logos, floor-plan images and letterhead images still fit because the browser shrinks them first. **In every mode the branding pictures (logo, icons, signature, stamp, letterhead images) are stored in the database (`file_blobs`)**, never in Drive or R2, so the login page, the app's icons and every printed letter keep working even while Google Drive is disconnected.

---

## 4. Repository layout & the Module Contract

### 4.1 Folder structure

```
nirmaan-crm/
├── wrangler.jsonc              # Cloudflare config (bindings, run_worker_first, crons, staging env)
├── package.json               # dev-only: wrangler. NO runtime dependencies.
├── migrations/                # numbered, additive-only SQL
│   ├── 0001_core.sql
│   ├── 0002_approvals.sql
│   ├── 0003_drawings.sql
│   ├── 0004_site.sql
│   ├── 0005_procurement.sql
│   ├── 0006_sales.sql
│   ├── 0007_people.sql
│   ├── 0008_email.sql
│   └── 0009_branding.sql      # v1.2: branding, brochure versions, share links, users & project access · v1.3: Google Drive columns (section F)
├── src/
│   ├── index.js               # entry: routes /api/*, /files/*, assets, scheduled()
│   ├── modules/               # BACKEND of each module — one folder per module key (§4.2)
│   │   ├── index.js           # the ONE static list of module imports (Workers cannot scan folders)
│   │   ├── approvals/         #   api.js (routes) · service.js (functions other modules may call)
│   │   │                      #   · hooks.js (event subscribers) — same shape for every module:
│   │   └── …                  #   projects · drawings · site · procurement · sales · people · reports
│   └── core/
│       ├── router.js          # tiny method+path router
│       ├── auth.js            # sessions, password (PBKDF2), OTP
│       ├── db.js              # D1 helpers: query, paginate, soft-delete
│       ├── storage.js         # file-store switch: gdrive / r2 / d1 drivers, per-document `store`
│       ├── gdrive.js          # Google Drive: OAuth sign-in, token refresh, folders, streamed upload/download, quota (§3.4)
│       ├── mail.js            # provider switch: smtp | brevo_api; queue + log
│       ├── smtp.js            # SMTP client over cloudflare:sockets (465 TLS)
│       ├── events.js          # tiny in-process event bus: emit(name, payload) / on(name, handler)
│       ├── notify.js          # in-app + email notification rules engine
│       ├── audit.js           # audit_log writer
│       ├── permissions.js     # the role matrix (§4.5) — single source of truth
│       ├── settings.js        # settings get/set, feature flags, AES-GCM secrets
│       ├── brand.js           # resolves company/project branding + letterhead (§7.10)
│       ├── share.js           # expiring customer share links: create, validate, revoke (§7.10)
│       ├── modules.js         # MODULE REGISTRY (§4.2)
│       └── util.js            # ids, money(paise), dates(IST), validation, CSV
├── public/                    # static website (no build step)
│   ├── index.html             # role-based home (§6)
│   ├── login.html
│   ├── app.css                # the ONLY stylesheet — design tokens §6
│   ├── ui.js                  # shared helpers: api(), toast(), forms, tables,
│   │                          #   photo compression, WhatsApp share, print, i18n
│   ├── i18n.js                # en / hi / mr label dictionaries
│   ├── sw.js + manifest.json  # PWA: installable, offline shell
│   ├── _headers               # security headers (CSP, nosniff, frame-ancestors) — §11.2
│   ├── print.css              # clean "Save as PDF" for letters/POs (letterhead drawn with real images)
│   ├── s.html                 # landing page for customer share links (/s/<token>)
│   ├── settings/              # users · access · branding · letterhead · storage (Google Drive) · email · modules pages
│   ├── print/                 # shared print helper (print.js), general letter, "How your letters will look" preview
│   └── modules/
│       ├── projects/   (index.html, detail.html, module.js)
│       ├── approvals/  (…)
│       ├── drawings/   (…)
│       ├── site/       (…)
│       ├── procurement/(…)
│       ├── sales/      (…)
│       ├── people/     (…)
│       └── reports/    (…)
└── docs/
    ├── THIS_GUIDE.md
    ├── CHANGELOG.md           # updated every phase
    └── DATA_DICTIONARY.md     # every table/field in plain English
```

### 4.2 Module registry & feature flags

`src/core/modules.js` exports one array; **adding a module = one registry entry + one backend folder (`src/modules/<key>/`) + one public folder + one import line in `src/modules/index.js` + one migration**:

```js
// core:true  = part of the spine, cannot be switched off
// nav:true   = shows in the menu when enabled
// enabledByDefault:false = installed but OFF until the Owner flips the switch
// requires   = modules that must be ON for this one to work (checked in Settings)
export const MODULES = [
  { key:"projects",    name:"Projects",        icon:"🏗️", core:true, nav:true, enabledByDefault:true,  requires:[] },
  { key:"approvals",   name:"Approvals",       icon:"📋", nav:true, enabledByDefault:true,  requires:["projects"] },
  { key:"drawings",    name:"Drawings",        icon:"📐", nav:true, enabledByDefault:true,  requires:["projects"] },
  { key:"site",        name:"Site Work",       icon:"👷", nav:true, enabledByDefault:true,  requires:["projects"] },
  { key:"procurement", name:"Purchase",        icon:"🛒", nav:true, enabledByDefault:true,  requires:["projects"] },
  { key:"sales",       name:"Sales",           icon:"🤝", nav:true, enabledByDefault:true,  requires:["projects"] }, // reacts to site's events if Site is ON
  { key:"people",      name:"Team & Hiring",   icon:"🧑‍💼", nav:true, enabledByDefault:false, requires:[] },          // optional
  { key:"reports",     name:"Reports",         icon:"📊", nav:true, enabledByDefault:true,  requires:["projects"] },
];
```

- Each module's `api.js` exports `routes` (array of `{method, path, handler, perm}`). `src/modules/index.js` imports every module's `api.js`, `service.js` and `hooks.js` **by name, once** (a Worker cannot discover folders at run time), and `src/index.js` mounts the routes and registers the hooks for every module that is switched ON.
- A setting `module.<key>.enabled` (Owner → Settings → Modules, simple ON/OFF switches) hides nav **and** blocks that module's API. Turning a module off never deletes its data.
- Modules may call **core helpers only** (`db`, `notify`, `audit`, `storage`, `mail`, `permissions`, `events`). Two ways for modules to cooperate, and nothing else:
  1. **Ask** — a small exported function in the other module's `service.js` (e.g. sales calls `site.milestonesDone(projectId)`), never raw SQL into another module's tables.
  2. **Announce** — emit an event through `core/events.js`; any module that cares subscribes in its own `hooks.js`. Example: `site` emits `milestone.done`; `sales/hooks.js` subscribes and readies the matching demands. `site` never imports `sales`, so either can be removed or replaced. A failing subscriber is logged to the audit log and never breaks the emitter's save; events run after the response is sent (`ctx.waitUntil`). A subscriber for a module that is OFF is simply not registered.

### 4.3 API conventions

- Paths: `/api/<module>/<resource>` (e.g. `/api/sales/leads`). `GET` list/detail, `POST` create, `PUT /:id` update, `DELETE /:id` soft-delete (money records — receipts, bills, demands, POs — use `POST /:id/cancel` or `/reverse` with a reason instead). **Every `POST/PUT/DELETE` must carry the header `X-NirmaanCRM: 1`** (added automatically by `ui.js`); the server rejects state-changing calls without it. Together with `SameSite=Lax` cookies this blocks cross-site request forgery.
- Every response: `{ ok:true, data:… }` or `{ ok:false, error:"plain-language message" }`.
- Lists support `?q=` (search), `?page=` (25/page), `?project_id=`, `?status=`.
- Every write: permission check → validation → write → `audit()` → optional `notify()`.
- Offline-created records carry a `client_uuid` (idempotency key) so a retry never creates a duplicate.
- File download: `GET /files/:documentId` → auth + permission check → stream from storage with `Content-Disposition` and `X-Content-Type-Options: nosniff`. **No public bucket or Google Drive URLs, ever** — a browser is never handed an R2 or Google address. A file reaches someone *without* a login in only two ways: (1) the few branding pictures under `/brand/*` (logo, icons — **never** signature or stamp), and (2) an expiring, revocable, tokenised customer link `/s/<token>` (§7.10). Uploads are checked on the server against an allow-list (jpg, png, webp, heic, pdf, docx, xlsx, csv, txt, dwg); **SVG and HTML uploads are refused** (they can carry scripts) — a browser may still *choose* an SVG logo, but it redraws it as a PNG itself before uploading (§7.10). Files above ~2 MB are uploaded as a **raw request body with a known length** and streamed straight into storage (never parsed as a multipart form), which keeps the free CPU and memory caps safe.
- **Google sign-in routes (Owner only; §3.4):** `POST /api/storage/google/start` (carries the usual `X-NirmaanCRM` header; creates an `oauth_states` row and returns Google's address) · `GET /api/storage/google/callback` (Google sends the Owner's browser back here with `code` and `state`) · `POST /api/storage/google/disconnect` · `GET /api/storage/status`. The callback is the **only** state-changing `GET` in the app and cannot carry the custom header, so it is protected instead by the **single-use `state`** (looked up by hash, unexpired, not used, created by *this* logged-in Owner) plus the PKCE verifier; anything else gets one plain "This sign-in link is no longer valid" page. No token, code or secret is ever written to a log, an audit line, a URL the app shows, or an export.

### 4.4 Database conventions

Snake_case names; module prefixes (`sal_`, `pro_`, `site_`, `apr_`, `drw_`, `ppl_`); core tables unprefixed. Every table: `id INTEGER PRIMARY KEY AUTOINCREMENT`, `created_at TEXT DEFAULT (datetime('now'))`, `deleted_at TEXT NULL` (where soft-delete applies). Money = `INTEGER` paise. Percentages = `INTEGER` basis points (suffix `_bp`; 18% = 1800). Timestamps = UTC text in SQLite format `YYYY-MM-DD HH:MM:SS` (column defaults and app code both use it), displayed IST; date-only columns hold `YYYY-MM-DD` IST dates. Phones = `+91XXXXXXXXXX`. Indexes on `project_id`, `status`, every foreign key used in a list, and date columns used in reminders — D1 bills every row *scanned*, so an unindexed filter is a cost problem as well as a speed problem (§3.2).

### 4.5 Roles & permission matrix (implemented in `core/permissions.js`)

Actions: **V**iew · **C**reate · **E**dit · **A**pprove · **X** export.

| Module | Owner | PM | Site Engg | Sales | Accounts | Purchase | HR/Admin | Viewer (CA/Auditor) |
|---|---|---|---|---|---|---|---|---|
| Projects | VCEAX | VCE | V | V | V | V | V | V |
| Approvals | VCEAX | VCEA | V | – | V | – | – | V |
| Drawings | VCEAX | VCEA | V (latest IFC only) | – | – | V | – | V |
| Site Work | VCEAX | VCEA | VCE | V (milestones only) | V | V (GRN) | – | V |
| Purchase | VCEAX | VCEA (approve ≤ limit) | C (GRN only) | – | VCE (bills) | VCE | – | V |
| Sales | VCEAX | VCEA | – | VCE (own leads; all if Owner-granted) | VCE (demands/receipts) | – | – | V |
| Team & Hiring | VCEAX | V | – | – | – | – | VCE | – |
| Reports | VCEAX | VCEX | V (site) | V (own) | VCEX | V | V (people) | VX |
| Branding & letterhead | VCEAX | V | – | V | V (+ bank details) | – | – | – |
| Brochures & collateral | VCEAX | VCE | V | V + share | V | V | V | V |
| Share links | VCEAX (all) | VCE (all; can revoke any) | – | C · V · revoke **own** | – | – | – | – |
| Users & Settings | VCEA | – | – | – | – | – | – | – |

Record-level rule: a Sales user sees only leads/bookings assigned to them (a booking follows its lead's assignee, or its creator if there is no lead) unless the Owner flips `sales.share_all_leads` in Settings. PO approval limit for PM is a setting (`po.pm_approval_limit_paise`, default ₹50,000) and is compared with the PO **total including GST**; above it, only Owner approves. **Field-level rule:** PAN and masked Aadhaar on bookings are shown only to Owner, Accounts and the booking's own Sales user — the Viewer (CA) role and other roles see them blanked (`PAN: hidden`). **Extra roles:** a person with two jobs (say Accounts + Purchase in a small office) has one main role plus `extra_roles`; their permissions are the **union**. `owner` can never be an extra role. **Brand fields:** PAN and bank account numbers (§7.10) are shown only to Owner and Accounts (bank details also print on demand letters and receipts); everyone else sees them blanked. **Branding files:** logo and letterhead pictures may be fetched by any logged-in user; **signature and stamp** only through the server-side print views of documents that role may issue. **The server enforces all of this on every request.**

### 4.6 Users, the Owner (admin) and project access — one login per person

**The roles in plain English** (these exact sentences appear beside the role dropdown):

| Role | In one line |
|---|---|
| **Owner** | You. The admin: everything — adding people, branding, settings, email — and approving any purchase order. |
| **Project Manager** | Runs a project: approvals, drawings, site work, purchase orders up to your limit; sees sales numbers. |
| **Site Engineer** | Files the daily report, opens the latest drawings, records material received, raises snags. Sees no money. |
| **Sales** | Leads, site visits, flats, bookings and brochures — only their own leads unless you allow more. |
| **Accounts** | Receipts, demands, vendor bills, reports, and the bank details printed on letters. |
| **Purchase** | Vendors, quotations and purchase orders; sees material received. |
| **HR / Admin** | Team & Hiring only. |
| **Viewer (CA / auditor)** | Read-only; can export reports; PAN and Aadhaar are hidden. |

**How you become the admin (Phase 3).** The first login with `OWNER_EMAIL` + `OWNER_PASSWORD` creates your account with role `owner` and `is_primary_owner = 1`, and makes you choose your own password straight away (`must_change_password`). From then on the two secrets are only a recovery tool (§11.4).

**Owner safeguards — enforced on the server and tested in Phases 3 and 13:**
1. There is **always at least one active Owner**. Any request that would leave none (deactivate, demote, delete) is refused.
2. The **primary owner** (you) cannot be deactivated, demoted or edited by anyone else, even another Owner.
3. Nobody can change **their own role**.
4. Only an Owner can create or edit an Owner, and only while the setting `access.allow_second_owner` is ON (default **OFF**). *Recommendation:* switch it ON and make one trusted person (a partner or family member) a second Owner, so the business is never locked behind a single phone.
5. Every user action is written to the audit log as a plain sentence ("Dhaval added Ramesh as Site Engineer on Shivneri Heights").

**Adding a person (Owner → Users → + Add person):** name · email (their login; must be unique) · mobile (+91) · role (with the one-line description) · extra roles (optional) · projects (§ below) · language. The system creates a **temporary password** (12 readable characters, no look-alike letters), shown **once** with Copy and Share buttons; it works only until their first login (and expires in 7 days). At first login the person must choose their own password (at least 10 characters, not the temporary one). Once email works (Phase 11) they can use **"Email me a login code"** instead and never need to remember a password.

**Managing people:** each person's row shows role, projects, **last login**, and Active/Deactivated. Buttons: *Reset password* (new temporary one), *Log out this person everywhere*, *Deactivate / Reactivate*. A separate **Log out everyone** button (Owner) ends all sessions at once — use it after a lost phone or any doubt. Deactivating a Sales, Site or Approvals person asks "Move their open work to…?" and emits the event `user.deactivated`; each module's own `hooks.js` reassigns that person's open leads, snags and approval items (modules stay independent).

**Which projects can a person see?** `project_members` lists who works on which project. Settings → **Access** has one checkbox per role: *"Limit this role to the projects they are assigned to."* Default: **only Site Engineer is ticked**; the Owner is never limited. A limited person sees only their projects in the picker, lists, search, reports, brochures and file downloads — enforced centrally by `permissions.visibleProjectIds(user)`, which every module's queries must use. A limited person with no project yet sees one friendly line: "No project assigned yet — ask the Owner."

**Fixed roles, easy to extend.** The eight roles are fixed so everyone speaks the same language. Needing a ninth (for example "Liaison executive") is a 15-minute change with the template in §10.7 — `users.role` is plain text, so it needs no database change.

---

## 5. Database schema (complete — Claude executes this as numbered migrations)

> **v1.1 note:** these migrations were corrected before any of them was applied anywhere, so editing them is legitimate. From the first real deploy onward they are frozen — every later change is a new file (§10.1).
>
> **v1.2 note:** `0009_branding.sql` (at the end of this section) is new. 0001–0008 are unchanged from v1.1, so if you already applied them, only 0009 is new. Everything in 0009 is additive (`ADD COLUMN`, `CREATE TABLE`, `CREATE INDEX`), as §10.1 requires.
>
> **v1.3 note:** section **F** at the end of `0009_branding.sql` is new (Google Drive columns, `drive_folders`, `oauth_states`). If you are starting fresh, create 0009 with sections A–F as printed. **If you already applied the v1.2 version of 0009 to a real database, do not edit it** (§10.1): save section F alone as `0010_gdrive.sql` and apply that. Either way, every statement is additive.
>
> Claude: create these exactly as the numbered migration files. Add the listed indexes. Do not invent extra columns without noting them in DATA_DICTIONARY.md. All future changes are new additive migrations (§10).

### 0001_core.sql

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT,
  role TEXT NOT NULL DEFAULT 'viewer',           -- owner|pm|site|sales|accounts|purchase|hr|viewer
  password_hash TEXT, password_salt TEXT,
  lang TEXT NOT NULL DEFAULT 'en',               -- en|hi|mr
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT, created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                           -- SHA-256 of the random cookie token
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL, user_agent TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL, code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, -- short code used in PO numbers, e.g. "SHIV-A"
  address TEXT, ward TEXT, city TEXT DEFAULT 'Mumbai',
  type TEXT DEFAULT 'new_build',                 -- new_build|redevelopment|plot
  status TEXT DEFAULT 'planning',                -- planning|approvals|under_construction|completed|on_hold
  rera_no TEXT, rera_expiry TEXT,
  start_date TEXT, target_date TEXT, budget_paise INTEGER,
  notes TEXT, created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  module TEXT, entity TEXT, entity_id INTEGER,   -- polymorphic link: ('site','dpr',42)
  title TEXT NOT NULL, category TEXT,            -- drawing|photo|challan|letter|noc|contract|other
  kind TEXT NOT NULL DEFAULT 'file',             -- file|link
  r2_key TEXT, external_url TEXT,                -- r2_key = Mode A object key · link-type documents store a URL · Google Drive files use drive_file_id (0009 section F)
  blob_id INTEGER,                               -- D1-blob storage reference (Mode B, and branding pictures in every mode)
  mime TEXT, size_bytes INTEGER,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE file_blobs (                        -- Mode B files, and branding pictures in every mode (§3.4)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mime TEXT, size_bytes INTEGER, data BLOB,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, body TEXT, link TEXT,
  read_at TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY, value_json TEXT NOT NULL,
  updated_by INTEGER, updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, action TEXT, entity TEXT, entity_id INTEGER,
  summary TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE rate_limits (                       -- login / OTP throttling (Phase 3)
  key TEXT PRIMARY KEY,                          -- e.g. 'login:ramesh@x.in' or 'otp:ramesh@x.in'
  window_start TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE counters (                          -- race-safe sequences, e.g. key 'po:<project_id>'
  key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_otp_email ON otp_codes(email, created_at);
CREATE INDEX idx_documents_link ON documents(module, entity, entity_id);
CREATE INDEX idx_documents_project ON documents(project_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
```

### 0002_approvals.sql

```sql
CREATE TABLE apr_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL, authority TEXT,            -- MCGM, MahaRERA, CFO, AAI…
  category TEXT DEFAULT 'approval',              -- approval|noc|compliance|renewal
  stage_order INTEGER DEFAULT 100,
  status TEXT DEFAULT 'not_started',             -- not_started|applied|query|approved|rejected|expired|na
  applied_on TEXT, approved_on TEXT, valid_till TEXT,
  reminder_days INTEGER DEFAULT 30,
  renew_months INTEGER,                          -- renewal items: months added to valid_till when completed (3, 12…)
  owner_user_id INTEGER REFERENCES users(id),
  consultant TEXT, fee_paise INTEGER, notes TEXT,
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE apr_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES apr_items(id),
  event TEXT NOT NULL, note TEXT, by_user INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_apr_project ON apr_items(project_id, status);
CREATE INDEX idx_apr_events_item ON apr_events(item_id);
CREATE INDEX idx_apr_valid ON apr_items(valid_till);
```

### 0003_drawings.sql

```sql
CREATE TABLE drw_drawings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  code TEXT NOT NULL,                            -- e.g. "STR-A-501"
  title TEXT NOT NULL,
  discipline TEXT DEFAULT 'arch',                -- arch|str|mep|fire|landscape|interior
  zone TEXT,                                     -- wing / floor / area
  waiting_consultant INTEGER NOT NULL DEFAULT 0, -- 1 = PM is waiting for the consultant to issue this drawing
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE drw_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drawing_id INTEGER NOT NULL REFERENCES drw_drawings(id),
  rev_no TEXT NOT NULL,                          -- R0, R1, R2…
  status TEXT DEFAULT 'draft',                   -- draft|ifc|superseded  (ifc = Issued For Construction)
  issued_on TEXT, received_from TEXT, note TEXT,
  document_id INTEGER REFERENCES documents(id),
  issued_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_drw_project ON drw_drawings(project_id, discipline);
CREATE INDEX idx_rev_drawing ON drw_revisions(drawing_id, status);
CREATE UNIQUE INDEX uq_drw_code ON drw_drawings(project_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_rev_no ON drw_revisions(drawing_id, rev_no);
CREATE UNIQUE INDEX uq_rev_one_ifc ON drw_revisions(drawing_id) WHERE status = 'ifc';  -- never two live revisions
```

### 0004_site.sql

```sql
CREATE TABLE site_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  wing TEXT, name TEXT NOT NULL,                 -- "Wing A – 5th slab"
  milestone_key TEXT,                            -- stable code used by payment plans, e.g. 'SLAB_5' (never change after use)
  planned_date TEXT, actual_date TEXT,
  status TEXT DEFAULT 'pending',                 -- pending|in_progress|done
  sort_order INTEGER DEFAULT 100,
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE site_dprs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  report_date TEXT NOT NULL, wing TEXT,
  work_summary TEXT NOT NULL,                    -- 2 lines is enough
  labour_count INTEGER, weather TEXT,
  materials_used TEXT, issues TEXT, safety_incident TEXT,
  created_by INTEGER REFERENCES users(id),
  client_uuid TEXT UNIQUE,                       -- offline idempotency
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE site_snags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  wing TEXT, location TEXT, title TEXT NOT NULL,
  severity TEXT DEFAULT 'medium',                -- low|medium|high
  status TEXT DEFAULT 'open',                    -- open|fixed|verified
  assigned_to INTEGER REFERENCES users(id), due_date TEXT, closed_at TEXT,
  created_by INTEGER REFERENCES users(id), client_uuid TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE INDEX idx_dpr_project_date ON site_dprs(project_id, report_date);
CREATE INDEX idx_milestone_project ON site_milestones(project_id, status);
CREATE UNIQUE INDEX uq_milestone_key ON site_milestones(project_id, COALESCE(wing,''), milestone_key) WHERE milestone_key IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_snag_project ON site_snags(project_id, status);
```

### 0005_procurement.sql

```sql
CREATE TABLE pro_vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, category TEXT,             -- cement|steel|bricks|rmc|contractor|services…
  contact_person TEXT, phone TEXT, email TEXT, gstin TEXT, address TEXT,
  rating INTEGER, notes TEXT, active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE pro_rfqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  title TEXT NOT NULL, material TEXT, qty REAL, unit TEXT, needed_by TEXT,
  status TEXT DEFAULT 'open',                    -- open|closed|cancelled
  created_by INTEGER, created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE pro_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id INTEGER NOT NULL REFERENCES pro_rfqs(id),
  vendor_id INTEGER NOT NULL REFERENCES pro_vendors(id),
  rate_paise INTEGER, amount_paise INTEGER, delivery_days INTEGER, terms TEXT,
  document_id INTEGER REFERENCES documents(id),
  selected INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE pro_pos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  vendor_id INTEGER NOT NULL REFERENCES pro_vendors(id),
  rfq_id INTEGER, po_no TEXT UNIQUE,             -- 'PO-<project code>-<4-digit po_seq>'
  po_seq INTEGER NOT NULL,                       -- from counters key 'po:<project_id>'; never reused, even if cancelled
  amount_paise INTEGER NOT NULL,                 -- SUBTOTAL before GST = sum of line items
  gst_bp INTEGER DEFAULT 1800,                   -- GST in basis points (18% = 1800)
  gst_paise INTEGER NOT NULL DEFAULT 0, total_paise INTEGER NOT NULL DEFAULT 0, -- total = subtotal + GST; PM limit compares THIS
  terms TEXT,
  status TEXT DEFAULT 'draft',                   -- draft|pending_approval|approved|rejected|part_received|received|closed|cancelled
  approved_by INTEGER, approved_at TEXT, created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE pro_po_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL REFERENCES pro_pos(id),
  description TEXT NOT NULL, qty REAL, unit TEXT,
  rate_paise INTEGER, amount_paise INTEGER
);
CREATE TABLE pro_grns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL REFERENCES pro_pos(id),
  received_on TEXT NOT NULL, qty_note TEXT, challan_no TEXT,
  received_by INTEGER REFERENCES users(id),
  document_id INTEGER REFERENCES documents(id),  -- photo of delivery challan
  client_uuid TEXT UNIQUE, created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE pro_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER REFERENCES pro_pos(id),
  vendor_id INTEGER NOT NULL REFERENCES pro_vendors(id),
  bill_no TEXT, amount_paise INTEGER NOT NULL, due_date TEXT,
  status TEXT DEFAULT 'received',                -- received|approved|paid|hold|cancelled (never deleted)
  paid_on TEXT, payment_ref TEXT,
  document_id INTEGER REFERENCES documents(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_po_project ON pro_pos(project_id, status);
CREATE UNIQUE INDEX uq_po_seq ON pro_pos(project_id, po_seq);
CREATE INDEX idx_quote_rfq ON pro_quotes(rfq_id);
CREATE INDEX idx_poitem_po ON pro_po_items(po_id);
CREATE INDEX idx_grn_po ON pro_grns(po_id);
CREATE INDEX idx_bill_due ON pro_bills(due_date, status);
```

### 0006_sales.sql

```sql
CREATE TABLE sal_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, -- phone stored as +91XXXXXXXXXX
  source TEXT DEFAULT 'other',                   -- portal_99acres|portal_magicbricks|portal_housing|broker|referral|hoarding|walkin|website|other
  source_detail TEXT, budget_paise INTEGER, config_pref TEXT,
  status TEXT DEFAULT 'new',                     -- new|contacted|site_visit|negotiation|booked|lost
  assigned_to INTEGER REFERENCES users(id),
  next_followup_at TEXT, last_contact_at TEXT,
  first_contact_at TEXT,                         -- set once; drives the response-time report and SLA nudges
  consent INTEGER DEFAULT 0, consent_at TEXT,    -- DPDP: customer agreed to be contacted (and when)
  notes TEXT, created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE sal_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES sal_leads(id),
  type TEXT DEFAULT 'call',                      -- call|whatsapp|visit|note
  outcome TEXT, note TEXT, by_user INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE sal_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES sal_leads(id),
  project_id INTEGER REFERENCES projects(id),
  visit_at TEXT NOT NULL,
  status TEXT DEFAULT 'scheduled',               -- scheduled|done|no_show|cancelled
  feedback TEXT, by_user INTEGER, created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE sal_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  wing TEXT, floor INTEGER, unit_no TEXT NOT NULL,
  type TEXT,                                     -- 1BHK|2BHK|3BHK|shop|office
  carpet_sqft REAL, rera_carpet_sqft REAL,
  price_paise INTEGER, floor_rise_paise INTEGER DEFAULT 0,
  status TEXT DEFAULT 'available',               -- available|blocked|booked|agreement|registered
  blocked_till TEXT, created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE sal_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  firm TEXT NOT NULL, contact TEXT, phone TEXT, rera_no TEXT,
  brokerage_default_bp INTEGER, notes TEXT, active INTEGER DEFAULT 1,  -- basis points: 2% = 200
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE sal_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  unit_id INTEGER NOT NULL REFERENCES sal_inventory(id),
  lead_id INTEGER REFERENCES sal_leads(id),
  customer_name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT,
  pan TEXT, aadhaar_masked TEXT,                 -- PAN is restricted (§4.5); Aadhaar: masked only, XXXX-XXXX-1234
  token_paise INTEGER, agreed_price_paise INTEGER NOT NULL,
  payment_plan TEXT DEFAULT 'clp',               -- clp|down_payment|custom
  booking_date TEXT, agreement_date TEXT, registration_date TEXT,
  gst_bp INTEGER DEFAULT 500,                    -- GST on demands: 5% = 500, 1% affordable = 100, commercial per CA (editable)
  status TEXT DEFAULT 'token',                   -- token|booked|agreement|registered|cancelled
  cancelled_on TEXT, cancel_reason TEXT,         -- a cancelled booking releases the flat (§7.6)
  channel_partner_id INTEGER REFERENCES sal_partners(id),
  brokerage_bp INTEGER, created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE sal_plan_stages (                   -- CLP template per project
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  stage_name TEXT NOT NULL,                      -- "On Booking", "5th slab", "On possession"
  pct_bp INTEGER NOT NULL,                       -- basis points: 10% = 1000; all stages of a project must add to 10000
  milestone_key TEXT,                            -- matches site_milestones.milestone_key; NULL for stages not tied to site work
  sort_order INTEGER DEFAULT 100
);
CREATE TABLE sal_demands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES sal_bookings(id),
  milestone_id INTEGER REFERENCES site_milestones(id),  -- filled when the booking's schedule is generated
  stage_id INTEGER REFERENCES sal_plan_stages(id),
  label TEXT NOT NULL, amount_paise INTEGER NOT NULL, gst_paise INTEGER DEFAULT 0,
  due_date TEXT,
  settled_paise INTEGER NOT NULL DEFAULT 0,      -- cash received + TDS deducted so far (kept in step by receipts)
  status TEXT DEFAULT 'scheduled',               -- scheduled (future) | ready (milestone done, awaiting review) | sent | partial | paid | overdue | cancelled
  letter_document_id INTEGER REFERENCES documents(id),
  sent_at TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE sal_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES sal_bookings(id),
  demand_id INTEGER REFERENCES sal_demands(id),
  amount_paise INTEGER NOT NULL,                 -- cash actually received
  tds_paise INTEGER NOT NULL DEFAULT 0,          -- TDS the customer deducted (1% s.194-IA; Form 26QB) — counts toward the demand
  mode TEXT,                                     -- cheque|neft|rtgs|upi|cash
  ref_no TEXT, received_on TEXT NOT NULL, received_by INTEGER, note TEXT,
  reversed_at TEXT, reversal_note TEXT,          -- bounced cheque / wrong entry: reverse, never delete
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE sal_brokerage_payments (           -- what has actually been paid to channel partners
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES sal_bookings(id),
  partner_id INTEGER NOT NULL REFERENCES sal_partners(id),
  amount_paise INTEGER NOT NULL, tds_paise INTEGER NOT NULL DEFAULT 0,  -- TDS on commission (s.194H) — confirm rate with CA
  paid_on TEXT NOT NULL, mode TEXT, ref_no TEXT, note TEXT,
  reversed_at TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_lead_assignee ON sal_leads(assigned_to, status, next_followup_at);
CREATE INDEX idx_lead_phone ON sal_leads(phone);
CREATE INDEX idx_inventory_project ON sal_inventory(project_id, status);
CREATE INDEX idx_demand_due ON sal_demands(due_date, status);
CREATE INDEX idx_receipt_booking ON sal_receipts(booking_id);
CREATE INDEX idx_activity_lead ON sal_activities(lead_id, created_at);
CREATE INDEX idx_visit_lead ON sal_visits(lead_id, visit_at);
CREATE INDEX idx_visit_day ON sal_visits(visit_at, status);
CREATE INDEX idx_booking_project ON sal_bookings(project_id, status);
CREATE INDEX idx_demand_booking ON sal_demands(booking_id, status);
CREATE INDEX idx_brokerage_booking ON sal_brokerage_payments(booking_id);
CREATE UNIQUE INDEX uq_inventory_unit ON sal_inventory(project_id, COALESCE(wing,''), unit_no) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_booking_one_active_per_unit ON sal_bookings(unit_id) WHERE status <> 'cancelled' AND deleted_at IS NULL;  -- the database itself refuses a double booking
```

### 0007_people.sql (optional module)

```sql
CREATE TABLE ppl_staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, role_title TEXT,
  department TEXT,                               -- site|sales|accounts|purchase|admin
  phone TEXT, email TEXT, joined_on TEXT,
  employment TEXT DEFAULT 'staff',               -- staff|contractor|consultant
  active INTEGER DEFAULT 1, notes TEXT,
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE ppl_hiring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position TEXT NOT NULL, project_id INTEGER REFERENCES projects(id),
  status TEXT DEFAULT 'open',                    -- open|interviewing|offered|hired|closed
  opened_on TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE ppl_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hiring_id INTEGER NOT NULL REFERENCES ppl_hiring(id),
  name TEXT NOT NULL, phone TEXT,
  status TEXT DEFAULT 'new',                     -- new|shortlisted|interview|selected|rejected
  interview_on TEXT, note TEXT,
  resume_document_id INTEGER REFERENCES documents(id),
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE INDEX idx_cand_hiring ON ppl_candidates(hiring_id, status);
```

### 0008_email.sql

```sql
CREATE TABLE email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email TEXT NOT NULL, subject TEXT NOT NULL, body_html TEXT,
  status TEXT DEFAULT 'queued',                  -- queued|sent|failed
  error TEXT, attempts INTEGER DEFAULT 0, next_attempt_at TEXT,
  template TEXT, related_entity TEXT, related_id INTEGER,        -- e.g. 'demand.send', 'sal_demands', 42
  attachment_document_id INTEGER REFERENCES documents(id),       -- e.g. the saved demand-letter PDF
  provider TEXT, message_id TEXT,                                -- smtp | brevo_api
  created_at TEXT DEFAULT (datetime('now')), sent_at TEXT
);
CREATE TABLE backup_log (                        -- nightly backup runs, resumable in chunks (§11.1)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT DEFAULT 'nightly',                   -- nightly|manual
  status TEXT DEFAULT 'running',                 -- running|ok|failed
  cursor_json TEXT,                              -- where the next tick continues (table, last id)
  files_written INTEGER DEFAULT 0, bytes INTEGER DEFAULT 0, note TEXT,
  started_at TEXT DEFAULT (datetime('now')), finished_at TEXT
);
CREATE INDEX idx_email_status ON email_log(status, next_attempt_at);
CREATE INDEX idx_backup_started ON backup_log(started_at);
```

### 0009_branding.sql (v1.2 — branding, brochure versions, share links, users & project access · v1.3 — Google Drive storage, section F)

```sql
-- ===== A. documents: versions, audience, language (brochures, floor plans, branding files) =====
ALTER TABLE documents ADD COLUMN series_key TEXT;                       -- groups the versions of ONE item: 'brochure:en', 'price_list', 'brand:logo' …
ALTER TABLE documents ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN is_latest INTEGER NOT NULL DEFAULT 1;  -- 0 = archived older version (kept, never deleted)
ALTER TABLE documents ADD COLUMN supersedes_id INTEGER REFERENCES documents(id);
ALTER TABLE documents ADD COLUMN audience TEXT NOT NULL DEFAULT 'internal';  -- internal | customer  (only 'customer' can EVER be shared by link)
ALTER TABLE documents ADD COLUMN language TEXT;                         -- en | hi | mr | NULL
-- New values for documents.category: branding | brochure | floor_plan | price_list | rera_certificate | video_link | site_photo
-- Reserved series_key values for branding files: brand:logo · brand:logo_icon · brand:signature · brand:stamp ·
--   brand:letterhead_header · brand:letterhead_footer · brand:letterhead_full · brand:letterhead_pdf (reference copy) ·
--   brand:pwa_192 · brand:pwa_512 · brand:favicon       (project_id NULL = company; a project row = that project's override)
CREATE UNIQUE INDEX uq_doc_latest ON documents(COALESCE(project_id,0), series_key)
  WHERE is_latest = 1 AND series_key IS NOT NULL AND deleted_at IS NULL;     -- one live version per item, enforced by the database
CREATE INDEX idx_documents_series ON documents(series_key, project_id, version);
CREATE INDEX idx_documents_category ON documents(project_id, category, is_latest);

-- ===== B. users: second job, forced password change, protected primary owner =====
ALTER TABLE users ADD COLUMN extra_roles TEXT;                          -- JSON list e.g. '["accounts","purchase"]'; permissions = union with role; never 'owner'
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
ALTER TABLE users ADD COLUMN is_primary_owner INTEGER NOT NULL DEFAULT 0;   -- the bootstrap owner; cannot be demoted or deactivated by anyone else (§4.6)
ALTER TABLE users ADD COLUMN deactivated_at TEXT;
ALTER TABLE users ADD COLUMN deactivated_by INTEGER REFERENCES users(id);
CREATE UNIQUE INDEX uq_primary_owner ON users(is_primary_owner) WHERE is_primary_owner = 1;   -- there can be only one

-- ===== C. project_members: who may see which project (§4.6) =====
CREATE TABLE project_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  added_by INTEGER REFERENCES users(id),
  removed_at TEXT,                                -- removal keeps history; re-adding creates a new row
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_project_member ON project_members(project_id, user_id) WHERE removed_at IS NULL;
CREATE INDEX idx_project_member_user ON project_members(user_id, removed_at);

-- ===== D. brand_profiles: company default (project_id NULL) + optional per-project overrides (§7.10) =====
CREATE TABLE brand_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),     -- NULL = company default. A project row stores ONLY what differs: a NULL field means "use the company value"
  legal_name TEXT, trade_name TEXT, tagline TEXT,
  address TEXT, phone TEXT, email TEXT, website TEXT,
  gstin TEXT, cin_or_llpin TEXT, promoter_rera_ref TEXT,   -- project RERA numbers live on projects.rera_no
  pan_enc TEXT,                                   -- RESTRICTED: AES-GCM encrypted with APP_KEY (Owner/Accounts only)
  bank_account_name TEXT, bank_name TEXT, bank_branch TEXT, bank_ifsc TEXT,
  bank_account_enc TEXT,                          -- RESTRICTED: AES-GCM encrypted; a project row = that project's RERA designated collection account
  signatory_name TEXT, signatory_title TEXT,
  footer_text TEXT,                               -- small print under every letter (e.g. "Subject to Mumbai jurisdiction")
  wa_intro_text TEXT,                             -- WhatsApp message with {{name}} {{project}} {{link}} {{expiry}} {{trade_name}}
  colour_primary TEXT, colour_secondary TEXT, colour_accent TEXT,   -- '#RRGGBB'; primary must reach 4.5:1 contrast against white
  letterhead_mode TEXT,                           -- generated | bands | fullpage
  margin_top_mm INTEGER, margin_bottom_mm INTEGER, margin_side_mm INTEGER,   -- safe area for 'fullpage'; defaults 45 / 30 / 20
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT DEFAULT (datetime('now')), created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_brand_scope ON brand_profiles(COALESCE(project_id,0));

-- ===== E. share_links: expiring, revocable customer links (§7.10). The file itself is never public. =====
CREATE TABLE share_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,                -- SHA-256 of the random token; the token itself is never stored
  document_id INTEGER NOT NULL REFERENCES documents(id),
  project_id INTEGER REFERENCES projects(id),
  entity TEXT, entity_id INTEGER,                 -- optional polymorphic link, e.g. ('sal_leads', 42): core never depends on the Sales tables
  recipient_label TEXT,                           -- "Mr Kulkarni" — for your eyes only; no phone number stored here
  created_by INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  max_views INTEGER,                              -- NULL = unlimited until expiry
  view_count INTEGER NOT NULL DEFAULT 0,          -- counted when the customer taps Open, not when a chat app previews the link
  first_viewed_at TEXT, last_viewed_at TEXT,
  revoked_at TEXT, revoked_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_share_doc ON share_links(document_id);
CREATE INDEX idx_share_entity ON share_links(entity, entity_id);
CREATE INDEX idx_share_creator ON share_links(created_by, created_at);
CREATE INDEX idx_share_expiry ON share_links(expires_at, revoked_at);

-- ===== F. Google Drive storage (v1.3, §3.4) =====
-- documents.store: where THIS file lives. NULL = a link item, or a row from before v1.3 (resolve as: r2_key set -> 'r2', blob_id set -> 'd1').
ALTER TABLE documents ADD COLUMN store TEXT CHECK (store IN ('gdrive','r2','d1'));
ALTER TABLE documents ADD COLUMN drive_file_id TEXT;                    -- Google Drive file id (an opaque string; never shown to users, never a download address)
ALTER TABLE documents ADD COLUMN drive_folder_id TEXT;                  -- the Drive folder it sits in (for the nightly check and archive moves)
ALTER TABLE documents ADD COLUMN thumb_drive_file_id TEXT;              -- small preview picture (photos), also in Drive
ALTER TABLE documents ADD COLUMN md5 TEXT;                              -- Drive's md5Checksum at upload; changed value = file was edited outside the CRM
ALTER TABLE documents ADD COLUMN drive_status TEXT NOT NULL DEFAULT 'ok';   -- ok | missing | trashed | lost  (set by the nightly check, §3.4)
ALTER TABLE documents ADD COLUMN drive_checked_at TEXT;
CREATE UNIQUE INDEX uq_doc_drive_file ON documents(drive_file_id) WHERE drive_file_id IS NOT NULL;
CREATE INDEX idx_doc_store_check ON documents(store, drive_checked_at);  -- nightly check: oldest-checked first
-- RULE (code, not SQL): branding pictures (category 'branding') always use store 'd1', whatever storage.driver says.

CREATE TABLE drive_folders (                    -- remembers the Drive folders the CRM created, so a save needs no folder search
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path_key TEXT NOT NULL UNIQUE,                -- 'root' · 'company' · 'backups' · 'archive' · 'p:12' · 'p:12:drawings' …
  project_id INTEGER REFERENCES projects(id),   -- NULL for company-level folders
  drive_folder_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE oauth_states (                     -- one row per "Connect Google Drive" attempt (CSRF + PKCE protection)
  state_hash TEXT PRIMARY KEY,                  -- SHA-256 of the random state value sent to Google; the value itself is never stored
  user_id INTEGER NOT NULL REFERENCES users(id),   -- must be the Owner who started it
  verifier_enc TEXT NOT NULL,                   -- the PKCE code_verifier, AES-GCM encrypted with APP_KEY
  purpose TEXT NOT NULL DEFAULT 'gdrive',
  expires_at TEXT NOT NULL,                     -- 10 minutes after creation
  used_at TEXT,                                 -- a state works once only
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_oauth_states_expiry ON oauth_states(expires_at);
```

Settings introduced in v1.2 (stored in `settings`, defaults in brackets): `share.default_expiry_days` [14] · `share.default_max_views` [none] · `files.brochure_max_mb` [25] · `access.limit_roles_to_assigned_projects` [`["site"]`] · `access.allow_second_owner` [off] · `branding.apply_colours_to_app` [on] · `brochure.price_list_default_audience` [internal].

Settings introduced in v1.3 (stored in `settings`; defaults in brackets): `storage.driver` [`gdrive`] · `storage.gdrive.status` [`not_connected`; then `connected` · `needs_reconnect`] · `storage.gdrive.refresh_token_enc` and `storage.gdrive.access_token_enc` (AES-GCM with `APP_KEY`; **never** returned by any API, shown on any screen, written to the audit log or included in any export) · `storage.gdrive.access_expires_at` · `storage.gdrive.account_email` (shown so the Owner can see *which* Google account is connected) · `storage.gdrive.root_folder_id` · `storage.gdrive.connected_at` · `storage.gdrive.last_ok_at` · `storage.warn_percent` [80]. The Google sign-in key (client id and secret) is **not** a setting: it is the Worker secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (§8 Phase 1 add-on).

---

## 6. UX Contract — designing for a 55-year-old site engineer

### 6.1 Design tokens (the only allowed styles, in `app.css`)

- Base font **18px**, headings 22–28px. System font stack (no web-font downloads).
- Buttons: minimum height **48px**, full-width on phones, one **primary** (deep blue `#1d4ed8`) per screen; secondary = outline; danger = red, always with a confirm step.
- Colour: white background, near-black text `#111827`, AA contrast. Status colours with **words, never colour alone**: 🟢 Approved · 🟡 Applied · 🔴 Overdue · ⚪ Not started.
- Cards with 12px radius, 16px padding, generous spacing. No dense grids except the inventory grid (which zooms).
- **Bottom navigation on phones**, built from the user's role and enabled modules (e.g. Site Engineer: Home · Drawings · Site · More; Sales: Home · Leads · Visits · More; Owner: Home · Site · Sales · More) with icons + words; top bar shows project picker + 🔔 notifications + language toggle (EN | हि | म).
- Dates everywhere **DD/MM/YYYY**; money **₹12,50,000** (en-IN); relative hints ("due in 5 days", "3 days late") next to dates.
- Every screen: a **?** Help button opening a 3-line plain-language "How to use this page" (in the chosen language).
- Errors: plain words + what to do next. Never show codes/stack traces to users (log them for Claude).
- Empty states: one friendly line + one big action button.
- **WhatsApp share** button on DPRs, drawings, leads, demand letters: opens `https://wa.me/?text=…` with a pre-written summary (name, project, status, link). Free, no API. Anything sent to a **customer** (brochures) goes as an expiring link from §7.10, never as a raw file address.
- **Print / Save as PDF** on POs, demand letters, receipts and detail pages via `print.css` + `window.print()`, on **your letterhead** (§7.10). Brand colours are applied through one CSS variable; the primary colour is checked for readable contrast (§7.10).

### 6.2 Role-based home screens (the heart of the simplicity)

**Site Engineer home** (also Hindi/Marathi):
```
┌──────────────────────────────┐
│ SHIVNERI HEIGHTS ▾      🔔  │
├──────────────────────────────┤
│  ┌────────────────────────┐  │
│  │  📷  TODAY'S WORK      │  │   ← opens DPR: 3 photos + 2 lines
│  │      REPORT            │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │  📐  DRAWINGS          │  │   ← latest IFC only, big search box
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │  🚚  MATERIAL RECEIVED │  │   ← GRN: pick PO, photo of challan
│  └────────────────────────┘  │
│  ⚠ 2 snags open · 1 drawing  │
│    updated yesterday         │
├──────────────────────────────┤
│ Home  Drawings  Site   More  │
└──────────────────────────────┘
```

**Sales home:** `[ + NEW LEAD ]` `[ 📞 TODAY'S FOLLOW-UPS (7) ]` `[ 🏠 SITE VISITS TODAY (2) ]` `[ 📤 SEND BROCHURE ]` + "My open leads" list with one-tap Call / WhatsApp buttons.

**Owner home:** the dashboard (§7.9) — but still just **6 big tiles**, each tappable to the underlying list. Until they are all done, a **"Finish setting up"** card sits on top: ☐ logo ☐ letterhead ☐ add your team ☐ first project ☐ first brochure ☐ email test.

**Accounts / Purchase / HR homes:** same pattern — 3 big buttons + today's list.

### 6.3 The DPR form (the most-used screen in the company)

1. Opens with **today's date and the engineer's project pre-filled**.
2. Big camera button: **"Add photos of today's work"** (up to 10; auto-compressed).
3. One text box: **"What work happened today?"** (voice-typing works via the phone keyboard; placeholder example: "Wing A 5th slab shuttering complete, 12 masons").
4. Labour count: big **− / +** stepper, not a keyboard field.
5. Optional collapsible "More details" (weather, materials, issues, safety) — collapsed by default.
6. One button: **SAVE REPORT**. Autosaves to the phone every few seconds.
7. **No network?** Banner: "No internet — report saved on this phone. It will send when you open the app with internet." A pending-sync badge shows the count; sync fires when the phone reconnects *or* the app is opened (iPhones cannot sync in the background), with `client_uuid` dedupe. Photos queue too, as compressed blobs in **IndexedDB** (never localStorage — it is too small); text drafts may use localStorage.
8. After save: "Done ✅ Share on WhatsApp?" one tap.

### 6.4 Language
`i18n.js` dictionaries for **English, Hindi, Marathi**. All site-module labels, home buttons, and common actions translated; user's choice stored on their profile. Claude generates the dictionaries; owner can correct any label in Settings → Labels (stored as settings overrides).

### 6.5 PWA
`manifest.json` (name, icon, theme colour — a plain fallback until branding is set) and, from Phase 4B, a `/manifest.webmanifest` built by the Worker from your branding (company name, theme colour, icons made from your logo), + `sw.js` caching the static shell only (never API responses). A phone keeps the icon it was installed with — after a logo change, tell the team to remove the old icon and *Add to Home Screen* again. The cache name carries the app version (`nirmaan-shell-v<N>`); on activate it deletes older caches, and `ui.js` shows a toast **"New version ready — tap to refresh"** so no phone keeps running old pages. Users tap **"Add to Home Screen"** once; it opens like an app, full-screen, with the icon. No app store, no updates to install — the website is always current.

---

## 7. Module specifications

### 7.1 Core shell — Projects, Users, Documents, Notifications, Audit, Settings, Search

- **Projects:** list + create/edit (fields per §5). Project picker in the top bar filters every module. Project detail page = tabs linking into each module's filtered view + its documents + its approvals status strip.
- **Users (Owner only):** add team member (name, email, phone, role, projects). Two login methods per user: password (temporary one shown once with a big Copy button, must be changed at first login) and **email OTP** once email is configured. Deactivate instead of delete. Owner safeguards, project access and the temporary-password rules are in **§4.6**.
- **Documents vault:** every upload anywhere lands here with its link (project/module/entity). Browse by project + category; search by title; drawing versions live in the revision register (§7.3), other documents keep every upload with uploader + date. Types: **file** (upload) or **link** (paste a URL — the no-card fallback for big PDFs). Download always goes through `/files/:id` with permission checks, whichever store (Drive, R2 or database) holds the file; a file whose Drive copy was deleted by hand shows a plain *"This file is missing from Google Drive"* badge instead of failing silently. Every document also carries an **audience** (*internal* or *customer-shareable*), an optional **language** and a **version** — brochures and branding files use these (§7.10).
- **Notifications:** in-app 🔔 with unread count; `notify(event, payload)` consults `notification_rules` (settings) → creates in-app rows and/or queues emails. Rules editable by Owner as simple checkboxes ("When a PO needs approval → email Owner ✅").
- **Audit log:** Owner/PM view, filter by person/module/date. Plain sentences: "Ramesh approved PO-SHIV-A-0042 (₹2,40,000) for Shivneri Heights".
- **Settings:** **Branding & Letterhead** (§7.10), **Access** (who sees which project, second Owner — §4.6), brochure & sharing defaults (link expiry, upload size), projects defaults, module ON/OFF switches (a module cannot be switched off while another ON module lists it in `requires`), role tweaks (the two flags in §4.5), **working hours** (default 09:00–19:00 IST — SLA nudges and non-urgent reminders wait for them), PO approval limit, **Storage** (which store is used, Google Drive connection status with Owner-only *Connect / Reconnect / Disconnect*, the quota meter and the *"files needing attention"* list — §3.4), email settings (§7.8), reminder rules, label overrides, **Export all data** (§11).
- **Global search:** top-bar box → `/api/search?q=` across leads (name/phone), flats, vendors, drawings (code/title), approvals, documents. Results grouped, tappable. Matching is **prefix-based on indexed columns** (§3.2 rule 2) so it never scans whole tables.

**Notification events seeded** (event → default recipients → channels):
| Event | Who | In-app | Email |
|---|---|---|---|
| lead.assigned | assignee | ✅ | ✅ |
| lead.followup_due (hourly cron) | assignee | ✅ | ✅ |
| lead.sla_1h (no first contact within 1 working hour) | assignee | ✅ | ✅ |
| lead.sla_4h (still no contact after 4 working hours) | PM | ✅ | ✅ |
| visit.scheduled | assignee + PM | ✅ | – |
| visit.reminder (2 hours before) | assignee | ✅ | – |
| approval.due_soon (daily, `valid_till` − `reminder_days`) | item owner + PM + Owner | ✅ | ✅ |
| rera.quarterly (15 Mar/Jun/Sep/Dec) | Owner + PM + Accounts | ✅ | ✅ |
| drawing.new_ifc | site + PM | ✅ | ✅ |
| dpr.missing (19:00 IST nudge) | site engineer + PM | ✅ | – |
| po.pending_approval | Owner (PM if ≤ limit) | ✅ | ✅ |
| po.approved / po.rejected | PO creator | ✅ | ✅ |
| grn.received | purchase + accounts | ✅ | – |
| bill.due (≤3 days) | accounts + Owner | ✅ | ✅ |
| milestone.done | Owner + PM + sales | ✅ | ✅ |
| demand.ready (milestone done → demand awaiting review) | sales + accounts | ✅ | ✅ |
| demand.overdue | sales + accounts + Owner | ✅ | ✅ |
| snag.high_open (>3 days) | PM | ✅ | – |
| brochure.updated (new version of a customer-shareable item) | sales + PM | ✅ | – |
| share.viewed (first time a customer taps Open on a shared link) | the person who shared it | ✅ | – |
| email.failed (3 attempts used) / backup.failed | Owner | ✅ | ✅ (Brevo/other route if SMTP is the failure) |

### 7.2 Approvals & Compliance (Mumbai)

**Purpose:** one screen answers "what is stuck, what is expiring, who is chasing it".

- List per project, ordered by `stage_order`, grouped: Approvals · NOCs · Compliance · Renewals. Each row: name, authority, status chip, owner ("Chasing: Mahesh (architect)"), key date, **days-left hint**.
- Item detail: status timeline (`apr_events`), applied/approved/valid-till dates, fee, consultant, notes, attached documents (IOD letter, NOC PDFs…), and **"Mark applied / Query received / Approved / Rejected / Expired"** big buttons that log events.
- **Templates:** "New project → Load Mumbai template" seeds Appendix A's checklist (editable, reorderable, add/remove rows). Redevelopment projects get the extra society-consent/DA items noted in Appendix A.
- **Renewals & recurring:** items with category `renewal` (RERA quarterly, fire NOC renewal, insurance) re-arm after each completion: marking done sets the next `valid_till` by adding that item's `renew_months` (3 for RERA quarterly, 12 for annual renewals).
- **Dashboard strip:** "3 approvals expiring in 30 days · 1 query unanswered for 6 days".
- Reminder engine per §7.1 events. RERA quarterly dates configurable; guide defaults are indicative — the UI shows a one-line note: "Confirm filing deadlines with your CA."

**Acceptance:** create project → load template → mark IOD "Applied" with a date → set CC `valid_till` 20 days out → it appears in "expiring soon" and (after Phase 11) emails the owner.

### 7.3 Drawings & Design register

**Purpose:** site never builds from a superseded drawing.

- Register per project: code, title, discipline, zone, **current IFC revision** (big chip "R3 · issued 12/11/2026"), last updated.
- Drawing detail: revision history list. **"Issue new revision"** flow: upload PDF (or link) → rev number auto-increments → choose status: *Draft* (office only) or **Issued For Construction** → issuing IFC **auto-marks the previous IFC "Superseded"** and fires `drawing.new_ifc` to site + PM. The supersede and the insert run as **one atomic `db.batch()`**, and the unique index in §5 (`uq_rev_one_ifc`) guarantees a drawing can never have two live revisions even if a bug slips in.
- **Site role sees only the latest IFC** per drawing — old revisions are invisible to them (PM/Owner can expand history). A superseded PDF opened by office staff shows a red banner: "SUPERSEDED — do not build from this. Current: R3."
- Discipline filter chips: Architectural · Structural · MEP · Fire · Landscape · Interior. Big search by code ("STR-A-501").
- Consultant coordination: `received_from` field (architect/structural engineer name) + a simple "Waiting from consultant" flag (`waiting_consultant`) on drawings with no IFC yet → appears on PM's home.
- Print/download + WhatsApp share of the *current* revision link.

**Acceptance:** issue R1 IFC → site sees R1 → issue R2 IFC → site sees only R2, gets notified; office opening R1 sees the red superseded banner.

### 7.4 Site Execution

**Purpose:** a daily report done in 90 seconds, milestones that drive money, snags that close.

- **DPR** per §6.3 (offline-first, photo-first, `client_uuid` dedupe). List view: calendar strip of last 14 days — green dot = report filed, grey = missing. PM can see all projects' today-status on one screen.
- **Milestones:** per project + wing, ordered (excavation → raft → plinth → slabs floor-by-floor → finishing → possession). PM sets planned dates; site marks **"Done today"** (one tap + optional photo; a date picker defaults to today so "finished yesterday" can be recorded — it sets `actual_date`). Marking done *emits* `milestone.done` on the event bus (`core/events.js`); the **sales module's own hook** then marks the matching CLP demands **Ready** (§7.6). Site never imports sales.
- **Snags (defects):** photo + location + severity → assign to person + due date → status open → fixed → verified (PM verifies). High-severity open >3 days nags the PM.
- **Weekly look-ahead (light):** on the milestone list, a "Next 7 days" filter = the Monday meeting agenda. No Gantt charts.
- Labour count lives on the DPR; a simple monthly labour-total report comes free in Reports.

**Acceptance:** airplane mode → file DPR with 2 photos → reconnect → it syncs once (no duplicate); mark "5th slab" done → matching demands turn **Ready** in Sales (after Phase 9).

### 7.5 Procurement

**Purpose:** every rupee of purchase has a trail: need → 3 quotes → your approval → delivery proof → bill → payment.

- **Vendors:** master list with category, GSTIN, phone (one-tap call), rating (1–5, set by PM after delivery), notes. Duplicate-phone warning on create.
- **RFQ + comparison:** create need (material, qty, unit, needed-by) → add up to N quotes (vendor, rate, amount auto = qty×rate, rounded to the paisa, delivery days, terms, quote PDF/photo) → **comparison table highlights lowest amount and fastest delivery** → select one → "Convert to PO" pre-fills everything. (Best practice: aim for 3 quotes; the UI shows "2 of 3 quotes added".)
- **PO:** auto number `PO-<projectcode>-<seq>` taken from the `counters` table (race-safe, never reused, even for cancelled POs); line items (each line = qty × rate, rounded to the nearest paisa); GST%; **subtotal + GST = total, and the PM limit is compared with the total**; terms; status flow **draft → pending_approval → approved/rejected**. Maker-checker: creator can't self-approve; PM approves ≤ the setting limit, Owner above it. Approval fires email to creator. **Print/Save-as-PDF** PO with company header. WhatsApp share to vendor.
- **GRN (goods received):** site engineer flow — pick approved PO (big list, today's expected first) → photo of challan → qty note ("received 90 of 100 bags") → save (offline-capable, `client_uuid`). Partial receipts set PO `part_received`; full sets `received`. Fires `grn.received`.
- **Bills:** accounts logs vendor bill against PO (bill no, amount, due date, photo) → approve → mark paid (date, mode, ref). Due-date reminders. A simple "Vendor ledger" page: POs, GRNs, bills, payments, balance payable.
- **Rate intelligence (free win):** last-paid rate per material shown on the quote screen ("Cement: last bought ₹385/bag on 02/11 from UltraBuild").

**Acceptance:** RFQ with 3 quotes → comparison highlights cheapest → PO with total ₹60,000 (incl. GST) routes to Owner (not PM) → site files GRN offline → accounts sees bill due reminder.

### 7.6 Sales CRM

**Purpose:** no lead forgotten; every booking's money collected on time.

- **Leads:** fast-add form (name, phone, source, project, config, budget — 30 seconds). Auto-assign round-robin among sales users (setting). **Response SLA** (counted in working hours; "contacted" = first call/WhatsApp logged, which sets `first_contact_at`): new lead not contacted within 1 hour → `lead.sla_1h` nudges assignee; >4 hours → `lead.sla_4h` nudges PM (industry best practice: speed-to-lead wins deals). Duplicate-phone detection (on the normalised +91 number) merges into the existing lead with a new activity. Saving requires the DPDP consent tick, which stores `consent_at`.
- **Lead detail:** timeline of activities; one-tap **Call** / **WhatsApp** (pre-filled intro message); status chips; **next follow-up date/time** (required to save a call outcome — this one discipline fixes 80% of leakage); "Log call" = outcome dropdown + optional note.
- **Site visits:** schedule (date/time, project) → day-list on sales home → mark done/no-show + feedback. Reminder to assignee 2 hours before.
- **Inventory grid:** per project, wing × floor matrix of flats; colour + word status (Available/Blocked/Booked/Agreement/Registered); tap flat → detail + price (base + floor rise) + "Block for 48h" / "Book". Blocking auto-expires via cron. **Never double-book:** booking a flat checks status server-side *and* the database itself refuses a second active booking for the same unit (`uq_booking_one_active_per_unit`), so even two people tapping Book at the same instant cannot both succeed — the loser sees "This flat was just booked by someone else".
- **Booking flow:** pick flat + lead → customer details (PAN, **masked** Aadhaar only) → agreed price → payment plan (CLP template / down-payment / custom) → token amount → creates booking + **generates the demand schedule** from `sal_plan_stages`. Maths (all integers): stage amount = `floor(agreed_price_paise × pct_bp ÷ 10000)`; the **remainder is added to the last stage** so the stages add up to the agreed price to the paisa; the plan is refused unless its `pct_bp` values add to exactly 10000. The **token amount counts toward the first stage** ("On Booking") — that stage's demand is only the balance. GST on each demand = `round(amount × gst_bp ÷ 10000)` (rate set per booking; 5% / 1% affordable for residential — **confirm rates with your CA**). Flat status → booked; lead status → booked. **RERA cap warning:** if money received before the registered agreement for sale exceeds **10% of the agreed price**, the screen shows a red warning (RERA s.13 — confirm with your advocate). **Cancelling a booking** (reason required) sets the booking `cancelled`, releases the flat to *available*, cancels unpaid demands and keeps all receipts for the refund discussion — nothing is deleted.
- **CLP automation (flagship):** stages with a `milestone_key` link to site milestones (matched on project + wing + key, never on typed names). When site marks the milestone done, the event `milestone.done` reaches `sales/hooks.js`, which moves the matching demands of all bookings in that project/wing from **scheduled → ready** with due date = actual done date + 7 days (setting) and fires `demand.ready` → sales/accounts review → **send demand letter**. A Worker cannot create PDFs without a library, so: staff open the letter's print view, **Save as PDF**, upload it to the demand (`letter_document_id`); the email then goes out with that PDF **attached** (plus the letter text in the body as a fallback), and the WhatsApp button shares the summary text. Letter template editable in Settings with placeholders ({{customer}}, {{flat}}, {{stage}}, {{amount}}, {{due_date}}, {{rera_no}}…).
- **Receipts:** accounts records payment (mode, ref, date, and **TDS deducted by the customer**, usually 1% under s.194-IA, with a reminder to collect the Form 26QB/16B proof) against a demand → `settled_paise` increases by cash + TDS; demand becomes **partial** until fully settled, then **paid**. A bounced cheque or wrong entry is **reversed** (reason kept), never deleted; booking progress auto-updates (agreement/registration dates set manually with document uploads). Overdue demands (> due date, unpaid) appear on owner dashboard and fire `demand.overdue`.
- **Channel partners:** master with RERA no., default brokerage%; booking links partner; **brokerage payable report** = `brokerage_bp` × agreed price (before GST unless the partner agreement says otherwise), minus payments recorded in `sal_brokerage_payments` (simple, exportable). TDS on commission (s.194H, currently 2% above the annual threshold — **confirm with your CA**) is recorded per payment.
- **Funnel + source report:** counts new → contacted → visit → negotiation → booked → lost, by source and by person; "Which portal gives bookings, not just leads?" — the report that decides your marketing spend.

**Acceptance:** add lead → 1-hour nudge works → schedule visit → book flat F-503 → CLP schedule generated paise-exact → site marks "5th slab" done → the demand turns **Ready** → attach the saved PDF → send → record a receipt with 1% TDS (demand shows paid only once cash + TDS cover it) → flat shows Agreement/Registered correctly; double-booking F-503 is refused; cancelling the booking frees F-503.

### 7.7 Team & Hiring (optional — the "recruiting manager" module)

- **Staff register:** name, role, department, phone, join date, employment type (staff/contractor/consultant), documents (Aadhaar **masked**, PAN, agreements) with Owner/HR-only access.
- **Hiring pipeline:** open position → candidates (name, phone, resume upload/link) → stages new → shortlisted → interview (date) → selected/rejected → "Hired" converts to a staff record. Interview-day list for the HR user.
- **Contractor labour roster:** staff records with employment=contractor + trade; feeds a simple "who works at which site" list. (Full attendance/payroll stays out of scope — Tally/registry as today.)
- Keep it to 3 screens: Staff · Open Positions · Candidates. Feature-flagged OFF by default; Owner switches it on when needed.

### 7.8 Email engine (company SMTP inside the software)

**This is a first-class module, not an afterthought.** Everything email flows through `core/mail.js` with a provider switch, a queue, and a visible log.

**Settings → Email screen (Owner):**
- Provider: **Company SMTP** (default) or **Brevo (free fallback)**.
- SMTP fields: host, port, security (SSL/TLS 465 recommended · STARTTLS 587), username, password (stored **AES-GCM encrypted** with the `APP_KEY` secret — never in code, never in the browser), from name + from address.
- **Preset dropdown** that fills the fields:

| Preset | Host | Port/Security | Password to use |
|---|---|---|---|
| Company email (cPanel/Hostinger/GoDaddy etc.) | `mail.yourcompany.in` | 465 SSL/TLS | Mailbox password |
| Gmail / Google Workspace | `smtp.gmail.com` | 465 SSL/TLS | **App password** (Google Account → Security → 2-Step Verification → App passwords) |
| Zoho Mail (India) | `smtp.zoho.in` | 465 SSL/TLS | App-specific password |
| Microsoft 365 | `smtp.office365.com` | 587 STARTTLS | Mailbox password — **Microsoft is retiring password (Basic) sign-in for SMTP; per Microsoft's Jan 2026 timeline it becomes off-by-default for existing tenants from about end-Dec 2026. Do not build on it — use Brevo.** |
| Brevo free relay | `smtp-relay.brevo.com` | 465 SSL/TLS (if refused, use the port shown on Brevo's *SMTP & API* page) | SMTP key from Brevo dashboard (free 300 emails/day). Brevo requires a **verified sender / authenticated domain** (SPF, DKIM, DMARC) and may need SMTP activation by their support |

- **"Send test email to me"** button → result in plain words, and the exact failure reason in the log if it fails.
- Send log screen: every email, status, error, retry button. Queued emails retry automatically (hourly cron, max 3 attempts) — a temporary SMTP outage never loses a reminder.
- Digest recipients (the 08:00 send time is set by the cron line in `wrangler.jsonc`; changing it is a one-line change you ask Claude for, §10.6); per-event email checkboxes (§7.1 table); editable templates with {{placeholders}}.

**Implementation notes for Claude (important, do not skip):**
1. Workers has **no nodemailer**. Implement `smtp.js` on `import { connect } from 'cloudflare:sockets'`.
2. **Prefer port 465 implicit TLS:** `connect({hostname, port:465}, {secureTransport:'on'})`. Sequence: read `220` greeting → `EHLO nirmaancrm` → `AUTH LOGIN` (base64 username/password) → `MAIL FROM` → `RCPT TO` → `DATA` → headers (From with display name, To, Subject, Date, Message-ID, MIME-Version, Content-Type `text/html; charset=UTF-8`) + body → dot-stuff lines starting with `.` → `.` → `QUIT`. Parse multi-line replies (`250-`) correctly; wrap every read in a timeout (10 s) so a dead server can't hang the request.
3. Port 587 STARTTLS: `connect({hostname, port:587}, {secureTransport:'starttls'})` → read greeting → EHLO → `STARTTLS` → `const tls = socket.startTls()` (returns a **new** socket; the old one is closed, so create fresh reader/writer from `tls`; call it only once) → EHLO again → auth. Also: a Worker **cannot open sockets to Cloudflare-proxied addresses** — if your mail host's DNS record is proxied (orange cloud) through Cloudflare, set it to DNS-only or use Brevo. There are known runtime quirks with STARTTLS on some providers — **if 587 fails, the UI must suggest "switch to 465 or use Brevo"**, not just show an error. **Never use port 25** (blocked for abuse prevention).
4. Fallback provider `brevo_api`: HTTPS `POST https://api.brevo.com/v3/smtp/email` with `api-key` header — no sockets at all, works everywhere, free 300/day. Same queue/log/templates; only the transport changes. This guarantees email works even if a provider blocks socket SMTP.
5. OTP login (§8 Phase 3) activates automatically once a test email succeeds: login page shows **"Email me a login code"** as the primary button (6 digits, 10-minute expiry, 5 attempts, max 3 codes per 15 minutes per email). Password login stays as fallback.
6. Cron jobs (UTC; IST = UTC+5:30): `30 2 * * *` = 08:00 IST digest · `30 13 * * *` = 19:00 IST DPR nudge · `30 * * * *` = hourly reminder sweep + email queue retry · `30 20 * * *` = 02:00 IST nightly backup (§11). Guard: skip all cron work when `ENVIRONMENT === 'staging'`. **Free-plan reality (§3.2):** a cron run may use only ~10 ms of CPU and **50 database queries**, and an account may have **5 cron triggers** (we use 4 — adding more needs the paid plan or merging them into the hourly sweep). So: the digest is composed from a handful of aggregate queries (never one per record); the hourly sweep handles at most ~40 queries per run and carries on at the next tick; the nightly backup is *resumable* (`backup_log.cursor_json`, §11.1).
7. **Deliverability:** ask whoever manages your domain to publish **SPF, DKIM and DMARC** records for the sending address (your hosting provider or Brevo shows the exact values). Without them login codes can land in spam. Test with a Gmail and an Outlook address.
8. **Attachments:** `mail.js` must support attachments (MIME multipart / Brevo `attachment` field) so a saved demand-letter PDF (`email_log.attachment_document_id`) goes out with the email.

**Daily digest contents** (one email to Owner + PM, sample in Appendix C): per project — yesterday's DPR summary (work, labour, photo count, issues) or a red "NO REPORT FILED"; milestones done/next; approvals expiring ≤30 days + open queries; POs awaiting approval; bills due ≤7 days; today's site visits + follow-up counts; overdue receivables total; storage meter if >80%.

### 7.9 Owner dashboard & Reports

**Dashboard = 6 tiles, each tappable** (no chart library needed; simple CSS bars):
1. **Money in:** collected this month · overdue receivables (₹, count) → demands list.
2. **Money out:** bills due ≤7 days · POs pending my approval → lists.
3. **Site:** reports filed yesterday (2 of 3 projects ✅) · milestones done this week · open high snags.
4. **Approvals:** expiring ≤30 days · queries open → approvals list.
5. **Sales:** new leads this week · visits today · bookings this month · funnel bar.
6. **System:** storage meter · last backup time · emails failed (if any).

**Reports (all exportable to CSV that opens in Excel; BOM-prefixed so ₹ and names render correctly):**
- Sales funnel by source/person/date-range; lead response-time report.
- Receivables ageing (0–30/31–60/60+); receipts register (**Tally-friendly columns**: date, party, amount, mode, ref, narration — your CA can map the import).
- Brokerage payable by partner.
- Purchase register (PO/GRN/bill/payment, vendor ledger); last-rate-per-material.
- DPR register + monthly labour totals; milestone planned-vs-actual (delay days).
- Approvals status sheet (for your liaisoning meetings).
- **Export everything** (Settings): ZIP of all CSVs + documents manifest — your data, yours forever. Built **in your browser** (CSV pages fetched one at a time, files streamed one at a time; §3.2), so it works on the free plan however big the data is.

### 7.10 Branding, Letterhead & Brochure Library (core — built in Phase 4B)

**Purpose:** every PO, demand letter and receipt leaves the company looking like *your* company, and a sales executive can send the right brochure to the right customer in two taps — without ever making a file public.

**A. Branding settings** (Owner edits: Settings → Branding. PM, Sales and Accounts can open it read-only). Five plain blocks:
1. **Company:** legal name, trade name (shown in the app and in WhatsApp texts), tagline, address, phone, email, website.
2. **Registrations:** GSTIN, CIN or LLP number, promoter's MahaRERA reference (optional — each *project's* RERA number comes from the project itself), **PAN** (restricted).
3. **Bank details printed on demand letters and receipts:** account name, bank, branch, IFSC, account number (restricted). A project can override these — the RERA designated collection account is per project.
4. **Pictures:** main **logo**, optional square **logo icon** (otherwise made from the logo), **signature**, **stamp / seal**.
5. **Look:** three colours (primary, secondary, accent), authorised signatory name + designation, footer small print, and the default WhatsApp intro text.

*Pictures — the safe rules.* PNG, JPG or WebP are accepted. **An SVG file is never stored**: SVG can carry scripts. If the Owner picks an SVG, the *browser* redraws it as a PNG (drawing an SVG as an image runs no script) and uploads that PNG; the server refuses any SVG or HTML upload outright. Logos are scaled to at most 1,200 px wide and compressed under ~300 KB, keeping transparency, so they fit the database (2 MB per row) comfortably. **Branding pictures (logo, icons, signature, stamp, letterhead images) are always stored in the database (`file_blobs`), in every storage mode** — so the login page, the app icon and every printed letter keep working even if Google Drive is disconnected. The signature and stamp are therefore also never in Drive, where a mis-set sharing option could expose them. PDFs, CorelDRAW and Illustrator files are not accepted as logos.
*App icons are automatic:* the browser makes a 32 px favicon and 192/512 px app icons from the logo and stores them as branding files; the Worker serves `/manifest.webmanifest` from your branding (§6.5).
*Colours:* the primary colour carries white button text, so it must reach **4.5:1 contrast against white**. If the chosen colour is too light, the screen shows the nearest darker shade and asks "Use this one?". Default is the §6.1 blue `#1d4ed8`. With `branding.apply_colours_to_app` ON, the Worker serves `/brand/theme.css` that sets the `--brand` colour used by buttons and the top bar.
*Public and private.* `/brand/*` (logo, icons, theme, manifest) is public because the login page and emails need them. **Signature and stamp are never public**: they are readable only through the server-side print views, and only by roles that may issue that document (§4.5). Anyone who can copy your signature image can forge a letter, so it is treated like a cheque book.

**B. Letterhead** (Owner: Settings → Letterhead; per-project override below). Choose one of three modes:
1. **Generated (default — no artwork needed):** logo and company name at the top, address and contact line, GSTIN and the project's RERA number in the footer — all built from block A. Start here.
2. **Header + footer images:** upload a **header band** and a **footer band** (PNG/JPG, full page width = 210 mm, i.e. 2480 px wide at 300 DPI; typical heights 35–50 mm header, 20–25 mm footer; each under ~600 KB). The middle of every page is free for text. Best if a designer made your letterhead.
3. **Full-page image:** one A4 image (1240 × 1754 px = 150 DPI, under ~700 KB) used as the whole page, with a **safe area** so text never lands on your artwork — defaults **top 45 mm · bottom 30 mm · sides 20 mm**, editable.
*Your letterhead is a PDF or Word file?* A browser cannot place a PDF behind printed text without extra software, so a PDF is accepted only as a **reference copy** (kept in the vault, internal). To use it, export page 1 as a JPG/PNG (Word: Save as picture · Mac Preview: Export · any free PDF-to-JPG site) and upload that as mode 2 or 3.

*Print rules for Claude.* A4 portrait, `@page { size: A4; margin: 0 }`. Draw the letterhead with real `<img>` elements (not CSS backgrounds) and `print-color-adjust: exact`, so logos print even when "Background graphics" is off. Header and footer repeat on **every page**; text flows between them; footer carries "Page 1 of 2". All letter types call one shared helper, `public/print/print.js`, which asks `/api/branding/resolve?project_id=` and lays the page out — each module owns its own print view (PO in `procurement`, demand letter and receipt in `sales`) and core owns the general letter.
*Signature & stamp rule.* They print only on **issued** documents — an approved PO, a demand that is Ready/Sent/Paid, a receipt. A draft prints with a grey **DRAFT** watermark and no signature or stamp.
*Save as PDF* (as in §7.6): Print → Destination **Save as PDF** → Margins **None** → Background graphics **ON** → Save → upload it to the record where an attachment is needed. The print screen shows these four lines under a **?**.
*"How your letters will look"* (Settings → Letterhead): an A4 preview of a sample PO and a sample demand letter with dummy data, a company/project switch, and **Print test page** — one sheet with 10 mm ruler lines, so you can see on your real printer where the safe area is.
*Resolution.* `brand.resolve(projectId)` returns the project's override if it has one, otherwise the company default, **field by field**. A project override (Projects → *project* → Branding → "Use different details for this project") may replace any field, logo, letterhead pictures, colours, signatory and the bank/RERA collection account; anything left blank inherits.
*Used by:* PO, demand letter, receipt, general letter, the preview, the logo and name in the 08:00 digest and other emails, the login page and the app icon.

**C. Brochure & marketing library** (Projects → *project* → Brochures; Owner and PM manage it, Sales views and shares). Each item has: title · **category** (`brochure`, `floor_plan`, `price_list`, `rera_certificate`, `video_link` — link only, `site_photo`) · language (EN/HI/MR) · **audience**: *Internal* (staff only) or ***Customer-shareable*** · **file or link** · optional note ("valid for Phase 1 launch").
- **Versions.** *Replace with new version* creates version N+1 and flags the old one `is_latest = 0` — kept, listed under **Older versions** for Owner/PM only. Sales sees only the latest. The unique index `uq_doc_latest` guarantees one live version per item even if a bug slips in. A new version fires `brochure.updated` (sales + PM) so nobody keeps sending the old one. Price lists default to *Internal*; making one customer-shareable needs an explicit Owner tick.
- **Sizes.** Mode G (Drive) and Mode A (R2): up to `files.brochure_max_mb` (default 25 MB, ceiling 90 MB — §3.4). Photos are compressed; **PDFs are not**, so compress a brochure PDF to under ~10 MB before uploading (Mac Preview → Export → *Reduce File Size*; Adobe or any free "compress PDF" site). The file is sent as a raw body with a known length and **streamed straight through the Worker into the store** (§4.3, §3.4), with a progress bar and a retry button; on a weak network or while Drive is disconnected it waits in the phone's upload queue (IndexedDB), like site photos. The brochure's *stored* name in Drive is the item title plus version (`Shivneri Heights – English – v2.pdf`), so your own Drive folder stays readable. Mode B: the Link option comes first — paste a Google Drive / Dropbox / YouTube link.
- **Who sees what.** Staff open files through `/files/:id` (permission-checked, limited by project access §4.6). Only `audience = customer` items can be shared.

**D. Customer sharing — expiring links, never public files.**
1. Sales taps **Send brochure** (Sales home) — or **Send brochure** on a lead — picks the lead (pre-filled when started from a lead) and sees the project's latest customer-shareable files with the brochure **pre-ticked**. One tap on **Share on WhatsApp** (or Email, or Copy link). That is 2 taps from a lead page, 3 from home.
2. For each file the system creates one `share_links` row: a random 32-byte token (shown only inside the link; only its SHA-256 hash is stored), expiry = now + `share.default_expiry_days` (default **14**; Sales may choose 3 / 7 / 14 / 30 days), and an optional max-views limit.
3. The WhatsApp text comes from the branding intro: *"Hello {{name}}, thank you for your interest in {{project}}. Brochure: {{link}} (valid till {{expiry}}). — {{trade_name}}"*.
4. The link `https://<your-site>/s/<token>` opens a small page with **no login**: your logo, the project name, the file title and one big **Open** button. The button loads `/s/<token>/file`, which streams the file from whichever store holds it (Drive, R2 or database — the customer never receives a Google address and never needs a Google account), or redirects for link-type items. **Views are counted only when Open is tapped** — chat apps fetch the landing page to build a preview, and that must not use up a view or trigger a false "opened" alert. Pages carry `noindex` and `no-store` headers.
5. A link works only if: the token's hash is found · not revoked · not expired · views below the limit · the file still exists and is `audience = customer`. Otherwise one plain page: *"This link has expired. Please ask {{trade_name}} to send a new one."* — never more detail.
6. **Abuse guard:** bad-token requests are counted per visitor in `rate_limits` (`share:<hash of IP>`, 30 per 10 minutes); beyond that the answer is `429` without touching the database again.
7. **Logged, and useful:** creating a link emits `share.created`; the Sales module's own hook adds a lead activity ("Shared brochure 'Shivneri Heights – English', expires 05/12/2026"). The first Open emits `share.viewed` → the sharer gets "Mr Kulkarni opened the brochure" — the perfect moment for a call. If Sales is OFF, sharing still works, just without a lead.
8. **Revoke:** Owner and PM see every link (Projects → Brochures → **Shared links**: who, what, to whom, expiry, views) and can revoke any; Sales sees and revokes their own. A revoked link dies at once. Replacing a brochure does **not** kill old links (each link keeps serving the version it was made for); the Owner can tick *"also revoke links to older versions"* while replacing.
9. **Link-type items:** NirmaanCRM's own link still expires and can be revoked, but the Google Drive / Dropbox address behind it stays as open as it was set to. The screen says so in one line: *"Expiry applies to this link only. For full control, store the file in NirmaanCRM (Mode G or A)."*
10. **A share link can never** list other files, reveal other customers, open an internal document, or be created for one.

**Acceptance:**
- Owner uploads a logo (an SVG chosen → it becomes a PNG; a hand-crafted `.svg` upload to the API is refused), sets header + footer bands, opens "How your letters will look" and prints the test page.
- An **approved** PO saved as PDF shows the letterhead on every page, plus signature and stamp; a **draft** PO shows DRAFT and no signature.
- A project override with a different RERA collection account prints on *that* project's demand letter only.
- Owner uploads brochure v1 (customer-shareable), then v2 → v1 moves to Older versions; Sales sees only v2; an internal price list never appears in *Send brochure*, and the API refuses to create a link for it.
- Sales sends the brochure to a test lead on WhatsApp → the link opens on another phone with no login → views stay **0** until Open is tapped, then 1, and the sharer is notified → **Revoke** → the link now says it has expired. A link set to expire in 1 minute (staging) expires.
- Ramesh (Site) cannot read branding bank/PAN fields, cannot reach the brochure admin screen, and cannot fetch the signature image by any URL.
- With Google Drive connected (Mode G): the brochure PDF appears in `NirmaanCRM/<project>/Brochures` in the Drive account with the title-and-version name; the same file in Drive has **no sharing set** ("Restricted"); the customer link still opens it with no Google login; after you click **Disconnect**, the login page, logo and a printed PO still look right, and the brochure link shows the plain "temporarily unavailable" page instead of an error.

---

## 8. The build phases (do them in order; each ends with a checklist YOU can verify)

> Every phase prompt below assumes the guide is uploaded and the Master Prompt rules are active. Paste the prompt, answer Claude's questions, run what it tells you, verify the checklist, then move on. **Commit to GitHub after every phase** (GitHub Desktop: write "Phase N done" → Commit → Push — three clicks, no commands).

### Phase 0 — Accounts & tools (human only, ~1½ hours)

1. **Cloudflare:** go to `dash.cloudflare.com/sign-up` → free account → verify email. (No plan purchase needed.)
2. **Storage decision (§3.4) — Mode G (Google Drive) is the default.** Mode G → do 2a–2d below (no card needed). Mode A → Dashboard → R2 → enable (payment-method verification; free within 10 GB) → then Manage Account → Billing → Billable Usage → *Create budget alert* → $1 (it only emails you). Mode B → skip this step entirely.
   - **2a. The Google account.** Create a **new, dedicated** Google account for the company's files (e.g. `yourcompany.crm@gmail.com`) at accounts.google.com. Do this in a **separate Chrome profile** (Chrome → your photo → *Add* → name it "CRM files") so you never confuse it with your personal Gmail. Turn on **2-step verification** and add a recovery phone and a recovery email; write the address and where its password is kept in the same safe place as your Cloudflare login. Do not use a personal account holding family photos or old mail: only *Gmail and Photos in that account share the same 15 GB*.
   - **2b. A Google Cloud project (only to make the sign-in key).** In that same profile open `console.cloud.google.com`, accept the terms, and create a project named `NirmaanCRM`. **If any screen asks for a card or offers a "free trial", close it** — the Drive API does not need billing, and a free trial can silently become paid. If it truly blocks you without a card, stop and tell Claude.
   - **2c. Switch on the Drive API.** Menu → *APIs & Services* → *Library* → search **Google Drive API** → **Enable**.
   - **2d. Stop here.** The consent screen and the sign-in key are made in the *Phase 1 add-on*, after the first deploy gives you your web address (Google needs it).
3. **Node.js:** install the LTS from `nodejs.org` (next-next-finish). Verify: open Terminal (Mac) / Command Prompt (Windows) → `node --version` shows a number.
4. **Project folder:** create `nirmaan-crm` on your laptop. In the terminal: `cd` into it → `npm init -y` → `npm install --save-dev wrangler`. *Windows tip: if PowerShell says "running scripts is disabled", open **Command Prompt** instead (search "cmd") and repeat the step.*
5. **Connect Cloudflare:** `npx wrangler login` → browser opens → Allow.
6. **GitHub (recommended):** free account at github.com → install **GitHub Desktop** → "Create new repository" from your folder → Publish (private).
7. **Email:** collect your company SMTP details from your hosting/email provider (host, port, username, password). No company email handy? Create a free Brevo account (brevo.com) → SMTP & API → copy the SMTP key. Either works; you can change it later in Settings.
8. Tell Claude: **"Phase 0 done. Mode G (or A, or B). Start Phase 1."** (Mode G: also say whether the Google Cloud project and Drive API are ready.)

**Done when:** `npx wrangler whoami` shows your email; you have a project folder; SMTP details (or Brevo key) are in your notes; **Mode G:** you can sign in to the dedicated Google account in its own Chrome profile with 2-step verification on, and *APIs & Services → Enabled APIs* lists "Google Drive API".

### Phase 1 — Skeleton + first live deploy

```text
PASTE INTO CLAUDE:
Phase 1. Per guide §4.1 and §3, create the full skeleton: wrangler.jsonc (D1 binding
DB, R2 binding FILES only if I chose Mode A, assets binding ASSETS, nodejs_compat,
staging env (its OWN D1 database and R2 bucket, its own ENVIRONMENT var, and crons set to [] because
a staging environment inherits the production crons and would break the 5-cron free limit; bindings
are not inherited, so define them again), assets run_worker_first = ["/api/*", "/files/*", "/s/*",
"/brand/*", "/manifest.webmanifest"], production crons commented out until Phase 11), package.json
(wrangler dev-only), src/index.js with the tiny router serving /api/health and
falling back to assets, src/core/events.js (tiny event bus), src/modules/index.js
(static import list, empty for now), public/_headers (security headers per §11.2), public/login.html + public/index.html placeholder with
app.css design tokens (§6.1) and ui.js api() helper, manifest.json + sw.js shell,
print.css, docs/CHANGELOG.md + docs/DATA_DICTIONARY.md. Then give me the exact
commands to create the D1 databases (npx wrangler d1 create nirmaan-db --location apac, then the same
for nirmaan-db-staging) and the R2 buckets if Mode A (npx wrangler r2 bucket create <name>), apply
nothing yet, and deploy production and staging. I must see a live https URL with our company colours and a working
/api/health returning ok.
```
**Done when:** you open `https://nirmaan-crm.<your-subdomain>.workers.dev` on your **phone** and see the styled placeholder; `/api/health` shows `{"ok":true}`; code is committed to GitHub.

#### Phase 1 add-on — the Google sign-in key (Mode G only, ~20 minutes, you do it with Claude's help)

*Why now:* Google needs your real web address (from the Phase 1 deploy) to create the key. *Why it matters:* this is the step that decides whether the Drive connection **lasts for years or dies every 7 days** — do not skip the audience choice. Google renames screens now and then; if a button is not where this says, tell Claude what you see on screen (do not paste any secret).

1. In the "CRM files" Chrome profile open `console.cloud.google.com`, select project `NirmaanCRM`, and open **Google Auth Platform** (the menu may still say *APIs & Services → OAuth consent screen*). Click **Get started**.
2. **App information:** name `NirmaanCRM` · support email = the dedicated account. **Audience: choose `Personal`** (a single-account app) **if it is offered.** It is the setting with no 7-day expiry, no review and no public listing. Contact email = the dedicated account. Accept the policy → **Create**.
3. **Data Access** (Scopes) → *Add or remove scopes* → tick only `…/auth/drive.file` ("See, edit, create and delete only the specific Google Drive files you use with this app") → **Save**. Add nothing else.
4. **Clients** → **Create client** → type **Web application** · name `NirmaanCRM web` · under *Authorized redirect URIs* add exactly `https://<your-site>/api/storage/google/callback` (your real workers.dev address, no trailing slash) → **Create**. A box shows a **Client ID** and a **Client secret**. Keep that box open.
5. Back in your terminal, **never in chat**: `npx wrangler secret put GOOGLE_CLIENT_ID` → paste the id → Enter; `npx wrangler secret put GOOGLE_CLIENT_SECRET` → paste the secret → Enter. Do this for production only. **Staging does not get Google keys** — staging uses the `d1` driver so a test never touches the real Drive.
6. Close the box. If you lose the secret, make a new one in *Clients* and run step 5 again (nothing else changes).

> **If `Personal` is not offered (decision box — tell Claude which you choose).** Google changes these screens, so Claude re-reads Google's current "Manage App Audience" page with you before you decide. As checked 21 Nov 2026: *External + Testing* makes sign-ins expire after 7 days (weekly reconnect — **not recommended**); *External + In production* needs a verified website and privacy-policy address on a domain you own, which a `workers.dev` address probably cannot provide; *Internal* needs a Google Workspace organisation. Pick one: **(1)** buy a custom domain (~₹700–1,100/year, the same one as §0's optional domain), publish the app under it; **(2)** use Google Workspace Business (paid) with *Internal*; **(3)** choose Mode A (R2) or Mode B + Link items instead; **(4)** as a last resort run in *Testing* and press **Reconnect** every week — the CRM keeps working in between and the red banner tells you when. Never leave the choice unmade.
>
> **Two facts Claude must re-verify in Phase 4 and report to you:** (a) that the `Personal` type accepts a *Web application* client and issues a refresh token that stays valid; (b) that `drive.file` access to files the CRM created persists across reconnects **with the same Client ID** (it should; if you ever replace the Client ID, the CRM would stop seeing its old files — so keep the same key for life, and §10.8 says how).

### Phase 2 — Database + storage layer

```text
PASTE INTO CLAUDE:
Phase 2. Create migrations 0001–0009 exactly per guide §5 (always create 0007 —
empty People tables are harmless and numbers never shift; the People module stays OFF
until I want it). Implement core/db.js (query helpers, pagination, soft
delete), core/storage.js with the driver interface (put/get/remove/usage) and the d1 + r2 drivers per §3.4
(d1 driver enforces the 1.8 MB cap using file_blobs; the gdrive driver is built in Phase 4, together with
the Connect Google Drive screen, so leave a clear placeholder), core/util.js (ids, paise money, IST dates, CSV with
BOM, validation), core/settings.js (get/set + AES-GCM encrypt/decrypt using
APP_KEY). Give me the commands to set secrets SESSION_SECRET, APP_KEY, OWNER_EMAIL,
OWNER_PASSWORD (show me how to generate random values; set them separately for
production and for staging — npx wrangler secret put NAME and npx wrangler secret put NAME --env staging —
with DIFFERENT values) and to apply migrations to remote AND staging (always with an explicit --remote
or --local flag; never rely on a default). Add GET /api/health/db that counts tables (open for now; Phase 3 makes it Owner-only).
```
**Done when:** `npx wrangler d1 migrations apply nirmaan-db --remote` succeeds; `/api/health/db` reports all tables; secrets are set (Claude shows you how to confirm without printing them).

### Phase 3 — Login, users, roles

```text
PASTE INTO CLAUDE:
Phase 3. Implement core/auth.js + core/permissions.js per §4.5 and §7.8 note 5:
PBKDF2-SHA256 (100,000 iterations — Cloudflare's maximum — via WebCrypto) password hashing, and MEASURE its CPU
time on the free plan: if a login can exceed the ~10 ms cap, STOP and tell me (fallbacks: make the emailed code the
main login, or the ~US$5 plan); sessions table with
hashed random tokens, HttpOnly/Secure/SameSite=Lax cookie, 30-day sliding expiry;
bootstrap owner created on first login from OWNER_EMAIL/OWNER_PASSWORD secrets — also whenever the owner's
password_hash is NULL (this is the documented recovery, §11.4);
POST /api/auth/login, /logout, GET /api/me (profile + permissions + enabled
modules + lang); OTP endpoints built but dormant until email works (Phase 11).
Login page per §6: big email + password fields, "Show password" toggle, plain
errors, rate-limit password attempts (5 per 15 min per email, via the rate_limits
table). Users admin page (Owner only) per §4.6: add people with name/email/mobile/role/extra
roles/projects/language; temporary password (12 readable characters) shown once with
Copy + Share buttons, valid until first login or 7 days, then a forced "choose your own
password" screen (10+ characters); role dropdown with the one-line plain-English
descriptions; last-login column; Reset password, Log out this person, Deactivate /
Reactivate, and a Log out everyone button; the Owner safeguards (always one active
Owner, primary owner untouchable, nobody edits their own role, second Owner only when
access.allow_second_owner is on); project_members and the Access checkboxes with
permissions.visibleProjectIds(user) used by every query. Write server-side tests for each
safeguard. Enforce permissions server-side on
every /api route; UI hides what the role can't use. Require the X-NirmaanCRM header on every
state-changing call (§4.3).
```
**Done when:** you log in as owner on your phone; you add "Ramesh – Site Engineer" with a temp password; Ramesh logs in on *his* phone and sees the site-engineer home (3 big buttons) and **cannot** open `/api/sales/leads` (Claude shows you how to test by pasting the URL — it must say "Please log in" or "Not allowed", never data).
Also: Ramesh is forced to choose his own password at first login; you cannot deactivate or demote yourself (the screen says why); with "second Owner" switched on you can add a backup Owner, who in turn cannot touch you; deactivating Ramesh logs him out on his phone within a minute.

### Phase 4 — Core shell

```text
PASTE INTO CLAUDE:
Phase 4. Per §7.1 build: Projects (list/create/edit + top-bar project picker that
filters everything), Documents vault (upload via storage.js with client-side
photo compression per §3.2, link-type documents, private /files/:id downloads
with permission checks, browse/search), notifications (bell, unread count,
notify() engine reading rules from settings — in-app channel now, email channel
queued but dormant), audit.js + audit viewer, Settings screen (company name/logo,
module ON/OFF switches per §4.2, the two sales/PO flags, storage meter, label
overrides), global search /api/search, and the role-based home screens per §6.2
with bottom nav, language toggle scaffolding (i18n.js with en filled; hi/mr in
Phase 12), and the ? help button on every page. PWA install prompt. Wire the
module registry and src/modules/index.js (static imports) so future modules mount with one line; include the
events.js bus and the 'requires' check on the module switches. Add project assignment (the project_members
screen on each project, the Settings → Access role checkboxes) per §4.6. Google Drive as the primary store (Mode G, guide §3.4): build core/gdrive.js with plain fetch, no Google
library — (1) Settings → Storage (Owner only): Connect Google Drive, using the OAuth web-server flow with
scope drive.file only, access_type=offline, prompt=consent, PKCE (S256) and a single-use state kept in
oauth_states; the callback exchanges the code, then stores the refresh token and the access token ENCRYPTED
with APP_KEY in settings, shows the connected account's email, creates the NirmaanCRM root folder and
remembers it in drive_folders; (2) automatic access-token refresh (one retry on 401); (3) the gdrive storage
driver — resumable upload where the Worker STREAMS the incoming body (FixedLengthStream, never buffered; reject
anything over files.brochure_max_mb with a plain message), download with Range pass-through and
Cache-Control: private, no-store, delete, and folder creation on first need (project / category folders per
§3.4); (4) a quota meter from Drive's about call, showing both "files in NirmaanCRM" and "whole Google account"
with 80% and 95% warnings (if the drive.file scope cannot read the quota, fall back to summing our own
documents sizes and say so on screen); (5) failure behaviour exactly as §3.4: invalid_grant → status
needs_reconnect, red Owner banner + one email, phone upload queue keeps new files, downloads show the plain
"paused" message, records and branding keep working; 403/429/5xx retried up to 3 times with growing pauses;
(6) the nightly verification slice (about 20 documents per run, oldest-checked first) setting drive_status,
and the Owner's "files needing attention" list with Restore / Re-upload / Mark lost; (7) never log, audit, return
or export any token, code or secret. Test with a real 20 MB PDF and report the measured Worker CPU time.
Branding, letterhead, brochures and customer share links are the NEXT step (Phase 4B) — do not start them yet.
```
**Done when:** you create project "Shivneri Heights"; upload a photo from your phone (check it shrank to <500 KB); add a link-type document; Ramesh sees only his modules; turning a module OFF hides it for everyone; audit shows your actions in plain sentences; "Add to Home Screen" works on Android/iPhone; Ramesh (limited to his own project) sees only that project in the picker, lists and search, while you see all.
- **Mode G:** Settings → Storage → **Connect Google Drive** → Google asks the dedicated account → you return to the CRM showing "Connected as yourcompany.crm@gmail.com"; you upload a site photo and a 20 MB PDF; both appear in the Drive account under `NirmaanCRM/<project>/…`, open correctly from the CRM, and show **Restricted** in Drive's Share box; the quota meter shows both numbers; you delete one file by hand in Drive → after the next check the CRM says "1 file needs attention"; you press **Disconnect** → the red banner appears, an upload waits in the phone queue, and **Connect** again clears it; Claude states what the measured CPU time per upload was and confirms the two Google facts in the Phase 1 add-on box.

### Phase 4B — Branding, letterhead & brochure library (the second half of the core shell)

```text
PASTE INTO CLAUDE:
Phase 4B. Build §7.10 exactly; migration 0009 is already applied. core/brand.js
(project override else company, field by field). Settings → Branding in the five plain
blocks, with PAN and bank account numbers encrypted using APP_KEY and hidden from
roles per §4.5. Logo, signature and stamp upload: the BROWSER converts a chosen SVG to
PNG, the SERVER refuses any SVG/HTML. Browser-made favicon + 192/512 icons; colour
contrast check (4.5:1 against white, offer the nearest darker shade); public /brand/*
(logo, icons, theme.css) and /manifest.webmanifest built from branding — signature and
stamp must NEVER be served publicly. Letterhead in three modes (generated · header+footer
bands · full-page image with safe-area margins), A4 geometry, real <img> elements with
print-color-adjust: exact, repeating header/footer, DRAFT watermark and no signature on
unissued documents, the shared public/print/print.js helper that modules call (the PO,
demand-letter and receipt print views come in their own phases), a general-letter page,
"How your letters will look" with the ruler test page, and per-project overrides.
Brochure library per project: categories, audience (internal/customer), language,
file-or-link, versions with uq_doc_latest, "Replace with new version", Older versions
view, raw-body streaming upload to the configured store (Google Drive by default; R2 or database if I chose them) with progress/retry (limit from
files.brochure_max_mb), Link-first screen in Mode B; branding pictures ALWAYS stored in file_blobs (store 'd1') in every mode. Customer sharing: core/share.js,
share_links, "Send brochure" on Sales home (for now it takes a typed name + mobile; Phase 9
adds the lead picker), WhatsApp text from the branding intro, public /s/<token> landing page
and /s/<token>/file (views counted only on Open), expiry / max views / revoke, IP throttle
via rate_limits, the events share.created and share.viewed, the brochure.updated
notification, and the Owner/PM "Shared links" screen. Also the Owner-home "Finish setting up"
checklist. Then give me the Done-when checklist and wait for my confirmation.
```
**Done when:**
- Settings → Branding: you save your company details; PAN and bank fields show for you but are blank for Ramesh and the CA (test with their logins).
- You pick an SVG logo → it is accepted (converted to PNG); a hand-made `.svg` upload straight to the API is refused.
- The login page and top bar show your logo; after removing the old icon and *Add to Home Screen* again, your phone shows your logo as the app icon.
- All three letterhead modes look right in "How your letters will look"; the ruler test page printed on real paper shows text clear of your artwork.
- A project override changes only that project's letters.
- Brochure: upload v1, tick *customer-shareable*, upload v2 → v1 sits under Older versions and Sales sees only v2.
- "Send brochure" to a test contact: WhatsApp opens with the link; the link opens on another phone with no login; the view count stays 0 until Open is tapped; the sharer is notified; **Revoke** → "This link has expired".
- An *internal* price list never appears in *Send brochure*, and the API refuses to create a link for it.

### Phase 5 — Approvals & Compliance

```text
PASTE INTO CLAUDE:
Phase 5. Build the approvals module exactly per §7.2 + Appendix A seed template
(include the redevelopment extras as optional rows). Migration 0002 already
applied. Implement api.js + pages: ordered checklist grouped by category, status
chips with words, item detail with event timeline and big status buttons,
documents attached, valid_till + reminder_days with days-left hints, "Load Mumbai
template" on project creation, renewal re-arming, expiring-soon strip on owner
home, and notify() events approval.due_soon + rera.quarterly (in-app now; email
queues activate Phase 11). Add the CA-verification note in the UI. Owner can
edit/reorder/add/delete template rows per project.
```
**Done when:** template loads (27 rows, or 29 for a redevelopment project); mark IOD Applied with a date; set a CC expiry 20 days away → it appears under "Expiring soon" on your home; the timeline reads like a story; Ramesh can view but not edit.

### Phase 6 — Drawings & Design

```text
PASTE INTO CLAUDE:
Phase 6. Build the drawings module per §7.3: register with discipline chips and
big code search; revision history; "Issue new revision" flow with auto-increment,
draft vs IFC, auto-supersede of the previous IFC, drawing.new_ifc notification to
site+PM; site role sees ONLY latest IFC (enforce in the API, not just UI);
superseded banner for office roles; received_from + "waiting from consultant"
flag surfaced on PM home; print/download/WhatsApp share. Link-type drawings
supported for Mode B.
```
**Done when:** the R1→R2 test in §7.3 passes exactly, including Ramesh being unable to fetch the old revision through the API.

### Phase 7 — Site Execution

```text
PASTE INTO CLAUDE:
Phase 7. Build the site module per §7.4 + §6.3: offline-first DPR (autosave text to
localStorage, photo queue in IndexedDB with client-side compression, client_uuid idempotency,
auto-sync on reconnect or app open (iPhones have no background sync), pending badge, plain-language offline banner), 14-day
calendar strip, PM all-projects today view; milestones per wing with planned
dates and one-tap "Done today" (date picker, default today) emitting the
milestone.done event (no subscriber until Phase 9); snags with photo/assign/severity and open→fixed→verified flow, high>3
days nudge; "Next 7 days" look-ahead filter; dpr.missing 19:00 IST logic (cron
activates Phase 11 — build the handler now). GRN screen comes in Phase 8 but
reserve the home button.
```
**Done when:** the airplane-mode test in §7.4 passes with zero duplicates; a DPR takes you under 2 minutes on your phone; Ramesh completes it without calling you.

### Phase 8 — Procurement

```text
PASTE INTO CLAUDE:
Phase 8. Build procurement per §7.5: vendors (duplicate-phone warning, one-tap
call, rating), RFQ + quote comparison (lowest/fastest highlighted, "2 of 3
quotes" hint, last-paid-rate display), convert-to-PO with auto numbering and line
items, maker-checker approval flow with the PM limit setting and email-queued
notifications, PO print/PDF on the company letterhead via print.js (§7.10: DRAFT watermark until approved,
signature + stamp only on approved POs) + WhatsApp share, site GRN flow (offline-capable,
challan photo, partial/full receipt status), bills with due reminders and vendor
ledger. Enforce: creator cannot approve own PO; PM cannot approve above limit;
site can ONLY create GRNs in this module.
```
**Done when:** the §7.5 acceptance test passes end-to-end, including the PO with total ₹60,000 (incl. GST) routing to you and not the PM.

### Phase 9 — Sales CRM

```text
PASTE INTO CLAUDE:
Phase 9. Build sales per §7.6: fast lead add with round-robin auto-assign and
duplicate-phone merge; 1-hour/4-hour response SLA nudges; lead timeline with
one-tap Call/WhatsApp and mandatory next-follow-up on call logging; visits with
2-hour reminder; inventory grid (wing×floor, colour+word status, 48h auto-expiring
blocks, server-side double-book prevention); booking flow generating paise-exact
CLP schedules from sal_plan_stages (pct_bp basis points, remainder to last stage, stages must total 10000);
milestone.done event subscriber in sales/hooks.js matching on (project, wing, milestone_key) → demands scheduled→ready
(due = done+7 days, setting); demand letters from editable template with a print view on the letterhead (§7.10, using the project's own
bank/RERA account), receipts printable the same way,
saved PDF attached to the email, + WhatsApp share; receipts with TDS → demand partial/paid →
booking progress; RERA 10% advance warning; booking cancellation releasing the flat;
brokerage payments table; overdue detection; channel partners + brokerage payable;
funnel/source/response-time reports. Sales users see only their own records
unless sales.share_all_leads is on. DPDP consent checkbox on lead creation. Connect "Send brochure" to
the lead picker and add the sales/hooks.js subscribers for share.created (lead activity) and
share.viewed (notify the sharer), per §7.10.
```
**Done when:** the full §7.6 acceptance test passes — especially: site marks "5th slab" done and the matching demands turn Ready; F-503 cannot be booked twice; ₹ amounts match the plan to the paisa.

### Phase 10 — Team & Hiring (optional — skip if not needed now)

```text
PASTE INTO CLAUDE:
Phase 10. Build the people module per §7.7 (3 screens: Staff, Open Positions,
Candidates), feature-flagged OFF by default, HR role access per §4.5, masked
Aadhaar only, hired→staff conversion, interview-day list. Keep it deliberately
light.
```
**Done when:** HR user runs a candidate from New → Interview → Hired and the staff record appears; you (Owner) can see staff documents; sales cannot.

### Phase 11 — Email engine + automation goes live

```text
PASTE INTO CLAUDE:
Phase 11. Build the email engine exactly per §7.8 including all six implementation
notes: smtp.js over cloudflare:sockets (465 implicit TLS first, 587 STARTTLS with
startTls and the fallback hint, never port 25), AUTH LOGIN/PLAIN, MIME HTML,
dot-stuffing, multi-line reply parsing, 10s timeouts; mail.js provider switch
smtp|brevo_api with queue + email_log + hourly retry (max 3); Settings→Email with
presets table, AES-GCM-encrypted password, "Send test email to me", send-log
screen with retry; enable OTP login as the primary login button once test
succeeds; editable templates with placeholders; per-event email checkboxes;
digest composer per §7.8 + Appendix C. Uncomment crons in wrangler.jsonc
(02:30, 13:30, 20:30 UTC + hourly) with the staging guard, and implement the
nightly backup job per §11.1 (chunked and resumable, never more than ~40 database queries per run), plus
attachment support for the demand-letter email (§7.8 note 8). Then walk me through entering MY company SMTP
details and testing, step by step.
```
**Done when:** test email arrives from **your company address**; you log out and log back in with **only an emailed code**; at 8:00 AM next morning the digest arrives (or use the "Send digest now" button Claude must include); a failed email shows in the log with a plain reason and retries.

### Phase 12 — Dashboard, reports, polish

```text
PASTE INTO CLAUDE:
Phase 12. Build the owner dashboard (6 tiles per §7.9, CSS bars only, every tile
tappable) and all reports + CSV exports (BOM, en-IN formats, Tally-friendly
receipts columns), Export-everything ZIP (built in the browser, §3.2), storage meter + Archive-old-project
tool per §3.2 (Mode G: move the project's Drive folder into _archive and mark it read-only; plus the browser ZIP "Free up space" button), Hindi + Marathi dictionaries for all site-module labels and common
actions (§6.4), label-override editor, final PWA polish (icons, offline shell),
re-test branding on every print view (PO, demand letter, receipt, general letter) and the share-link
expiry/revoke flow, and a consistency pass: every screen obeys §6 (18px, 48px buttons, plain errors,
empty states, help button, ≤3 taps to any daily task).
```
**Done when:** dashboard numbers match the underlying lists; CSVs open cleanly in Excel with ₹ intact; Ramesh switches to मराठी and the whole site flow reads Marathi; archive tool produces a ZIP and frees storage; your PO, demand letter and receipt all print on the letterhead — signature and stamp on issued documents, DRAFT on drafts.

### Phase 13 — Hardening, UAT, go-live

```text
PASTE INTO CLAUDE:
Phase 13. Final pass per §9 and §11: security checklist (server-side perms on
every route, cookie flags, the X-NirmaanCRM CSRF header, CSP via public/_headers, upload allow-list (no SVG/HTML), OTP/password rate limits, private files, encrypted
SMTP creds, secrets not in code/git, .gitignore), input validation sweep, audit
coverage sweep, the §7.10 share-link and branding negative tests (wrong token, expired, revoked, internal file,
signature/stamp unreachable, SVG refused), the Google Drive drills (§3.4: disconnect and reconnect; revoke the app at myaccount.google.com/permissions and see the banner; delete a file by hand and see it flagged; upload exactly the size ceiling and one byte over; confirm no token or secret appears in logs, audit text, API responses or the export ZIP; confirm nothing in Drive is shared), the §4.6 Owner-safeguard and project-access tests, backup restore drill (give me exact commands to restore last
night's backup into staging and verify counts), optional Cloudflare Access
second-lock walkthrough (free ≤50 users), staging→prod deploy routine, and the
UAT script + role cheat sheets from §9 and Appendix D formatted for printing.
Then produce docs/OPERATIONS.md (daily/weekly rituals, troubleshooting table
§11.4, cost-guard routine) and a final CHANGELOG.
```
**Done when:** the §9 UAT passes with your actual site engineer; restore drill works; the share-link, Owner-safeguard and Google Drive drills all pass; you have printed cheat sheets; the team is live.

---

## 9. Go-live, training, and the first 30 days

### 9.1 The 55-year-old UAT (do this with your real site engineer, on his real phone)
Give him the printed cheat sheet (Appendix D) and watch silently. Pass = each task done in **under 2 minutes, without asking you**:
1. File today's work report with 2 photos.
2. Find the latest structural drawing for Wing A, 5th slab.
3. Record a delivery: pick the PO, photograph the challan.
4. Raise a snag with a photo and assign it.
5. Switch the app to Hindi/Marathi and back.

Then the **Owner and Sales run** (added in v1.2):
6. **Owner:** upload your logo and letterhead, then save an *approved* PO as PDF — letterhead on every page, signature and stamp present; save a *draft* — it shows DRAFT and no signature.
7. **Sales:** upload a customer-shareable brochure to a project, send it to a test contact on WhatsApp, open the link on a different phone, then revoke it — it must say expired.
8. **Everyone:** log in with their *own* email, change the temporary password, and confirm they see only their own modules and projects (the "should NOT see" list in §4.6).

Any task that fails → paste the observation to Claude with the Bug Template (§10.4). **Do not go live until all five pass.** Repeat the equivalent 4-task test with your sales executive (add lead, log call with next follow-up, schedule visit, book a flat) and accounts (record receipt, see overdue list, export CSV).

### 9.2 Training (30 minutes per person, not a classroom)
- Before the session: create their login (§4.6) and give them the temporary password in person or in a private message — never in a group chat.
- Install to home screen together (2 min). Log in with emailed code together (2 min).
- Do their 3 daily tasks together twice (15 min). Hand over the one-page cheat sheet.
- Create a WhatsApp group "NirmaanCRM help" — questions go there; you paste them to Claude; fixes deploy in minutes. This is your entire support system, at ₹0.

### 9.3 Go-live checklist
- ☐ All UAT passed · ☐ Real projects created with Mumbai templates loaded · ☐ Current IFC drawings uploaded (old ones marked superseded) · ☐ Inventory + price list entered · ☐ Open leads imported (CSV paste-in helper Claude builds on request) · ☐ Vendors + open POs entered · ☐ Team users created, roles correct, each person's login tested once with the "should NOT see" check · ☐ Google Drive connected, a test file opens, quota meter visible, 2-step verification on the Drive account · ☐ Logo, colours and letterhead set; a test PO printed to PDF · ☐ Project brochures uploaded and *customer-shareable* ticked; a share link tested on your own phone · ☐ Second Owner decided (§4.6) · ☐ SMTP test green, digest recipients set · ☐ Nightly backup ran once · ☐ Restore drill done · ☐ GitHub current · ☐ Cheat sheets printed.

### 9.4 First-30-days rituals (this is what makes it succeed)
- **Daily 7 PM:** DPR nudge goes out automatically; engineers file before leaving site.
- **Daily 8 AM:** you read the digest with chai. Anything red gets one phone call.
- **Monday 30-min meeting:** open the dashboard on a TV/laptop — approvals expiring, "Next 7 days" milestones, POs pending, overdue receivables, sales funnel. The screen runs the meeting; nobody prepares PowerPoint.
- **Weekly:** you spend 10 minutes in the audit log and send-log (trust but verify).
- **Monthly:** download the Export-everything ZIP to your laptop + an external drive (§11). Check the storage meter.
- **Rule for the team:** "If it's not in NirmaanCRM, it didn't happen." WhatsApp is for discussion; the record lives in the system.

---

## 10. Upgrade & change playbook (the "modular, easily changed" promise)

### 10.1 Safety rules (Claude must follow these on EVERY change, forever)
1. Read `docs/DATA_DICTIONARY.md` + the relevant module folder first.
2. **Additive-only migrations:** new file `00NN_description.sql`, only `CREATE TABLE` / `ADD COLUMN` / `CREATE INDEX`. Never edit an applied migration. Never drop/rename in place — deprecate in the dictionary instead.
3. Respect the module contract (§4): core helpers only; new module = folder + migration + registry entry + feature flag.
4. Update `DATA_DICTIONARY.md` + `CHANGELOG.md` in the same change.
5. Deploy to **staging first** (`npx wrangler deploy --env staging`, separate DB/bucket), run the phase's acceptance checklist there, then prod.
6. Backup before any migration: `npx wrangler d1 export nirmaan-db --remote --output=pre-change.sql`.
7. Rollback exists: `npx wrangler rollback` (previous deployment) + GitHub history for code. Data is never lost because migrations are additive.

### 10.2 Template — add a field
```text
PASTE INTO CLAUDE:
Change request per guide §10: in the [module] [screen], add field "[label]"
(type: [text/number/date/dropdown with values…], required: [yes/no], visible to
roles: […]). Follow all §10.1 safety rules: additive migration, dictionary +
changelog updates, staging first. Give me the full changed files and the exact
commands, then the 3-click test to verify.
```

### 10.3 Template — add a whole module (example: Rentals, or Site Attendance)
```text
PASTE INTO CLAUDE:
New module per guide §4.2 contract: "[name]". Purpose: [2 lines]. Screens: [list,
max 3]. Fields: [list]. Workflow: [steps]. Roles: [who does what]. Notifications:
[event → who]. Reports: [if any]. Create src/modules/<key>/ (api.js, service.js, hooks.js) and public/modules/<key>/, the migration (next number), the one import line in
src/modules/index.js, the registry entry (enabledByDefault:false until I test, with its requires list), pages obeying §6, api.js obeying §4.3,
events emitted/consumed only via core/events.js,
permissions in the matrix, seed data if needed. Update docs. Staging first.
```

### 10.4 Template — bug report (works even from your phone)
```text
PASTE INTO CLAUDE:
Bug per guide §10.4. I am [role]. I clicked: [steps]. I expected: [x]. Happened:
[y]. Error text/screenshot: [paste]. Time: [approx, IST]. Follow §10.1: smallest
safe fix, full changed files, staging first, and a 3-click test. If it's an
email/SMTP issue, check email_log reasoning per §7.8 and §11.4 first.
```

### 10.5 Template — quarterly cost & health audit
```text
PASTE INTO CLAUDE:
Run the guide §3.2 cost guard: give me the dashboard checks (Workers requests,
D1 rows read/written, and file storage — the Google Drive meter in Settings → Storage and/or R2) with my current numbers pasted below, tell me
headroom percentages, and if storage >80% walk me through the archive tool.
Also verify crons ran (digest/backup timestamps) and email_log failure rate.
[paste numbers from Cloudflare dashboard → Workers & Pages → nirmaan-crm → Metrics]
```

### 10.6 Template — change a scheduled time (digest, DPR nudge, backup)
```text
PASTE INTO CLAUDE:
Change request per guide §10: move the [8 AM digest / 7 PM DPR nudge / 2 AM backup]
to [new IST time]. Convert to UTC for wrangler.jsonc (IST = UTC+5:30), keep the staging
guard, remember the free plan allows only 5 cron triggers per account (§3.2), update
CHANGELOG, staging first, then give me the deploy command.
```

### 10.7 Template — add a role or change what a role can do (example: "Liaison executive")
```text
PASTE INTO CLAUDE:
Change request per guide §10 and §4.5–4.6: add a role "[name]", described in one plain
sentence as "[sentence]". It can [view/create/edit/approve/export] in [modules] and
nothing else; record-level limits: [e.g. only their own items]. Add it to the permission
matrix in core/permissions.js (the single source of truth), the role dropdown with its
one-line description, its home screen (3 big buttons), the glossary and the cheat sheet.
users.role is plain text, so there is NO database change unless I name a new field. Add a
server-side test that the new role is refused everywhere else. Staging first, update
CHANGELOG + DATA_DICTIONARY, then give me the 3-click test (log in as a test person with
this role and try to open Sales, Purchase and Settings).
```

### 10.8 Template — change the file store or the Google account (v1.3)
Three situations. In all three: take a database export first (§10.1 rule 6) and work on staging first.

```text
PASTE INTO CLAUDE:
Change request per guide §3.4 and §10: [pick ONE]
(a) CONNECT A DIFFERENT GOOGLE ACCOUNT (the old one is lost, or I am moving to a new company account).
    Keep the same Google Cloud project and Client ID if possible. Disconnect the old account, connect the new one,
    create a fresh NirmaanCRM folder tree, and tell me which documents point to files the new account cannot see
    (drive.file only sees files the CRM itself created in that account). Offer to COPY the old files across while the
    old account is still reachable, then mark failures "lost" in the files-needing-attention list.
(b) MOVE ALL FILES FROM GOOGLE DRIVE TO R2 (or the reverse). Write a resumable copy script that moves a few files
    per run (free CPU cap), verifies md5, updates documents.store and the id columns, deletes the source only after
    I confirm, and shows progress in Settings → Storage. New uploads switch only when I press Switch.
(c) I REPLACED THE GOOGLE CLIENT ID/SECRET. Warn me first: files created under the old Client ID may become
    invisible to the CRM; propose the safest path (keep the old key if I still have it).
Update CHANGELOG + DATA_DICTIONARY, then give me the test: upload, open, share link, quota meter.
```

---

## 11. Backups, security, privacy, troubleshooting

### 11.1 Backups (3-2-1, adapted, all free)
1. **Nightly automatic (starts 02:00 IST, finishes by itself):** a free Worker run may do only ~50 database queries, so the backup is **chunked and resumable**: the 02:00 run creates a `backup_log` row, then each run (02:00 and the following hourly ticks) dumps up to ~40 pages of rows into JSON files of **under 1.5 MB** each, saves its place in `backup_log.cursor_json`, and marks the run `ok` when every table (plus a documents manifest) is done. Files go to storage under `backups/YYYY-MM-DD/` (in **Mode G**: the Drive folder `NirmaanCRM/_backups/YYYY-MM-DD/`), keeping the last 30 days. **A copy inside the same Google account protects you from mistakes and from a Cloudflare problem — not from losing that Google account**, which is why item 3 (a copy on your own laptop) is not optional. **Mode B** (no R2): copying records into D1 again would duplicate the whole database (file BLOBs included) and run into the 2 MB row and 5 GB limits, so Mode B does **not** keep nightly copies; D1 Time Travel (item 2) protects the records, the nightly run only writes a `backup_log` heartbeat, and the dashboard nags for the monthly Export-everything download (item 3), which is what protects the files. A failed or unfinished run fires `backup.failed`.
2. **D1 Time Travel:** Cloudflare lets you restore the database to any minute within the last **7 days on the free plan** (30 days on the paid plan) — a bonus safety net for the *records*, not a replacement for items 1 and 3.
3. **Monthly manual:** Settings → **Export everything** (ZIP of CSVs + files) to your laptop **and** an external drive **or a different Google account's Drive** (never the CRM's own). Plus before any change: `npx wrangler d1 export nirmaan-db --remote --output=pre-change.sql`.
4. **Quarterly restore drill:** Claude's Phase 13 script restores last night's backup into staging and compares row counts. A backup you've never restored is a hope, not a backup.

### 11.2 Security checklist (enforced in code, verified in Phase 13)
HTTPS only · CSRF custom header + `SameSite` cookies · CSP, `nosniff` and frame-blocking via `public/_headers` · upload allow-list (no SVG/HTML) · passwords PBKDF2-hashed · OTP 6-digit/10-min/5-attempt/3-per-15-min · sessions hashed-at-rest, HttpOnly+Secure+SameSite cookies, 30-day expiry, logout kills server-side · **every** API route permission-checked · files private behind `/files/:id` · customer share links = 32-byte random token stored only as a hash, expiring, revocable, throttled, `customer`-audience files only (§7.10) · signature and stamp never public · Owner safeguards and forced first-login password change (§4.6) · SMTP password and the Google Drive tokens AES-GCM encrypted with `APP_KEY` · Google permission `drive.file` only (the CRM cannot see the rest of that Drive), nothing in Drive ever shared, no Drive address ever given to a browser (§3.4), Google client secret only as a Worker secret · secrets via `wrangler secret`, never in code or GitHub (`.gitignore` covers `.dev.vars`) · rate limits on login/OTP · audit on all writes · soft deletes · optional **Cloudflare Access** second lock (Zero Trust free for up to 50 users — confirm on Cloudflare's pricing page; path: Workers & Pages → your Worker → **Access** tab → *Protect this Worker behind Access* → *All traffic* → email-OTP policy; the app still does its own login and roles). **Default OFF.** Warning: Access sessions expire, and when they do the phone's background upload of offline reports is redirected to a login page and fails. If you enable it, set a long session (e.g. 30 days) and repeat the airplane-mode test in §7.4 across an expiry before relying on it. **If you do enable Access, add a *Bypass* policy for `/s/*` and `/brand/*`** — otherwise customers cannot open the brochure links you send them, and the login page loses its logo.

### 11.3 Privacy (India DPDP Act 2023 — practical basics)
The DPDP Rules were notified in November 2025 and phase their duties in over roughly 12–18 months — so treat everything below as *needed by 2027 at the latest* and confirm exact dates with your CA. Consent checkbox when capturing a lead ("Customer agreed to be contacted about this project") · privacy-policy page linked in the app footer (Claude drafts it; your CA reviews) · store **masked** Aadhaar only, PAN where legally needed (and hidden from roles that do not need it, §4.5) · least-privilege roles (sales can't see HR documents) · customer data export on request, and erasure of *lead* data on request (Owner tools; audit keeps the record). Booking, demand and receipt records are **retained as the law requires** (confirm the retention period with your CA) and, once that period ends, anonymised rather than deleted · no selling/sharing data with third parties (files kept in Google Drive sit with Google as your service provider, under the dedicated account's terms — the privacy-policy page Claude drafts says so; keep that account for the CRM only and never share it)  · share links carry no personal data (the token is random; the recipient label is for your eyes only) and expire after 14 days by default · breach response: rotate secrets, force logout all sessions (one button), notify affected parties as advised by your CA. *This guide is operational guidance, not legal advice.*

### 11.4 Troubleshooting (plain-language table for OPERATIONS.md)

| Symptom | First check | Fix |
|---|---|---|
| Site won't open at all | Cloudflare dashboard → Worker status; your internet | `npx wrangler deploy` again; paste any error to Claude (§10.4) |
| "Please log in" loop | Cookies blocked? Correct URL? | Allow cookies; use the exact workers.dev URL; Owner re-sends temp password |
| Login code never arrives | Settings → Email → Send log | Spam folder; SMTP test; switch preset to 465; check SPF/DKIM/DMARC (§7.8 note 7); or Brevo fallback (§7.8) |
| Test email fails on 587 | Provider blocks STARTTLS | Use 465 preset; Microsoft 365 is retiring password SMTP — use Brevo |
| Photos won't upload | Size/network | App auto-compresses; offline queue syncs later; Mode B cap 1.8 MB → use Link type |
| Red banner "Google Drive needs to be reconnected" | Settings → Storage → status | Owner presses **Reconnect** and signs in with the dedicated account. Common causes: Google asked for a re-login, the app was removed at myaccount.google.com/permissions, the password was changed, or the consent screen is in *Testing* (7-day expiry — fix the audience, Phase 1 add-on). Phones keep new photos in the queue meanwhile. |
| "This file is missing from Google Drive" | Settings → Storage → Files needing attention | Someone moved or deleted it in Drive. Open Drive's **Trash** with the dedicated account → restore → press *Restore*; otherwise re-upload or *Mark lost*. Tell staff to work through the CRM, not inside the Drive folders |
| Upload says "Google is busy, try again" | Wait a minute | Google rate limit or outage; the phone retries by itself. If it repeats for an hour, check status.google.com and then the bug template |
| Storage meter says Google account 14+ of 15 GB | Settings → Storage | Gmail/Photos in that account count too: empty its Trash and Spam, archive an old project (§3.2), or buy a Google One plan (check one.google.com for current India prices) |
| "Not allowed" during Connect Google Drive | Which Google account did you pick? | Use the dedicated account, in its own Chrome profile; make sure the consent screen lists only the `drive.file` scope |
| Duplicate-looking records | Offline retries | Shouldn't happen (client_uuid); if it does, bug template |
| Digest didn't arrive | Cron ran? email_log | "Send digest now" button; check log; re-deploy (crons live in wrangler.jsonc) |
| "Rows written" near limit | Dashboard → D1 metrics | Usually a runaway cron — bug template with the numbers |
| Storage meter >80% | Settings → System | Archive old project (§3.2) |
| A page or job fails with "exceeded CPU / resources" | Cloudflare dashboard → your Worker → Logs | You hit a free-plan cap (§3.2). Bug template with the log line; Claude splits the work into smaller steps, or you move to the ~US$5 plan |
| Logo or letterhead missing in the saved PDF | Print dialog → "Background graphics" | Tick it and set Margins to None. The app draws the letterhead as images, so if it still fails, use the bug template and name your browser |
| Customer says the brochure link has "expired" | Projects → Brochures → Shared links | Check expiry/revoked; send a new link (2 taps) |
| A new employee cannot see their project | Users → their name → Projects | Add them to the project (§4.6) |
| The app icon on a phone is still the old logo | — | Phones keep the icon they installed with: remove it and *Add to Home Screen* again |
| Forgot owner password | Is email working? | **Easiest:** login page → "Email me a login code". **If email is down:** (1) `npx wrangler secret put OWNER_PASSWORD` (choose a new one); (2) `npx wrangler d1 execute nirmaan-db --remote --command "UPDATE users SET password_hash=NULL, password_salt=NULL WHERE role='owner'"`; (3) log in with `OWNER_EMAIL` + the new `OWNER_PASSWORD` — the Phase 3 bootstrap re-arms because the owner's hash is empty — then change it in your profile. Claude copies these exact steps into OPERATIONS.md. |
| Anything else | — | Bug template §10.4 with screenshot. You are never stuck: code is in GitHub, data is exportable, Claude has the full spec. |

---

## Appendix A — Mumbai approvals seed template (indicative; verify with architect/CA)

Typical MCGM-jurisdiction building project (MCGM is commonly called BMC). `cat` = category, `rem` = default reminder days before expiry. Claude seeds these as editable rows; redevelopment adds the ★ rows.

| # | Item | Authority | cat | rem |
|---|---|---|---|---|
| 1 | Property card / title search / search report | Advocate / Revenue | compliance | – |
| 2 | DP remark & zoning check (reservation, road line) | MCGM | approval | – |
| 3 | Architect & consultants appointed (LOA) | Internal | compliance | – |
| 4 | Site survey & layout plan | Licensed surveyor | compliance | – |
| ★5 | Society consent (redevelopment: required majority) & DA/development agreement registration | Society / Advocate | compliance | – |
| ★6 | Existing tenants' transit-rent & bank guarantee arrangements | Internal / Bank | compliance | 30 |
| 7 | IOD application (BMC online building-proposal system / AutoDCR — confirm current portal with your architect) | MCGM | approval | – |
| 8 | Provisional Fire NOC | Chief Fire Officer, Mumbai Fire Brigade (MCGM) | noc | 30 |
| 9 | Height NOC (AAI colour coding) | Airports Authority of India | noc | 30 |
| 10 | Environment clearance / SEIAA (if built-up ≥ 20,000 sqm — confirm threshold with your environment consultant) | SEIAA / MoEFCC | noc | 45 |
| 11 | Tree authority permission | MCGM Tree Authority | noc | 30 |
| 12 | Traffic NOC (if applicable) | Mumbai Traffic Police | noc | 30 |
| 13 | CRZ / MCZMA clearance (if coastal plot) | MCZMA | noc | 45 |
| 14 | Collector / land-tenure permission (if applicable) | Collector | noc | 30 |
| 15 | IOD conditions compliance (all departments) | MCGM | compliance | 15 |
| 16 | BOCW labour cess registration & returns | Labour Dept | compliance | 30 |
| 17 | CAR / contractor's all-risk insurance | Insurer | renewal | 30 |
| 18 | Commencement Certificate (CC) | MCGM | approval | 30 |
| 19 | MahaRERA registration (BEFORE any advertisement/sale) | MahaRERA | approval | 45 |
| 20 | Plinth check & further CC | MCGM | approval | 15 |
| 21 | Stage-wise further CCs (superstructure) | MCGM | approval | 15 |
| 22 | RERA quarterly progress updates (portal; filing window — confirm in the current MahaRERA circular) | MahaRERA | renewal | 15 |
| 23 | 70% designated-account compliance (receipts vs withdrawals) | Bank / CA | renewal | 15 |
| 24 | Fire completion NOC | CFO | noc | 30 |
| 25 | Lift & electrical inspector approvals | PWD Electrical / Lift Inspector | noc | 30 |
| 26 | Building Completion Certificate (BCC) | MCGM | approval | 30 |
| 27 | Occupancy Certificate (OC) | MCGM | approval | 30 |
| 28 | Water/sewer connections; electricity meters | MCGM / BEST, Adani Electricity, Tata Power or MSEDCL (as applicable to your plot) | approval | 30 |
| 29 | Society formation / conveyance (as applicable) | Registrar / Advocate | compliance | 45 |

Each seeded row gets a `notes` line listing required documents (e.g., IOD: "AutoDCR submission receipt, approved plan, title documents") and `owner_user_id` unset (you assign who chases). The RERA quarterly "prepare the update" reminder fires on 15 Mar/Jun/Sep/Dec — a planning date chosen for this guide, **not a verified MahaRERA deadline**; confirm the actual filing window with your CA and edit it in Settings.

## Appendix B — Glossary (plain words; also build into the app's Help)

| Term | Meaning |
|---|---|
| IOD | Intimation of Disapproval — MCGM's conditional go-ahead; conditions must be met before CC |
| CC / BCC / OC | Commencement Certificate (start work) / Building Completion / Occupancy Certificate (move-in legal) |
| NOC | No-Objection Certificate from a department (fire, airport, tree…) |
| MahaRERA | Maharashtra's real-estate regulator; registration + quarterly updates mandatory |
| AutoDCR | MCGM's online plan-scrutiny/approval system |
| DP remark | Development Plan zoning note on your plot |
| Plinth | Ground-level base of the building; plinth check unlocks further CC |
| DPR | Daily Progress Report — what happened at site today |
| IFC drawing | "Issued For Construction" — the only revision site may build from |
| Revision (R0, R1…) | Version of a drawing; newer IFC supersedes older |
| Snag | Defect to fix (honeycombing, misaligned socket…) |
| RFQ / PO / GRN | Request for Quotation / Purchase Order / Goods Receipt Note (delivery proof) |
| CLP | Construction-Linked Payment plan — customer pays as slabs are cast |
| Demand letter | Letter asking a booked customer for the next CLP instalment |
| Token / Agreement / Registration | Booking stages: advance → registered agreement for sale → stamp duty & registration at IGR |
| Carpet area (RERA) | Net usable area as defined by RERA — the legal sale area |
| Channel partner | Broker with RERA registration; earns brokerage on bookings |
| Tally | Your accountant's software; we export CSVs it can import |
| SMTP | The standard way software sends email through your email provider |
| OTP | One-Time Password — the 6-digit login code emailed to you |
| PWA | Installable website — "Add to Home Screen", works like an app |
| Cron | Automatic scheduled job (digest at 8 AM, backup at 2 AM) |
| Migration | A numbered, safe database change file |
| Staging | A private copy of the software to test changes before going live |
| CFO | Chief Fire Officer — head of the fire authority that issues fire NOCs |
| BOCW | Building and Other Construction Workers (welfare cess and registration) |
| SEIAA | State Environment Impact Assessment Authority — gives environment clearance for larger projects |
| CRZ / MCZMA | Coastal Regulation Zone / the Maharashtra coastal-zone authority |
| DPDP | India's Digital Personal Data Protection Act 2023 (and its 2025 Rules) |
| TDS / Form 26QB | Tax deducted at source; for property purchases the buyer deducts 1% and files Form 26QB, so cash received can be 1% less than the demand |
| Event | A short message one module announces ("5th slab done") that other modules may react to |
| Basis point (bp) | One hundredth of a percent; 1% = 100 bp. Used so money maths is exact |
| Letterhead | The printed top and bottom of your company stationery (logo, address, registrations). NirmaanCRM puts it on every PO, demand letter and receipt |
| Safe area | The margin on a full-page letterhead where text must not print, so it never covers your artwork |
| Brochure library / collateral | Per-project brochures, floor plans, price lists and photos, with versions |
| Share link | A web address that lets one customer open one file, no login needed, and stops working by itself after a set time — or when you cancel it |
| Customer-shareable | A tick on a file saying it may be sent to customers. Files without it can never be shared by link |
| Primary owner | The first admin account (you). Nobody else can demote or deactivate it |
| Project assignment | Choosing which projects a person can see (e.g. a site engineer sees only his own) |

## Appendix C — Sample 8:00 AM digest email

```text
Subject: 🏗️ Shivneri Group — Morning Report, 21/11/2026

SHIVNERI HEIGHTS (Wing A & B)
• Yesterday: Wing A 5th slab shuttering complete; 14 masons, 6 helpers.
  3 photos. Issue: RMC delivery delayed 2 hrs.
• Wing B: ⚠ NO REPORT FILED yesterday (Ramesh notified 7 PM).
• Milestone done: Wing A – 5th slab ✅ → 4 demand letters ready to send (₹38.4L).
• Approvals: CC stage-2 expires in 18 days; Fire NOC query open 6 days.

SALES
• 3 new leads yesterday (2 MagicBricks, 1 referral). 7 follow-ups today.
• Site visits today: 2 (11:00 Kulkarni, 16:30 Shaikh).
• Bookings this month: 2. Overdue receivables: ₹22.5L (3 customers).

PURCHASE & ACCOUNTS
• POs awaiting your approval: 1 (PO-SHIV-A-0042, ₹2.40L, steel).
• Bills due ≤7 days: ₹6.85L (2 bills).

SYSTEM
• Files: 4.1 GB in NirmaanCRM (Google account 9.8 / 15 GB). Backup: ✅ 02:00. Emails failed: 0.

Open dashboard → https://nirmaan-crm.yourname.workers.dev
```

## Appendix D — One-page role cheat sheets (print these)

**SITE ENGINEER (Ramesh)** — 3 buttons on your home screen:
1. **Today's Work Report:** tap → add photos → say/type what happened → labour +/− → SAVE. No internet? It saves and sends itself later. Share to WhatsApp if asked.
2. **Drawings:** tap → type drawing number or tap Structural → the drawing shown is ALWAYS the current one. Old ones are hidden so you never build wrong.
3. **Material Received:** tap → tap the PO in the list → photo of challan → how much came → SAVE.
Snag found? More → Snags → photo + where + how bad → assign → SAVE. Language: top bar हि/म toggle. Help: **?** on every screen.

**SALES (Priya)** — every morning:
1. **Today's Follow-ups:** tap each → Call button → after the call, log outcome and **set the next date** (the system will remind you — never keep it in your head).
2. **New lead?** + NEW LEAD → name, phone, source → SAVE. Call within the hour; the system nudges you if you don't.
3. **Site visit:** lead page → Schedule visit → date/time. Mark Done/No-show after.
4. **Booking:** Inventory → tap flat → Book → customer + price + plan → SAVE. Demands turn **Ready** automatically when slabs are cast — you review, attach the saved PDF and Send.
5. **Send a brochure:** home → SEND BROCHURE → pick the person → Share on WhatsApp. The link stops working by itself after 14 days; you will see a notification when they open it.

**ACCOUNTS (Sunita)**
1. **Receipts:** Sales → booking → Record receipt (amount, mode, ref, date — and the TDS if the customer deducted 1%). Overdue list is on your home.
2. **Bills:** Purchase → Bills → add bill photo + due date → approve → mark paid with ref.
3. **Month-end:** Reports → Receipts register → Export CSV → send to CA for Tally.
4. **Print a receipt or demand letter:** open it → Print → Destination *Save as PDF*, Margins *None*, Background graphics *ON* → Save. It comes out on the company letterhead.

**OWNER (You)**
First time only: Settings → Branding (logo and details) → Letterhead → Users (add each person, choose the role, assign projects) → Project → Brochures (upload, tick *customer-shareable*). Every day: 8 AM digest with chai → tap anything red. Monday: dashboard on screen, run the meeting from it. Approve POs from the notification (one tap). Monthly: Export everything ZIP. That's the whole job.

## Appendix E — Resume prompt (new chat / session limit hit)

```text
PASTE INTO CLAUDE (re-upload this guide first):
Continue building NirmaanCRM per the attached guide. Obey the Master Prompt rules
(§0) and all contracts (§2–§6). Current state: Phase [N] is complete/in progress.
My storage mode is [G/A/B] (if G: Google Drive connected yes/no, and the connected account email). Here is my file tree, wrangler.jsonc, latest migration
number, and docs/CHANGELOG.md: [paste — or upload the files/zip].
Resume exactly from: [next step / the bug below]. Do not redo completed phases.
```

## Appendix F — FAQ

- **Will Cloudflare ever force me to pay?** Inside the §3.2 limits, no — but limits can change, so recheck Cloudflare's pricing pages once a year (§10.5). The app warns you before limits; the only realistic one is file storage, solved by the archive tool. If their policies change years from now, your data is plain SQLite + files and your code is standard JS — portable to any host (a ₹200/month VPS, Deno Deploy, etc.). No lock-in by design.
- **Why does R2 want my card?** It's a metered service with a free allowance, so Cloudflare verifies identity. The $1 budget alert (it emails you; it does not cap spend) plus the in-app meter and archive tool keep overspend very unlikely. Prefer zero cards? Mode G (Google Drive, the default) needs none, and Mode B (§3.4) works fully, with the 1.8 MB file cap and Link documents.
- **Can Google or my staff see my files?** The files sit in that Google account like any Drive files, so Google hosts them under its normal terms. Staff never get a Drive login — they open files only through the CRM, which checks their role and project every time. Customers get only an expiring CRM link, never a Google address.
- **Why a separate Google account, and not my own Drive?** The CRM is limited to files it creates itself (`drive.file`), so it could not read your other documents anyway — but a dedicated account keeps the 15 GB for the company, keeps your personal Gmail out of the business, and lets a partner hold the recovery details. Do not use an account with family photos.
- **What if that Google account is locked or I lose its password?** Records stay safe in Cloudflare (and Time Travel, §11.1) and branding keeps working; files and the nightly backups in that account are the exposed part. That is why the monthly copy to your laptop exists (§11.1) and why 2-step verification and recovery details matter on day one.
- **Why not a Google "service account" robot?** It has no storage and cannot save into an ordinary Drive (§3.4).
- **Do I need a Google Cloud card?** Not for this setup, as far as Google's pages reviewed on 21 Nov 2026 say. Decline any free-trial screen; if Google insists on a card for the Drive API or the sign-in key, stop and tell Claude.
- **Can Claude's free tier build this?** Possibly, in small steps — one phase per session with the Resume Prompt — but each phase writes many long files and the free tier may hit its usage limits mid-phase. A paid Claude plan, or Claude Code (which writes the files and runs the wrangler commands for you), is strongly recommended for the build. Running the finished CRM stays ₹0.
- **What if a team member's phone is lost?** Owner → Users → Deactivate. Sessions die server-side. Nothing lives on the phone except unsynced drafts.
- **More than 50 users someday?** The app itself has no user limit; only the *optional* Access second lock is capped at 50 free. You never needed it.
- **WhatsApp automation?** One-tap share is free and covers 90% of the need. The Business API costs money per conversation — deliberately out of scope.
- **Can a developer maintain it later?** Yes — any junior JS developer can: no framework, no build step, full data dictionary, changelog, and this spec. That's the modularity dividend.
- **Multiple companies?** One company per deployment (projects are the spine). A second company = a second deployment of the same code with its own database — still free.
- **Can every employee have their own login and role?** Yes — one login per person, eight plain-English roles, you as Owner (admin), and optionally "this person sees only these projects" (§4.6). Nobody shares a password.
- **Can I use my own letterhead, logo and colours?** Yes (§7.10). With no artwork the software builds a letterhead from your logo and details. A PDF letterhead is kept as a reference copy; export page 1 as a JPG/PNG to use it, because a browser cannot print text over a PDF page.
- **Can customers open a brochure without logging in?** Yes, through an expiring link you send on WhatsApp or email; you can cancel it any time. Anyone holding the link can open *that one file* until it expires — like sending a PDF, but with an off-switch. No file is ever left publicly open.
- **Is my signature image safe?** It is private to the server and appears only on issued documents (an approved PO, a sent demand letter, a receipt); drafts print without it.
- **Is my customer data legal to store?** With consent, masked IDs, role access, and a privacy policy (§11.3) you're following DPDP basics. Your CA should review the policy template Claude drafts.

## Appendix G — Industry best practices → where they live in this software

| Practice | Source tradition | Implemented as |
|---|---|---|
| Single source of truth for documents | ISO 19650-style CDE (simplified) | Document vault + drawing revision control (§7.3) |
| Only-current-revision at the workface | BIM/ISO 19650 discipline | Site sees latest IFC only; superseded banner |
| Stage-gate approvals | PMBOK gating | Approvals checklist with stage order + expiry reminders (§7.2) |
| Daily huddle + weekly look-ahead | Lean / Last Planner | 90-second DPR + "Next 7 days" milestones (§7.4) |
| Maker-checker & delegation limits | Internal financial controls | PO creator ≠ approver; PM limit setting (§7.5) |
| 3-quote comparison | Standard procurement policy | RFQ comparison + last-paid-rate intelligence |
| Speed-to-lead SLA | Real-estate sales ops | 1-hour/4-hour nudges + mandatory next follow-up (§7.6) |
| Construction-linked cash flow | Indian developer finance + RERA | Milestone→demand-letter automation; 70% account reminder |
| Compliance calendar | RERA/MCGM practice | Renewals re-arming; quarterly reminders (Appendix A) |
| Least privilege + audit trail | ISO 27001 basics | Role matrix server-side; audit log (§4.5, §7.1) |
| 3-2-1 backup | Ops standard | Nightly cloud + Time Travel + monthly offline ZIP + restore drills (§11.1) |
| Accountant handoff, not accounting rebuild | Indian SME practice | Tally-friendly CSV exports (§7.9) |
| Data minimisation & consent | DPDP Act 2023 | Consent flag, masked Aadhaar, privacy page (§11.3) |
| Controlled external sharing | Document-control practice (secure expiring links) | Hashed random tokens, expiry, revoke, audience flag, no public bucket (§7.10) |
| Loosely coupled modules ("modular monolith") | Software architecture practice | Module folders + `service.js` contracts + event bus; modules never import each other (§4.2) |

---

**End of guide.** Upload → Master Prompt → Phase 0 → build one phase at a time → verify by clicking → go live. Your software, your data, ₹0 a month, and a site engineer who actually uses it. That's the whole point.
