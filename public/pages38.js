// pages38.js — Module 4, step 2: Word letters (demand letter per milestone, allotment letter), "sent" marks kept by hand, letter templates, refund helper.
Object.assign(ICONS, { letters: 'M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h8' });
Object.assign(ROUTE_TITLES, { letters: 'Letter templates' });
Object.assign(PAGES, { letters: renderLetterTemplates });

const _sidebarItems38 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems38(role).map(([g, items]) => [g, [...items]]);
  if (['owner', 'pm', 'accounts'].includes(role)) {
    const item = { label: 'Letter templates', route: 'letters', icon: 'letters' };
    let done = false;
    for (const [, items] of groups) { const i = items.findIndex((x) => x.route === 'collections'); if (i >= 0) { items.splice(i + 1, 0, item); done = true; break; } }
    if (!done) groups[groups.length - 1][1].push(item);
  }
  return groups;
};

const SENT_VIA_OPTS = [['email', 'Email'], ['whatsapp', 'WhatsApp'], ['hand', 'By hand'], ['courier', 'Courier'], ['other', 'Other']];

// Make the Word file and hand it to the browser as a download.
async function letterDownload(kind, id) {
  let d;
  try { d = (await api(kind === 'demand' ? `/api/sales/demands/${id}/letter` : `/api/sales/bookings/${id}/allotment-letter`)).data; } catch (e) { toast(e.message, 6000); return false; }
  const f = d.fields;
  const edit = [['date', 'Date'], ['customer_name', 'Name'], ['address', 'Address'], ['flat_no', 'Flat number'], ['agreement_value', 'Agreement value'],
    ...(kind === 'demand' ? [['stage_name', 'Instalment'], ['demand_amount', 'Amount'], ['gst_amount', 'GST'], ['total_due', 'Total payable'], ['due_date', 'Due date'], ['bank_details', 'Bank details']] : []), ['other_details', 'Other details (anything you want to add)']];
  const v = await openForm({ title: kind === 'demand' ? 'Demand letter' : 'Allotment letter', intro: 'Check or change anything for this customer. The letter downloads as a Word file you can edit before sending.', submit: 'Download Word file',
    fields: edit.map(([k, l]) => ({ name: k, label: l, type: k === 'other_details' || k === 'bank_details' || k === 'address' ? 'textarea' : 'text', value: f[k] || '' })) });
  if (!v) return false;
  const map = { ...f, ...v };
  if (v.total_due !== f.total_due) delete map.total_due_words;   // the words belong to the original figure
  let bytes;
  try {
    if (d.template.doc_id) { const r = await fetch(`/api/files/download/${d.template.doc_id}`, { credentials: 'include' }); if (!r.ok) throw new Error('The Word template could not be opened. Upload it again under Letter templates.'); bytes = await DocxLib.fillDocx(new Uint8Array(await r.arrayBuffer()), map); }
    else bytes = DocxLib.textToDocx(DocxLib.fillText(d.template.body, map));
  } catch (e) { toast(e.message || 'The letter could not be made.', 7000); return false; }
  const name = `${kind === 'demand' ? 'Demand' : 'Allotment'}-${String(map.flat_no || '').replace(/[^\w-]/g, '')}-${String(kind === 'demand' ? map.stage_name || '' : map.customer_name || '').replace(/[^\w]+/g, '_').slice(0, 30)}.docx`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  toast('Downloaded. Tick "Sent" here once you have sent it.', 6000);
  return true;
}

async function letterMarkSent(kind, id, checked) {
  let via = 'email';
  if (checked) { const v = await openForm({ title: 'How did you send it?', fields: [{ name: 'via', label: 'Sent by', type: 'select', options: SENT_VIA_OPTS }], submit: 'Mark as sent' }); if (!v) return false; via = v.via; }
  return !!(await act(api(kind === 'demand' ? `/api/sales/demands/${id}/mark-sent` : `/api/sales/bookings/${id}/allotment-sent`, { method: 'POST', body: { sent: checked, via } }), checked ? 'Marked as sent' : 'Mark removed'));
}

// ---------- on the Demand letters screen: a Word button and a "Sent" box on each demand ----------
const _loadDemandLetters38 = loadDemandLetters;
loadDemandLetters = async function (selected) {
  await _loadDemandLetters38(selected);
  const body = $('dl-body'); if (!body) return;
  body.querySelectorAll('.dl-cb').forEach((cb) => {
    const card = cb.closest('label'); if (!card || card.querySelector('[data-wl]')) return;
    const id = Number(cb.value); const sent = !!card.querySelector('.chip') && /Sent /.test(card.textContent);
    const holder = card.querySelector('div'); if (!holder) return;
    holder.insertAdjacentHTML('beforeend', `<div class="row-btns" style="margin-top:8px"><button type="button" class="btn small btn-primary" data-wl="${id}">Word letter</button><span class="chip" style="background:#e5e7eb;color:#111827"><input type="checkbox" data-sentbox="${id}"${sent ? ' checked' : ''} style="width:22px;height:22px;vertical-align:middle"> Sent by hand</span></div>`);
    card.querySelector('[data-wl]').onclick = (e) => { e.preventDefault(); e.stopPropagation(); letterDownload('demand', id); };
    const box = card.querySelector('[data-sentbox]'); box.onclick = (e) => e.stopPropagation();
    box.onchange = async () => { const want = box.checked; if (!(await letterMarkSent('demand', id, want))) box.checked = !want; };
  });
};

// ---------- on a booking: the allotment letter ----------
const _bookingDetail38 = bookingDetail;
bookingDetail = async function (id) {
  await _bookingDetail38(id);
  if (!['owner', 'pm', 'accounts', 'sales'].includes(currentUser.role)) return;
  const ov = [...document.querySelectorAll('.modal-overlay')].pop(); if (!ov || ov.querySelector('[data-allot]')) return;
  let info = null; try { info = (await api(`/api/sales/bookings/${id}/allotment-letter`)).data; } catch (e) { return; }
  const modal = ov.querySelector('.modal'); if (!modal) return;
  const box = document.createElement('div'); box.className = 'card';
  box.innerHTML = `<b>Allotment letter</b><p class="muted">${info.sent_at ? 'Marked as sent on ' + esc(dateIST(info.sent_at).substring(0, 10)) + (info.sent_via ? ' (' + esc(info.sent_via) + ')' : '') : 'Not sent yet.'}</p><div class="row-btns"><button class="btn small btn-primary" data-allot="1">Word letter</button><span class="chip" style="background:#e5e7eb;color:#111827"><input type="checkbox" data-allotsent="1"${info.sent_at ? ' checked' : ''} style="width:22px;height:22px;vertical-align:middle"> Sent by hand</span></div>`;
  const first = modal.querySelector('h3') || modal.lastElementChild; modal.insertBefore(box, first);
  box.querySelector('[data-allot]').onclick = () => letterDownload('allotment', id);
  const cb = box.querySelector('[data-allotsent]'); cb.onchange = async () => { const want = cb.checked; if (!(await letterMarkSent('allotment', id, want))) cb.checked = !want; };
};

// ---------- the template screen ----------
async function renderLetterTemplates(main) {
  main.innerHTML = '<h1>Letter templates</h1><p class="help">The wording of your demand letters and the allotment letter. Use {{name}} where a customer\'s details go (the list is below). The built-in wording is a starting text only: have your advocate approve the final wording. A demand letter can be different for each payment stage.</p><div id="lt-out">Loading...</div>';
  const projects = await getProjects().catch(() => []);
  const pid = scopeProject && projects.some((p) => p.id === scopeProject) ? scopeProject : (projects[0] || {}).id;
  if (!pid) { $('lt-out').innerHTML = '<p>Create a project first.</p>'; return; }
  const load = async () => {
    try {
      const d = (await api('/api/sales/letter-templates?project_id=' + pid)).data;
      const find = (kind, stage) => d.templates.find((t) => t.kind === kind && (t.stage_id || 0) === (stage || 0));
      const row = (label, kind, stage) => {
        const t = find(kind, stage);
        return `<div class="card"><div class="row"><div><b>${esc(label)}</b><p class="muted">${t ? (t.doc_id ? 'Your Word template is used' : 'Your own text is used') + ' · changed ' + esc(dateIST(t.updated_at).substring(0, 10)) : (stage ? 'Uses the general demand letter' : 'Built-in wording')}</p></div></div>
          <div class="row-btns"><button class="btn small btn-primary" data-ed="${kind}:${stage || 0}">${t ? 'Change' : 'Write your own'}</button>${t ? `<button class="btn small" data-rm="${t.id}">Back to ${stage ? 'the general letter' : 'the built-in wording'}</button>` : ''}</div></div>`;
      };
      $('lt-out').innerHTML = `<h3>Demand letter (all stages)</h3>${row('General demand letter', 'demand', 0)}<h3>Demand letter for one stage</h3>${d.stages.map((s) => row(s.stage_name, 'demand', s.id)).join('') || '<p class="muted">No payment stages yet.</p>'}
        <h3>Allotment letter</h3>${row('Allotment letter', 'allotment', 0)}
        <h3>What you can put in a letter</h3><p class="muted">${d.fields.map((f) => '{{' + f + '}}').join('  ')}</p><p class="help">The bank account, signatory and other fixed details come from Settings (collection account text, letter signatory). Each customer\'s letter can still be changed before it downloads.</p>`;
      $('lt-out').querySelectorAll('[data-ed]').forEach((b) => { b.onclick = async () => {
        const [kind, stage] = b.dataset.ed.split(':'); const t = find(kind, Number(stage));
        const v = await openForm({ title: 'Letter wording', intro: 'Type the letter, or upload a Word file (.docx) that already has the {{names}} in it. If you upload, the file is used and the text below is ignored.', fields: [
          { name: 'body', label: 'Letter text', type: 'textarea', value: t && t.body ? t.body : (kind === 'allotment' ? d.defaults.allotment : d.defaults.demand) }, { name: 'file', label: 'Or a Word file (.docx)', type: 'file' }] });
        if (!v) return;
        const body = { project_id: pid, kind, stage_id: Number(stage) || undefined, body: v.body, title: '' };
        if (v.file) { const fd = new FormData(); fd.append('file', v.file, v.file.name); fd.append('title', 'Letter template ' + kind); fd.append('category', 'agreement'); fd.append('module', 'sales'); fd.append('project_id', String(pid)); fd.append('audience', 'internal');
          const up = await act(api('/api/files/upload', { method: 'POST', body: fd })); if (!up) return; body.doc_id = up.data.id; }
        if (await act(api('/api/sales/letter-templates', { method: 'POST', body }), 'Saved')) load();
      }; });
      $('lt-out').querySelectorAll('[data-rm]').forEach((b) => { b.onclick = async () => { if (confirm('Go back to the earlier wording?') && await act(api(`/api/sales/letter-templates/${b.dataset.rm}`, { method: 'DELETE' }), 'Done')) load(); }; });
    } catch (e) { $('lt-out').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };
  load();
}
