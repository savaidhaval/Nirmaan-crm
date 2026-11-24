// complaint.js — the resident's complaint form (opened from the QR code). No login. Cloudflare Turnstile when the server has it switched on.
(async function () {
  const $ = (id) => document.getElementById(id);
  const project = new URLSearchParams(location.search).get('project') || '';
  let cfg; try { cfg = (await (await fetch('/api/public/complaint-config?project=' + encodeURIComponent(project))).json()).data; } catch (e) { cfg = { enabled: false }; }
  if (cfg && cfg.project) $('cmp-title').textContent = 'Report a problem: ' + cfg.project;
  const contact = cfg ? [cfg.phone ? 'call ' + cfg.phone : '', cfg.email ? 'email ' + cfg.email : ''].filter(Boolean).join(' or ') : '';
  if (!cfg || !cfg.enabled) { $('cmp-off').hidden = false; if (contact) $('cmp-off').textContent = 'This form is not switched on yet. Please ' + contact + '.'; return; }
  $('cmp-form').hidden = false;
  if (cfg.email) $('cmp-mail').textContent = 'To send photos, email them to ' + cfg.email + ' and mention your flat number.';
  let token = cfg.site_key === 'mock' ? 'ok-token' : '', widget = null;
  if (cfg.site_key !== 'mock') {
    const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
    s.onload = () => { widget = window.turnstile.render('#cmp-turnstile', { sitekey: cfg.site_key, callback: (t) => { token = t; }, 'expired-callback': () => { token = ''; } }); };
    document.head.appendChild(s);
  }
  const err = (m) => { $('cmp-error').textContent = m; $('cmp-error').hidden = !m; };
  $('cmp-form').onsubmit = async (e) => {
    e.preventDefault(); err('');
    if (!$('cmp-consent').checked) { err('Please tick the box to say we may contact you.'); return; }
    if (!token) { err('Please tick the check box above ("I am human") first.'); return; }
    $('cmp-send').disabled = true;
    try {
      const r = await fetch('/api/public/complaint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, name: $('cmp-name').value, phone: $('cmp-phone').value, flat: $('cmp-flat').value, category: $('cmp-cat').value, title: $('cmp-title2').value, detail: $('cmp-detail').value, consent: true, company_website: $('cmp-trap').value, token }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { err(d.error || 'Something went wrong. Please try again.'); $('cmp-send').disabled = false; if (widget !== null && window.turnstile) { window.turnstile.reset(widget); token = ''; } return; }
      $('cmp-form').hidden = true; $('cmp-done').hidden = false;
      if (d.data && d.data.due_by) $('cmp-done-msg').textContent = 'We have your message. Our team will attend to it by ' + d.data.due_by + '.';
    } catch (x) { err('No connection. Please try again.'); $('cmp-send').disabled = false; }
  };
})();
