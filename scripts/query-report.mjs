// scripts/query-report.mjs <dev.log> — after a full test run: the busiest requests and sweep runs by database statements.
// Fails (exit 1) if any request or sweep used more than 50 statements (the free-plan limit per request / cron run).
import fs from 'node:fs';
const log = fs.readFileSync(process.argv[2] || 'dev.log', 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
const by = new Map(), cron = [];
for (const m of log.matchAll(/QC (GET|POST|PUT|DELETE) (\S+) (\d+) (\d+) (\d+)/g)) { const k = `${m[1]} ${m[2]}`; const n = Number(m[3]), ms = Number(m[4]); const e = by.get(k) || { n: 0, ms: 0, calls: 0 }; e.n = Math.max(e.n, n); e.ms = Math.max(e.ms, ms); e.calls++; by.set(k, e); }
for (const m of log.matchAll(/QCRON (\S+ \S+ \S+ \S+ \S+) (\d+) (\d+)/g)) cron.push({ cron: m[1], n: Number(m[2]), ms: Number(m[3]) });
const rows = [...by.entries()].sort((a, b) => b[1].n - a[1].n);
console.log(`Requests measured: ${[...by.values()].reduce((s, e) => s + e.calls, 0)} calls over ${rows.length} routes`);
console.log('Busiest routes (most database statements in one request):'); rows.slice(0, 15).forEach(([k, e]) => console.log(`  ${String(e.n).padStart(3)} statements  ${String(e.ms).padStart(5)} ms (wall)  ${k}`));
const worstCron = cron.sort((a, b) => b.n - a.n)[0]; if (worstCron) console.log(`Hourly/daily sweep runs: ${cron.length}; busiest used ${worstCron.n} statements in ${worstCron.ms} ms (${worstCron.cron})`);
const over = rows.filter(([, e]) => e.n > 50); const cronOver = cron.filter((c) => c.n > 50);
if (over.length || cronOver.length) { console.log('OVER THE CAP:'); over.forEach(([k, e]) => console.log(`  ${k} ${e.n}`)); cronOver.forEach((c) => console.log(`  sweep ${c.cron} ${c.n}`)); process.exit(1); }
console.log('No request or sweep went over 50 statements.');
