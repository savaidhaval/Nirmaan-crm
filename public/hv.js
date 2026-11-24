// hv.js — the buyer's page for the handover steps: joint inspection, choosing a handover time, signing the baseline. No login. One-time link.
(async function () {
  const $ = (id) => document.getElementById(id);
  const token = location.pathname.split('/')[2] || '';
  const msg = (t, bad) => { $('hv-msg').textContent = t; $('hv-msg').style.color = bad ? '#b91c1c' : '#166534'; };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const post = async (body) => { const r = await fetch('/api/public/hv/' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NirmaanCRM': '1' }, body: JSON.stringify(body) }); return { ok: r.ok, d: await r.json().catch(() => ({})) }; };
  let info; try { info = (await (await fetch('/api/public/hv/' + encodeURIComponent(token))).json()).data; } catch (e) { info = { state: 'invalid' }; }
  if (!info || info.state === 'invalid') { msg('This link is not valid. Please contact our office.', true); return; }
  if (info.state === 'expired') { msg('This link has expired. Please contact our office for a new one.', true); return; }
  if (info.state === 'done') { msg('Thank you. This has already been completed.'); return; }
  const contact = [info.phone, info.email].filter(Boolean).join(' · ');
  $('hv-title').textContent = info.project || info.company || 'Your flat';
  $('hv-sub').textContent = `Dear ${info.customer}, flat ${info.flat}.`;
  const field = (id, label, extra) => `<label style="display:block;margin:12px 0">${label}<input id="${id}" ${extra || ''} style="width:100%;min-height:52px;font-size:18px;padding:0 14px;border-radius:14px;border:1px solid #cbd5e1"></label>`;
  const btn = (id, text) => `<button class="btn btn-primary btn-full" id="${id}" style="min-height:56px;font-size:18px">${text}</button>`;
  if (info.kind === 'inspection') {
    $('hv-body').innerHTML = `<p style="font-size:18px">Please walk through your flat with our engineer. If you see a small thing to set right, type it below (one per line). We will fix it within ${esc(info.touchup_days)} days.</p>
      <label style="display:block;margin:12px 0">Touch-ups (optional, one per line)<textarea id="hv-touch" rows="4" maxlength="900" style="width:100%;font-size:18px;padding:10px;border-radius:14px;border:1px solid #cbd5e1"></textarea></label>
      ${field('hv-name', 'Type your full name to sign', 'autocomplete="name" maxlength="80"')}
      <label class="check" style="display:block;margin:12px 0;font-size:18px"><input type="checkbox" id="hv-ok" style="width:26px;height:26px"> I have inspected the flat and this is my joint inspection report.</label>${btn('hv-go', 'Sign the report')}`;
    $('hv-go').onclick = async () => {
      $('hv-go').disabled = true;
      const { ok, d } = await post({ name: $('hv-name').value, confirm: $('hv-ok').checked, touchups: $('hv-touch').value.split('\n') });
      if (ok) { $('hv-body').innerHTML = ''; msg(d.data.touchups ? `Thank you. We will set ${d.data.touchups} thing(s) right within ${d.data.due_days} days.` : 'Thank you. Your report is signed.'); } else { msg(d.error || 'Something went wrong.', true); $('hv-go').disabled = false; }
    };
  } else if (info.kind === 'baseline') {
    $('hv-body').innerHTML = `<p style="font-size:18px">Before you start any interior work, we have photographed the floors, waterproofing and fittings of your flat as they are today. By signing you confirm that you were shown these photographs and that this is the condition you are taking over.</p>
      ${field('hv-name', 'Type your full name to sign', 'autocomplete="name" maxlength="80"')}
      <label class="check" style="display:block;margin:12px 0;font-size:18px"><input type="checkbox" id="hv-ok" style="width:26px;height:26px"> I confirm this.</label>${btn('hv-go', 'Sign')}`;
    $('hv-go').onclick = async () => { $('hv-go').disabled = true; const { ok, d } = await post({ name: $('hv-name').value, confirm: $('hv-ok').checked }); if (ok) { $('hv-body').innerHTML = ''; msg('Thank you. It is signed.'); } else { msg(d.error || 'Something went wrong.', true); $('hv-go').disabled = false; } };
  } else if (info.kind === 'slot') {
    const draw = () => {
      const days = {}; (info.slots || []).forEach((s) => { (days[s.slot_on] = days[s.slot_on] || []).push(s); });
      $('hv-body').innerHTML = (info.mine ? `<p style="font-size:18px;color:#166534"><b>Your time: ${esc(info.mine.slot_on)} at ${esc(info.mine.start_time)}.</b> You can change it below.</p>` : '<p style="font-size:18px">Please choose a time to collect your keys. It takes about 45 minutes.</p>')
        + (Object.keys(days).length ? Object.entries(days).map(([d, ss]) => `<h3>${esc(d)}</h3><div>${ss.map((s) => `<button class="btn" data-s="${s.id}" style="min-height:52px;margin:4px;font-size:17px">${esc(s.start_time)}</button>`).join('')}</div>`).join('') : '<p>No free times right now. Please contact our office' + (contact ? ' (' + esc(contact) + ')' : '') + '.</p>');
      $('hv-body').querySelectorAll('[data-s]').forEach((b) => { b.onclick = async () => { const { ok, d } = await post({ slot_id: Number(b.dataset.s) }); if (ok) { info.mine = { slot_on: d.data.slot_on, start_time: d.data.start_time }; info.slots = info.slots.filter((x) => x.id !== Number(b.dataset.s)); msg(`Booked: ${d.data.slot_on} at ${d.data.start_time}. See you at the site office.`); draw(); } else { msg(d.error || 'Something went wrong.', true); } }; });
    };
    draw();
  }
})();
