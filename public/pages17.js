// pages17.js — WP-22: drawing acknowledgement. Site users tap "I have seen R3"; the PM sees who has not.

const _loadDrawings17 = loadDrawings;
loadDrawings = async function () {
  await _loadDrawings17();
  try {
    const d = (await api('/api/drawings/acks/summary')).data, by = {}; d.acks.forEach((a) => { by[a.drawing_id] = a; });
    document.querySelectorAll('#drawings-list [data-id]').forEach((card) => {
      const a = by[card.dataset.id]; if (!a || !a.site_total) return; const row = card.querySelector('.row'); if (!row) return;
      const tag = d.is_site ? (a.my_ack ? chip('You have seen ' + a.rev_no, 'good') : chip('Please confirm ' + a.rev_no, 'warn')) : chip(`Seen by ${a.site_acked} of ${a.site_total}`, a.site_acked >= a.site_total ? 'good' : 'warn');
      row.insertAdjacentHTML('beforeend', `<div style="margin-top:4px">${tag}</div>`);
    });
  } catch (e) { /* the list works without this */ }
};

const _drawingDetail17 = drawingDetail;
drawingDetail = async function (d) {
  await _drawingDetail17(d);
  const modal = [...document.querySelectorAll('.modal-overlay .modal')].pop(); if (!modal) return;
  try {
    const a = (await api(`/api/drawings/${d.id}/acks`)).data; if (!a.revision || !a.total) return;
    const mine = currentUser.role === 'site' ? a.people[0] : null;
    const box = document.createElement('div'); box.className = 'card'; box.style.borderLeft = '4px solid var(--s3)';
    if (mine) box.innerHTML = mine.acked_at ? `<p>${chip('You confirmed ' + a.revision.rev_no, 'good')} <span class="muted">${esc(dateIST(mine.acked_at))}</span></p>`
      : `<p><b>${esc(a.revision.rev_no)}</b> is the current drawing for construction. Please confirm you have seen it.</p><button class="btn btn-primary btn-full" id="drw-ack">I have seen ${esc(a.revision.rev_no)}</button>`;
    else box.innerHTML = `<p><b>${esc(a.revision.rev_no)}</b>: seen by <b>${a.seen} of ${a.total}</b> site users</p>${a.people.map((p) => `<p class="muted">${p.acked_at ? '✓' : '○'} ${esc(p.name)}${p.acked_at ? ' · ' + esc(dateIST(p.acked_at)) : ' · not yet'}</p>`).join('')}`;
    modal.querySelector('p.muted').insertAdjacentElement('afterend', box);
    const b = box.querySelector('#drw-ack');
    if (b) b.onclick = async () => { if (await act(api(`/api/drawings/revisions/${a.revision.id}/ack`, { method: 'POST' }), 'Thank you. Recorded.')) { b.closest('.modal-overlay').remove(); loadDrawings(); } };
  } catch (e) { /* the drawing still opens */ }
};
