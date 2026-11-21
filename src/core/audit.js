// core/audit.js — audit log writer (§7.1, §4.5 rule 10)

export async function audit(env, userId, action, entity, entityId, summary) {
  try {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    await env.DB.prepare(`
      INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(userId, action, entity, entityId, summary, now).run();
  } catch (e) {
    // Never let audit failure break the main operation
    console.error('Audit write failed:', e.message);
  }
}

export async function getAuditLog(env, params = {}) {
  let sql = 'SELECT al.*, u.name, u.email FROM audit_log al LEFT JOIN users u ON u.id = al.user_id WHERE 1=1';
  const bindParams = [];
  if (params.entity) {
    sql += ' AND al.entity = ?';
    bindParams.push(params.entity);
  }
  if (params.userId) {
    sql += ' AND al.user_id = ?';
    bindParams.push(params.userId);
  }
  sql += ' ORDER BY al.created_at DESC';
  if (params.limit) {
    sql += ' LIMIT ?';
    bindParams.push(params.limit);
  }
  const stmt = env.DB.prepare(sql);
  bindParams.forEach((p, i) => stmt.bind(i + 1, p));
  const { results } = await stmt.all();
  return results;
}
