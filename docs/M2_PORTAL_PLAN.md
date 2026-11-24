# Plan: leads from 99acres, MagicBricks, Housing.com and Meta lead forms

Status: **plan only, nothing built.** Needs your answers at the bottom. Written 2026-11-24.

## What already works
- One signed intake address, `POST /api/webhooks/leads/<source>`: checks a signature and a timestamp, refuses repeats (`webhook_seen`), drops duplicates by mobile number, assigns the next executive, tells them. Source name is kept (`99acres`, `magicbricks`, ...), so the marketing report already splits by it.
- Website form, CSV import, reception check-in.

## What is different about each source (to confirm with the portals; I could not verify their current terms from here)
| Source | How leads normally reach a CRM | Free? |
|---|---|---|
| Meta lead forms (Facebook / Instagram) | Meta calls our address when someone submits (it sends only a lead number; we then ask Meta for the name and phone). Needs a Meta app, the page's permission "leads retrieval", and Meta's app review. Signature is Meta's own format, not ours. | Yes |
| 99acres, MagicBricks, Housing.com | Every enquiry is emailed to the advertiser. Some also offer a "CRM integration" (they push to your address, or you pull with a key); usually switched on by your account manager and may depend on your package. | Email: yes. Integration: ask |

## Recommended route (free, works for all three portals)
**Email-to-lead.** Cloudflare Email Routing is free and can hand each incoming email to our Worker. Steps:
1. Make one address, for example `leads@crm.mysociety.tech`. Set it as the lead-notification address in each portal account (or auto-forward the portal emails to it).
2. The Worker reads the email, recognises the portal from the sender, pulls out name, mobile, email, project / listing and message, and makes the lead through the same code as the webhook (so duplicates, assignment and notifications behave the same).
3. Anything it cannot read goes to a "Leads to check" list (raw text kept 30 days) instead of being lost.
Cost: nothing. Free-plan fit: one request per email, about 5 database statements, a small text parse (well under the 10 ms CPU cap; no attachments read).

**Meta** gets its own receiver: `GET` to prove the address, `POST` for each lead, then one call to Meta for the details. Secrets (app secret, verify word, page token) go in as Worker secrets, never in the code or logs.

**If a portal offers a CRM push**, point it at the existing signed address; only a small field-mapping table is needed.

## Steps (each its own package, in this order)
1. **P1 Mapping and "Leads to check"** (no outside setup): table mapping each portal's project / listing name to your project, a settings screen for it, a list of unreadable leads. Done when a pasted sample email from each portal creates the right lead on the right project, repeat enquiries add a note instead of a second lead, and a garbled email lands in "Leads to check".
2. **P2 Email receiver:** Email Routing to the Worker, parser per portal, tests using the sample emails. You: create the address and point the portals at it. Done when a real test enquiry from each portal shows as a lead within a minute.
3. **P3 Meta receiver:** the receiver, secrets, Meta app and review. Done when a Meta test lead (Meta's Lead Ads testing tool) appears as a lead.
4. **P4 Portal pushes (only if your account managers offer them):** map and switch on.
5. **P5 Watch-dog:** a Sales-page strip "no lead from <source> for 24 hours" (a broken forward is silent otherwise), and cost per lead already works from the marketing spend screen.

## Rules kept
- Consent: a portal or Meta enquiry is stored with the source as its basis; marketing WhatsApp (site updates) still goes only to leads with consent ticked.
- No new paid service, no card, no new cron (the watch-dog runs inside the hourly sweep), no raw secrets in logs. Each package: staging first, backup first.

## Needs you
1. Which portals do you actually pay for today, and do you have a login for each (to change the lead-notification email)?
2. Can you create `leads@crm.mysociety.tech` in Cloudflare Email Routing (needs your Cloudflare login), or shall I give click-by-click steps?
3. Meta: is there a Facebook Page and Business account for the project, and will you be the admin who approves the app? (Review takes days; start early.)
4. Please forward one real sample enquiry email from each portal (remove nothing; I will not store it). The parser depends on exact wording.
5. Which project does each portal listing belong to (a short list is enough)?
