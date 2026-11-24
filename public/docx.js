// docx.js — makes and fills Word (.docx) files in the browser with no library. A .docx is a zip of XML files.
//   DocxLib.textToDocx(text)            -> Uint8Array of a plain letter, one paragraph per line
//   await DocxLib.fillDocx(bytes, map)  -> the same Word file with every {{name}} replaced (even when Word split it across several pieces)
//   DocxLib.fillText(text, map)         -> the same replacement on plain text
// Files are stored uncompressed when made (Word opens them fine); compressed files are read with the browser's DecompressionStream.
const DocxLib = (() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const T = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

  function zipStore(files) {   // files: [{ name, data: Uint8Array }]
    const chunks = [], central = []; let offset = 0;
    const w16 = (v) => new Uint8Array([v & 255, (v >> 8) & 255]), w32 = (v) => new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
    const cat = (...a) => { const n = a.reduce((t, x) => t + x.length, 0), o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const local = cat(w32(0x04034b50), w16(20), w16(0x0800), w16(0), w16(0), w16(0x21), w32(crc), w32(size), w32(size), w16(name.length), w16(0), name, f.data);
      central.push(cat(w32(0x02014b50), w16(20), w16(20), w16(0x0800), w16(0), w16(0), w16(0x21), w32(crc), w32(size), w32(size), w16(name.length), w16(0), w16(0), w16(0), w16(0), w32(0), w32(offset), name));
      chunks.push(local); offset += local.length;
    }
    const cd = cat(...central);
    return cat(...chunks, cd, w32(0x06054b50), w16(0), w16(0), w16(files.length), w16(files.length), w32(cd.length), w32(offset), w16(0));
  }

  async function inflateRaw(bytes) {
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  async function unzip(buf) {   // -> Map name -> Uint8Array
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let e = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('This is not a Word file.');
    const count = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = new Map();
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The Word file looks damaged.');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
      const lnlen = dv.getUint16(lo + 26, true), lelen = dv.getUint16(lo + 28, true), start = lo + 30 + lnlen + lelen, raw = buf.subarray(start, start + csize);
      out.set(name, method === 0 ? raw.slice() : await inflateRaw(raw));
      p += 46 + nlen + elen + clen;
    }
    return out;
  }

  const fillText = (text, map) => String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (map[k] == null ? '' : String(map[k])));

  // Word often splits "{{customer_name}}" into several pieces. Work paragraph by paragraph: join the pieces, replace, write the result into the first piece.
  function fillXml(xml, map) {
    return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (para) => {
      const ts = [...para.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)];
      if (!ts.length) return para;
      const joined = ts.map((m) => unesc(m[1])).join('');
      if (!/\{\{\s*\w+\s*\}\}/.test(joined)) return para;
      const lines = fillText(joined, map).split('\n').map((l) => `<w:t xml:space="preserve">${esc(l)}</w:t>`).join('<w:br/>');
      let i = 0;
      return para.replace(/<w:t(?: [^>]*)?>[\s\S]*?<\/w:t>/g, () => (i++ === 0 ? lines : '<w:t></w:t>'));
    });
  }

  async function fillDocx(bytes, map) {
    const files = await unzip(bytes); const out = [];
    for (const [name, data] of files) {
      if (name.endsWith('/')) continue;
      out.push({ name, data: /^word\/(document|header\d*|footer\d*)\.xml$/.test(name) ? enc.encode(fillXml(dec.decode(data), map)) : data });
    }
    return zipStore(out);
  }

  function textToDocx(text) {
    const paras = String(text).replace(/\r/g, '').split('\n').map((l) => (l.trim() === '' ? '<w:p/>' : `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`)).join('');
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const files = [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
      ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`],
      ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${paras}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`],
    ];
    return zipStore(files.map(([name, xml]) => ({ name, data: enc.encode(xml) })));
  }

  return { zipStore, unzip, fillText, fillXml, fillDocx, textToDocx, crc32 };
})();
if (typeof module !== 'undefined') module.exports = DocxLib;
