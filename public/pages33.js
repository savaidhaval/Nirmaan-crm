// pages33.js — Welcome page, project chooser and project home.
// After login a person lands on Welcome, picks a project, and then sees only that project's modules (and only the screens their role allows).
// Company-wide things (Business Development, people, library, admin, "you") live on the Welcome page. Loaded last, so it wraps every earlier menu.

// Screens that belong to the company, not to one project. Everything else needs a project to be chosen first.
const ORG_ROUTES = new Set(['home', 'welcome', 'dashboard', 'ai', 'insights', 'tasks', 'bd', 'projects', 'team', 'people', 'documents', 'professionals', 'branding', 'sharelinks',
  'users', 'audit', 'datatools', 'storage', 'email', 'settings', 'profile', 'workreport', 'security', 'notifications', 'help', 'password', 'more']);
const ORG_GROUPS = [
  ['Company', ['bd', 'projects', 'tasks', 'ai', 'insights', 'dashboard']],
  ['People', ['team', 'people']],
  ['Library', ['documents', 'professionals', 'branding', 'sharelinks']],
  ['Admin', ['users', 'audit', 'datatools', 'storage', 'email', 'settings']],
  ['You', ['profile', 'workreport', 'security']],
];
Object.assign(ICONS, { projects: ICONS.projects || 'M3 21h18M5 21V7l7-4 7 4v14', welcome: 'M3 11l9-8 9 8M5 10v10h14V10' });

// ---------- the menu: company menu until a project is chosen, then that project's modules ----------
const _sidebarItems33 = sidebarItems;
sidebarItems = function (role) {
  const base = _sidebarItems33(role);
  const all = new Map(); base.forEach(([, items]) => items.forEach((i) => { if (!all.has(i.route)) all.set(i.route, i); }));
  const modules = base.filter(([g]) => g && /^\d\./.test(g)).map(([g, items]) => [g, items.filter((i) => !ORG_ROUTES.has(i.route))]).filter(([, items]) => items.length);
  if (scopeProject) {
    const docs = all.get('documents'); const m1 = modules.find(([g]) => g.startsWith('1.'));
    if (docs && m1 && !m1[1].some((i) => i.route === 'documents')) m1[1].push(docs);   // project files sit with Land & Approvals
    return [[null, [{ label: 'Project home', route: 'home', icon: 'home' }, { label: 'All projects', route: 'welcome', icon: 'welcome' }]], ...modules];
  }
  const out = [[null, [{ label: 'Welcome', route: 'home', icon: 'welcome' }]]];
  ORG_GROUPS.forEach(([name, routes]) => {
    const items = routes.map((r) => { const i = all.get(r); return i ? (r === 'dashboard' ? { ...i, label: 'Company overview' } : i) : null; }).filter(Boolean);
    if (items.length) out.push([name, items]);
  });
  return out;
};
const orgGroupsFor = (role) => { const keep = scopeProject; scopeProject = 0; try { return sidebarItems(role).filter((g) => g[0]); } finally { scopeProject = keep; } };
const projectModulesFor = (role) => { const keep = scopeProject; scopeProject = keep || -1; try { return sidebarItems(role).filter((g) => g[0]); } finally { scopeProject = keep; } };

// ---------- phone tabs ----------
const _bottom33 = getBottomNavItems;
getBottomNavItems = function (role) {
  const menu = { label: 'Menu', route: 'more', icon: 'menu' };
  if (!scopeProject) return [{ label: 'Welcome', route: 'home', icon: 'welcome' }, ...(role === 'owner' ? [{ label: 'Overview', route: 'dashboard', icon: 'dashboard' }] : []), menu];
  const have = new Set(sidebarItems(role).flatMap((g) => g[1]).map((i) => i.route));
  const picks = _bottom33(role).filter((i) => i.route !== 'more' && i.route !== 'home' && i.route !== 'dashboard' && have.has(i.route)).slice(0, 3);
  return [{ label: 'Home', route: 'home', icon: 'home' }, ...picks, menu];
};

// ---------- moving between company and project ----------
const _navigate33 = navigate;
navigate = function (route) {
  if (route === 'welcome') { setScopeProject(0); route = 'home'; }
  else if (!scopeProject && !ORG_ROUTES.has(route)) { toast('Choose a project first.', 3000); route = 'home'; }
  return _navigate33(route);
};
const _logout33 = logout;
logout = async function () { try { sessionStorage.removeItem('nirmaan.welcomed'); } catch (e) { /* ignore */ } setScopeProject(0); return _logout33.apply(this, arguments); };
// a new login starts on the Welcome page, even if the last session ended inside a project
const _renderApp33 = renderApp;
renderApp = function () {
  try { if (currentUser && !sessionStorage.getItem('nirmaan.welcomed')) { sessionStorage.setItem('nirmaan.welcomed', '1'); setScopeProject(0); currentPage = 'home'; } } catch (e) { /* storage blocked: stay where we are */ }
  _renderApp33.apply(this, arguments);
  paintProjectChip();
};
// the old "All projects" drop-down is replaced by the project chip; this only drops a project the person can no longer see
fillProjectPicker = async function () {
  const sel = $('project-picker'); if (sel) sel.hidden = true;
  if (!currentUser || !scopeProject) return;
  try { const ps = await getProjects(); if (!ps.some((p) => p.id === scopeProject)) { setScopeProject(0); renderApp(); } } catch (e) { /* offline: keep it */ }
};
function paintProjectChip() {
  const bar = document.querySelector('.top-right'); if (!bar || !currentUser) return;
  let chip33 = $('proj-chip'); if (chip33) chip33.remove();
  if (!scopeProject) return;
  const p = (projectCache || []).find((x) => x.id === scopeProject);
  if (!projectCache) getProjects().then(() => paintProjectChip()).catch(() => {});   // the name arrives a moment after a reload
  chip33 = document.createElement('button'); chip33.id = 'proj-chip'; chip33.className = 'btn small proj-chip'; chip33.title = 'Change project';
  chip33.innerHTML = `${icon('projects', 16)}<span>${esc(p ? p.name : 'Project')}</span>`;
  chip33.onclick = () => navigate('welcome');
  bar.insertBefore(chip33, bar.firstChild);
}

// ---------- Welcome and project home ----------
const typeLabel33 = (p) => (p.type === 'redevelopment' ? 'Redevelopment' : 'New build');
PAGES.home = (main) => (scopeProject ? renderProjectHome(main) : renderWelcome(main));
PAGES.welcome = PAGES.home;
async function renderWelcome(main) {
  const first = String(currentUser.name || '').trim().split(/\s+/)[0] || 'there';
  const hour = new Date(Date.now() + 19800000).getUTCHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  main.innerHTML = `<h1>${greet}, ${esc(first)}</h1><p class="help">${esc(currentUser.role)} · ${esc(new Date(Date.now() + 19800000).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }))}</p><p class="muted" id="wl-load">Loading your projects…</p>`;
  let projects = []; try { projects = await getProjects(true); } catch (e) { projects = []; }
  if (!$('wl-load')) return;
  const org = orgGroupsFor(currentUser.role);
  const owner = currentUser.role === 'owner', mgr = ['owner', 'pm'].includes(currentUser.role);
  const projCard = (p) => `<button class="card proj-card" data-pick="${p.id}"><b>${esc(p.name)}</b><p class="muted">${esc(p.code || '')} · ${esc(typeLabel33(p))}${p.status && p.status !== 'planning' ? ' · ' + esc(String(p.status).replace(/_/g, ' ')) : ''}</p><span class="btn small btn-primary">Open</span></button>`;
  const orgHtml = org.map(([name, items]) => `<div class="card"><b>${esc(t(name))}</b><div class="row-btns">${items.map((i) => `<button class="btn small" data-org="${i.route}">${esc(t(i.label))}</button>`).join('')}</div></div>`).join('');
  main.innerHTML = `<h1>${greet}, ${esc(first)}</h1><p class="help">${esc(currentUser.role)} · ${esc(new Date(Date.now() + 19800000).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }))}</p>
    <h2>Choose your project</h2>
    ${projects.length ? `<div class="grid">${projects.map(projCard).join('')}</div>` : `<div class="empty-state"><p>${mgr ? 'No project yet. A project starts from Business Development once the society appoints us, or when land is bought.' : 'You are not on any project yet. Ask the Owner to add you.'}</p>${org.some(([, i]) => i.some((x) => x.route === 'bd')) ? '<button class="btn btn-primary" data-org="bd">Open Business Development</button>' : ''}</div>`}
    ${orgHtml ? `<h2>Company</h2>${orgHtml}` : ''}`;
  main.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => { setScopeProject(b.dataset.pick); navigate('home'); }; });
  main.querySelectorAll('[data-org]').forEach((b) => { b.onclick = () => navigate(b.dataset.org); });
}
async function renderProjectHome(main) {
  let projects = []; try { projects = await getProjects(); } catch (e) { projects = []; }
  const p = projects.find((x) => x.id === scopeProject);
  if (!p) { setScopeProject(0); renderWelcome(main); return; }
  const mods = projectModulesFor(currentUser.role);
  const blurb = { '1.': 'Approvals, redevelopment, site readiness', '2.': 'Leads, inventory, brochures', '3.': 'Site, drawings, procurement, contractors', '4.': 'Demands, RERA account, bank, reports', '5.': 'Possession, handover and snags' };
  main.innerHTML = `<button class="btn small" id="ph-back">← All projects</button><h1>${esc(p.name)}</h1><p class="help">${esc(p.code || '')} · ${esc(typeLabel33(p))}</p>
    ${mods.length ? mods.map(([name, items]) => `<div class="card"><b>${esc(name)}</b><p class="muted">${esc(blurb[name.slice(0, 2)] || '')}</p><div class="row-btns">${items.map((i) => `<button class="btn small" data-go="${i.route}">${esc(t(i.label))}</button>`).join('')}</div></div>`).join('') : '<div class="empty-state"><p>Nothing in this project is open to your role yet.</p></div>'}`;
  $('ph-back').onclick = () => navigate('welcome');
  main.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => navigate(b.dataset.go); });
}
