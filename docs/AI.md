# AI assistant: how it works and its limits

**Engine:** Cloudflare Workers AI (free daily allowance, no card). Default model `@cf/meta/llama-3.1-8b-instruct`; change it in More → Settings → "AI model" if Cloudflare renames it. The binding is added at deploy time only (`.github/workflows/deploy.yml`), because it makes local runs and tests try to connect to Cloudflare. A manual `wrangler deploy` from a laptop therefore has no AI unless you add `[ai] binding = "AI"` to `wrangler.toml` first.

**Switch:** off by default. Owner turns it on in More → Settings → "AI assistant". Daily team cap: "AI: most requests per day" (default 300). One person can make 12 requests per 5 minutes.

**Three things it does**
1. **Ask the CRM.** The question is matched to topics (vendor bills, customer dues, approvals, budget, stock, petty cash, contractors, leads, site reports, expiring contracts, purchase orders). The server runs fixed read-only queries for the topics the person's role may see, in the projects they may see, and gives the model only those lines. The answer shows "Based on" and the facts. Amounts in the answer that are not in the facts are flagged.
2. **Write a message.** Lead follow-up, payment reminder, vendor messages. English, Hindi or Marathi; WhatsApp or email style. A draft box to edit and copy. Nothing is ever sent by the system.
3. **Summarise.** A lead's history, a project's week, or pasted text.

**Safety rules built in**
- The model has no tools and cannot read or change the database. It sees only the text built in `src/routes/ai_facts.js`.
- Never sent to the model: phone numbers, email addresses, PAN, Aadhaar, bank details, passwords, file contents.
- Questions and answers are not stored. `ai_log` keeps only who used which feature and when (for the daily cap).
- If no topic matches, or the role has no access, no model call is made.
- Facts and notes are marked as data; the model is told to ignore instructions inside them.

**Known limits:** a small free model can still misread facts or write awkward Hindi/Marathi; always read before using. When the free daily allowance of Cloudflare is used up, the assistant says so and works again the next day. The model was NOT exercised against the real Cloudflare service during development (tests use a mock); check it once after deploy.
