// routes/partydocs.js — WP-9: vendor and contractor documents with expiry dates and reminders.
// Document types are typed freely (no fixed list). A newer copy replaces the old one, which stops its reminders.
import { vendorName } from './procurement2.js';
import { contractorNames } from './contractors.js';
import { professionalName } from './professionals.js';

const TYPES = ['vendor', 'contractor', 'professional'];
const KINDS = ['contract', 'document'];
const MODULE_OF = { vendor: 'procurement', contractor: 'contractors', professional: 'professionals' };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));

// Hourly (one statement): PM and Purchase hear about documents inside their reminder window, again once expired. Once per document per week.
export async function partyDocsSweep(env) {
  await env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
    SELECT u.id, (CASE WHEN d.kind = 'contract' THEN 'Contract ' ELSE 'Document ' END) || (CASE WHEN d.valid_till < date('now') THEN 'EXPIRED: ' ELSE 'expiring: ' END) || d.party_label || ' – ' || d.doc_type || ' (#' || d.id || ')',
           'Valid till ' || d.valid_till || '. Upload the renewed copy and it replaces this one.', 'procurement', datetime('now')
    FROM pro_party_docs d JOIN users u ON u.role IN ('pm', 'purchase') AND u.active = 1 AND u.deleted_at IS NULL
    WHERE d.deleted_at IS NULL AND d.superseded_by IS NULL AND d.valid_till IS NOT NULL AND d.valid_till <= date('now', '+' || d.reminder_days || ' days')
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.title LIKE '%(#' || d.id || ')' AND n.title LIKE (CASE WHEN d.valid_till < date('now') THEN '%EXPIRED:%' ELSE '%expiring:%' END) AND n.created_at > datetime('now', '-7 days'))`).run();
}

export function registerPartyDocs(router, h) {
  const { withAuth, json, serverError, nowStr, getSetting } = h;
  const today = () => new Date(Date.now() + 19800000).toISOString().substring(0, 10);

  // The party's own module decides who may see and change its documents. Site never sees them.
  const guard = (action, fn) => async (req, env) => {
    const u = new URL(req.url).searchParams;
    let type = u.get('party_type');
    if (!type && req.method !== 'GET') { try { type = (await req.clone().json()).party_type; } catch (e) { type = null; } }
    if (!TYPES.includes(type)) return json({ ok: false, error: 'Say whether this is a vendor or a contractor.' }, 400);
    return withAuth(req, env, MODULE_OF[type], action, async (req, env) => {
      if (req.user.role === 'site') return json({ ok: false, error: 'Not allowed.' }, 403);
      if (type === 'contractor' && (await getSetting(env, 'con.enabled')) !== 'on') return json({ ok: false, error: 'The Contractors module is switched off.' }, 403);
      req.partyType = type;
      return fn(req, env);
    });
  };

  async function label(env, type, id) {
    if (type === 'vendor') return vendorName(env, id);
    if (type === 'professional') return professionalName(env, id);
    const m = await contractorNames(env, [id]); return m[id] ? m[id].name : null;
  }

  router.get('/api/partydocs', guard('V', async (req, env) => {
    try {
      const id = Number(new URL(req.url).searchParams.get('party_id'));
      const rows = (await env.DB.prepare(`SELECT d.id, d.doc_type, d.valid_till, d.reminder_days, d.document_id, d.note, d.created_at, d.superseded_by, d.kind, doc.title AS file_title
        FROM pro_party_docs d LEFT JOIN documents doc ON doc.id = d.document_id WHERE d.party_type = ? AND d.party_id = ? AND d.deleted_at IS NULL ORDER BY d.superseded_by IS NOT NULL, d.kind != 'contract', d.valid_till IS NULL, d.valid_till LIMIT 100`).bind(req.partyType, id).all()).results;
      const t = today();
      for (const r of rows) {
        r.current = r.superseded_by == null;
        r.days_left = r.valid_till ? Math.round((Date.parse(r.valid_till) - Date.parse(t)) / 86400000) : null;
        r.state = !r.current ? 'replaced' : r.days_left == null ? 'no_expiry' : r.days_left < 0 ? 'expired' : r.days_left <= r.reminder_days ? 'expiring' : 'valid';
      }
      return json({ ok: true, data: { docs: rows } });
    } catch (e) { return serverError(e, 'partydocs-list'); }
  }));

  router.post('/api/partydocs', guard('E', async (req, env) => {
    try {
      const b = await req.json(); const type = req.partyType, pid = Number(b.party_id);
      const docType = String(b.doc_type || '').trim().slice(0, 80);
      if (!docType) return json({ ok: false, error: 'Type in what this document is (for example: GST certificate).' }, 400);
      if (b.valid_till && !isDate(b.valid_till)) return json({ ok: false, error: 'The valid-till date looks wrong.' }, 400);
      const kind = KINDS.includes(b.kind) ? b.kind : 'document';
      const days = b.reminder_days === undefined || b.reminder_days === '' ? 30 : Math.round(Number(b.reminder_days));
      if (!(days >= 0 && days <= 365)) return json({ ok: false, error: 'Reminder days should be between 0 and 365.' }, 400);
      const name = await label(env, type, pid);
      if (!name) return json({ ok: false, error: `That ${type} was not found.` }, 404);
      let old = null;
      if (b.replaces_id) {
        old = await env.DB.prepare('SELECT id FROM pro_party_docs WHERE id = ? AND party_type = ? AND party_id = ? AND deleted_at IS NULL AND superseded_by IS NULL').bind(Number(b.replaces_id), type, pid).first();
        if (!old) return json({ ok: false, error: 'The document being replaced was not found or is already replaced.' }, 404);
      }
      // New copy and the "replaced" mark go in together, so a reminder can never fire for the old one by mistake.
      const res = await env.DB.batch([
        env.DB.prepare('INSERT INTO pro_party_docs (party_type, party_id, party_label, doc_type, valid_till, reminder_days, document_id, note, kind, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(type, pid, name, docType, b.valid_till || null, days, b.document_id ? Number(b.document_id) : null, String(b.note || '').slice(0, 200), kind, req.user.user_id, nowStr()),
        ...(old ? [env.DB.prepare('UPDATE pro_party_docs SET superseded_by = last_insert_rowid() WHERE id = ? AND superseded_by IS NULL').bind(old.id)] : []),
        env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, last_insert_rowid(), ?, ?)').bind(req.user.user_id, old ? 'replace' : 'create', 'pro_party_docs', `${old ? 'Replaced' : 'Added'} ${kind} ${docType} for ${name}`, nowStr()),
      ]);
      return json({ ok: true, data: { id: res[0].meta.last_row_id } });
    } catch (e) { return serverError(e, 'partydocs-create'); }
  }));

  router.delete('/api/partydocs/:id', guard('E', async (req, env) => {
    try {
      if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can delete a document.' }, 403);
      const r = await env.DB.prepare('UPDATE pro_party_docs SET deleted_at = ? WHERE id = ? AND party_type = ? AND deleted_at IS NULL').bind(nowStr(), Number(req.params.id), req.partyType).run();
      if (!r.meta.changes) return json({ ok: false, error: 'Document not found.' }, 404);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'partydocs-delete'); }
  }));
}
