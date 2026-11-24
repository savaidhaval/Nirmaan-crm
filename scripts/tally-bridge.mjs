#!/usr/bin/env node
// scripts/tally-bridge.mjs — sends the CRM's new vouchers to Tally Prime, and tells the CRM what happened.
// Run it on the computer where Tally Prime is open (Tally's XML port switched on: F1 Help > Settings > Connectivity, port 9000).
// Needs only Node.js 18 or newer. No installation, no packages.
//
//   node scripts/tally-bridge.mjs --url https://crm.example.com --token <token from the CRM, Tally screen> [--tally http://localhost:9000] [--every 300] [--since 2026-04-01] [--once] [--dry-run]
//
// Every few minutes it asks the CRM for vouchers not yet in Tally, sends each one to Tally on this computer, and reports "posted" or the error.
// A voucher Tally refuses (for example a ledger that does not exist in Tally) is retried 3 times, then left for a person to look at on the CRM's Tally screen.
// The token can be revoked on the CRM at any time; the bridge then stops.
import { buildEnvelope, parseAnswer } from './tally-xml.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > -1 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : dflt; };
const CRM = String(arg('url', process.env.CRM_URL || '')).replace(/\/+$/, ''), TOKEN = String(arg('token', process.env.CRM_TOKEN || '')), TALLY = String(arg('tally', process.env.TALLY_URL || 'http://localhost:9000'));
const EVERY = Math.max(60, Number(arg('every', 300)) || 300), ONCE = !!arg('once', false), DRY = !!arg('dry-run', false), SINCE = arg('since', '');
if (!CRM || !TOKEN || CRM === 'true' || TOKEN === 'true') { console.error('Give the CRM address and the token: --url https://... --token ...'); process.exit(2); }
const log = (m) => console.log(`${new Date().toLocaleString('en-IN')}  ${m}`);
const headers = { Authorization: 'Bearer ' + TOKEN, 'X-NirmaanCRM': '1', 'Content-Type': 'application/json' };

async function cycle() {
  const r = await fetch(`${CRM}/api/tally/bridge/pending${SINCE && SINCE !== true ? '?since=' + SINCE : ''}`, { headers });
  if (r.status === 401 || r.status === 403) { log('The CRM refused the token (revoked or wrong). Stopping.'); process.exit(3); }
  if (!r.ok) { log(`The CRM answered ${r.status}. Will try again.`); return; }
  const { data } = await r.json();
  if (!data.vouchers.length) { log(`Nothing new${data.blocked ? ` (${data.blocked} held back on the CRM because a ledger name is missing)` : ''}.`); return; }
  log(`${data.vouchers.length} voucher(s) to send${data.blocked ? `, ${data.blocked} held back for a missing ledger name` : ''}.`);
  const results = [];
  for (const v of data.vouchers) {
    if (DRY) { log(`[dry run] ${v.vtype} ${v.number || ''} ${v.date} ${v.narration}`); continue; }
    let ans;
    try {
      const res = await fetch(TALLY, { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: buildEnvelope(v, data.company) });
      ans = parseAnswer(await res.text());
    } catch (e) { log('Cannot reach Tally on ' + TALLY + ': is Tally open with its XML port on? Will try again.'); return; }   // nothing is reported: the vouchers stay pending
    results.push({ key: v.key, ok: ans.ok, error: ans.error });
    log(`${ans.ok ? 'posted ' : 'FAILED '} ${v.vtype} ${v.number || ''} ${v.date}${ans.ok ? '' : ': ' + ans.error}`);
  }
  if (results.length) {
    const rr = await fetch(`${CRM}/api/tally/bridge/result`, { method: 'POST', headers, body: JSON.stringify({ results }) });
    if (!rr.ok) log(`Could not tell the CRM (${rr.status}). The vouchers may be sent again; Tally will refuse true duplicates only if numbers repeat.`);
  }
}

log(`Tally bridge started. CRM ${CRM}, Tally ${TALLY}${DRY ? ', dry run' : ''}.`);
do { try { await cycle(); } catch (e) { log('Problem: ' + e.message); } if (!ONCE) await new Promise((ok) => setTimeout(ok, EVERY * 1000)); } while (!ONCE);
