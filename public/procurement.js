/* Sitely procurement helpers. Pure functions shared by the UI and tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SitelyProcurement = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function text(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 500); }

  function parseCsv(csv) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    const src = String(csv || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
    return rows.filter(r => r.some(v => String(v).trim()));
  }

  function importContractors(csv, current, makeId) {
    const rows = parseCsv(csv);
    if (!rows.length) return { contractors: current || [], added: 0, skipped: 0 };
    const headers = rows[0].map(v => text(v, 80).toLowerCase().replace(/[^a-z0-9]+/g, ''));
    const aliases = {
      company: ['company', 'companyname', 'business'], contact: ['contact', 'contactname', 'name'],
      email: ['email', 'emailaddress'], phone: ['phone', 'phonenumber', 'mobile'],
      trade: ['trade', 'scope', 'category'], notes: ['notes', 'note']
    };
    const col = {};
    for (const key of Object.keys(aliases)) col[key] = headers.findIndex(h => aliases[key].includes(h));
    const out = Array.isArray(current) ? current.slice() : [];
    const seen = new Set(out.map(c => (text(c.email, 200).toLowerCase() || (text(c.company, 200).toLowerCase() + '|' + text(c.contact, 200).toLowerCase()))));
    let added = 0, skipped = 0;
    for (const r of rows.slice(1)) {
      const get = key => col[key] >= 0 ? r[col[key]] : '';
      const c = {
        id: (makeId ? makeId() : ('ctr_' + Math.random().toString(36).slice(2, 12))).slice(0, 40),
        company: text(get('company'), 160), contact: text(get('contact'), 120),
        email: text(get('email'), 200).toLowerCase(), phone: text(get('phone'), 60),
        trade: text(get('trade'), 120), notes: text(get('notes'), 1000), active: true
      };
      if (!c.company && !c.contact) { skipped++; continue; }
      const key = c.email || (c.company.toLowerCase() + '|' + c.contact.toLowerCase());
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key); out.push(c); added++;
    }
    return { contractors: out, added, skipped };
  }

  function packetUrl(origin, jobId, req) {
    if (!req || !req.id || !req.token) return '';
    return String(origin || '').replace(/\/$/, '') + '/bid/' +
      [jobId, req.id, req.token].map(encodeURIComponent).join('/');
  }

  function mailto(req, contractor, jobName, origin, jobId) {
    const to = text(contractor && contractor.email, 200);
    const subject = 'Bid request - ' + text(req && req.title, 160) + ' - ' + text(jobName, 160);
    const lines = [
      'Hello ' + (text(contractor && contractor.contact, 120) || text(contractor && contractor.company, 160) || 'there') + ',', '',
      'Please review the bid invitation for ' + text(jobName, 160) + '.',
      text(req && req.scope, 4000),
      req && req.dueDate ? 'Bid due: ' + req.dueDate : '',
      packetUrl(origin, jobId, req) ? 'Plans and documents: ' + packetUrl(origin, jobId, req) : '', '',
      'Please email your estimate to ' + text(req && req.returnEmail, 200) + '.', '', 'Thank you,'
    ].filter((v, i, a) => v !== '' || (i && a[i - 1] !== ''));
    return 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\n'));
  }

  return { parseCsv, importContractors, packetUrl, mailto };
});
