// pages5.js — Finance (project financials, late interest, TDS), data import, two-step sign-in, privacy tools.
// Loaded after pages4.js.

Object.assign(ICONS, {
  finance: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  tools: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.1-.6-.6-2.1z',
  shield: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z',
});
Object.assign(ROUTE_TITLES, { finance: 'Finance', datatools: 'Import & privacy', security: 'Two-step sign-in' });
Object.assign(PAGES, { finance: renderFinance, datatools: renderDataTools, security: renderSecurity });

const _sidebarItems5 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems5(role).map(([g, items]) => [g, [...items]]);
  const add = (label, route, icon) => groups[groups.length - 1][1].push({ label, route, icon });
  if (['owner', 'pm', 'accounts'].includes(role)) add('Finance', 'finance', 'finance');
  if (['owner', 'pm'].includes(role)) add('Import & privacy', 'datatools', 'tools');
  add('Two-step sign-in', 'security', 'shield');
  return groups;
};

const isMoneyRole = () => ['owner', 'pm', 'accounts'].includes(currentUser.role);
const kvRow = (pairs) => `<div class="kv">${pairs.map(([k, v]) => `<span>${esc(k)}</span><b>${v}</b>`).join('')}</div>`;
const tabBar = (tabs, cur) => `<div class="tabs">${tabs.map(([k, l]) => `<button class="tab${cur === k ? ' on' : ''}" data-tab5="${k}">${esc(l)}</button>`).join('')}</div>`;

// ---------------------------------------------------------------- login: second step
const _renderLogin5 = renderLogin;
renderLogin = function () {
  _renderLogin5();
  const err = (m) => { const e = $('login-error'); e.textContent = m; e.style.display = 'block'; };
  const go = async () => {
    $('login-error').style.display = 'none';
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: { email: $('login-email').value.trim(), password: $('login-password').value } });
      if (r.data && r.data.mfa_required) return mfaStep(r.data.mfa_token);
      await loadUser();
    } catch (e) { err(e.message); }
  };
  $('login-btn').onclick = go;
  $('login-password').onkeydown = (e) => { if (e.key === 'Enter') go(); };
};
function mfaStep(token) {
  $('app-main').innerHTML = `<div class="login-card"><img class="login-logo" src="/identity/logo-horizontal.png" alt="Nirman: Construction CRM" width="300" height="61">
    <h1>Two-step sign-in</h1><p class="sub">Open your authenticator app and type the 6-digit code. Lost your phone? Use one of your recovery codes.</p>
    <div class="field"><label for="mfa-code">Code</label><input id="mfa-code" autocomplete="one-time-code" inputmode="text" maxlength="12" placeholder="123456"></div>
    <div class="error" id="mfa-error" style="display:none"></div>
    <button class="btn btn-primary btn-full" id="mfa-go">Verify</button>
    <p class="help" style="text-align:center;margin-top:14px"><a href="#" id="mfa-back">Back to sign in</a></p></div>`;
  $('mfa-code').focus();
  const go = async () => {
    try { await api('/api/auth/mfa/verify', { method: 'POST', body: { mfa_token: token, code: $('mfa-code').value.trim() } }); await loadUser(); }
    catch (e) { const x = $('mfa-error'); x.textContent = e.message; x.style.display = 'block'; }
  };
  $('mfa-go').onclick = go; $('mfa-code').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  $('mfa-back').onclick = (e) => { e.preventDefault(); renderLogin(); };
}

// force enrolment when the Owner has made two-step mandatory for this role
const _renderApp5 = renderApp;
renderApp = function () {
  _renderApp5();
  api('/api/auth/me').then((r) => { if (r.data.mfa_enroll_required) { navigate('security'); toast('Your role must turn on two-step sign-in before you continue.', 7000); } }).catch(() => {});
};

// ---------------------------------------------------------------- security screen
async function renderSecurity(main) {
  main.innerHTML = '<h1>Two-step sign-in</h1><div id="sec-out" class="card" style="max-width:640px">Loading…</div>';
  const draw = async () => {
    const o = $('sec-out'); if (!o) return;
    const s = (await api('/api/auth/totp/status')).data;
    let owner = '';
    if (currentUser.role === 'owner') {
      const cur = (await api('/api/settings')).data.settings['security.require_mfa_roles'];
      const roles = ['owner', 'pm', 'accounts', 'sales', 'site', 'viewer'];
      let sel = []; try { sel = Array.isArray(cur) ? cur : JSON.parse(cur || '[]'); } catch (e) { sel = []; }
      owner = `<hr><h2>Require it for</h2><p class="muted">People in these roles cannot use the CRM until they turn on two-step sign-in.</p>
        <div>${roles.map((r) => `<label class="check"><input type="checkbox" data-mfarole="${r}"${sel.includes(r) ? ' checked' : ''}> ${esc(r)}</label>`).join('')}</div>
        <button class="btn" id="mfa-save-roles" style="margin-top:8px">Save</button>`;
    }
    if (s.enrolled) {
      o.innerHTML = `<p>${chip('On', 'good')} Your account asks for a code from your authenticator app at sign-in.</p><p class="muted">Recovery codes left: <b>${s.recovery_left}</b></p>
        <button class="btn" id="mfa-off" style="color:#dc2626">Turn off</button>${owner}`;
      $('mfa-off').onclick = async () => {
        const v = await openForm({ title: 'Turn off two-step sign-in', intro: 'Enter a current code or a recovery code.', fields: [{ name: 'code', label: 'Code', required: true }], submit: 'Turn off' });
        if (v && await act(api('/api/auth/totp/disable', { method: 'POST', body: v }), 'Turned off')) draw();
      };
    } else {
      o.innerHTML = `<p>${chip('Off', 'warn')} ${s.required ? '<b>Required for your role.</b> ' : ''}Add a second step with Google Authenticator, Microsoft Authenticator or any similar app.</p>
        <button class="btn btn-primary" id="mfa-on">Set up</button><div id="mfa-setup"></div>${owner}`;
      $('mfa-on').onclick = async () => {
        const d = await act(api('/api/auth/totp/setup', { method: 'POST', body: {} })); if (!d) return;
        $('mfa-setup').innerHTML = `<ol style="margin:12px 0 0 18px"><li>In your app, add an account <b>manually</b> and type this key:<br><code style="font-size:15px;word-break:break-all">${esc(d.data.secret)}</code>
          <button class="btn small" id="mfa-copy">Copy</button> or <a href="${esc(d.data.uri)}">open in the app</a> (phone).</li>
          <li>Type the 6-digit code it shows:</li></ol>
          <div class="field"><input id="mfa-first" inputmode="numeric" maxlength="6" placeholder="123456"></div><button class="btn btn-primary" id="mfa-confirm">Turn on</button>`;
        $('mfa-copy').onclick = () => copyText(d.data.secret);
        $('mfa-confirm').onclick = async () => {
          const r = await act(api('/api/auth/totp/enable', { method: 'POST', body: { code: $('mfa-first').value.trim() } })); if (!r) return;
          o.innerHTML = `<h2>Save your recovery codes</h2><p class="muted">Each works once if you lose your phone. They are shown only now — print or store them safely.</p>
            <pre style="font-size:16px;line-height:1.7;background:#f8fafc;padding:12px;border-radius:8px">${r.data.recovery_codes.map(esc).join('\n')}</pre>
            <button class="btn" id="rc-copy">Copy</button> <button class="btn btn-primary" id="rc-done">I have saved them</button>`;
          $('rc-copy').onclick = () => copyText(r.data.recovery_codes.join('\n')); $('rc-done').onclick = () => { draw(); navigate('home'); };
        };
      };
    }
    const sv = $('mfa-save-roles');
    if (sv) sv.onclick = async () => { const roles = [...o.querySelectorAll('[data-mfarole]')].filter((c) => c.checked).map((c) => c.dataset.mfarole); await act(api('/api/settings/security.require_mfa_roles', { method: 'POST', body: { value: roles } }), 'Saved'); };
  };
  draw().catch((e) => { const o = $('sec-out'); if (o) o.textContent = e.message; });
}

// users admin: reset someone's second step
const _loadUsers5 = loadUsers;
loadUsers = async function () {
  await _loadUsers5();
  const list = $('users-list'); if (!list || currentUser.role !== 'owner') return;
  list.querySelectorAll('[data-act="reset"]').forEach((b) => {
    const m = document.createElement('button'); m.className = 'btn small'; m.textContent = 'Reset 2-step'; m.dataset.id = b.dataset.id;
    m.onclick = async () => { if (confirm('Remove two-step sign-in for ' + (b.dataset.name || 'this user') + '? They will sign in with password only until they set it up again.')) await act(api(`/api/users/${m.dataset.id}/reset-mfa`, { method: 'POST', body: {} }), 'Two-step reset'); };
    b.after(m);
  });
};

// ---------------------------------------------------------------- finance screen
let finTab = 'fin';
function renderFinance(main) {
  const tabs = [['fin', 'Project financials'], ['int', 'Late interest'], ...(['owner', 'accounts'].includes(currentUser.role) ? [['tds', 'TDS & Tally']] : [])];
  if (!tabs.some((x) => x[0] === finTab)) finTab = 'fin';
  main.innerHTML = `<h1>Finance</h1>${tabBar(tabs, finTab)}<div id="fin-out">Loading…</div>`;
  main.querySelectorAll('[data-tab5]').forEach((b) => { b.onclick = () => { finTab = b.dataset.tab5; renderFinance(main); }; });
  ({ fin: finProject, int: finInterest, tds: finTds })[finTab]().catch((e) => { const o = $('fin-out'); if (o) o.innerHTML = `<div class="error">${esc(e.message)}</div>`; });
}

async function finProject() {
  const projects = await getProjects(); const o = $('fin-out');
  const pid = scopeProject || (projects[0] && projects[0].id);
  if (!pid) { o.innerHTML = '<p class="muted">No projects yet.</p>'; return; }
  const d = (await api('/api/reports/project-financials?project_id=' + pid)).data;
  const c = d.cost, s = d.sales, p = d.projection, r = d.rera;
  const bar = (label, v, max, col) => `<div class="agerow"><span>${esc(label)}</span><div class="bar-track"><div style="width:${max ? Math.min(100, Math.round((v * 100) / max)) : 0}%;background:${col};height:100%;border-radius:6px"></div></div><b>${moneyP(v)}</b></div>`;
  o.innerHTML = `<p class="muted">${esc(d.project)} · certified completion <b>${d.percent_complete}%</b> ${['owner', 'pm'].includes(currentUser.role) ? '<button class="btn small" id="fin-edit">Update</button>' : ''}</p>
    ${d.flags.map((f) => `<div class="card" style="border-left:4px solid #f59e0b">${esc(f)}</div>`).join('')}
    <div class="grid2"><div class="card"><h2>Cost against budget</h2>
      ${bar('Budget', c.budget_paise, Math.max(c.budget_paise, c.committed_paise), '#94a3b8')}${bar('Committed (approved POs)', c.committed_paise, Math.max(c.budget_paise, c.committed_paise), '#3b82f6')}${bar('Billed', c.billed_paise, Math.max(c.budget_paise, c.committed_paise), '#f59e0b')}${bar('Paid (gross)', c.paid_gross_paise, Math.max(c.budget_paise, c.committed_paise), '#16a34a')}
      ${kvRow([['Not yet committed', c.uncommitted_budget_paise == null ? '—' : moneyP(c.uncommitted_budget_paise)], ['POs awaiting approval', moneyP(c.pending_po_paise)], ['Bills unpaid', moneyP(c.unpaid_bills_paise)], ['TDS deducted', moneyP(c.tds_deducted_paise)]])}</div>
    <div class="card"><h2>Sales & collections</h2>${kvRow([['Bookings', s.bookings], ['Booked value', moneyP(s.booked_value_paise)], ['Unsold at list price', moneyP(s.unsold_list_paise)], ['Collected (principal)', moneyP(s.collected_paise)], ['Collected %', s.collected_pct == null ? '—' : s.collected_pct + '%'], ['Receivable', moneyP(s.receivable_paise)]])}</div></div>
    <div class="grid2"><div class="card"><h2>Margin projection</h2>${kvRow([['Revenue (booked + unsold)', moneyP(p.revenue_paise)], ['Cost (budget or committed)', moneyP(p.cost_paise)], ['Margin', `<span style="color:${p.margin_paise < 0 ? '#dc2626' : '#166534'}">${moneyP(p.margin_paise)}${p.margin_pct == null ? '' : ' · ' + p.margin_pct + '%'}</span>`]])}</div>
    <div class="card"><h2>RERA withdrawal estimate</h2>${kvRow([['In designated account', moneyP(r.designated_collected_paise)], ['Can withdraw (estimate)', moneyP(r.eligible_withdrawal_paise)]])}<p class="muted">${esc(r.note)}</p></div></div>`;
  const ed = $('fin-edit');
  if (ed) ed.onclick = async () => {
    const v = await openForm({ title: 'Project progress & budget', intro: 'Completion is what your engineer / architect certifies.', fields: [{ name: 'percent_complete', label: 'Certified completion %', type: 'number', value: d.percent_complete, required: true }, { name: 'budget_paise', label: 'Total cost budget (₹)', type: 'money', value: c.budget_paise ? String(c.budget_paise / 100) : '' }] });
    if (!v) return; const body = { percent_complete: v.percent_complete }; if (v.budget_paise) body.budget_paise = v.budget_paise;
    if (await act(api('/api/projects/' + pid, { method: 'PUT', body }), 'Saved')) { projectCache = null; finProject(); }
  };
}

async function finInterest() {
  const o = $('fin-out'); const pid = scopeProject ? '?project_id=' + scopeProject : '';
  const d = (await api('/api/reports/interest' + pid)).data;
  o.innerHTML = `<div class="card"><h2>Interest on late payments</h2><p class="muted">Simple interest at ${(d.rate_bp / 100).toFixed(2)}% a year on overdue demands. ${d.enabled ? '' : '<b>Switched off.</b>'} Waived interest and interest already paid are deducted.</p>
    ${kvRow([['Accrued', moneyP(d.totals.accrued)], ['Waived', moneyP(d.totals.waived)], ['Paid', moneyP(d.totals.paid)], ['Due', `<b>${moneyP(d.totals.due)}</b>`]])}
    ${currentUser.role === 'owner' ? '<button class="btn small" id="int-set">Rate & grace</button>' : ''}</div>
    <div class="card"><h2>By booking</h2>${d.rows.length ? d.rows.map((x) => `<div class="row" style="margin:6px 0"><div><b>${esc(x.customer)}</b> <span class="muted">${esc(x.flat)} · ${esc(x.project || '')}</span></div><div>${moneyP(x.due)} <button class="btn small" data-bk="${x.booking_id}">Open</button></div></div>`).join('') : '<p class="muted">No interest due.</p>'}</div>`;
  o.querySelectorAll('[data-bk]').forEach((b) => { b.onclick = () => bookingDetail(Number(b.dataset.bk)); });
  const st = $('int-set');
  if (st) st.onclick = async () => {
    const v = await openForm({ title: 'Late-payment interest', intro: 'RERA rule is SBI highest MCLR + 2%. Confirm the current figure with your advocate.', fields: [{ name: 'rate', label: 'Interest % a year', type: 'number', value: d.rate_bp / 100, required: true }, { name: 'grace', label: 'Grace days', type: 'number', value: 0 }, { name: 'enabled', label: 'On', type: 'checkbox', checkLabel: 'Charge interest', value: d.enabled }] });
    if (!v) return;
    await act(Promise.all([api('/api/settings/interest.rate_bp', { method: 'POST', body: { value: Math.round(v.rate * 100) } }), api('/api/settings/interest.grace_days', { method: 'POST', body: { value: v.grace || 0 } }), api('/api/settings/interest.enabled', { method: 'POST', body: { value: v.enabled ? 'on' : 'off' } })]), 'Saved'); finInterest();
  };
}

async function finTds() {
  const o = $('fin-out'); const d = (await api('/api/reports/tds')).data;
  o.innerHTML = `<div class="card"><h2>TDS to deposit</h2><p class="muted">${esc(d.note)}</p>${kvRow([['Pending', moneyP(d.pending_paise)], ['Overdue bills', d.overdue_count]])}</div>
    <div class="card"><h2>Tally exports</h2><p class="muted">CSV files to import as vouchers into Tally.</p><a class="btn" href="/api/export/tally/receipts" download>Receipts</a> <a class="btn" href="/api/export/tally/purchases" download>Purchases</a></div>
    <div class="card"><h2>Deductions</h2>${d.rows.length ? d.rows.map((x) => `<div class="row" style="margin:8px 0"><div><b>${esc(x.vendor)}</b> <span class="muted">${esc(x.bill_no || '')} · ${esc(x.tds_section || '')} · ${esc(x.quarter)} · due ${esc(x.due_date)}</span>${x.has_pan ? '' : ' ' + chip('no PAN · 20%', 'bad')}</div>
      <div>${moneyP(x.tds_paise)} ${x.tds_deposited_on ? chip('Deposited ' + x.tds_deposited_on, 'good') : `${x.overdue ? chip('Overdue', 'bad') : ''} <button class="btn small" data-dep="${x.id}">Record deposit</button>`}</div></div>`).join('') : '<p class="muted">No TDS yet.</p>'}</div>`;
  o.querySelectorAll('[data-dep]').forEach((b) => {
    b.onclick = async () => {
      const v = await openForm({ title: 'TDS deposit', fields: [{ name: 'challan', label: 'Challan (BSR code / serial)', required: true }, { name: 'deposited_on', label: 'Deposited on', type: 'date', value: new Date().toISOString().slice(0, 10) }] });
      if (v && await act(api(`/api/procurement/bills/${b.dataset.dep}/tds-deposit`, { method: 'POST', body: v }), 'Recorded')) finTds();
    };
  });
}

// vendor bill form with GST + TDS
addBill = async function (poId, vendorId) {
  const v = await openForm({ title: 'Record vendor bill', intro: 'Enter the bill total including GST. TDS is worked out on the amount before GST.', fields: [
    { name: 'bill_no', label: 'Vendor invoice no.', required: true }, { name: 'amount_paise', label: 'Bill total incl. GST (₹)', type: 'money', required: true },
    { name: 'gst_paise', label: 'GST in it (₹)', type: 'money' }, { name: 'tds_section', label: 'TDS section', type: 'select', options: [['194C', '194C contractor'], ['194J', '194J professional'], ['194I', '194I rent'], ['194Q', '194Q goods'], ['', 'No TDS']], value: '194C' },
    { name: 'tds_pct', label: 'TDS % (1 / 2 / 10)', type: 'number', value: 1 }, { name: 'due_date', label: 'Payment due', type: 'date' }], submit: 'Save bill' });
  if (!v) return;
  const body = { po_id: Number(poId), vendor_id: Number(vendorId), bill_no: v.bill_no, amount_paise: v.amount_paise, gst_paise: v.gst_paise || 0, due_date: v.due_date || undefined };
  if (v.tds_section) { body.tds_section = v.tds_section; body.tds_bp = Math.round((v.tds_pct || 0) * 100); }
  const r = await act(api('/api/procurement/bills', { method: 'POST', body }), 'Bill recorded');
  if (r && r.data && r.data.on_hold) toast(`Saved but ON HOLD: ${r.data.hold_reason} The PM must check and release it before payment.`, 9000);
  if (r) { if (r.data.note) toast(r.data.note, 7000); if (typeof loadProcurement === 'function') loadProcurement(); else navigate('procurement'); }
};

// ---------------------------------------------------------------- booking: interest panel + statement
const _bookingDetail5 = bookingDetail;
bookingDetail = async function (id) {
  await _bookingDetail5(id);
  const modals = document.querySelectorAll('.modal-overlay .modal'); const m = modals[modals.length - 1]; if (!m) return;
  const box = document.createElement('div'); box.className = 'card'; box.innerHTML = '<h3>Late interest</h3><p class="muted">Loading…</p>';
  const actions = m.querySelector('.modal-actions'); m.insertBefore(box, actions);
  try {
    const it = (await api(`/api/sales/bookings/${id}/interest`)).data;
    const canMoney = ['owner', 'pm', 'accounts'].includes(currentUser.role);
    box.innerHTML = `<h3>Late interest</h3>${it.enabled ? '' : '<p class="muted">Interest is switched off.</p>'}
      ${kvRow([['Accrued', moneyP(it.accrued)], ['Waived', moneyP(it.waived)], ['Paid', moneyP(it.paid)], ['Due', `<b>${moneyP(it.due)}</b>`]])}
      ${it.demands.map((x) => `<p class="muted">${esc(x.label)}: ${x.days_late} days late · ${moneyP(x.accrued_paise)}${x.waived_paise ? ' (waived ' + moneyP(x.waived_paise) + ')' : ''} ${canMoney ? `<button class="btn small" data-waive="${x.demand_id}">${currentUser.role === 'owner' ? 'Waive' : 'Ask to waive'}</button>` : ''}</p>`).join('')}
      ${it.waivers.filter((w) => w.status === 'requested').map((w) => `<p>${chip('Waiver asked', 'warn')} ${moneyP(w.amount_paise)} — ${esc(w.reason)} ${currentUser.role === 'owner' ? `<button class="btn small" data-wok="${w.id}">Approve</button> <button class="btn small" data-wno="${w.id}">Reject</button>` : ''}</p>`).join('')}
      <div class="row-btns" style="margin-top:8px">${['owner', 'accounts'].includes(currentUser.role) && it.due > 0 ? '<button class="btn small" id="int-rcpt">Record interest receipt</button>' : ''}<button class="btn small" id="stmt">Statement of account</button></div>
      <p class="muted" style="font-size:12px">${esc(it.note)}</p>`;
    $('stmt').onclick = () => openPrint('statement', id);
    const refresh = () => { document.querySelectorAll('.modal-overlay').forEach((x) => x.remove()); bookingDetail(id); };
    box.querySelectorAll('[data-waive]').forEach((b) => { b.onclick = async () => {
      const v = await openForm({ title: 'Waive interest', intro: currentUser.role === 'owner' ? 'Enter your approval PIN: every waiver is signed with it.' : 'The Owner will approve it with the approval PIN.', fields: [{ name: 'amount_paise', label: 'Amount to waive (₹)', type: 'money', required: true }, { name: 'reason', label: 'Reason', required: true }, ...(currentUser.role === 'owner' ? [{ name: 'pin', label: 'Approval PIN (6 digits)', type: 'password', required: true }] : [])] });
      if (v && await act(api(`/api/sales/demands/${b.dataset.waive}/interest-waiver`, { method: 'POST', body: v }), currentUser.role === 'owner' ? 'Waived' : 'Sent to the Owner')) refresh(); }; });
    box.querySelectorAll('[data-wok]').forEach((b) => { b.onclick = async () => { const v = await openForm({ title: 'Approve the waiver', intro: 'Enter your approval PIN.', fields: [{ name: 'pin', label: 'Approval PIN (6 digits)', type: 'password', required: true }] }); if (v && await act(api(`/api/sales/waivers/${b.dataset.wok}/approve`, { method: 'POST', body: { pin: v.pin } }), 'Approved')) refresh(); }; });
    box.querySelectorAll('[data-wno]').forEach((b) => { b.onclick = async () => { if (await act(api(`/api/sales/waivers/${b.dataset.wno}/reject`, { method: 'POST', body: {} }), 'Rejected')) refresh(); }; });
    const ir = $('int-rcpt');
    if (ir) ir.onclick = async () => {
      const v = await openForm({ title: 'Interest receipt', intro: 'Interest paid by the customer. It does not reduce the principal due.', fields: [{ name: 'amount_paise', label: 'Amount (₹)', type: 'money', value: String(it.due / 100), required: true }, { name: 'mode', label: 'Mode', type: 'select', options: [['bank', 'Bank transfer'], ['cheque', 'Cheque'], ['upi', 'UPI']] }, { name: 'ref_no', label: 'Reference / UTR', required: true }] });
      if (v && await act(api(`/api/sales/bookings/${id}/receipts`, { method: 'POST', body: { ...v, kind: 'interest' } }), 'Receipt saved')) refresh();
    };
  } catch (e) { box.innerHTML = `<h3>Late interest</h3><p class="muted">${esc(e.message)}</p>`; }
};

// ---------------------------------------------------------------- data import + privacy
let toolTab = 'imp';
function renderDataTools(main) {
  const tabs = [['imp', 'Import from CSV'], ...(currentUser.role === 'owner' ? [['priv', 'Privacy requests']] : [])];
  if (!tabs.some((x) => x[0] === toolTab)) toolTab = 'imp';
  main.innerHTML = `<h1>Import & privacy</h1>${tabBar(tabs, toolTab)}<div id="tool-out"></div>`;
  main.querySelectorAll('[data-tab5]').forEach((b) => { b.onclick = () => { toolTab = b.dataset.tab5; renderDataTools(main); }; });
  (toolTab === 'imp' ? toolImport : toolPrivacy)();
}

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false; text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((c) => c.trim() !== '')) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some((c) => c.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}
const IMPORT_KINDS = {
  inventory: { label: 'Flats (inventory)', chunk: 100, cols: 'project_code,wing,floor,unit_no,type,price,rera_carpet_sqft', sample: 'ABC1,A,3,301,2BHK,"1,25,00,000",650' },
  vendors: { label: 'Vendors', chunk: 100, cols: 'name,phone,email,gstin,pan,address', sample: 'Sai Steel Traders,9820012345,,27ABCDE1234F1Z5,ABCDE1234F,Vikhroli' },
  leads: { label: 'Leads', chunk: 8, cols: 'name,phone,email,project_code,source,consent', sample: 'Rahul Mehta,9820098200,,ABC1,99acres,yes' },
};
function toolImport() {
  const o = $('tool-out');
  o.innerHTML = `<div class="card" style="max-width:720px"><h2>Bring in a spreadsheet</h2><p class="muted">Save your Excel sheet as <b>CSV</b>, choose what it holds, and upload. You see every row checked before anything is saved.</p>
    <div class="field"><label>What is in the file?</label><select id="imp-kind">${Object.entries(IMPORT_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></div>
    <p class="muted" id="imp-cols"></p><button class="btn small" id="imp-tpl">Download template</button>
    <div class="field" style="margin-top:12px"><label>CSV file</label><input type="file" id="imp-file" accept=".csv,text/csv"></div>
    <div id="imp-out"></div></div>`;
  const kind = () => $('imp-kind').value;
  const cols = () => { $('imp-cols').innerHTML = 'Columns: <code>' + esc(IMPORT_KINDS[kind()].cols) + '</code>'; }; cols(); $('imp-kind').onchange = () => { cols(); $('imp-out').innerHTML = ''; };
  $('imp-tpl').onclick = () => { const k = IMPORT_KINDS[kind()]; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([k.cols + '\n' + k.sample + '\n'], { type: 'text/csv' })); a.download = kind() + '-template.csv'; a.click(); };
  const run = async (rows, dry, onProgress) => {
    const k = IMPORT_KINDS[kind()]; const all = []; let created = 0;
    for (let i = 0; i < rows.length; i += k.chunk) {
      const r = (await api('/api/import/' + kind(), { method: 'POST', body: { rows: rows.slice(i, i + k.chunk), dry_run: dry } })).data;
      r.results.forEach((x) => all.push({ ...x, row: i + x.row })); created += r.created; onProgress(Math.min(i + k.chunk, rows.length), rows.length);
    }
    return { all, created };
  };
  $('imp-file').onchange = async (ev) => {
    const out = $('imp-out'); const f = ev.target.files[0]; if (!f) return;
    if (f.size > 2 * 1024 * 1024) { out.innerHTML = '<div class="error">File is too big (limit 2 MB). Split it.</div>'; return; }
    const rows = parseCsv(await f.text()); if (!rows.length) { out.innerHTML = '<div class="error">No rows found. Is the first line the column names?</div>'; return; }
    out.innerHTML = '<p class="muted">Checking…</p>';
    try {
      const chk = await run(rows, true, (a, b) => { out.innerHTML = `<p class="muted">Checking ${a} of ${b}…</p>`; });
      const bad = chk.all.filter((x) => !x.ok);
      out.innerHTML = `<p>${chip(chk.all.length - bad.length + ' ready', 'good')} ${bad.length ? chip(bad.length + ' with problems', 'bad') : ''}</p>
        ${bad.length ? `<div style="max-height:220px;overflow:auto">${bad.slice(0, 100).map((x) => `<p class="muted">Row ${x.row}: ${esc(x.error)}</p>`).join('')}</div><p class="muted">Rows with problems are skipped. Fix them in your sheet and upload again, or go ahead with the rest.</p>` : ''}
        ${chk.all.length - bad.length ? `<button class="btn btn-primary" id="imp-go">Import ${chk.all.length - bad.length} rows</button>` : ''}`;
      const go = $('imp-go');
      if (go) go.onclick = async () => {
        go.disabled = true;
        try { const r = await run(rows, false, (a, b) => { go.textContent = `Importing ${a} of ${b}…`; }); out.innerHTML = `<p>${chip(r.created + ' imported', 'good')}</p>`; toast(r.created + ' imported'); projectCache = null; }
        catch (e) { out.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
      };
    } catch (e) { out.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };
}

function toolPrivacy() {
  const o = $('tool-out');
  o.innerHTML = `<div class="card" style="max-width:720px"><h2>Customer data requests (DPDP)</h2><p class="muted">A customer can ask for a copy of their data or ask you to erase it. Cancelled bookings and old leads can be erased; money records and receipts are kept as the law requires.</p>
    <div class="field"><label>Customer mobile</label><input id="pv-phone" inputmode="numeric" placeholder="10-digit mobile"></div><button class="btn btn-primary" id="pv-find">Find</button><div id="pv-out" style="margin-top:12px"></div></div>`;
  $('pv-find').onclick = async () => {
    const out = $('pv-out'); const r = await act(api('/api/privacy/find?phone=' + encodeURIComponent($('pv-phone').value.trim()))); if (!r) return;
    const rec = [...r.data.bookings.map((b) => ({ t: 'booking', id: b.id, label: `Booking · ${b.customer_name} · ${b.wing || ''}-${b.unit_no} · ${b.status}`, erased: b.erased_at })), ...r.data.leads.map((l) => ({ t: 'lead', id: l.id, label: `Lead · ${l.name} · ${l.status}`, erased: l.erased_at }))];
    out.innerHTML = rec.length ? rec.map((x) => `<div class="row" style="margin:8px 0"><div>${esc(x.label)} ${x.erased ? chip('erased', 'info') : ''}</div><div>${x.erased ? '' : `<a class="btn small" href="/api/privacy/export?${x.t}_id=${x.id}" download>Export</a> <button class="btn small" style="color:#dc2626" data-er="${x.t}:${x.id}">Erase</button>`}</div></div>`).join('') : '<p class="muted">Nothing found for that number.</p>';
    out.querySelectorAll('[data-er]').forEach((b) => { b.onclick = async () => {
      const [t, id] = b.dataset.er.split(':');
      const v = await openForm({ title: 'Erase personal data', intro: 'Name, phone, email, address and PAN are removed. Amounts and receipts stay. This cannot be undone.', fields: [{ name: 'reason', label: 'Reason / request reference', required: true }], submit: 'Erase' });
      if (v && await act(api('/api/privacy/erase', { method: 'POST', body: { [t + '_id']: Number(id), reason: v.reason } }), 'Erased')) $('pv-find').click();
    }; });
  };
}
