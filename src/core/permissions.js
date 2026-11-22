// permissions.js — role matrix (§4.5). Single source of truth.
// Actions: V=View, C=Create, E=Edit, A=Approve, X=Export

const ROLES = ['owner', 'pm', 'site', 'sales', 'accounts', 'purchase', 'hr', 'viewer'];

// Module → role → permissions string
const MATRIX = {
  projects: {
    owner: 'VCEAX', pm: 'VCE', site: 'V', sales: 'V', accounts: 'V', purchase: 'V', hr: 'V', viewer: 'V',
  },
  approvals: {
    owner: 'VCEAX', pm: 'VCEA', site: 'V', sales: '–', accounts: 'V', purchase: '–', hr: '–', viewer: 'V',
  },
  drawings: {
    owner: 'VCEAX', pm: 'VCEA', site: 'V', sales: '–', accounts: '–', purchase: 'V', hr: '–', viewer: 'V',
  },
  site: {
    owner: 'VCEAX', pm: 'VCEA', site: 'VCE', sales: 'V', accounts: 'V', purchase: 'V', hr: '–', viewer: 'V',
  },
  procurement: {
    owner: 'VCEAX', pm: 'VCEA', site: 'C', sales: '–', accounts: 'VCE', purchase: 'VCE', hr: '–', viewer: 'V',
  },
  redevelopment: {
    owner: 'VCEAX', pm: 'VCE', site: '–', sales: '–', accounts: 'V', purchase: '–', hr: '–', viewer: 'V',
  },
  transit: {
    owner: 'VCEAX', pm: 'V', site: '–', sales: '–', accounts: 'VCE', purchase: '–', hr: '–', viewer: 'V',
  },
  bank: {
    owner: 'VCEAX', pm: '–', site: '–', sales: '–', accounts: 'VCE', purchase: '–', hr: '–', viewer: '–',
  },
  feasibility: {
    owner: 'VCEAX', pm: 'VCE', site: '–', sales: '–', accounts: 'V', purchase: '–', hr: '–', viewer: 'V',
  },
  rera: {
    owner: 'VCEAX', pm: 'V', site: '–', sales: '–', accounts: 'VCEX', purchase: '–', hr: '–', viewer: 'VX',
  },
  ai: {
    owner: 'VCEAX', pm: 'VC', site: 'VC', sales: 'VC', accounts: 'VC', purchase: 'VC', hr: '–', viewer: 'VC',
  },
  professionals: {
    owner: 'VCEAX', pm: 'VCE', site: '–', sales: '–', accounts: 'VCE', purchase: 'VCE', hr: '–', viewer: 'V',
  },
  petty: {
    owner: 'VCEAX', pm: 'VCEA', site: 'VC', sales: '–', accounts: 'VCE', purchase: '–', hr: '–', viewer: '–',
  },
  stores: {
    owner: 'VCEAX', pm: 'VCEA', site: 'VCE', sales: '–', accounts: 'V', purchase: 'VCE', hr: '–', viewer: 'V',
  },
  budget: {
    owner: 'VCEAX', pm: 'VCE', site: '–', sales: '–', accounts: 'V', purchase: 'V', hr: '–', viewer: 'V',
  },
  contractors: {
    owner: 'VCEAX', pm: 'VCEA', site: 'V', sales: '–', accounts: 'VCE', purchase: 'VCE', hr: '–', viewer: 'V',
  },
  sales: {
    owner: 'VCEAX', pm: 'VCEA', site: '–', sales: 'VCE', accounts: 'VCE', purchase: '–', hr: '–', viewer: 'V',
  },
  people: {
    owner: 'VCEAX', pm: 'V', site: '–', sales: '–', accounts: '–', purchase: '–', hr: 'VCE', viewer: '–',
  },
  reports: {
    owner: 'VCEAX', pm: 'VCEX', site: 'V', sales: 'V', accounts: 'VCEX', purchase: 'V', hr: 'V', viewer: 'VX',
  },
  branding: {
    owner: 'VCEAX', pm: 'V', site: '–', sales: 'V', accounts: 'V', purchase: '–', hr: '–', viewer: '–',
  },
  brochures: {
    owner: 'VCEAX', pm: 'VCE', site: 'V', sales: 'V', accounts: 'V', purchase: 'V', hr: 'V', viewer: 'V',
  },
  share_links: {
    owner: 'VCEAX', pm: 'VCE', site: '–', sales: 'C', accounts: '–', purchase: '–', hr: '–', viewer: '–',
  },
  users_settings: {
    owner: 'VCEA', pm: '–', site: '–', sales: '–', accounts: '–', purchase: '–', hr: '–', viewer: '–',
  },
};

export function can(role, module, action) {
  const perms = MATRIX[module] && MATRIX[module][role];
  if (!perms) return false;
  return perms.includes(action);
}

export function hasExtraRole(user, extraRole) {
  if (!user.extra_roles) return false;
  try {
    const list = JSON.parse(user.extra_roles);
    return Array.isArray(list) && list.includes(extraRole);
  } catch (e) {
    return false;
  }
}

export function userCan(user, module, action) {
  if (!user || !user.role) return false;
  if (can(user.role, module, action)) return true;
  // Extra roles add permissions
  if (user.extra_roles) {
    try {
      const extras = JSON.parse(user.extra_roles);
      for (const er of extras) {
        if (er === 'owner') continue; // owner can never be extra
        if (can(er, module, action)) return true;
      }
    } catch (e) {}
  }
  return false;
}

// Project-scoped visibility: which project IDs can this user see?
async function allVisibleProjectIds(env, user) {
  if (!user) return [];
  if (user.role === 'owner') {
    // Owner is never limited
    const rows = await query(env.DB, "SELECT id FROM projects WHERE deleted_at IS NULL AND COALESCE(status, '') != 'archived'");
    return rows.results.map((r) => r.id);
  }
  const limitRoles = await getLimitRoles(env);
  if (!limitRoles.includes(user.role)) {
    // Not a limited role — sees all projects
    const rows = await query(env.DB, "SELECT id FROM projects WHERE deleted_at IS NULL AND COALESCE(status, '') != 'archived'");
    return rows.results.map((r) => r.id);
  }
  // Limited role — only assigned projects
  const rows = await query(env.DB, `
    SELECT pm.project_id FROM project_members pm
    JOIN projects p ON p.id = pm.project_id
    WHERE pm.user_id = ? AND pm.removed_at IS NULL AND p.deleted_at IS NULL AND COALESCE(p.status, '') != 'archived'
  `, [user.user_id ?? user.id]);
  return rows.results.map((r) => r.project_id);
}

// Same as above, narrowed to the picked project when the request carries ?project_id=N (GET only).
export async function visibleProjectIds(env, user) {
  const ids = await allVisibleProjectIds(env, user);
  return user && user.scopeProject ? ids.filter((i) => i === user.scopeProject) : ids;
}

export async function getLimitRoles(env) {
  const val = await getSetting(env, 'access.limit_roles_to_assigned_projects');
  if (val === null) return ['site'];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : ['site'];
    } catch (e) {
      return ['site'];
    }
  }
  return ['site'];
}

export async function canSeeProject(env, user, projectId) {
  const ids = await visibleProjectIds(env, user);
  return ids.includes(projectId);
}

export function roleLabel(role) {
  const labels = {
    owner: 'Owner', pm: 'Project Manager', site: 'Site Engineer', sales: 'Sales',
    accounts: 'Accounts', purchase: 'Purchase', hr: 'HR / Admin', viewer: 'Viewer (CA/Auditor)',
  };
  return labels[role] || role;
}

export function roleOneLine(role) {
  const lines = {
    owner: 'You. The admin: everything — adding people, branding, settings, email — and approving any purchase order.',
    pm: 'Runs a project: approvals, drawings, site work, purchase orders up to your limit; sees sales numbers.',
    site: 'Files the daily report, opens the latest drawings, records material received, raises snags. Sees no money.',
    sales: 'Leads, site visits, flats, bookings and brochures — only their own leads unless you allow more.',
    accounts: 'Receipts, demands, vendor bills, reports, and the bank details printed on letters.',
    purchase: 'Vendors, quotations and purchase orders; sees material received.',
    hr: 'Team & Hiring only.',
    viewer: 'Read-only; can export reports; PAN and Aadhaar are hidden.',
  };
  return lines[role] || '';
}

import { query } from './db.js';
import { getSetting } from './settings.js';
