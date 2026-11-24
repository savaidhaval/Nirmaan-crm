// pages39.js — price / cost per sq ft. One helper set used across Sales, Budget, Procurement, Contractors, Rent and Corpus.
//  * "Show ₹ per sq ft" in the account menu turns the extra figures on or off on this phone.
//  * A form that asks for an amount can also take it as a rate per sq ft: the amount is then worked out from the area.
// Which area is divided by is set per project (Price list screen): RERA carpet of flats for sale (default), of all flats, built-up, or plot.
const AREA_CACHE = {};
async function areaFor(pid) {
  pid = Number(pid); if (!pid) return null;
  const c = AREA_CACHE[pid]; if (c && Date.now() - c.t < 60000) return c.v;
  try { const v = (await api('/api/areas?project_id=' + pid)).data; AREA_CACHE[pid] = { t: Date.now(), v }; return v; } catch (e) { return null; }
}
const psfOn = () => { try { return localStorage.getItem('nirmaan.psf') === '1'; } catch (e) { return false; } };
const psfRate = (paise, sqft) => (sqft > 0 ? Math.round(paise / sqft / 100) : null);   // rupees per sq ft
const psfText = (paise, sqft) => { const r = psfRate(paise, sqft); return r == null ? '' : '₹' + r.toLocaleString('en-IN') + ' / sq ft'; };
const psfTag = (paise, sqft) => { const t = psfText(paise, sqft); return t ? ` <span class="muted">(${t})</span>` : ''; };
const psfNeedArea = (a) => (a && a.area_sqft ? '' : 'The project has no area to divide by yet. Set it on the Price list screen (Project area).');
// a "money" form field holds paise, so a rate per sq ft times the area in sq ft is the total in paise
const psfTotal = (ratePaise, sqft) => Math.round(Number(ratePaise) * Number(sqft));

(function addMenuSwitch() {
  const m = document.getElementById('user-menu'); if (!m || document.getElementById('menu-psf')) return;
  const d = document.createElement('div'); d.className = 'menu-item'; d.id = 'menu-psf';
  d.textContent = 'Show ₹ per sq ft: ' + (psfOn() ? 'On' : 'Off');
  d.onclick = () => { try { localStorage.setItem('nirmaan.psf', psfOn() ? '0' : '1'); } catch (e) { /* storage blocked */ } location.reload(); };
  m.insertBefore(d, document.getElementById('menu-logout'));
})();

// ---------- a booking: what the buyer pays per sq ft ----------
const _bookingDetail39 = bookingDetail;
bookingDetail = async function (id) {
  await _bookingDetail39(id);
  if (!psfOn()) return;
  const ov = [...document.querySelectorAll('.modal-overlay')].pop(); if (!ov || ov.querySelector('[data-psf-card]')) return;
  let d; try { d = (await api(`/api/sales/bookings/${id}`)).data; } catch (e) { return; }
  const b = d.booking || d; let snap = {}; try { snap = JSON.parse(b.unit_snapshot || '{}'); } catch (e) { /* none */ }
  const area = Number(snap.rera_carpet_sqft || snap.carpet_sqft) || 0; if (!(area > 0)) return;
  const modal = ov.querySelector('.modal'); if (!modal) return;
  const paid = ((d.receipts || []).filter((r) => !r.reversed_at && r.kind !== 'interest')).reduce((t, r) => t + r.amount_paise + (r.tds_paise || 0), 0);
  const card = document.createElement('div'); card.className = 'card'; card.dataset.psfCard = '1';
  card.innerHTML = `<b>Per sq ft</b> <span class="muted">(RERA carpet ${esc(area)} sq ft)</span><div class="kv"><span>Rate card</span><b>${esc(psfText(b.list_price_paise || 0, area))}</b><span>Agreed</span><b>${esc(psfText(b.agreed_price_paise, area))}</b><span>Paid so far</span><b>${esc(psfText(paid, area))}</b></div>`;
  modal.insertBefore(card, modal.querySelector('h3') || modal.lastElementChild);
};

// ---------- a work order: its value per sq ft of the project ----------
if (typeof woDetail === 'function') {
  const _woDetail39 = woDetail;
  woDetail = async function (id) {
    await _woDetail39(id);
    if (!psfOn()) return;
    const ov = [...document.querySelectorAll('.modal-overlay')].pop(); if (!ov || ov.querySelector('[data-psf-card]')) return;
    let d; try { d = (await api(`/api/contractors/work-orders/${id}`)).data; } catch (e) { return; }
    const w = d.wo || d.work_order || d; const a = await areaFor(w.project_id); if (!a || !a.area_sqft) return;
    const modal = ov.querySelector('.modal'); if (!modal) return;
    const card = document.createElement('div'); card.className = 'card'; card.dataset.psfCard = '1';
    card.innerHTML = `<b>Per sq ft of the project</b> <span class="muted">(${esc(a.basis_label)}: ${esc(a.area_sqft)} sq ft)</span><div class="kv"><span>Work order value</span><b>${esc(psfText(w.value_paise, a.area_sqft))}</b></div>`;
    modal.insertBefore(card, modal.children[1] || null);
  };
}

// ---------- project area (shown on the Price list screen) ----------
async function psfAreaCard(host, pid) {
  const a = await areaFor(pid); if (!a) return;
  const canSet = ['owner', 'pm'].includes(currentUser.role);
  const card = document.createElement('div'); card.className = 'card';
  card.innerHTML = `<b>Project area for "per sq ft" figures</b><p class="muted">Dividing by: <b>${esc(a.basis_label)}</b>${a.area_sqft ? ': ' + esc(a.area_sqft) + ' sq ft' : ' (not known yet)'}.<br>Flats for sale ${esc(a.saleable_sqft)} · rehab ${esc(a.rehab_sqft)} · landowner ${esc(a.landowner_sqft)} · built-up ${a.builtup_sqft ? esc(a.builtup_sqft) : 'not entered'} · plot ${a.plot_sqft ? esc(a.plot_sqft) : 'not entered'} (sq ft)${a.flats_without_area ? `<br>${a.flats_without_area} flat(s) have no RERA carpet area yet.` : ''}</p>${canSet ? '<button class="btn small" data-psf-area>Change</button>' : ''}`;
  host.appendChild(card);
  const b = card.querySelector('[data-psf-area]'); if (!b) return;
  b.onclick = async () => {
    const v = await openForm({ title: 'Project area', intro: 'Every "per sq ft" figure in the app divides by the area you choose here.', fields: [
      { name: 'area_basis', label: 'Divide by', type: 'select', value: a.basis, options: [['saleable', 'RERA carpet area of the flats for sale'], ['carpet_all', 'RERA carpet area of all flats (sale, rehab and landowner)'], ['builtup', 'Built-up area of the project'], ['plot', 'Plot area']] },
      { name: 'builtup_sqft', label: 'Built-up area of the whole project (sq ft)', type: 'number', value: a.builtup_sqft || '' }] });
    if (v && await act(api('/api/areas', { method: 'POST', body: { project_id: pid, area_basis: v.area_basis, builtup_sqft: v.builtup_sqft === '' ? null : v.builtup_sqft } }), 'Saved')) { delete AREA_CACHE[pid]; location.reload(); }
  };
}
