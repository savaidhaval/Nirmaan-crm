// tests/units.mjs — pure-function checks that need no server: financial-year rollover for numbering (1 April, IST).
import { fyOf } from '../src/routes/sales3.js';
import { foldInLists, withLongInLists } from '../src/core/db.js';
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
const ist = (iso) => new Date(Date.parse(iso) + 19800000);   // the app passes "now + 5.5 hours" so that UTC fields read as IST
ok('31 March 23:59 IST is still the old financial year', fyOf(ist('2026-03-31T18:29:00Z')) === '2025-26', fyOf(ist('2026-03-31T18:29:00Z')));
ok('1 April 00:00 IST starts the new financial year', fyOf(ist('2026-03-31T18:30:00Z')) === '2026-27', fyOf(ist('2026-03-31T18:30:00Z')));
ok('January belongs to the year that began the previous April', fyOf(ist('2027-01-15T05:00:00Z')) === '2026-27');
ok('December and April of the same year agree', fyOf(ist('2026-12-31T05:00:00Z')) === '2026-27' && fyOf(ist('2026-04-30T05:00:00Z')) === '2026-27');
ok('the year before a century rollover is written with two digits (2099-00)', fyOf(ist('2099-06-01T05:00:00Z')) === '2099-00');
// paise arithmetic: percentages are basis points and rounded to the nearest paisa, never floats in storage
const gst = (paise, bp) => Math.round((paise * bp) / 10000);
ok('18% of Rs 1,23,456.78 is Rs 22,222.22 to the paisa', gst(12345678, 1800) === 2222222);
ok('5% of Rs 9,99,999.99 is Rs 50,000.00 (rounds up)', gst(99999999, 500) === 5000000);
ok('1 paisa at 18% rounds to 0 paise, not a fraction', gst(1, 1800) === 0 && Number.isInteger(gst(1, 1800)));
// long "IN (?, ?, ...)" lists: D1 refuses more than 100 values in one statement, so above 100 projects each list is folded into one JSON value
const ids = Array.from({ length: 150 }, (_, i) => i + 1);
const f1 = foldInLists(`SELECT * FROM t WHERE deleted_at IS NULL AND project_id IN (${ids.map(() => '?').join(',')}) AND status = ?`, [...ids, 'open']);
ok('150 project ids become one value', f1 && f1.params.length === 2 && JSON.parse(f1.params[0]).length === 150 && f1.params[1] === 'open', JSON.stringify(f1 && f1.params.length));
ok('the list is read back with json_each and later values are renumbered', f1.sql === 'SELECT * FROM t WHERE deleted_at IS NULL AND project_id IN (SELECT value FROM json_each(?1)) AND status = ?2', f1.sql);
const ph = ids.map(() => '?').join(', ');
const f2 = foldInLists(`SELECT ? AS x, (SELECT COUNT(*) FROM a WHERE project_id IN (${ph})) AS n, (SELECT COUNT(*) FROM b WHERE b.project_id NOT IN ( ${ph} )) AS m WHERE note != 'IN (?, ?)' -- IN (?, ?)
  AND y = ?`, ['x', ...ids, ...ids, 'y']);
ok('two lists, a NOT IN list, and "?" inside quotes or comments are handled', f2 && f2.params.length === 4 && f2.params[0] === 'x' && f2.params[3] === 'y' && JSON.parse(f2.params[2]).length === 150
  && f2.sql.includes("note != 'IN (?, ?)' -- IN (?, ?)") && (f2.sql.match(/json_each/g) || []).length === 2, f2 && f2.sql);
const f3 = foldInLists(`UPDATE t SET a = ?2 WHERE b = ?1 AND id IN (${ids.map((_, i) => '?' + (i + 3)).join(',')})`, ['b', 'a', ...ids]);
ok('numbered values (?1, ?2, ?3...) keep their meaning', f3 && f3.sql === 'UPDATE t SET a = ?1 WHERE b = ?2 AND id IN (SELECT value FROM json_each(?3))' && f3.params[0] === 'a' && f3.params[1] === 'b' && JSON.parse(f3.params[2])[149] === 150, f3 && f3.sql);
ok('a statement with no list is left alone', foldInLists('SELECT * FROM t WHERE a = ? AND b IN (?)', [1, 2]) === null);
// the wrapper only changes statements with more than 100 values
const seen = []; const fake = { prepare: (sql) => ({ sql, bind(...a) { seen.push({ sql, n: a.length }); return this; } }), batch: (s) => s.length };
const wdb = withLongInLists(fake);
wdb.prepare('SELECT * FROM t WHERE id IN (?, ?)').bind(1, 2);
wdb.prepare(`SELECT * FROM t WHERE id IN (${ph})`).bind(...ids);
ok('100 or fewer values are sent exactly as written', seen[0].sql === 'SELECT * FROM t WHERE id IN (?, ?)' && seen[0].n === 2);
ok('more than 100 values are sent as one folded value', seen[1].n === 1 && seen[1].sql.includes('json_each(?1)'), JSON.stringify(seen[1]));
ok('other database calls pass straight through', wdb.batch([1, 2, 3]) === 3 && withLongInLists(wdb) === wdb);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
