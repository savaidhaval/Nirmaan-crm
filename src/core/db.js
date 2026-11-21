// db.js — D1 helpers: query, paginate, soft-delete, batch (§4.4)

function bindStmt(stmt, params) {
  const n = params.length;
  if (n === 0) return stmt;
  if (n === 1) return stmt.bind(params[0]);
  if (n === 2) return stmt.bind(params[0], params[1]);
  if (n === 3) return stmt.bind(params[0], params[1], params[2]);
  if (n === 4) return stmt.bind(params[0], params[1], params[2], params[3]);
  if (n === 5) return stmt.bind(params[0], params[1], params[2], params[3], params[4]);
  if (n === 6) return stmt.bind(params[0], params[1], params[2], params[3], params[4], params[5]);
  return stmt.bind(...params);
}

export async function query(db, sql, params = []) {
  const stmt = bindStmt(db.prepare(sql), params);
  return stmt.all();
}

export async function queryOne(db, sql, params = []) {
  const stmt = bindStmt(db.prepare(sql), params);
  return stmt.first();
}

export async function run(db, sql, params = []) {
  const stmt = bindStmt(db.prepare(sql), params);
  return stmt.run();
}

export async function batch(db, statements) {
  const stmts = statements.map(({ sql, params = [] }) => bindStmt(db.prepare(sql), params));
  return db.batch(stmts);
}

export async function paginate(db, sql, countSql, params, page, pageSize = 25) {
  const offset = (page - 1) * pageSize;
  const dataParams = [...params, pageSize, offset];
  const data = await query(db, sql + ' LIMIT ? OFFSET ?', dataParams);
  const countParams = params.slice();
  const count = await queryOne(db, countSql, countParams);
  const total = count ? Number(count.cnt) : 0;
  return {
    data,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function softDelete(db, table, id, idCol = 'id') {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  return run(db, `UPDATE ${table} SET deleted_at = ? WHERE ${idCol} = ? AND deleted_at IS NULL`, [now, id]);
}

export async function restore(db, table, id, idCol = 'id') {
  return run(db, `UPDATE ${table} SET deleted_at = NULL WHERE ${idCol} = ?`, [id]);
}

export async function exists(db, table, id, idCol = 'id') {
  const row = await queryOne(db, `SELECT 1 FROM ${table} WHERE ${idCol} = ? AND deleted_at IS NULL LIMIT 1`, [id]);
  return !!row;
}
