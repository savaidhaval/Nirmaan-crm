# Nirmaan CRM

CRM and project management for a Mumbai real-estate developer. Production: https://crm.mysociety.tech

## Branch policy

Work on `Dhaval`. `main` deploys to production and must not receive commits or merges without Dhaval's explicit approval. A GitHub ruleset requires a pull request for `main`, and local `pre-commit` and `pre-push` hooks block direct work on it.

## Stack

- Cloudflare Workers and D1
- Vanilla HTML, CSS, and JavaScript
- Wrangler
- Google Drive for document storage

## Run

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npm run dev
```

Fill `.dev.vars` with local values. Never commit it.

## Deploy

```powershell
npm run deploy
```

This publishes to production. Do not run it without approval.

## Layout

- `src/` - Worker entry point, routes, modules, and core logic
- `public/` - static assets
- `migrations/` - D1 migrations
- `docs/` - build guide, changelog, and handover notes
- `tests/` - integration tests

## Current focus

Ongoing module work. See `CHANGELOG.md` and `HANDOVER_FOR_CLAUDE.md` for the latest state.

## Read first

`HANDOVER_FOR_CLAUDE.md`, `CLAUDE.md`.

## Notes

- Apply production migrations only with approval: `npx wrangler d1 migrations apply nirmaan-db --remote`.
- Set secrets with `wrangler secret put`, never in code.
- Pushes to `claude/**` open a pull request automatically. Pushes to `Dhaval` do not.
- Workspace brief: `D:\Opencode\projects\nirmaan-crm.md`.
