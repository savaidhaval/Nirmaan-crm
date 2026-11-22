// routes/importer.js — validated CSV imports (rows are parsed in the browser and sent in small chunks).
// Free-plan Workers allow ~50 database calls per request, so each call carries a limited number of rows
// and the browser loops. dry_run=true validates only.
import { shared } from './sales_ops.js';
import { inIds, idBinds } from '../core/permissions.js';

const LIMITS = { inventory: 100, vendors: 100, leads: 8 };

export function registerImporter(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr, encryptSetting } = h;
  const rup = (v) => { if (v === undefined || v === null || String(v).trim() === '') return 0; const n = Number(String(v).replace(/[,₹\s]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
  const str = (v, n) => String(v ?? '').trim().slice(0, n);

  router.post('/api/import/:kind', async (req, env) => {
    const kind = req.params.kind;
    if (!LIMITS[kind]) return json({ ok: false, error: 'Unknown import.' }, 404);
    const mod = kind === 'inventory' ? ['sales', 'C'] : kind === 'vendors' ? ['procurement', 'C'] : ['sales', 'C'];
    return withAuth(req, env, mod[0], mod[1], async (req, env) => {
      try {
        const user = req.user;
        if (kind === 'inventory' && !['owner', 'pm'].includes(user.role)) return json({ ok: false, error: 'Only the Owner or PM can import flats.' }, 403);
        if (kind === 'vendors' && !['owner', 'pm', 'purchase', 'accounts'].includes(user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
        const body = await req.json();
        const rows = Array.isArray(body.rows) ? body.rows : [];
        if (!rows.length) return json({ ok: false, error: 'No rows.' }, 400);
        if (rows.length > LIMITS[kind]) return json({ ok: false, error: `Send at most ${LIMITS[kind]} rows per request.` }, 400);
        const dry = !!body.dry_run;
        const ids = await visibleProjectIds(env, user);
        const projects = (await env.DB.prepare(`SELECT id, code FROM projects WHERE deleted_at IS NULL AND id IN (${inIds(ids) || 'NULL'})`).bind(...idBinds(ids)).all()).results;
        const byCode = Object.fromEntries(projects.map((p) => [String(p.code).toLowerCase(), p.id]));
        const results = []; let created = 0;

        if (kind === 'inventory') {
          const valid = [];
          const seen = new Set();
          for (const [i, r] of rows.entries()) {
            const pid = byCode[String(r.project_code || '').trim().toLowerCase()];
            const price = rup(r.price); const rise = rup(r.floor_rise);
            const category = String(r.category || 'sale').toLowerCase() === 'rehab' ? 'rehab' : 'sale';
            const unit = str(r.unit_no, 20);
            let error = null;
            if (!pid) error = 'Unknown project code.'; else if (!unit) error = 'Flat number is required.'; else if (Number.isNaN(price) || Number.isNaN(rise)) error = 'Price must be a number.'; else if (category === 'sale' && !(price > 0)) error = 'A flat for sale needs a price.';
            const key = `${pid}|${str(r.wing, 20)}|${unit}`;
            if (!error && seen.has(key)) error = 'Repeated in this file.'; seen.add(key);
            results.push({ row: i + 1, ok: !error, error });
            if (!error) valid.push({ pid, wing: str(r.wing, 20) || null, floor: r.floor === '' || r.floor == null ? null : Number(r.floor), unit, type: str(r.type, 20), carpet: Number(r.carpet_sqft) || null, rera: Number(r.rera_carpet_sqft) || null, price, rise, category, idx: results.length - 1 });
          }
          if (valid.length) {
            const existing = (await env.DB.prepare(`SELECT project_id, COALESCE(wing, '') AS wing, unit_no FROM sal_inventory WHERE deleted_at IS NULL AND project_id IN (${[...new Set(valid.map((v) => v.pid))].map(() => '?').join(',')})`).bind(...new Set(valid.map((v) => v.pid))).all()).results;
            const ex = new Set(existing.map((e) => `${e.project_id}|${e.wing}|${e.unit_no}`));
            const toInsert = [];
            for (const v of valid) { if (ex.has(`${v.pid}|${v.wing || ''}|${v.unit}`)) { results[v.idx] = { ...results[v.idx], ok: false, error: 'This flat already exists.' }; } else toInsert.push(v); }
            if (!dry && toInsert.length) {
              await env.DB.batch(toInsert.map((v) => env.DB.prepare('INSERT INTO sal_inventory (project_id, wing, floor, unit_no, type, carpet_sqft, rera_carpet_sqft, price_paise, floor_rise_paise, category, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                .bind(v.pid, v.wing, Number.isFinite(v.floor) ? v.floor : null, v.unit, v.type, v.carpet, v.rera, v.price, v.rise || 0, v.category, v.category === 'rehab' ? 'rehab' : 'available', nowStr())));
              created = toInsert.length;
            } else created = toInsert.length;
          }
        } else if (kind === 'vendors') {
          const norm = (p) => String(p || '').replace(/\D/g, '').slice(-10);
          const existing = (await env.DB.prepare('SELECT lower(name) AS name, phone FROM pro_vendors WHERE deleted_at IS NULL').all()).results;
          const names = new Set(existing.map((e) => e.name)); const phones = new Set(existing.map((e) => norm(e.phone)).filter(Boolean));
          const toInsert = [];
          for (const [i, r] of rows.entries()) {
            const name = str(r.name, 120); const phone = norm(r.phone);
            let error = null;
            if (!name) error = 'Name is required.'; else if (names.has(name.toLowerCase())) error = 'A vendor with this name exists.'; else if (phone && phones.has(phone)) error = 'A vendor with this phone exists.'; else if (r.gstin && !/^[0-9A-Za-z]{15}$/.test(String(r.gstin).trim())) error = 'GSTIN must be 15 characters.'; else if (r.pan && !/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(String(r.pan).trim())) error = 'PAN looks wrong.';
            results.push({ row: i + 1, ok: !error, error });
            if (!error) { names.add(name.toLowerCase()); if (phone) phones.add(phone); toInsert.push({ name, r }); }
          }
          if (!dry && toInsert.length) {
            // PAN is encrypted: do it per row after building (async)
            const withPan = await Promise.all(toInsert.map(async ({ r }) => (r.pan ? 'enc:' + (await encryptSetting(env, String(r.pan).trim().toUpperCase())) : null)));
            const final = toInsert.map(({ name, r }, k) => env.DB.prepare('INSERT INTO pro_vendors (name, category, contact_person, phone, email, gstin, pan, address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
              .bind(name, str(r.category, 40), str(r.contact_person, 80), str(r.phone, 20), str(r.email, 120), str(r.gstin, 15).toUpperCase(), withPan[k], str(r.address, 200), nowStr()));
            await env.DB.batch(final);
          }
          created = toInsert.length;
        } else {
          // leads: one at a time through the same rules as the lead form (duplicate phone, round-robin, audit)
          for (const [i, r] of rows.entries()) {
            const pid = r.project_code ? byCode[String(r.project_code).trim().toLowerCase()] : null;
            if (r.project_code && !pid) { results.push({ row: i + 1, ok: false, error: 'Unknown project code.' }); continue; }
            const digits = String(r.phone || '').replace(/\D/g, '').slice(-10);
            if (!str(r.name, 120)) { results.push({ row: i + 1, ok: false, error: 'Name is required.' }); continue; }
            if (digits.length !== 10) { results.push({ row: i + 1, ok: false, error: 'Mobile must have 10 digits.' }); continue; }
            if (dry) {
              const dup = await env.DB.prepare('SELECT id FROM sal_leads WHERE phone_norm = ? AND deleted_at IS NULL LIMIT 1').bind(digits).first();
              results.push({ row: i + 1, ok: !dup, error: dup ? 'This mobile is already a lead.' : null }); if (!dup) created++;
              continue;
            }
            const res = await shared.createLead(env, user, { name: r.name, phone: r.phone, email: r.email, project_id: pid, source: str(r.source, 40) || 'import', config_pref: r.config, budget_paise: rup(r.budget) || 0, consent: String(r.consent || '').toLowerCase() === 'yes' }, {});
            results.push({ row: i + 1, ok: res.status === 200, error: res.status === 200 ? null : res.error }); if (res.status === 200) created++;
          }
        }
        if (!dry && created) await env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, 'import', kind, 0, `Imported ${created} ${kind} row(s)`, nowStr()).run();
        return json({ ok: true, data: { dry_run: dry, valid: results.filter((x) => x.ok).length, invalid: results.filter((x) => !x.ok).length, created: dry ? 0 : created, results } });
      } catch (e) { return serverError(e, 'import'); }
    });
  });
}
