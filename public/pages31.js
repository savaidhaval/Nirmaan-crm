// pages31.js — the menu follows the five CRM modules. Loaded last: it takes whatever menu the earlier screens built and regroups it,
// so no screen is lost. People, Library, Admin and You stay as they were. Module 5 holds Possession & handover and Snags (pages32.js adds them).
Object.assign(ICONS, {
  'g-site': 'M3 21h18M5 21V10l5-4v15M10 10h9v11M13 14h3M13 17h3',
  'g-handover': 'M8 15a4 4 0 110-8 4 4 0 010 8zM11 11h10M18 11v3M21 11v3M4 21h16',
});
const NAV_MODULES = [
  ['1. Land & Approvals', 'g-projects', ['bd', 'projects', 'tasks', 'approvals', 'redevelopment', 'siteboard', 'feasibility']],
  ['2. Pre-Sales & Inventory', 'g-sales', ['sales', 'reception', 'tokens', 'updates', 'stacking', 'brochures', 'enquiryform']],
  ['3. Site & Contractors', 'g-site', ['drawings', 'site', 'quality', 'stores', 'procurement', 'contractors', 'budget', 'boq', 'petty']],
  ['4. Collections & RERA', 'g-money', ['demandletters', 'rera', 'bank', 'tally', 'finance', 'reports']],
  ['5. Possession & Society', 'g-handover', ['possession', 'snags']],
];
// the open/closed state and icons look the group up by name
NAV_MODULES.forEach(([name, ic]) => { if (!NAV_GROUPS.some((g) => g[0] === name)) NAV_GROUPS.push([name, ic, []]); });
const _sidebarItems31 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems31(role);
  const all = groups.flatMap(([g, items]) => items.map((i) => [g, i]));
  const claimed = new Set(NAV_MODULES.flatMap((m) => m[2]));
  const out = groups.filter((g) => g[0] === null).map((g) => [null, g[1].slice()]);
  const top = new Set(out.flatMap((g) => g[1].map((i) => i.route)));   // a screen already at the top is not repeated in a module
  NAV_MODULES.forEach(([name, , routes]) => {
    const items = routes.filter((r) => !top.has(r)).map((r) => (all.find(([, i]) => i.route === r) || [])[1]).filter(Boolean);
    if (items.length) out.push([name, items]);
  });
  // everything else keeps its own heading (People, Library, Admin, You, More); a screen no module claims is never lost
  const rest = new Map();
  all.forEach(([g, i]) => { if (g === null || claimed.has(i.route) || top.has(i.route)) return; const k = ['Projects', 'Money', 'Sales'].includes(g) ? 'More' : g; if (!rest.has(k)) rest.set(k, []); rest.get(k).push(i); });
  groups.forEach(([g]) => { if (g !== null && rest.has(g)) out.push([g, rest.get(g)]); });
  if (rest.has('More') && !out.some((o) => o[0] === 'More')) out.push(['More', rest.get('More')]);
  return out;
};
