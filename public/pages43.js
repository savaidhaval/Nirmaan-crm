// pages43.js — loaded last: inside a project, keep only the modules that apply to it (after every other screen has joined the menu).
// Redevelopment screens only on a redevelopment project; while the project has not started (no appointment letter / sale deed yet)
// only Land & Approvals. The server refuses new work in the other modules too (src/core/projgate.js).
const _sidebarItems43 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems43(role);
  const p = scopeProject > 0 ? curProject33() : null;
  if (!p) { LOCKED33 = new Set(); return groups; }
  const pending = notStarted33(p);
  LOCKED33 = new Set(pending ? groups.filter(([g]) => g && !g.startsWith('1.')).flatMap(([, items]) => items.map((i) => i.route)) : []);
  return groups.map(([g, items]) => [g, items.filter((i) => (g === null || !LOCKED33.has(i.route)) && (p.type === 'redevelopment' || !REDEV_ONLY33.has(i.route)))]).filter(([g, items]) => g === null || items.length);
};
