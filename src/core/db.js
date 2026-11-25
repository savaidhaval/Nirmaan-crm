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

// ---------- Long "IN (?, ?, ...)" lists (D1 accepts at most 100 bound values per statement) ----------
// Many lists are filtered with "project_id IN (?, ?, ...)", one value per project the user can see.
// Above 100 projects D1 refuses those statements ("too many SQL variables"). When a statement has more
// than 100 values, each "IN (?, ?, ...)" list is folded into one JSON value read back with json_each,
// so the statement needs one value per list instead of one per project. Statements with 100 or fewer
// values are sent exactly as written.
export const D1_MAX_BOUND = 100;

// Blank out quoted text and comments (same length) so a "?" or "IN (" inside them is never touched.
function maskSql(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === close) {
          if (close !== ']' && sql[j + 1] === close) { j += 2; continue; }   // '' inside a string
          break;
        }
        j++;
      }
      out += ' '.repeat(Math.min(j + 1, sql.length) - i);
      i = j + 1;
    } else if (c === '-' && sql[i + 1] === '-') {
      let j = sql.indexOf('\n', i);
      if (j < 0) j = sql.length;
      out += ' '.repeat(j - i);
      i = j;
    } else if (c === '/' && sql[i + 1] === '*') {
      let j = sql.indexOf('*/', i + 2);
      j = j < 0 ? sql.length : j + 2;
      out += ' '.repeat(j - i);
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// Returns { sql, params } with every "IN (?, ?, ...)" list of two or more values replaced by
// "IN (SELECT value FROM json_each(?N))". Other values keep their place (renumbered as ?N).
// Returns null when nothing can be folded (for example named :params), so the caller sends it as written.
export function foldInLists(sql, params) {
  const masked = maskSql(sql);
  if (/[:@$][A-Za-z_]/.test(masked.replace(/\?\d*/g, ''))) return null;   // named parameters: leave alone
  // Every placeholder in order, with the 1-based value it reads (SQLite rule: "?" = highest so far + 1).
  const marks = [];
  let max = 0;
  for (const m of masked.matchAll(/\?(\d*)/g)) {
    const idx = m[1] ? Number(m[1]) : max + 1;
    if (idx > max) max = idx;
    marks.push({ start: m.index, end: m.index + m[0].length, idx });
  }
  const lists = [];
  for (const m of masked.matchAll(/\bIN\s*\(\s*\?\d*(?:\s*,\s*\?\d*)+\s*\)/gi)) {
    lists.push({ start: m.index, end: m.index + m[0].length });
  }
  if (!lists.length) return null;
  const newParams = [];
  const renumber = new Map();   // old value index -> new value index (for values outside lists)
  const take = (idx) => {
    if (!renumber.has(idx)) { newParams.push(params[idx - 1]); renumber.set(idx, newParams.length); }
    return renumber.get(idx);
  };
  let out = '';
  let pos = 0;
  let li = 0;
  for (let k = 0; k < marks.length; k++) {
    const mk = marks[k];
    const list = lists[li];
    if (list && mk.start >= list.start && mk.end <= list.end) {
      const values = [];
      while (k < marks.length && marks[k].end <= list.end) { values.push(params[marks[k].idx - 1]); k++; }
      k--;
      newParams.push(JSON.stringify(values));
      out += sql.slice(pos, list.start) + `IN (SELECT value FROM json_each(?${newParams.length}))`;
      pos = list.end;
      li++;
    } else {
      out += sql.slice(pos, mk.start) + '?' + take(mk.idx);
      pos = mk.end;
    }
  }
  out += sql.slice(pos);
  return { sql: out, params: newParams };
}

// Wrap a D1 database so statements with more than 100 values fold their IN lists before running.
// Everything else (batch, exec, prepare with few values) passes straight through to D1.
export function withLongInLists(db) {
  if (!db || db.__longInLists) return db;
  return new Proxy(db, {
    get(t, k) {
      if (k === '__longInLists') return true;
      if (k === 'prepare') {
        return (sql) => {
          const stmt = t.prepare(sql);
          const bind = stmt.bind.bind(stmt);
          stmt.bind = (...args) => {
            if (args.length > D1_MAX_BOUND) {
              const f = foldInLists(sql, args);
              if (f) return t.prepare(f.sql).bind(...f.params);
            }
            return bind(...args);
          };
          return stmt;
        };
      }
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}
