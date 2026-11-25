// core/projgate.js — the project check that runs on every route (§4.5, §4.6), after the role check.
// 1. A request that names a project (GET ?project_id=N, or "project_id" in a JSON body) is refused unless the person can see that project.
// 2. A project that has not started yet (start_basis = 'pending') takes no new work in Modules 2-5 (sales, site, money, possession):
//    a redevelopment project starts with the society's appointment letter after the 79A process; a land project when the land is bought.
// Cost: one or two small reads, and only when the request names a project.
import { getLimitRoles } from './permissions.js';
import { getSetting } from './settings.js';

// The five project modules and the permission areas (core/permissions.js) that make each one up.
export const PROJECT_MODULES = [
  { key: 'm1', label: '1. Land & Approvals', areas: ['projects', 'approvals', 'redevelopment', 'transit', 'feasibility'] },
  { key: 'm2', label: '2. Pre-Sales & Inventory', areas: ['sales', 'brochures', 'share_links'] },
  { key: 'm3', label: '3. Site & Contractors', areas: ['drawings', 'site', 'procurement', 'contractors', 'stores', 'budget', 'petty'] },
  { key: 'm4', label: '4. Collections & RERA', areas: ['rera', 'bank', 'tally'] },
  { key: 'm5', label: '5. Possession & Society', areas: [] },   // possession and snags use the sales and site permissions
];
// Areas that take new work only after the project has started (everything outside Module 1).
const AFTER_START = new Set(PROJECT_MODULES.filter((m) => m.key !== 'm1').flatMap((m) => m.areas));

export const START_BASIS = { appointment_letter: 'Appointment letter from the society (after the 79A process)', land_purchase: 'Land bought (sale deed registered)', da_registered: 'Development agreement registered' };
export const startNeeds = (type) => (type === 'redevelopment' ? 'appointment_letter' : 'land_purchase');
export const isStarted = (p) => !!p && p.start_basis !== 'pending';   // NULL = the project existed before this rule: treated as started
export async function startGateOn(env) { const v = await getSetting(env, 'projects.start_gate'); return v !== 'off' && v !== false; }

// The project id a request names, without using up the body the route will read.
export async function requestProjectId(req) {
  if (req.method === 'GET') return Number(new URL(req.url).searchParams.get('project_id')) || 0;
  if (!['POST', 'PUT'].includes(req.method) || !/application\/json/i.test(req.headers.get('content-type') || '')) return 0;
  try { const b = await req.clone().json(); return b && typeof b === 'object' && !Array.isArray(b) ? Number(b.project_id) || 0 : 0; } catch (e) { return 0; }
}

// Returns a Response to refuse the request, or null to let the route run.
export async function projectGate(env, user, pid, area, method, json) {
  const p = await env.DB.prepare(`SELECT p.id, p.type, p.start_basis,
      EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ? AND m.removed_at IS NULL) AS member
    FROM projects p WHERE p.id = ? AND p.deleted_at IS NULL`).bind(user.user_id ?? user.id, pid).first();
  if (!p) return null;   // an unknown project: the route gives its own "not found"
  if (user.role !== 'owner' && !p.member && (await getLimitRoles(env)).includes(user.role)) {
    return json({ ok: false, error: 'You are not on this project. Ask the Owner to add you to it.', code: 'not_member' }, 403);
  }
  if (method !== 'GET' && p.start_basis === 'pending' && AFTER_START.has(area) && (await startGateOn(env))) {
    const what = p.type === 'redevelopment' ? "the society's appointment letter (after the 79A process)" : 'the land purchase (registered sale deed)';
    return json({ ok: false, error: `This project has not started yet. Record ${what} on the project home first. Until then only Land & Approvals is open.`, code: 'not_started' }, 409);
  }
  return null;
}
