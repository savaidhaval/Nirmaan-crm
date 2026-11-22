// routes/professionals.js — register of professionals (architect, structural engineer, advocate, CA, consultants...).
// Their contracts and documents live in the same Documents block as vendors and contractors (partydocs.js, party_type 'professional').

const MONEY_ROLES = ['owner', 'accounts'];

// ----- Service function other modules call -----
export async function professionalName(env, id) {
  const r = await env.DB.prepare('SELECT name FROM pro_professionals WHERE id = ? AND deleted_at IS NULL').bind(id).first();
  return r ? r.name : null;
}

export function registerProfessionals(router, h) {
  const { withAuth, json, serverError, nowStr, encryptSetting, decryptSetting } = h;
  const audit = (env, user, action, id, summary) => env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, 'pro_professionals', id || 0, String(summary).slice(0, 300), nowStr());

  router.get('/api/professionals', async (req, env) => withAuth(req, env, 'professionals', 'V', async (req, env) => {
    try {
      const q = new URL(req.url).searchParams; const term = String(q.get('q') || '').trim().toLowerCase();
      let sql = 'SELECT id, name, profession, firm, phone, email, gstin, pan_enc, notes, active FROM pro_professionals WHERE deleted_at IS NULL'; const args = [];
      if (term) { sql += " AND (lower(name) LIKE ? OR lower(COALESCE(profession, '')) LIKE ? OR lower(COALESCE(firm, '')) LIKE ?)"; args.push(`%${term}%`, `%${term}%`, `%${term}%`); }
      const rows = (await env.DB.prepare(sql + ' ORDER BY active DESC, name LIMIT 300').bind(...args).all()).results;
      for (const r of rows) {
        r.has_pan = !!r.pan_enc; r.pan_masked = '';
        if (r.pan_enc && MONEY_ROLES.includes(req.user.role)) { try { r.pan_masked = '••••' + (await decryptSetting(env, r.pan_enc)).slice(-4); } catch (e) { r.pan_masked = '••••'; } }
        delete r.pan_enc;
      }
      return json({ ok: true, data: { professionals: rows } });
    } catch (e) { return serverError(e, 'prof-list'); }
  }));

  const readBody = async (req, env, partial) => {
    const b = await req.json();
    const name = String(b.name || '').trim().slice(0, 120);
    if (!partial && !name) return { err: json({ ok: false, error: 'Give the professional a name.' }, 400) };
    if (b.pan && !/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(String(b.pan).trim())) return { err: json({ ok: false, error: 'PAN looks wrong (format ABCDE1234F).' }, 400) };
    if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.email).trim())) return { err: json({ ok: false, error: 'That email address looks wrong.' }, 400) };
    return { b, name, pan: b.pan ? await encryptSetting(env, String(b.pan).trim().toUpperCase()) : null };
  };

  router.post('/api/professionals', async (req, env) => withAuth(req, env, 'professionals', 'C', async (req, env) => {
    try {
      const { b, name, pan, err } = await readBody(req, env, false); if (err) return err;
      const r = await env.DB.prepare('INSERT INTO pro_professionals (name, profession, firm, phone, email, gstin, pan_enc, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(name, String(b.profession || '').trim().slice(0, 60), String(b.firm || '').slice(0, 120), String(b.phone || '').slice(0, 20), String(b.email || '').slice(0, 120), String(b.gstin || '').slice(0, 20), pan, String(b.notes || '').slice(0, 500), nowStr()).run();
      await audit(env, req.user, 'create', r.meta.last_row_id, `Added professional "${name}" (${b.profession || ''})`).run();
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'prof-create'); }
  }));

  router.put('/api/professionals/:id', async (req, env) => withAuth(req, env, 'professionals', 'E', async (req, env) => {
    try {
      const cur = await env.DB.prepare('SELECT * FROM pro_professionals WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!cur) return json({ ok: false, error: 'Professional not found.' }, 404);
      const { b, name, pan, err } = await readBody(req, env, true); if (err) return err;
      const pick = (k, max) => (b[k] !== undefined ? String(b[k]).slice(0, max) : cur[k]);
      await env.DB.prepare('UPDATE pro_professionals SET name = ?, profession = ?, firm = ?, phone = ?, email = ?, gstin = ?, pan_enc = ?, notes = ?, active = ? WHERE id = ?')
        .bind(name || cur.name, pick('profession', 60), pick('firm', 120), pick('phone', 20), pick('email', 120), pick('gstin', 20), pan || cur.pan_enc, pick('notes', 500), b.active === undefined ? cur.active : (b.active ? 1 : 0), cur.id).run();
      await audit(env, req.user, 'update', cur.id, `Updated professional "${name || cur.name}"`).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'prof-update'); }
  }));
}
