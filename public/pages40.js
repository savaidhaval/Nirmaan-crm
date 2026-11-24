// pages40.js — Agreement for Sale (Word), WhatsApp share buttons, "Checked on MahaRERA" for channel partners.
// Loaded after pages39.js.

// ---------- WhatsApp share (opens WhatsApp with the message ready; nothing is sent from the server) ----------
async function waShare(bookingId, kind, extra) {
  const r = await act(api(`/api/sales/bookings/${bookingId}/whatsapp`, { method: 'POST', body: { kind, ...(extra || {}) } }));
  if (!r) return false;
  window.open(r.data.url, '_blank', 'noopener');
  toast('WhatsApp is open with the message ready. Press Send there.', 6000);
  return true;
}

// ---------- booking screen: Agreement for Sale + WhatsApp ----------
const _bookingDetail40 = bookingDetail;
bookingDetail = async function (id) {
  await _bookingDetail40(id);
  if (!['owner', 'pm', 'accounts', 'sales'].includes(currentUser.role)) return;
  const ov = [...document.querySelectorAll('.modal-overlay')].pop(); if (!ov || ov.querySelector('[data-agr]')) return;
  const modal = ov.querySelector('.modal'); if (!modal) return;
  let d; try { d = (await api('/api/sales/bookings/' + id)).data; } catch (e) { return; }
  const cancelled = d.booking.status === 'cancelled';
  const box = document.createElement('div'); box.className = 'card';
  const demands = (d.demands || []).filter((x) => ['ready', 'partial'].includes(x.status));
  box.innerHTML = `<b>Agreement for Sale and WhatsApp</b>
    <div class="row-btns" style="margin-top:8px">${cancelled ? '' : '<button class="btn small btn-primary" data-agr="1">Agreement (Word)</button>'}
    <button class="btn small" data-wa="balance">WhatsApp: balance</button>
    ${demands[0] ? '<button class="btn small" data-wa="demand">WhatsApp: demand</button>' : ''}
    ${d.receipts && d.receipts.length ? '<button class="btn small" data-wa="receipt">WhatsApp: last receipt</button>' : ''}
    ${cancelled ? '' : '<button class="btn small" data-wa="agreement">WhatsApp: agreement ready</button>'}
    <button class="btn small" data-wa="thanks">WhatsApp: thanks</button></div>
    <p class="help" style="margin:6px 0 0">WhatsApp opens with the message written. You press Send. Nothing goes out by itself.</p>`;
  const anchor = modal.querySelector('.modal-actions'); modal.insertBefore(box, anchor);
  const b = box.querySelector('[data-agr]'); if (b) b.onclick = () => agreementDownload(id);
  box.querySelectorAll('[data-wa]').forEach((x) => {
    x.onclick = async () => {
      const kind = x.dataset.wa; const extra = {};
      if (kind === 'demand') extra.demand_id = demands[0].id;
      if (kind === 'receipt') { const rs = d.receipts.filter((r) => !r.reversed_at); if (!rs.length) { toast('No receipt to send.'); return; } extra.receipt_id = rs[rs.length - 1].id; }
      waShare(id, kind, extra);
    };
  });
};

async function agreementDownload(id) {
  let d;
  try { d = (await api(`/api/sales/bookings/${id}/agreement`)).data; } catch (e) { toast(e.message, 6000); return false; }
  const f = d.fields;
  if (!d.reviewed && !confirm("This wording has NOT been approved by your advocate yet. The Word file will say DRAFT. Continue?")) return false;
  const edit = [['agreement_date', 'Agreement date'], ['customer_name', 'Allottee name(s)'], ['address', 'Address'], ['flat_no', 'Flat number'], ['carpet_area', 'RERA carpet area (sq. ft.)'], ['agreement_value', 'Agreement value'], ['possession_date', 'Possession date'], ['interest_rate', 'Interest on delay'], ['defect_years', 'Defect liability (years)'], ['other_details', 'Other terms (optional)']];
  const v = await openForm({ title: 'Agreement for Sale', intro: 'Check the details for this customer. The file downloads as Word so your advocate can finish and approve it.', submit: 'Download Word file',
    fields: edit.map(([k, l]) => ({ name: k, label: l, type: ['address', 'other_details'].includes(k) ? 'textarea' : 'text', value: f[k] || '' })) });
  if (!v) return false;
  const map = { ...f, ...v }; if (v.agreement_value !== f.agreement_value) delete map.agreement_value_words;
  let bytes;
  try {
    if (d.template.doc_id) { const r = await fetch(`/api/files/download/${d.template.doc_id}`, { credentials: 'include' }); if (!r.ok) throw new Error('The Word template could not be opened. Upload it again under Letter templates.'); bytes = await DocxLib.fillDocx(new Uint8Array(await r.arrayBuffer()), map); }
    else { let body = d.template.body; if (!d.reviewed && !/\{\{draft_notice\}\}/.test(body)) body = '{{draft_notice}}\n\n' + body; bytes = DocxLib.textToDocx(DocxLib.fillText(body, map)); }
  } catch (e) { toast(e.message || 'The agreement could not be made.', 7000); return false; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  a.download = `Agreement-${String(map.flat_no || '').replace(/[^\w-]/g, '')}-${String(map.customer_name || '').replace(/[^\w]+/g, '_').slice(0, 30)}.docx`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  toast(d.reviewed ? 'Downloaded.' : 'Downloaded as a DRAFT. Your advocate must approve the wording.', 6000);
  return true;
}

// ---------- Letter templates screen: the Agreement for Sale wording + advocate approval ----------
const _renderLetterTemplates40 = renderLetterTemplates;
renderLetterTemplates = async function (main) {
  await _renderLetterTemplates40(main);
  const out = $('lt-out'); if (!out) return;
  const projects = await getProjects().catch(() => []);
  const pid = scopeProject && projects.some((p) => p.id === scopeProject) ? scopeProject : (projects[0] || {}).id; if (!pid) return;
  const paint = async () => {
    let d; try { d = (await api('/api/sales/letter-templates?project_id=' + pid)).data; } catch (e) { return; }
    const t = d.templates.find((x) => x.kind === 'agreement');
    let card = out.querySelector('#lt-agr');
    if (!card) { card = document.createElement('div'); card.id = 'lt-agr'; out.insertBefore(card, out.querySelector('h3:last-of-type') || null); }
    const isOwner = currentUser.role === 'owner';
    card.innerHTML = `<h3>Agreement for Sale</h3><div class="card"><div class="row"><div><b>Agreement for Sale</b><p class="muted">${t ? (t.doc_id ? 'Your Word template is used' : 'Your own text is used') + ' · changed ' + esc(dateIST(t.updated_at).substring(0, 10)) : 'Built-in starting text only'}</p>
      <p>${t && t.reviewed_on ? chip('Approved by ' + t.reviewed_by + ' on ' + t.reviewed_on, 'good') : chip(t ? 'Not approved by an advocate yet' : 'Built-in text: advocate must review', 'warn')}</p></div></div>
      <div class="row-btns"><button class="btn small btn-primary" data-agr-ed="1">${t ? 'Change' : 'Write your own'}</button>${t && isOwner ? '<button class="btn small" data-agr-rv="' + t.id + '">Advocate has approved</button>' : ''}${t ? '<button class="btn small" data-agr-rm="' + t.id + '">Back to built-in text</button>' : ''}</div>
      <p class="help" style="margin:8px 0 0">The built-in text follows the usual MahaRERA structure but is only a starting point. Give it to your advocate. Saving new wording clears the approval mark.</p></div>`;
    card.querySelector('[data-agr-ed]').onclick = async () => {
      const v = await openForm({ title: 'Agreement for Sale wording', intro: 'Type the agreement, or upload a Word file (.docx) that already has the {{names}} in it. If you upload, the file is used.', fields: [
        { name: 'body', label: 'Agreement text', type: 'textarea', value: t && t.body ? t.body : d.defaults.agreement }, { name: 'file', label: 'Or a Word file (.docx)', type: 'file' }] });
      if (!v) return;
      const body = { project_id: pid, kind: 'agreement', body: v.body, title: '' };
      if (v.file) { const fd = new FormData(); fd.append('file', v.file, v.file.name); fd.append('title', 'Agreement for Sale template'); fd.append('category', 'agreement'); fd.append('module', 'sales'); fd.append('project_id', String(pid)); fd.append('audience', 'internal');
        const up = await act(api('/api/files/upload', { method: 'POST', body: fd })); if (!up) return; body.doc_id = up.data.id; }
      if (await act(api('/api/sales/letter-templates', { method: 'POST', body }), 'Saved. It needs the advocate\'s approval again.')) paint();
    };
    const rv = card.querySelector('[data-agr-rv]');
    if (rv) rv.onclick = async () => { const v = await openForm({ title: 'Advocate approval', intro: 'Record which advocate approved this wording. Do this only after they have actually reviewed it.', fields: [{ name: 'advocate', label: "Advocate's name", required: true }] }); if (v && await act(api(`/api/sales/letter-templates/${rv.dataset.agrRv}/review`, { method: 'POST', body: v }), 'Recorded')) paint(); };
    const rm = card.querySelector('[data-agr-rm]');
    if (rm) rm.onclick = async () => { if (confirm('Go back to the built-in text?') && await act(api(`/api/sales/letter-templates/${rm.dataset.agrRm}`, { method: 'DELETE' }), 'Done')) paint(); };
  };
  await paint();
  new MutationObserver(() => { if (!out.querySelector('#lt-agr')) paint(); }).observe(out, { childList: true });
};
PAGES.letters = renderLetterTemplates;   // the page table holds the old function


// ---------- channel partners: "Checked on MahaRERA" ----------
const _decorateSales40 = decorateSales;
decorateSales = async function (el) {
  await _decorateSales40(el);
  if (!['owner', 'accounts'].includes(currentUser.role)) return;
  let par; try { par = (await api('/api/sales/partners')).data.partners; } catch (e) { return; }
  el.querySelectorAll('[data-kyc]').forEach((b) => {
    const p = par.find((x) => String(x.id) === b.dataset.kyc); if (!p || b.parentElement.querySelector('[data-rv]')) return;
    const stale = p.rera_verified_on && p.rera_verified_on < new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const tag = p.rera_verified_on ? (stale ? chip('MahaRERA check is old: ' + p.rera_verified_on, 'bad') : chip('Checked on MahaRERA ' + p.rera_verified_on, 'good')) : chip('Not checked on MahaRERA', 'warn');
    b.insertAdjacentHTML('beforebegin', `<button class="btn small" data-rv="${p.id}">Checked on MahaRERA</button> `);
    b.closest('.card').querySelector('.muted').insertAdjacentHTML('afterend', `<p style="margin:4px 0">${tag}</p>`);
    b.parentElement.querySelector('[data-rv]').onclick = async () => {
      const v = await openForm({ title: 'MahaRERA check: ' + p.firm, intro: 'Open the MahaRERA website (maharera.maharashtra.gov.in), search the registered agents for the number below, and write what you see. There is no automatic check available.', fields: [
        { name: 'rera_no', label: 'Registration number on file', value: p.rera_no || '', help: 'Change it on the KYC screen if it is wrong.' }, { name: 'note', label: 'What you saw on the website', type: 'textarea', required: true, placeholder: 'Registered agent, name matches, valid till …' }] , submit: 'Record the check' });
      if (v && await act(api(`/api/sales/partners/${p.id}/verify-rera`, { method: 'POST', body: { note: v.note } }), 'Check recorded')) loadSales();
    };
  });
};
