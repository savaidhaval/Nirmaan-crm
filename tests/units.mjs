// tests/units.mjs — pure-function checks that need no server: financial-year rollover for numbering (1 April, IST).
import { fyOf } from '../src/routes/sales3.js';
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
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
