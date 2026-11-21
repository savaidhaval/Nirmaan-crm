// print.js — renders PO / demand letter / receipt from /api/print/* on the company letterhead.
const q = new URLSearchParams(location.search);
const kind = q.get('k');
const id = Number(q.get('id'));
const sheet = document.getElementById('sheet');
const e = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (p) => moneyP(p);

function words(n) {
  n = Math.round(n);
  if (!n) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : ''));
  const three = (x) => (x >= 100 ? ones[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + two(x % 100) : '') : two(x));
  const parts = [];
  const cr = Math.floor(n / 10000000); n %= 10000000;
  const lk = Math.floor(n / 100000); n %= 100000;
  const th = Math.floor(n / 1000); n %= 1000;
  if (cr) parts.push(three(cr) + ' Crore');
  if (lk) parts.push(two(lk) + ' Lakh');
  if (th) parts.push(two(th) + ' Thousand');
  if (n) parts.push(three(n));
  return parts.join(' ');
}
const rupeeWords = (paise) => `Rupees ${words(Math.floor(paise / 100))}${paise % 100 ? ' and ' + words(paise % 100) + ' Paise' : ''} Only`;

// Pictures come from signed-in-only endpoints (never public). Returns an object URL or null.
async function asset(kind, brandId) {
  try {
    const r = await fetch('/api/print/asset/' + kind + (brandId ? '?brand=' + brandId : ''), { credentials: 'include' });
    if (!r.ok) return null;
    return URL.createObjectURL(await r.blob());
  } catch (err) { return null; }
}

function imgReady(img) { return new Promise((res) => { if (img.complete) res(); else { img.onload = res; img.onerror = res; } }); }

async function letterhead(b, draft) {
  const mode = b.letterhead_mode || 'generated';
  const has = (k) => (b.pictures || []).includes(k);
  const top = Number(b.margin_top_mm) || 20, side = Number(b.margin_side_mm) || 20, bottom = Number(b.margin_bottom_mm) || 20;
  const col = /^#[0-9a-fA-F]{3,8}$/.test(b.colour_primary || '') ? b.colour_primary : '#1d4ed8';
  const pics = {};
  const want = [];
  if (mode === 'image' && has('letterhead')) want.push('letterhead');
  if (mode === 'bands') { if (has('header')) want.push('header'); if (has('footer')) want.push('footer'); }
  if (mode === 'generated' && has('logo')) want.push('logo');
  if (!draft) { if (has('signature')) want.push('signature'); if (has('stamp')) want.push('stamp'); }
  await Promise.all(want.map(async (k) => { pics[k] = await asset(k, b.brand_id); }));
  let head = '', foot = '', bg = '', pad;
  if (mode === 'image' && pics.letterhead) {
    bg = `<img class="bg" src="${pics.letterhead}" alt="">`;
    pad = `padding:${top}mm ${side}mm ${bottom}mm ${side}mm`;
  } else if (mode === 'bands') {
    head = pics.header ? `<img class="band" src="${pics.header}" alt="">` : '';
    foot = pics.footer ? `<img class="band bottom" src="${pics.footer}" alt="">` : (b.footer_text ? `<div class="foot">${e(b.footer_text)}</div>` : '');
    pad = `padding:0 ${side}mm ${bottom + 12}mm ${side}mm`;
    head = head ? head + `<div style="height:8mm"></div>` : `<div style="height:${top}mm"></div>`;
  } else {
    head = `<div class="lh" style="border-bottom:3px solid ${col}">${pics.logo ? `<img src="${pics.logo}" alt="" style="height:16mm;float:right">` : ''}<h1 style="color:${col}">${e(b.trade_name || b.legal_name || 'Company name')}</h1>
      ${b.tagline ? `<div class="tag">${e(b.tagline)}</div>` : ''}<div class="meta">${e(b.legal_name)}${b.address ? ' · ' + e(b.address) : ''}${b.phone ? ' · ' + e(b.phone) : ''}${b.email ? ' · ' + e(b.email) : ''}${b.gstin ? ' · GSTIN ' + e(b.gstin) : ''}${b.promoter_rera_ref ? ' · RERA ' + e(b.promoter_rera_ref) : ''}</div></div>`;
    foot = b.footer_text ? `<div class="foot">${e(b.footer_text)}</div>` : '';
    pad = `padding:14mm ${side}mm ${bottom + 10}mm ${side}mm`;
  }
  return { head, foot, bg, pad, pics };
}

async function render(d) {
  const b = d.brand; const lh = await letterhead(b, d.draft);
  let body = '';
  if (d.kind === 'po') {
    const p = d.po;
    body = `<div class="doc-title">Purchase Order</div>
      <div class="two"><div><b>To:</b><br>${e(p.vendor)}<br>${e(p.vendor_address || '')}<br>${p.vendor_gstin ? 'GSTIN ' + e(p.vendor_gstin) : ''}</div>
      <div style="text-align:right"><b>PO No:</b> ${e(p.po_no)}<br><b>Date:</b> ${e(String(p.created_at).substring(0, 10))}<br><b>Project:</b> ${e(p.project_name)}<br>${e(p.project_address || '')}</div></div>
      <table><tr><th>#</th><th>Description</th><th class="r">Qty</th><th>Unit</th><th class="r">Rate</th><th class="r">Amount</th></tr>
      ${d.items.map((i, n) => `<tr><td>${n + 1}</td><td>${e(i.description)}</td><td class="r">${e(i.qty)}</td><td>${e(i.unit)}</td><td class="r">${inr(i.rate_paise)}</td><td class="r">${inr(i.amount_paise)}</td></tr>`).join('') || `<tr><td>1</td><td colspan="4">As agreed</td><td class="r">${inr(p.amount_paise)}</td></tr>`}
      <tr><td colspan="5" class="r">Subtotal</td><td class="r">${inr(p.amount_paise)}</td></tr>
      <tr><td colspan="5" class="r">GST @ ${(p.gst_bp / 100).toFixed(1)}%</td><td class="r">${inr(p.gst_paise)}</td></tr>
      <tr><th colspan="5" class="r">Total</th><th class="r">${inr(p.total_paise)}</th></tr></table>
      <div class="words">${rupeeWords(p.total_paise)}</div>
      ${p.terms ? `<p><b>Terms:</b> ${e(p.terms)}</p>` : ''}`;
  } else if (d.kind === 'demand') {
    const x = d.demand; const total = x.amount_paise + (x.gst_paise || 0);
    body = `<div class="doc-title">Demand Letter</div>
      <div class="two"><div><b>To:</b> ${e(x.customer_name)}<br>${e(x.customer_address || '')}</div><div style="text-align:right"><b>Date:</b> ${e(new Date().toLocaleDateString('en-IN'))}<br><b>Flat:</b> ${e((x.wing ? x.wing + '-' : '') + x.unit_no)}<br><b>Project:</b> ${e(x.project_name)}${x.rera_no ? '<br>MahaRERA ' + e(x.rera_no) : ''}</div></div>
      <p>Dear ${e(x.customer_name)},</p>
      <p>As per the agreed payment plan, the stage <b>“${e(x.label)}”</b> has been reached. Kindly pay the amount below${x.due_date ? ' on or before <b>' + e(x.due_date) + '</b>' : ''}.</p>
      <table><tr><th>Particulars</th><th class="r">Amount</th></tr><tr><td>${e(x.label)}</td><td class="r">${inr(x.amount_paise)}</td></tr>
      <tr><td>GST</td><td class="r">${inr(x.gst_paise || 0)}</td></tr>${x.settled_paise ? `<tr><td>Already received</td><td class="r">− ${inr(x.settled_paise)}</td></tr>` : ''}
      <tr><th>Amount due</th><th class="r">${inr(total - (x.settled_paise || 0))}</th></tr></table>
      <div class="words">${rupeeWords(total - (x.settled_paise || 0))}</div>
      ${b.bank_name ? `<p><b>Pay to:</b> ${e(b.bank_account_name)}, ${e(b.bank_name)}${b.bank_branch ? ', ' + e(b.bank_branch) : ''}, IFSC ${e(b.bank_ifsc)}. Ask our office for the account number.</p>` : ''}`;
  } else if (d.kind === 'receipt') {
    const r = d.receipt;
    body = `<div class="doc-title">Receipt</div>
      <div class="two"><div><b>Received from:</b> ${e(r.customer_name)}<br><b>Flat:</b> ${e((r.wing ? r.wing + '-' : '') + r.unit_no)}, ${e(r.project_name)}</div><div style="text-align:right"><b>Receipt #</b> ${e(r.id)}<br><b>Date:</b> ${e(r.received_on)}</div></div>
      <table><tr><th>Towards</th><th>Mode / reference</th><th class="r">Amount</th></tr>
      <tr><td>${e(r.demand_label || 'Booking payment')}</td><td>${e(r.mode || '')} ${e(r.ref_no || '')}</td><td class="r">${inr(r.amount_paise)}</td></tr>
      ${r.tds_paise ? `<tr><td colspan="2">TDS deducted by customer</td><td class="r">${inr(r.tds_paise)}</td></tr>` : ''}</table>
      <div class="words">${rupeeWords(r.amount_paise)}</div>
      <p style="font-size:10pt;color:#555">Subject to realisation of cheque, if paid by cheque.</p>`;
  } else {
    // sample: shows margins, a ruler and a dummy letter so artwork can be checked on real paper
    body = `<div class="doc-title">Sample letter</div><p>Dear Sir / Madam,</p><p>This page shows how your letters will look with the current style and margins. Check that the text stays clear of your logo, header and footer artwork when printed on A4.</p>
      <table><tr><th>Item</th><th class="r">Amount</th></tr><tr><td>Sample line</td><td class="r">${inr(12345600)}</td></tr></table>
      <div class="words">${rupeeWords(12345600)}</div>
      <div class="ruler"><span>0</span><span>5 cm</span><span>10 cm</span><span>15 cm</span><span>20 cm</span></div>
      <p style="font-size:10pt;color:#555">Margins: top ${e(b.margin_top_mm || 45)} mm · bottom ${e(b.margin_bottom_mm || 30)} mm · sides ${e(b.margin_side_mm || 20)} mm. Style: ${e(b.letterhead_mode || 'generated')}.</p>`;
  }
  // signature and stamp appear only on issued documents (never on drafts)
  const sign = d.draft ? '' : `<div class="sign">For ${e(b.legal_name || b.trade_name)}<div class="sigrow">${lh.pics.signature ? `<img src="${lh.pics.signature}" alt="Signature" class="sig">` : '<br><br><br>'}${lh.pics.stamp ? `<img src="${lh.pics.stamp}" alt="Stamp" class="stamp">` : ''}</div>${e(b.signatory_name || '')}<br>${e(b.signatory_title || '')}</div>`;
  sheet.style.cssText = lh.pad;
  sheet.innerHTML = `${lh.bg}${d.draft ? '<div class="watermark">DRAFT</div>' : ''}${lh.head}<div class="body">${body}</div>${sign}${lh.foot}`;
  await Promise.all(Array.from(sheet.querySelectorAll('img')).map(imgReady));
  document.title = `${d.kind}-${id}`;
}

document.getElementById('btn-print').addEventListener('click', () => window.print());
document.getElementById('btn-back').addEventListener('click', () => window.close());
const load = kind === 'sample'
  ? api('/api/branding?brand_id=' + (Number(q.get('brand')) || 0)).then((r) => ({ kind: 'sample', draft: true, brand: r.data.branding || {} }))
  : api(`/api/print/${kind}/${id}`).then((r) => r.data);
load.then(render).catch((err) => { sheet.textContent = err.message; });
