// c.js — the buyer's confirmation page. No login. One-time link from the reception QR.
(async function () {
  const $ = (id) => document.getElementById(id);
  const token = location.pathname.split('/')[2] || '';
  const msg = (t, bad) => { $('c-msg').textContent = t; $('c-msg').style.color = bad ? '#b91c1c' : '#166534'; };
  let info; try { info = (await (await fetch('/api/public/checkin/' + encodeURIComponent(token))).json()).data; } catch (e) { info = { state: 'invalid' }; }
  if (!info || info.state === 'invalid') { msg('This link is not valid. Please ask at the reception desk.', true); return; }
  if (info.state === 'expired') { msg('This link has expired. Please ask at the reception desk for a new one.', true); return; }
  if (info.state === 'done') { msg('Thank you. Your visit is already confirmed.'); return; }
  $('c-title').textContent = 'Welcome to ' + (info.project || info.company || 'our site');
  $('c-ask').textContent = info.firm ? 'Did you come today with ' + info.firm + '? Type your mobile number and choose.' : 'Please type your mobile number to confirm your visit.';
  $('c-yes').textContent = info.firm ? 'Yes, I came with ' + info.firm : 'Confirm my visit';
  $('c-form').hidden = false;
  if (!info.firm) $('c-no').hidden = true;
  const send = async (answer) => {
    $('c-yes').disabled = $('c-no').disabled = true;
    try {
      const r = await fetch('/api/public/checkin/' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NirmaanCRM': '1' }, body: JSON.stringify({ phone: $('c-phone').value, answer }) });
      const d = await r.json();
      if (d.ok) { $('c-form').hidden = true; msg('Thank you. Your visit is confirmed. Our team will be with you shortly.'); } else { msg(d.error || 'Something went wrong.', true); $('c-yes').disabled = $('c-no').disabled = false; }
    } catch (e) { msg('No connection. Please try again.', true); $('c-yes').disabled = $('c-no').disabled = false; }
  };
  $('c-yes').onclick = () => send('yes'); $('c-no').onclick = () => send('no');
})();
