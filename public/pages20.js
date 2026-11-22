// pages20.js — WP-25 customer statement link (Accounts, Owner) and WP-24 website enquiry form page (Owner, PM, Sales).

// ---- statement: open it, save as PDF, upload, get a link ----
const _bookingDetail20 = bookingDetail;
bookingDetail = async function (id) {
  await _bookingDetail20(id);
  if (!['owner', 'accounts'].includes(currentUser.role)) return;
  const modal = [...document.querySelectorAll('.modal-overlay .modal')].pop(); if (!modal) return;
  const card = document.createElement('div'); card.className = 'card';
  card.innerHTML = `<div class="row"><div><b>Customer statement</b><p class="muted">Send the customer a statement with a link that stops working after a few days. No login needed.</p></div><button class="btn btn-primary small" id="stm-open">Send statement</button></div>`;
  const first = modal.querySelector('h2'); if (first) first.insertAdjacentElement('afterend', card); else modal.prepend(card);
  card.querySelector('#stm-open').onclick = () => statementFlow(id);
};

async function statementFlow(bookingId) {
  const b = (await api(`/api/sales/bookings/${bookingId}`)).data.booking;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const links = async () => (await api(`/api/sales/bookings/${bookingId}/statement-links`)).data.links;
  const draw = async (made) => {
    const ls = await links().catch(() => []);
    ov.innerHTML = `<div class="modal" role="dialog" aria-label="Customer statement"><h2>Statement for ${esc(b.customer_name)}</h2>
      ${made ? `<div class="card" style="border-left:4px solid var(--s3)"><b>Link ready</b><p class="muted">Valid until ${esc(dateIST(made.expires_at))}</p><input readonly id="stm-url" value="${esc(location.origin + made.link)}" style="width:100%;min-height:48px;padding:0 14px;border:0;border-radius:14px;background:#f0f0f3;font-size:.9rem">
        <div class="row-btns"><button class="btn btn-primary small" id="stm-copy">Copy the link</button><a class="btn small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Your account statement: ' + location.origin + made.link)}">Share on WhatsApp</a><a class="btn small" href="mailto:?subject=${encodeURIComponent('Your account statement')}&body=${encodeURIComponent('Your account statement (the link stops working after a few days): ' + location.origin + made.link)}">Email</a></div></div>` : `
      <ol class="os-steps"><li>Open the statement and save it as a PDF (Print, then Save as PDF).</li><li>Choose the saved file here.</li><li>Tap Create link.</li></ol>
      <div class="row-btns"><a class="btn" target="_blank" rel="noopener" href="/print.html?k=statement&id=${bookingId}">1. Open the statement</a></div>
      <div class="field" style="margin-top:12px"><label for="stm-file">2. The saved PDF</label><input type="file" id="stm-file" accept="application/pdf"></div>
      <div class="field"><label for="stm-days">Link works for (days)</label><input type="number" id="stm-days" value="14" min="1" max="90"></div>
      <button class="btn btn-primary btn-full" id="stm-go">3. Create link</button>`}
      ${ls.length ? `<h3>Earlier links</h3>${ls.map((l) => `<div class="card"><div class="row"><div><b>${esc(dateIST(l.created_at))}</b><p class="muted">by ${esc(l.by_name || '')} · opened ${l.view_count} time(s) · ${l.state === 'active' ? 'valid until ' + esc(dateIST(l.expires_at)) : l.state}</p></div>${chip(l.state, l.state === 'active' ? 'good' : '')}</div>${l.state === 'active' ? `<button class="btn small" data-rv="${l.id}">Turn off</button>` : ''}</div>`).join('')}` : ''}
      <div class="modal-actions"><button class="btn" id="stm-close">Close</button></div></div>`;
    ov.querySelector('#stm-close').onclick = () => ov.remove();
    ov.querySelectorAll('[data-rv]').forEach((x) => { x.onclick = async () => { if (confirm('Turn this link off? The customer will no longer be able to open it.') && await act(api(`/api/sales/statement-links/${x.dataset.rv}/revoke`, { method: 'POST' }), 'Link turned off')) draw(); }; });
    const copy = ov.querySelector('#stm-copy'); if (copy) copy.onclick = () => copyText(ov.querySelector('#stm-url').value);
    const go = ov.querySelector('#stm-go'); if (go) go.onclick = async () => {
      const f = ov.querySelector('#stm-file').files[0]; if (!f) { toast('Choose the saved PDF first.'); return; }
      if (f.type !== 'application/pdf') { toast('The statement must be a PDF. Use Print, then Save as PDF.', 5000); return; }
      go.disabled = true;
      const fd = new FormData(); fd.append('file', f, f.name); fd.append('title', `Statement ${b.customer_name} ${today()}`); fd.append('category', 'statement'); fd.append('module', 'statement'); fd.append('project_id', String(b.project_id)); fd.append('audience', 'customer');
      const up = await act(api('/api/files/upload', { method: 'POST', body: fd })); if (!up) { go.disabled = false; return; }
      const r = await act(api(`/api/sales/bookings/${bookingId}/statement-link`, { method: 'POST', body: { document_id: up.data.id, days: Number(ov.querySelector('#stm-days').value) || 14 } })); if (!r) { go.disabled = false; return; }
      draw(r.data);
    };
  };
  document.body.appendChild(ov); draw();
}

// ---- website enquiry form: the address and the embed code ----
const _sidebarItems20 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems20(role).map((g) => [g[0], g[1].slice()]);
  if (['owner', 'pm', 'sales'].includes(role)) { const g = groups.find((x) => x[0] === 'Sales'); if (g) g[1].push({ label: 'Website form', route: 'enquiryform', icon: 'enquiryform' }); }
  return groups;
};
async function renderEnquiryForm(main) {
  const projects = await getProjects(); let on = false;
  try { on = (await (await fetch('/api/public/enquiry-config')).json()).data.enabled; } catch (e) { /* off */ }
  main.innerHTML = `<h1>Website enquiry form</h1><p class="help">Put this form on your website, a QR code or a flyer. Every enquiry becomes a lead for the sales team, with the person's consent recorded. A repeat enquiry from the same number is added to the first lead, not made again.</p>
    ${on ? '<p>' + chip('Switched on', 'good') + '</p>' : '<div class="card" style="border-left:4px solid var(--s4)"><b>Not switched on yet.</b><p class="muted">Two settings are needed once: a free Cloudflare Turnstile site key and secret key. Ask your developer or me to set them. Until then the form shows a polite message instead.</p></div>'}
    <div class="field"><label>For which project?</label><select id="eq-proj"><option value="">Any (general enquiry)</option>${projects.map((p) => `<option value="${esc(p.code)}">${esc(p.name)}</option>`).join('')}</select></div>
    <div class="card"><b>Link (for a QR code, WhatsApp or a flyer)</b><input readonly id="eq-link" style="width:100%;min-height:48px;padding:0 14px;border:0;border-radius:14px;background:#f0f0f3;margin:8px 0"><div class="row-btns"><button class="btn small btn-primary" id="eq-copy">Copy link</button><a class="btn small" id="eq-open" target="_blank" rel="noopener">Open the form</a></div></div>
    <div class="card"><b>Embed on another website</b><p class="muted">Paste this where the form should appear.</p><textarea readonly id="eq-embed" rows="3" style="width:100%;border:0;border-radius:14px;background:#f0f0f3;padding:12px;font-family:ui-monospace,Menlo,monospace;font-size:.85rem"></textarea><div class="row-btns"><button class="btn small" id="eq-copy2">Copy code</button></div></div>`;
  const upd = () => { const c = $('eq-proj').value, url = `${location.origin}/enquiry.html${c ? '?project=' + encodeURIComponent(c) : ''}`; $('eq-link').value = url; $('eq-open').href = url; $('eq-embed').value = `<iframe src="${url}" title="Enquiry" width="100%" height="620" style="border:0;max-width:560px" loading="lazy"></iframe>`; };
  $('eq-proj').onchange = upd; upd(); $('eq-copy').onclick = () => copyText($('eq-link').value); $('eq-copy2').onclick = () => copyText($('eq-embed').value);
}
PAGES.enquiryform = (m) => renderEnquiryForm(m);
Object.assign(ROUTE_TITLES, { enquiryform: 'Website form' });
Object.assign(ICONS, { enquiryform: 'M4 5h16v14H4zM8 9h8M8 13h5' });
