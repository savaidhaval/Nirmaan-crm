// pages10.js — AI assistant: ask the CRM, write a message, summarise. Everything it produces is a draft for a person to check.

const AI_SUGGEST = ['Which vendor bills are due this week?', 'What stock is running low?', 'Which leads need a follow-up?', 'What is over budget?', 'Which contracts expire soon?', 'Which approvals are pending?', 'How much petty cash is in hand?', 'Which customers are overdue?'];

async function renderAi(main) {
  main.innerHTML = '<h1>AI assistant</h1><div id="ai-body">Loading...</div>';
  let st;
  try { st = (await api('/api/ai/status')).data; } catch (e) { $('ai-body').innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  if (!st.enabled) {
    $('ai-body').innerHTML = `<div class="card"><p>The AI assistant is switched off.</p><p class="muted">${currentUser.role === 'owner' ? 'Turn it on in More → Settings → “AI assistant”.' : 'Ask the Owner to switch it on.'}</p></div>`;
    return;
  }
  const r = currentUser.role;
  const draftKinds = [...(['owner', 'pm', 'sales'].includes(r) ? [['lead_followup', 'Follow up a lead', 'lead']] : []), ...(['owner', 'pm', 'accounts'].includes(r) ? [['payment_reminder', 'Remind a customer about a payment', 'demand']] : []),
    ...(['owner', 'pm', 'purchase', 'accounts'].includes(r) ? [['vendor_po_followup', 'Ask a vendor for delivery status', 'vendor'], ['vendor_payment_status', 'Tell a vendor about their payment', 'vendor'], ['vendor_quote_request', 'Ask a vendor for a quotation', 'vendor']] : [])];
  const sumKinds = [...(['owner', 'pm', 'sales'].includes(r) ? [['lead', 'A lead\'s history', 'lead']] : []), ['project_week', 'A project\'s week', 'project'], ['text', 'Text I paste', null]];
  $('ai-body').innerHTML = `<p class="muted">Free daily allowance: ${st.used_today} of ${st.daily_limit} used today by the team. AI can make mistakes. It never changes anything and never sends anything: check what it writes before you use it.</p>

    <div class="card"><h3>Ask the CRM</h3><div class="field"><input id="ai-q" placeholder="Ask about bills, stock, leads, budget, approvals…" maxlength="400"></div>
      <div class="row-btns">${AI_SUGGEST.slice(0, 5).map((q) => `<button class="btn small" data-sug="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <button class="btn btn-primary btn-full" id="ai-ask" style="margin-top:8px">Ask</button><div id="ai-out"></div></div>

    ${draftKinds.length ? `<div class="card"><h3>Write a message</h3><div class="field"><label>What for?</label><select id="dr-kind">${draftKinds.map(([k, l, t]) => `<option value="${k}" data-pick="${t}">${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label id="dr-pick-label">Who?</label><input id="dr-q" placeholder="Start typing a name"></div><div id="dr-results"></div>
      <div class="field"><label>Anything to include? (optional)</label><input id="dr-note" maxlength="500" placeholder="e.g. offer a Saturday visit"></div>
      <div class="field"><label>Tone</label><select id="dr-tone"><option value="polite">Polite and warm</option><option value="firm">Polite but firm</option></select></div>
      <div class="field"><label>For</label><select id="dr-channel"><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select></div>
      <button class="btn btn-primary btn-full" id="dr-go">Write the draft</button><div id="dr-out"></div></div>` : ''}

    <div class="card"><h3>Summarise</h3><div class="field"><label>What?</label><select id="sm-kind">${sumKinds.map(([k, l, t]) => `<option value="${k}" data-pick="${t || ''}">${esc(l)}</option>`).join('')}</select></div>
      <div id="sm-pickbox"><div class="field"><input id="sm-q" placeholder="Start typing a name"></div><div id="sm-results"></div></div>
      <div id="sm-textbox" style="display:none" class="field"><textarea id="sm-text" rows="5" maxlength="6000" placeholder="Paste a contract note, an email, anything long"></textarea></div>
      <button class="btn btn-primary btn-full" id="sm-go">Summarise</button><div id="sm-out"></div></div>`;

  const aiError = (el, e) => { el.innerHTML = `<div class="error" style="margin-top:8px">${esc(e.message)}</div>`; };
  const factsBlock = (facts) => (facts && facts.length ? `<details style="margin-top:8px"><summary class="muted">The facts this is based on</summary>${facts.map((l) => `<p class="muted" style="margin:2px 0">${esc(l)}</p>`).join('')}</details>` : '');
  const busy = (btn, on) => { btn.disabled = on; btn.dataset.t = btn.dataset.t || btn.textContent; btn.textContent = on ? 'Thinking…' : btn.dataset.t; };

  // ----- ask -----
  const doAsk = async () => {
    const q = $('ai-q').value.trim(); if (q.length < 3) { toast('Type your question first'); return; }
    busy($('ai-ask'), true);
    try {
      const d = (await api('/api/ai/ask', { method: 'POST', body: { question: q } })).data;
      $('ai-out').innerHTML = `<div class="card" style="margin-top:10px;background:#f8fafc"><p style="white-space:pre-wrap">${esc(d.answer)}</p>${(d.warnings || []).map((w) => `<p style="color:#92400e"><b>⚠ ${esc(w)}</b></p>`).join('')}
        ${d.model_used ? '<p class="muted">AI answer. Check important numbers against the facts below.</p>' : ''}${d.based_on && d.based_on.length ? `<p class="muted">Based on: ${esc(d.based_on.join(', '))}</p>` : ''}${factsBlock(d.facts)}</div>`;
    } catch (e) { aiError($('ai-out'), e); }
    busy($('ai-ask'), false);
  };
  $('ai-ask').onclick = doAsk; $('ai-q').onkeydown = (e) => { if (e.key === 'Enter') doAsk(); };
  document.querySelectorAll('[data-sug]').forEach((b) => { b.onclick = () => { $('ai-q').value = b.dataset.sug; doAsk(); }; });

  // ----- record picker shared by draft and summary -----
  const picker = (inputId, resultsId, getKind) => {
    const state = { id: null, label: '' }; let t = null;
    const search = async () => {
      const kind = getKind(); const box = $(resultsId); state.id = null;
      if (!kind) { box.innerHTML = ''; return; }
      try {
        const rows = (await api(`/api/ai/find?kind=${kind}&q=${encodeURIComponent($(inputId).value.trim())}`)).data.results;
        box.innerHTML = rows.map((x) => `<button class="btn small" data-pick-id="${x.id}" data-label="${esc(x.label)}" style="margin:2px">${esc(x.label)}</button>`).join('') || '<p class="muted">Nothing found.</p>';
        box.querySelectorAll('[data-pick-id]').forEach((b) => { b.onclick = () => { state.id = Number(b.dataset.pickId); state.label = b.dataset.label; box.innerHTML = `<p>✔ <b>${esc(b.dataset.label)}</b></p>`; }; });
      } catch (e) { box.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
    };
    $(inputId).oninput = () => { clearTimeout(t); t = setTimeout(search, 300); };
    return { state, search };
  };

  // ----- draft -----
  if ($('dr-kind')) {
    const kindOf = () => $('dr-kind').selectedOptions[0].dataset.pick;
    const dp = picker('dr-q', 'dr-results', kindOf);
    $('dr-kind').onchange = () => { $('dr-q').value = ''; $('dr-results').innerHTML = ''; dp.state.id = null; dp.search(); };
    dp.search();
    $('dr-go').onclick = async () => {
      if (!dp.state.id) { toast('Pick the person or record first'); return; }
      busy($('dr-go'), true);
      try {
        const d = (await api('/api/ai/draft', { method: 'POST', body: { kind: $('dr-kind').value, id: dp.state.id, tone: $('dr-tone').value, channel: $('dr-channel').value, note: $('dr-note').value.trim() } })).data;
        $('dr-out').innerHTML = `<div style="margin-top:10px"><label>Draft (you can edit it)</label><textarea id="dr-text" rows="9" style="width:100%">${esc(d.draft)}</textarea>
          <div class="row-btns"><button class="btn btn-primary" id="dr-copy">Copy</button></div><p class="muted">AI draft. Check names, amounts and dates before you send it. Nothing has been sent.</p>${factsBlock(d.facts)}</div>`;
        $('dr-copy').onclick = async () => { try { await navigator.clipboard.writeText($('dr-text').value); toast('Copied'); } catch (e) { $('dr-text').select(); toast('Select the text and copy it'); } };
      } catch (e) { aiError($('dr-out'), e); }
      busy($('dr-go'), false);
    };
  }

  // ----- summary -----
  const smKind = () => $('sm-kind').selectedOptions[0].dataset.pick;
  const sp = picker('sm-q', 'sm-results', smKind);
  const smSwitch = () => { const text = $('sm-kind').value === 'text'; $('sm-pickbox').style.display = text ? 'none' : 'block'; $('sm-textbox').style.display = text ? 'block' : 'none'; $('sm-q').value = ''; $('sm-results').innerHTML = ''; sp.state.id = null; if (!text) sp.search(); };
  $('sm-kind').onchange = smSwitch; smSwitch();
  $('sm-go').onclick = async () => {
    const kind = $('sm-kind').value; const body = { kind };
    if (kind === 'text') body.text = $('sm-text').value; else { if (!sp.state.id) { toast('Pick one first'); return; } body.id = sp.state.id; }
    busy($('sm-go'), true);
    try {
      const d = (await api('/api/ai/summary', { method: 'POST', body })).data;
      $('sm-out').innerHTML = `<div class="card" style="margin-top:10px;background:#f8fafc"><p style="white-space:pre-wrap">${esc(d.summary)}</p><p class="muted">AI summary of: ${esc(d.based_on)}. Check anything important.</p>${factsBlock(d.facts)}</div>`;
    } catch (e) { aiError($('sm-out'), e); }
    busy($('sm-go'), false);
  };
}
