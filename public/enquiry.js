// enquiry.js — the public enquiry form. No login. Shows Cloudflare Turnstile when the server has it switched on.
(async function () {
  const $ = (id) => document.getElementById(id);
  const project = new URLSearchParams(location.search).get('project') || '';
  let cfg; try { cfg = (await (await fetch('/api/public/enquiry-config?project=' + encodeURIComponent(project))).json()).data; } catch (e) { cfg = { enabled: false }; }
  if (!cfg || !cfg.enabled) { $('enq-form').hidden = true; $('enq-off').hidden = false; return; }
  if (cfg.project) $('enq-title').textContent = 'Enquire about ' + cfg.project; else if (cfg.company) $('enq-title').textContent = 'Enquire with ' + cfg.company;
  let token = cfg.site_key === 'mock' ? 'ok-token' : '', widget = null;
  if (cfg.site_key !== 'mock') {
    const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
    s.onload = () => { widget = window.turnstile.render('#enq-turnstile', { sitekey: cfg.site_key, callback: (t) => { token = t; }, 'expired-callback': () => { token = ''; } }); };
    document.head.appendChild(s);
  }
  const err = (m) => { $('enq-error').textContent = m; $('enq-error').hidden = !m; };
  $('enq-form').onsubmit = async (e) => {
    e.preventDefault(); err('');
    if (!$('enq-consent').checked) { err('Please tick the box to say we may contact you.'); return; }
    if (!token) { err('Please tick the check box above ("I am human") first.'); return; }
    $('enq-send').disabled = true;
    try {
      const r = await fetch('/api/public/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('enq-name').value, phone: $('enq-phone').value, email: $('enq-email').value, message: $('enq-msg').value, company_website: $('enq-trap').value, consent: true, token, project }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { err(d.error || 'Something went wrong. Please try again.'); $('enq-send').disabled = false; if (widget !== null && window.turnstile) { window.turnstile.reset(widget); token = ''; } return; }
      $('enq-form').hidden = true; $('enq-done').hidden = false;
    } catch (x) { err('No connection. Please try again.'); $('enq-send').disabled = false; }
  };
})();
