/* Export the Ridgeline workspace back to .xlsx — patches the ORIGINAL workbook's
   sheet XMLs with the user's edits, preserving all formulas, styles and structure. */
(function () {
  'use strict';

  // ---- CRC32 ----
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function readZip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const e = {
        method: dv.getUint16(off + 10, true),
        time: dv.getUint16(off + 12, true),
        date: dv.getUint16(off + 14, true),
        crc: dv.getUint32(off + 16, true),
        compSize: dv.getUint32(off + 20, true),
        uncompSize: dv.getUint32(off + 24, true),
        lho: dv.getUint32(off + 42, true)
      };
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      e.name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nameLen));
      entries.push(e);
      off += 46 + nameLen + extraLen + commentLen;
    }
    for (const e of entries) {
      const nameLen = dv.getUint16(e.lho + 26, true);
      const extraLen = dv.getUint16(e.lho + 28, true);
      const start = e.lho + 30 + nameLen + extraLen;
      e.compData = bytes.subarray(start, start + e.compSize);
    }
    return entries;
  }

  async function inflate(data) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function deflate(data) {
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function writeZip(entries) {
    let size = 22;
    for (const e of entries) {
      const nb = new TextEncoder().encode(e.name);
      e.nameBytes = nb;
      size += 30 + nb.length + e.compData.length + 46 + nb.length;
    }
    const out = new Uint8Array(size);
    const dv = new DataView(out.buffer);
    let p = 0;
    for (const e of entries) {
      e.offset = p;
      dv.setUint32(p, 0x04034b50, true);
      dv.setUint16(p + 4, 20, true);
      dv.setUint16(p + 6, 0, true);
      dv.setUint16(p + 8, e.method, true);
      dv.setUint16(p + 10, e.time || 0, true);
      dv.setUint16(p + 12, e.date || 0x5884, true);
      dv.setUint32(p + 14, e.crc, true);
      dv.setUint32(p + 18, e.compData.length, true);
      dv.setUint32(p + 22, e.uncompSize, true);
      dv.setUint16(p + 26, e.nameBytes.length, true);
      dv.setUint16(p + 28, 0, true);
      out.set(e.nameBytes, p + 30);
      out.set(e.compData, p + 30 + e.nameBytes.length);
      p += 30 + e.nameBytes.length + e.compData.length;
    }
    const cdStart = p;
    for (const e of entries) {
      dv.setUint32(p, 0x02014b50, true);
      dv.setUint16(p + 4, 20, true);
      dv.setUint16(p + 6, 20, true);
      dv.setUint16(p + 8, 0, true);
      dv.setUint16(p + 10, e.method, true);
      dv.setUint16(p + 12, e.time || 0, true);
      dv.setUint16(p + 14, e.date || 0x5884, true);
      dv.setUint32(p + 16, e.crc, true);
      dv.setUint32(p + 20, e.compData.length, true);
      dv.setUint32(p + 24, e.uncompSize, true);
      dv.setUint16(p + 28, e.nameBytes.length, true);
      dv.setUint32(p + 42, e.offset, true);
      out.set(e.nameBytes, p + 46);
      p += 46 + e.nameBytes.length;
    }
    dv.setUint32(p, 0x06054b50, true);
    dv.setUint16(p + 8, entries.length, true);
    dv.setUint16(p + 10, entries.length, true);
    dv.setUint32(p + 12, p - cdStart, true);
    dv.setUint32(p + 16, cdStart, true);
    return out;
  }

  const escXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function cellXml(ref, sAttr, value) {
    const s = sAttr ? ' s="' + sAttr + '"' : '';
    if (value === null || value === undefined || value === '') return '<c r="' + ref + '"' + s + '/>';
    if (typeof value === 'number' && isFinite(value)) return '<c r="' + ref + '"' + s + '><v>' + value + '</v></c>';
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + escXml(value) + '</t></is></c>';
  }

  function colNum(ref) {
    const m = /^([A-Z]+)/.exec(ref);
    let n = 0;
    for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64;
    return n;
  }

  function patchSheetXml(xml, edits) {
    for (const ref in edits) {
      const val = edits[ref];
      const rowNum = +(/(\d+)$/.exec(ref)[1]);
      // existing cell?
      const cellRe = new RegExp('<c r="' + ref + '"([^>]*?)(?:/>|>[\\s\\S]*?</c>)');
      const m = cellRe.exec(xml);
      if (m) {
        const sAttr = (/\ss="(\d+)"/.exec(m[1]) || [])[1];
        xml = xml.slice(0, m.index) + cellXml(ref, sAttr, val) + xml.slice(m.index + m[0].length);
        continue;
      }
      // existing row?
      const rowRe = new RegExp('(<row r="' + rowNum + '"[^>]*>)([\\s\\S]*?)(</row>)');
      const rm = rowRe.exec(xml);
      if (rm) {
        // insert in column order
        const myCol = colNum(ref);
        let body = rm[2];
        let insertAt = body.length;
        const cRefRe = /<c r="([A-Z]+\d+)"/g;
        let cm;
        while ((cm = cRefRe.exec(body))) {
          if (colNum(cm[1]) > myCol) { insertAt = cm.index; break; }
        }
        body = body.slice(0, insertAt) + cellXml(ref, null, val) + body.slice(insertAt);
        xml = xml.slice(0, rm.index) + rm[1] + body + rm[3] + xml.slice(rm.index + rm[0].length);
        continue;
      }
      // row missing entirely: insert before first row with larger r, else before </sheetData>
      const newRow = '<row r="' + rowNum + '">' + cellXml(ref, null, val) + '</row>';
      const allRows = /<row r="(\d+)"/g;
      let pos = -1, am;
      while ((am = allRows.exec(xml))) {
        if (+am[1] > rowNum) { pos = am.index; break; }
      }
      if (pos < 0) pos = xml.indexOf('</sheetData>');
      if (pos < 0) continue;
      xml = xml.slice(0, pos) + newRow + xml.slice(pos);
    }
    return xml;
  }

  const SHEET_NAMES = ['Read Me', 'Settings', 'Specifications', 'Estimate', 'Allowances', 'Schedule', 'Calendar', 'Exclusions', 'Draws', 'Material Takeoff', 'Material Estimate', 'Calculators', 'Price Database'];

  window.RidgelineExportXlsx = async function (edits, filename) {
    const resp = await fetch('uploads/template.xlsx');
    if (!resp.ok) throw new Error('Could not load original workbook');
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const entries = readZip(bytes);

    // group edits by sheet
    const bySheet = {};
    for (const key in edits) {
      const i = key.indexOf('!');
      const sn = key.slice(0, i), ref = key.slice(i + 1);
      (bySheet[sn] = bySheet[sn] || {})[ref] = edits[key];
    }

    const out = [];
    for (const e of entries) {
      const sm = /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(e.name);
      const sheetName = sm ? SHEET_NAMES[+sm[1] - 1] : null;
      if (sheetName && bySheet[sheetName]) {
        const raw = e.method === 0 ? e.compData : await inflate(e.compData);
        let xml = new TextDecoder().decode(raw);
        xml = patchSheetXml(xml, bySheet[sheetName]);
        // force full recalc so Excel refreshes dependent formulas on open
        const uncomp = new TextEncoder().encode(xml);
        out.push({ name: e.name, method: 8, compData: await deflate(uncomp), crc: crc32(uncomp), uncompSize: uncomp.length, time: e.time, date: e.date });
      } else if (e.name === 'xl/workbook.xml' && Object.keys(bySheet).length) {
        const raw = e.method === 0 ? e.compData : await inflate(e.compData);
        let xml = new TextDecoder().decode(raw);
        if (/<calcPr /.test(xml)) xml = xml.replace(/<calcPr [^>]*\/>/, '<calcPr fullCalcOnLoad="true"/>');
        else xml = xml.replace('</workbook>', '<calcPr fullCalcOnLoad="true"/></workbook>');
        const uncomp = new TextEncoder().encode(xml);
        out.push({ name: e.name, method: 8, compData: await deflate(uncomp), crc: crc32(uncomp), uncompSize: uncomp.length, time: e.time, date: e.date });
      } else {
        out.push({ name: e.name, method: e.method, compData: e.compData, crc: e.crc, uncompSize: e.uncompSize, time: e.time, date: e.date });
      }
    }

    const zipBytes = writeZip(out);
    const blob = new Blob([zipBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'Ridgeline_Project.xlsx';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  };
})();
