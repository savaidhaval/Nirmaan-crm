// pages29.js — Module 1 step 2: vacating proof location, PAN and Aadhaar (last 4), the Owner's approval PIN and rent changes waiting for it,
// and the site proofs needed before a demolition work order can be approved.

// The phone's location, or null if it is off or refused.
function m1Where() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 }), () => resolve(null), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}

// Save a rent that may need the Owner's PIN. Asks for the PIN when the server says so; a change by anyone else goes to the Owner.
async function m1RentSave(method, url, body) {
  try { return await api(url, { method, body }); } catch (e) {
    if (e.data && e.data.code === 'pin_required' && !/Set your approval PIN/.test(e.message)) {
      const v = await openForm({ title: 'Approve this rent change', intro: 'This changes a rent that is already set. Enter your approval PIN.', fields: [{ name: 'pin', label: 'Approval PIN (6 digits)', type: 'password', required: true }] });
      if (!v) return null;
      return m1RentSave(method, url, { ...body, pin: v.pin });
    }
    toast(e.message, 6000); return null;
  }
}

// ---------- rent tab: approval PIN and changes waiting ----------
const _rdRent29 = rdRent;
rdRent = async function (pane, month) {
  await _rdRent29(pane, month);
  let pin = null, ch = null;
  try { pin = (await api('/api/redev/approval-pin')).data; ch = (await api('/api/redev/rent-changes?status=pending')).data.changes; } catch (e) { return; }
  const isOwner = pin.is_owner;
  const rows = ch.map((c) => `<div class="card"><b>${esc(c.summary)}</b><p class="muted">Asked by ${esc(c.requested_by_name || '')} · ${esc(dateIST(c.created_at))}</p><p class="muted">${esc(Object.entries(c.change).map(([k, v]) => `${k.replace(/_paise$/, '').replace(/_/g, ' ')}: ${/paise/.test(k) && v !== '' && v != null ? '₹' + (Number(v) / 100).toLocaleString('en-IN') : v}`).join(' · '))}</p>
    ${isOwner ? `<div class="row-btns"><button class="btn small btn-primary" data-chg-ok="${c.id}">Approve with PIN</button><button class="btn small" data-chg-no="${c.id}">Reject</button></div>` : '<p class="muted">Waiting for the Owner.</p>'}</div>`).join('');
  pane.insertAdjacentHTML('afterbegin', `<div class="card"><b>Rent changes</b>${isOwner ? `<p class="muted">${pin.has_pin ? 'Your approval PIN is set.' : 'Set your 6-digit approval PIN. A change to a rent that is already set is applied only with it.'}</p><button class="btn small" id="rc-pin">${pin.has_pin ? 'Change approval PIN' : 'Set approval PIN'}</button>` : '<p class="muted">A change to a rent that is already set waits here for the Owner\'s approval.</p>'}
    ${ch.length ? '' : '<p class="muted">Nothing is waiting.</p>'}</div>${rows}`);
  const again = () => rdRent(pane, month);
  const setPin = $('rc-pin');
  if (setPin) setPin.onclick = async () => {
    const v = await openForm({ title: pin.has_pin ? 'Change approval PIN' : 'Set approval PIN', intro: 'Six digits, not all the same. It is never shown again and is stored only as a scrambled code.', fields: [
      { name: 'password', label: 'Your login password', type: 'password', required: true }, { name: 'pin', label: 'New PIN (6 digits)', type: 'password', required: true }, { name: 'pin2', label: 'Type the PIN again', type: 'password', required: true }] });
    if (!v) return; if (v.pin !== v.pin2) return toast('The two PINs are not the same.', 4000);
    if (await act(api('/api/redev/approval-pin', { method: 'POST', body: { password: v.password, pin: v.pin } }), 'PIN saved')) again();
  };
  pane.querySelectorAll('[data-chg-ok]').forEach((b) => { b.onclick = async () => {
    const v = await openForm({ title: 'Approve this rent change', fields: [{ name: 'pin', label: 'Approval PIN (6 digits)', type: 'password', required: true }] });
    if (v && await act(api(`/api/redev/rent-changes/${b.dataset.chgOk}/approve`, { method: 'POST', body: { pin: v.pin } }), 'Approved and applied')) again();
  }; });
  pane.querySelectorAll('[data-chg-no]').forEach((b) => { b.onclick = async () => {
    const v = await openForm({ title: 'Reject this change', fields: [{ name: 'note', label: 'Why?', required: true }] });
    if (v && await act(api(`/api/redev/rent-changes/${b.dataset.chgNo}/reject`, { method: 'POST', body: v }), 'Rejected')) again();
  }; });
};

// ---------- members tab: PAN and Aadhaar buttons, site proofs ----------
const _rdMembers29 = rdMembers;
rdMembers = async function (pane) {
  await _rdMembers29(pane);
  if (!isRole('owner', 'pm')) return;
  const members = (await api(`/api/redev/societies/${RD.soc}/members?page=${RD.page}&q=${encodeURIComponent(RD.q)}&status=${RD.st}`)).data.members;
  pane.querySelectorAll('[data-vac]').forEach((b) => {
    if (b.parentElement.querySelector(`[data-ident="${b.dataset.vac}"]`)) return;
    b.insertAdjacentHTML('afterend', `<button class="btn small" data-ident="${b.dataset.vac}">PAN &amp; Aadhaar</button>`);
  });
  pane.querySelectorAll('[data-ident]').forEach((b) => { b.onclick = async () => {
    const m = members.find((x) => String(x.id) === b.dataset.ident) || {};
    const v = await openForm({ title: `PAN and Aadhaar · ${m.member_name || ''}`, intro: `On file: PAN ${m.pan_masked || 'none'} · Aadhaar ${m.aadhaar_masked || 'none'}. One PAN can belong to one member only.`, fields: [
      { name: 'pan', label: 'PAN (leave empty to keep what is on file)', placeholder: 'ABCDE1234F' }, { name: 'aadhaar_last4', label: 'Aadhaar: last 4 digits only', placeholder: '1234', help: 'The full Aadhaar number is never stored.' }] });
    if (v && await act(api(`/api/redev/members/${b.dataset.ident}/identity`, { method: 'PUT', body: v }), 'Saved')) rdMembers(pane);
  }; });
  // site proofs for the pre-demolition gate
  let sp = null; try { sp = (await api(`/api/redev/projects/${RD.d.society.project_id}/site-proofs`)).data; } catch (e) { return; }
  const by = Object.fromEntries(sp.proofs.map((p) => [p.kind, p]));
  pane.insertAdjacentHTML('afterbegin', `<div class="card"><b>Before demolition</b><p class="muted">A demolition work order cannot be approved until the IOD is approved and these are on file.</p>${sp.blocked ? chip(sp.blocked.replace('Demolition cannot be released yet. ', ''), 'warn') : chip('Clear for demolition', 'good')}
    ${Object.entries(sp.labels).map(([k, label]) => { const p = by[k]; return `<div class="row"><div>${esc(label)}<p class="muted">${p ? (p.status === 'not_applicable' ? 'Not applicable: ' + esc(p.note || '') : 'On file' + (p.ref_no ? ' · ' + esc(p.ref_no) : '')) : 'Missing'}</p></div><button class="btn small" data-proof="${k}">${p ? 'Change' : 'Add'}</button></div>`; }).join('')}</div>`);
  pane.querySelectorAll('[data-proof]').forEach((b) => { b.onclick = async () => {
    const k = b.dataset.proof;
    const v = await openForm({ title: sp.labels[k], intro: 'Attach the receipt or letter, or say why it does not apply to this site.', fields: [
      { name: 'file', label: 'File (photo or PDF)', type: 'file' }, { name: 'ref_no', label: 'Reference / receipt number' }, { name: 'on_date', label: 'Date on it', type: 'date' },
      { name: 'not_applicable', type: 'checkbox', checkLabel: 'Does not apply to this site' }, { name: 'note', label: 'If it does not apply, why?' }] });
    if (!v) return;
    const body = { ref_no: v.ref_no, on_date: v.on_date || null, note: v.note, status: v.not_applicable ? 'not_applicable' : 'provided' };
    if (v.file) { const id = await rdUpload(v.file, sp.labels[k]); if (!id) return; body.document_id = id; }
    if (await act(api(`/api/redev/projects/${RD.d.society.project_id}/site-proofs/${k}`, { method: 'PUT', body }), 'Saved')) rdMembers(pane);
  }; });
};
