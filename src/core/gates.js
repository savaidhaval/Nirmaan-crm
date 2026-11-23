// core/gates.js — the approvals that must exist before work, sales, demands or possession can go ahead.
// One query per project reads the approval list; everything else is worked out here. Read-only.

// What kind of approval an item is: its gate_key, or worked out from its name for items made before gate_key existed.
export function gateOf(item) {
  if (item.gate_key) return item.gate_key;
  const n = String(item.name || '').toLowerCase();
  if (/maharera registration|rera registration/.test(n)) return 'rera_reg';
  if (/fire completion|fire.*final/.test(n)) return 'fire_final';
  if (/occupa|\(oc\)|\boc\b/.test(n)) return 'oc';
  if (/building completion|\bbcc\b/.test(n)) return 'bcc';
  if (/plinth/.test(n)) return 'plinth_cc';
  if (/further cc|stage-wise further/.test(n)) return 'further_cc';
  if (/commencement certificate|\(cc\)/.test(n)) return 'cc';
  if (/\biod\b/.test(n) && !/compliance|conditions/.test(n)) return 'iod';
  return null;
}
export const GATE_LABEL = { iod: 'IOD', cc: 'Commencement Certificate (CC)', plinth_cc: 'Plinth CC', further_cc: 'Further CC', rera_reg: 'MahaRERA registration', fire_final: 'Fire completion NOC', bcc: 'Building Completion Certificate', oc: 'Occupancy Certificate (OC)' };
// Usual order in Mumbai: [gate, gates it needs first]. Used to link approvals when a checklist is loaded.
export const GATE_DEPS = { cc: ['iod'], plinth_cc: ['cc'], further_cc: ['plinth_cc'], rera_reg: ['cc'], oc: ['further_cc', 'fire_final'] };

export async function approvalState(env, projectId) {
  const rows = (await env.DB.prepare('SELECT id, name, gate_key, status, approved_on, letter_date, cc_upto_floor, wing FROM apr_items WHERE project_id = ? AND deleted_at IS NULL').bind(projectId).all()).results;
  const items = rows.map((r) => ({ ...r, gate: gateOf(r) }));
  const approved = (g, wing) => items.filter((i) => i.gate === g && i.status === 'approved' && (!i.wing || !wing || i.wing === wing));
  return {
    items,
    has: (g) => items.some((i) => i.gate === g),
    approved: (g, wing) => approved(g, wing).length > 0,
    // highest floor allowed by an approved CC / further CC for this wing (null = none recorded)
    ccUpto: (wing) => { const f = [...approved('cc', wing), ...approved('plinth_cc', wing), ...approved('further_cc', wing)].map((i) => i.cc_upto_floor).filter((x) => x != null); return f.length ? Math.max(...f) : null; },
    // OC date for a wing: a part OC for that wing or a full OC
    ocDate: (wing) => { const d = approved('oc', wing).map((i) => i.letter_date || i.approved_on).filter(Boolean).sort(); return d.length ? String(d[0]).slice(0, 10) : null; },
  };
}

// Sales may start only after MahaRERA registration: the project has its number, and the registration item (if listed) is approved.
export async function saleBlock(env, projectId) {
  const p = await env.DB.prepare('SELECT rera_no FROM projects WHERE id = ?').bind(projectId).first();
  if (!p || !String(p.rera_no || '').trim()) return 'This project has no MahaRERA registration number yet. Bookings, cost sheets and demands open only after registration (add the number in Projects → Details).';
  const st = await approvalState(env, projectId);
  if (st.has('rera_reg') && !st.approved('rera_reg')) return 'MahaRERA registration is not marked approved in Approvals. Bookings open after it is approved.';
  return null;
}

// India Standard Time date, YYYY-MM-DD.
export const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
export const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

// A wing (or the whole project) on hold: returns the reason, or null. Used before certifying, pouring and selling.
export async function holdFor(env, projectId, wing) {
  const h = await env.DB.prepare("SELECT wing, reason FROM prj_holds WHERE project_id = ? AND released_at IS NULL AND (wing IS NULL OR ? IS NULL OR wing = ?) ORDER BY wing IS NULL DESC LIMIT 1").bind(projectId, wing || null, wing || null).first();
  return h ? `${h.wing ? 'Wing ' + h.wing : 'The project'} is on hold: ${h.reason}` : null;
}
