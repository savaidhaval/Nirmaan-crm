// scripts/tally-xml.mjs — turns one CRM voucher into the request Tally Prime accepts on its XML port, and reads Tally's answer.
// Same format as the file the browser exports (public/pages18.js), one voucher per request so one bad voucher never blocks the rest.
const esc = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
// paise to a decimal string with integer maths only, so Tally and the CRM agree to the paisa
export const amount = (p, negative) => `${negative ? '-' : ''}${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`;

export function buildEnvelope(v, company) {
  const d = String(v.date).replace(/-/g, '');
  const msg = `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${esc(v.vtype)}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${d}</DATE><VOUCHERTYPENAME>${esc(v.vtype)}</VOUCHERTYPENAME>${v.number ? `<VOUCHERNUMBER>${esc(v.number)}</VOUCHERNUMBER>` : ''}<NARRATION>${esc(v.narration)}</NARRATION>${v.party ? `<PARTYLEDGERNAME>${esc(v.party)}</PARTYLEDGERNAME>` : ''}<EFFECTIVEDATE>${d}</EFFECTIVEDATE>`
    + v.entries.map((e) => `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(e.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${e.dr ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${amount(e.paise, e.dr)}</AMOUNT></ALLLEDGERENTRIES.LIST>`).join('') + '</VOUCHER></TALLYMESSAGE>';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>${company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : ''}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>\n${msg}\n</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

// Tally answers with <CREATED>1</CREATED> when it took the voucher, and <LINEERROR> text when it did not.
export function parseAnswer(text) {
  const t = String(text || '');
  const num = (tag) => { const m = t.match(new RegExp(`<${tag}>\\s*(\\d+)\\s*</${tag}>`, 'i')); return m ? Number(m[1]) : 0; };
  const errs = [...t.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map((m) => m[1].trim()).filter(Boolean);
  const ok = num('CREATED') > 0 && num('ERRORS') === 0 && errs.length === 0;
  return { ok, error: ok ? '' : (errs.join('; ') || (num('ERRORS') ? 'Tally reported an error for this voucher.' : /<RESPONSE>/i.test(t) ? 'Tally did not create the voucher.' : 'Tally gave an answer the bridge does not understand.')).slice(0, 300) };
}
