// scripts/restore-drill.mjs — prove a backup can be restored: take Everything-backup from a running local server, load it into a brand-new empty
// local database, and compare the row count of EVERY table. Usage (server running with test data):
//   OWNER_EMAIL=... OWNER_PASSWORD=... node scripts/restore-drill.mjs [http://localhost:8787]
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8787', dir = '/tmp/restore-drill-' + Date.now();
fs.mkdirSync(dir, { recursive: true });
const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NirmaanCRM': '1' }, body: JSON.stringify({ email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD }) });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0]; if (!cookie) { console.error('Could not sign in as Owner.'); process.exit(2); }
const files = [];
for (const part of [1, 2, 3]) { const r = await fetch(`${BASE}/api/export-all?part=${part}`, { headers: { cookie, 'X-NirmaanCRM': '1' } }); const f = `${dir}/part${part}.json`; fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); files.push(f); }
const tables = {}; for (const f of files) Object.assign(tables, JSON.parse(fs.readFileSync(f, 'utf8')).tables);
const names = Object.keys(tables);
console.log(`Backup read: ${names.length} tables, ${names.reduce((s, t) => s + tables[t].length, 0)} rows.`);
const sql = execSync(`node scripts/restore.mjs ${files.join(' ')}`, { maxBuffer: 1 << 28 }).toString(); fs.writeFileSync(`${dir}/restore.sql`, sql);
const run = (args) => execSync(`npx wrangler d1 ${args} --local --persist-to ${dir}/db`, { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
run('migrations apply nirmaan-db'); console.log('Empty database created with the current schema.');
run(`execute nirmaan-db --file ${dir}/restore.sql`); console.log('Backup loaded.');
fs.writeFileSync(`${dir}/counts.sql`, names.map((t) => `SELECT '${t}' AS t, COUNT(*) AS n FROM ${t};`).join('\n'));
const res = JSON.parse(run(`execute nirmaan-db --file ${dir}/counts.sql --json`));
const got = {}; for (const r of res) { const row = (r.results || [])[0]; if (row) got[row.t] = row.n; }
let bad = 0; for (const t of names) { const want = tables[t].length; if (got[t] !== want) { bad++; console.log(`MISMATCH  ${t}: backup has ${want} rows, restored database has ${got[t]}`); } }
console.log(`${names.length} tables compared: ${names.length - bad} match, ${bad} do not.`);
process.exit(bad ? 1 : 0);
