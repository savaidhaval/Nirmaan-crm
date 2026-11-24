// tests/docx.mjs — the browser Word helper (public/docx.js): makes a valid .docx, fills a template whose {{placeholders}} Word split into pieces, reads a compressed file.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
const D = new Function(readFileSync(new URL('../public/docx.js', import.meta.url), 'utf8') + '; return DocxLib;')();
const dir = mkdtempSync(join(tmpdir(), 'docx-'));
const map = { customer_name: 'Mr & Mrs Mehta <A>', flat_no: 'A-1401', agreement_value: '₹ 3,85,00,000', other_details: 'Line one\nLine two' };

const made = D.textToDocx('Dear {{customer_name}},\n\nFlat {{flat_no}}\n{{other_details}}');
writeFileSync(join(dir, 'made.docx'), made);
ok('the zip it makes is valid (checked with the unzip tool)', /No errors detected|OK/i.test(execSync(`unzip -t ${join(dir, 'made.docx')}`).toString()));
const files = await D.unzip(made);
ok('it holds the five parts Word needs', ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels'].every((n) => files.has(n)));
ok('the document XML is well formed', (() => { try { execSync(`xmllint --noout -`, { input: new TextDecoder().decode(files.get('word/document.xml')) }); return true; } catch (e) { return String(e.message).includes('not found') || false; } })());
const filled = await D.fillDocx(made, map);
const doc = new TextDecoder().decode((await D.unzip(filled)).get('word/document.xml'));
ok('placeholders are replaced and special characters are escaped', doc.includes('Mr &amp; Mrs Mehta &lt;A&gt;') && doc.includes('A-1401') && !doc.includes('{{'), doc.slice(0, 600));
ok('a value with line breaks becomes real line breaks in Word', doc.includes('Line one</w:t><w:br/><w:t xml:space="preserve">Line two'));
ok('an unknown placeholder becomes empty, not left in the letter', D.fillText('A {{nope}} B', {}) === 'A  B');

// a template as Word writes it: the placeholder split over three runs, compressed (deflate) by a normal zip tool
const body = '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Allotted to </w:t></w:r><w:r><w:t>{{cust</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>omer_na</w:t></w:r><w:r><w:t>me}} for flat {{flat_no}}.</w:t></w:r></w:p><w:p><w:r><w:t>Value {{ agreement_value }}</w:t></w:r></w:p></w:body></w:document>';
execSync(`python3 -I - <<'PY'
import zipfile
z = zipfile.ZipFile(${JSON.stringify(join(dir, 'word.docx'))}, 'w', zipfile.ZIP_DEFLATED)
z.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')
z.writestr('word/document.xml', ${JSON.stringify(body)})
z.writestr('word/media/pad.txt', 'x' * 5000)
z.close()
PY`);
const tpl = new Uint8Array(readFileSync(join(dir, 'word.docx')));
const out = await D.fillDocx(tpl, map);
const doc2 = new TextDecoder().decode((await D.unzip(out)).get('word/document.xml'));
ok('a compressed Word file is read and its split placeholders are joined and filled', doc2.includes('Allotted to Mr &amp; Mrs Mehta &lt;A&gt; for flat A-1401.') && doc2.includes('Value ₹ 3,85,00,000') && !doc2.includes('{{'), doc2);
ok('other parts of the file are kept', (await D.unzip(out)).has('word/media/pad.txt'));
writeFileSync(join(dir, 'out.docx'), out);
ok('the filled file is a valid zip too', /No errors detected|OK/i.test(execSync(`unzip -t ${join(dir, 'out.docx')}`).toString()));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
