/* Keystone — catalog / templates / estimate / dashboard module.
 * v2: "Where it all comes together" design — ledger aesthetic, themeable via CSS vars.
 * Data model unchanged from v1:
 *   catalog  = { settings, categories, items(+costLines), priceList, exclusions }
 *   job.estimate = per-job snapshot; job.schedule = [{task,start,finish,status,pct}]
 */
(function () {
  const el = (...a) => React.createElement(...a);
  let idc = Date.now() % 100000;
  const nid = p => p + '_' + (++idc) + '_' + Math.random().toString(36).slice(2, 6);

  // ---------- design tokens (all colors via CSS variables → themeable) ----------
  const T = {
    bg: 'var(--bg,#F6F3ED)', sf: 'var(--sf,#FDFBF7)', s2: 'var(--s2,#EBE5D8)',
    ln: 'var(--ln,#D9D2C4)', tx: 'var(--tx,#26211A)', mu: 'var(--mu,#7A6F60)', ac: 'var(--ac,#A64B24)'
  };
  const serif = "'Source Serif 4',serif";
  const sans = "'Instrument Sans',sans-serif";

  // Two-menu theming: PAPER (surfaces & text) × ACCENT (the one working color).
  const PAPERS = [
    { id: 'white',    name: 'White',      tag: 'clean & standard', v: { bg: '#FFFFFF', sf: '#FAFAFA', s2: '#F1F1F0', ln: '#E4E3E0', tx: '#232019', mu: '#8A857B' } },
    { id: 'coolgrey', name: 'Cool Grey',  tag: 'soft on the eyes', v: { bg: '#F6F7F8', sf: '#FDFDFE', s2: '#ECEEF0', ln: '#DDE0E3', tx: '#1F242A', mu: '#75808B' } },
    { id: 'warm',     name: 'Warm Paper', tag: 'the ledger feel',  v: { bg: '#F6F3ED', sf: '#FDFBF7', s2: '#EBE5D8', ln: '#D9D2C4', tx: '#26211A', mu: '#7A6F60' } },
    { id: 'graphite', name: 'Graphite',   tag: 'dark workshop',    v: { bg: '#191A1C', sf: '#202225', s2: '#292B2F', ln: '#37393E', tx: '#ECECEA', mu: '#9C9C96' } },
    { id: 'night',    name: 'Night',      tag: 'true dark',        v: { bg: '#101214', sf: '#17191C', s2: '#1F2226', ln: '#2D3136', tx: '#E9EAEB', mu: '#8F959C' } }
  ];
  const ACCENTS = [
    { id: 'rust',    name: 'Ridgeline Rust', c: '#A64B24', dark: '#D97B4A' },
    { id: 'blue',    name: 'Ink Blue',       c: '#2F5B93', dark: '#7CA9DB' },
    { id: 'olive',   name: 'Olive',          c: '#5F6B2B', dark: '#A9BC6B' },
    { id: 'oxblood', name: 'Oxblood',        c: '#8E1F14', dark: '#D9614E' },
    { id: 'ink',     name: 'Charcoal',       c: '#3A3A3A', dark: '#C8C8CC' },
    { id: 'teal',    name: 'Teal',           c: '#1F6E6B', dark: '#63BDB9' }
  ];
  const THEMES = PAPERS; // legacy export shape

  function applyTheme(paperId, accentId) {
    const p = PAPERS.find(x => x.id === paperId) || PAPERS[0];
    const a = ACCENTS.find(x => x.id === accentId) || ACCENTS[0];
    const dark = p.id === 'graphite' || p.id === 'night';
    const root = document.documentElement;
    for (const k in p.v) root.style.setProperty('--' + k, p.v[k]);
    root.style.setProperty('--ac', dark ? a.dark : a.c);
    document.body.style.background = p.v.bg;
    try { localStorage.setItem('keystone_paper', p.id); localStorage.setItem('keystone_accent', a.id); } catch (e) {}
    return p.id + '/' + a.id;
  }
  function currentTheme() {
    try {
      return [localStorage.getItem('keystone_paper') || 'white', localStorage.getItem('keystone_accent') || 'rust'];
    } catch (e) { return ['white', 'rust']; }
  }

  const fmt$ = n => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt$0 = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
  const num = v => { const n = parseFloat(String(v).replace(/[$,%\s,]/g, '')); return isNaN(n) ? 0 : n; };

  // ---------- expand/collapse (ksOpen is a map of open item ids) ----------
  const ksIsOpen = (c, id) => !!(c.state.ksOpen && typeof c.state.ksOpen === 'object' && c.state.ksOpen[id]);
  const ksToggle = (c, id) => { const o = (c.state.ksOpen && typeof c.state.ksOpen === 'object') ? Object.assign({}, c.state.ksOpen) : {}; if (o[id]) delete o[id]; else o[id] = true; c.setState({ ksOpen: o }); };
  const ksExpandAll = (c, ids) => { const o = {}; ids.forEach(id => { o[id] = true; }); c.setState({ ksOpen: o }); };
  const ksCollapseAll = (c) => c.setState({ ksOpen: {} });

  // ---------- math (unchanged) ----------
  function lineCalc(l, settings) {
    const cost = (Number(l.qty) || 0) * (Number(l.unitCost) || 0);
    const mk = l.markupPct != null ? Number(l.markupPct) : settings.defaultMarkupPct;
    const price = cost * (1 + mk);
    const tax = l.taxable ? price * settings.salesTaxPct : 0;
    return { cost, price, tax, total: price + tax, mkAmt: cost * mk };
  }
  function itemCalc(item, settings) {
    const t = { cost: 0, price: 0, tax: 0, total: 0, mkAmt: 0 };
    for (const l of item.costLines) { const c = lineCalc(l, settings); t.cost += c.cost; t.price += c.price; t.tax += c.tax; t.total += c.total; t.mkAmt += c.mkAmt; }
    return t;
  }
  function estTotals(est) {
    const t = { cost: 0, price: 0, tax: 0, total: 0, allowances: 0 };
    for (const it of est.items) {
      if (it.excluded) continue;
      const c = itemCalc(it, est.settings);
      t.cost += c.cost; t.price += c.price; t.tax += c.tax; t.total += c.total;
      if (it.allowance) t.allowances += c.total;
    }
    return t;
  }

  // ---------- data ----------
  async function ensureCatalog(S) {
    let cat = null;
    try {
      cat = await S.api('/catalog');
    } catch (e) {
      if (String(e.message).indexOf('not found') === -1) throw e;
      const resp = await fetch('catalog-seed.json');
      const seed = await resp.json();
      await S.api('/catalog', { method: 'PUT', body: JSON.stringify(seed) });
      return seed;
    }
    if ((cat.version || 1) < 2 && (cat.exclusions || []).indexOf('TOTAL EXCLUDED VALUE') !== -1) {
      try {
        const resp = await fetch('catalog-seed.json');
        const seed = await resp.json();
        cat.exclusions = seed.exclusions;
        cat.version = 2;
        await S.api('/catalog', { method: 'PUT', body: JSON.stringify(cat) });
      } catch (e) {}
    }
    return cat;
  }

  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

  function snapshot(catalog, itemIds) {
    const wanted = itemIds ? new Set(itemIds) : null;
    const items = catalog.items.filter(i => !wanted || wanted.has(i.id)).map(i => {
      const c = deepCopy(i);
      c.excluded = false;
      return c;
    });
    const usedCats = new Set(items.map(i => i.categoryId));
    return {
      settings: deepCopy(catalog.settings),
      categories: catalog.categories.filter(c => usedCats.has(c.id)).map(deepCopy),
      items,
      exclusions: deepCopy(catalog.exclusions || [])
    };
  }

  // ---------- ui atoms ----------
  const label = (t, extra) => el('div', { style: Object.assign({ fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.16em', color: T.mu }, extra || {}) }, t);
  const serifHead = (t, size) => el('div', { style: { fontFamily: serif, fontWeight: 600, fontSize: (size || 20) + 'px', color: T.tx } }, t);

  function btn(labelTxt, onClick, kind) {
    const styles = {
      solid: { background: T.tx, color: T.bg, border: 'none', padding: '10px 17px' },
      accent: { background: 'transparent', color: T.ac, border: 'none', padding: '6px 4px' },
      line: { background: 'transparent', color: T.tx, border: '1.5px solid ' + T.tx, padding: '9px 16px' },
      danger: { background: 'transparent', color: T.ac, border: '1px solid ' + T.ln, padding: '7px 13px' }
    }[kind || 'line'];
    return el('button', {
      onClick, style: Object.assign({ fontFamily: sans, fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }, styles)
    }, labelTxt);
  }

  function cellInput(c, value, onCommit, opts) {
    opts = opts || {};
    return el('input', {
      className: opts.className,
      defaultValue: value == null ? '' : String(value),
      onFocus: e => e.target.select(),
      onBlur: e => { onCommit(e.target.value); c.ksTouch(); },
      onKeyDown: e => { if (e.key === 'Enter') e.target.blur(); },
      style: {
        border: '1px solid transparent', borderBottom: '1px dotted ' + T.ln, borderRadius: 0,
        padding: '3px 5px', fontSize: '13px', fontFamily: sans, background: 'transparent',
        width: opts.w || '100%', textAlign: opts.align || 'left', color: T.tx,
        fontVariantNumeric: 'tabular-nums'
      }
    });
  }

  function taxPill(c, l, save) {
    return el('span', {
      onClick: () => { l.taxable = !l.taxable; save(); c.ksTick(); },
      style: {
        display: 'inline-block', minWidth: '24px', textAlign: 'center', padding: '1px 7px',
        fontSize: '10.5px', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.08em',
        background: l.taxable ? T.tx : 'transparent', color: l.taxable ? T.bg : T.mu,
        border: '1px solid ' + (l.taxable ? T.tx : T.ln)
      }
    }, l.taxable ? 'TAX' : '—');
  }

  function chip(txt, onClick) {
    return el('span', {
      onClick: onClick ? (e => { e.stopPropagation(); onClick(e); }) : undefined,
      title: onClick ? 'Edit' : undefined,
      style: { fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', color: T.ac, border: '1px solid ' + T.ac, padding: '1px 7px', marginLeft: '8px', verticalAlign: 'middle', whiteSpace: 'nowrap', cursor: onClick ? 'pointer' : 'inherit' }
    }, txt);
  }

  const iconBtn = (txt, title, onClick) => el('span', { title, onClick, style: { cursor: 'pointer', color: T.mu, fontSize: '13px', padding: '0 4px' } }, txt);

  // numeric stepper: [−] n [+] — value read via getter so re-renders stay honest
  function stepper(c, get, set, min) {
    const v = get();
    const b = (txt, d) => el('button', {
      onClick: () => { set(Math.max(min, get() + d)); c.ksTick(); },
      style: { width: '20px', height: '20px', border: '1px solid ' + T.ln, background: T.sf, color: T.mu, fontSize: '12px', fontWeight: 700, cursor: 'pointer', lineHeight: '16px', padding: 0, fontFamily: sans }
    }, txt);
    return el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' } },
      b('−', -1),
      el('span', { style: { minWidth: '22px', textAlign: 'center', fontSize: '12.5px', fontVariantNumeric: 'tabular-nums', color: T.tx, fontWeight: 600 } }, String(v)),
      b('＋', 1));
  }

  function wrap(children) {
    return el('div', { style: { fontFamily: sans, color: T.tx } }, ...children);
  }

  // ---------- pending notes (PM -> office) ----------
  function collectPending(jobsMeta, detail) {
    const out = [];
    for (const m of jobsMeta) {
      const j = detail[m.id];
      for (const n of ((j && j.pendingNotes) || [])) {
        if (n.status === 'pending') out.push({ job: m, note: n });
      }
    }
    return out;
  }

  function officeInboxCard(c, jobsMeta, detail) {
    const pending = collectPending(jobsMeta, detail);
    if (!pending.length) return null;
    const act = async (p, status) => {
      const j = detail[p.job.id];
      const notes = (j.pendingNotes || []).map(n => n.id === p.note.id ? Object.assign({}, n, { status }) : n);
      j.pendingNotes = notes;
      try { await c.ksApi('/jobs/' + p.job.id, { method: 'PUT', body: JSON.stringify({ pendingNotes: notes }) }); } catch (e) { alert('Could not save: ' + e.message); }
      c.ksTick();
    };
    return el('div', { style: { border: '1.5px solid ' + T.ac, padding: '20px 22px', background: T.sf, marginBottom: '18px' } },
      label('OFFICE INBOX — ' + pending.length + ' PENDING', { borderBottom: '1px solid ' + T.ln, paddingBottom: '8px', color: T.ac }),
      ...pending.slice(0, 8).map((p, i) => el('div', { key: i, style: { padding: '11px 0', borderBottom: '1px dashed ' + T.ln } },
        el('div', { style: { fontSize: '11px', color: T.mu, marginBottom: '3px' } },
          p.note.by + ' · ' + p.job.name + ' · ' + (p.note.target || 'general') + ' · ' + new Date(p.note.ts).toLocaleDateString()),
        el('div', { style: { fontSize: '13.5px', color: T.tx, lineHeight: 1.5 } }, p.note.text),
        el('div', { style: { display: 'flex', gap: '10px', marginTop: '7px' } },
          btn('Approve', () => act(p, 'approved'), 'accent'),
          btn('Dismiss', () => act(p, 'rejected'), 'danger')))));
  }

  function pmNoteCard(c) {
    const jobsMeta = c.state.jobs || [];
    const s = c._pmNote = c._pmNote || { jobId: null, target: 'general', text: '' };
    const jobId = s.jobId || c.state.jobId || (jobsMeta[0] && jobsMeta[0].id);
    const send = async () => {
      if (!s.text.trim()) { alert('Write the note first.'); return; }
      const by = (window.RidgelineSync && window.RidgelineSync.userName()) || 'PM';
      const note = { id: 'n' + Date.now() + Math.random().toString(36).slice(2, 6), by, target: s.target, text: s.text.trim(), ts: Date.now(), status: 'pending' };
      try {
        const j = await c.ksApi('/jobs/' + jobId);
        const notes = (j.pendingNotes || []).concat([note]);
        await c.ksApi('/jobs/' + jobId, { method: 'PUT', body: JSON.stringify({ pendingNotes: notes }) });
        if (c.ksJobCache && c.ksJobCache[jobId]) c.ksJobCache[jobId].pendingNotes = notes;
        if (c.state.jobId === jobId) c.jobPendingNotes = notes;
        s.text = ''; c._pmNoteSent = true;
        c.ksTick();
      } catch (e) { alert('Could not send: ' + e.message); }
    };
    const sel = (value, opts, onCh) => el('select', {
      value, onChange: e => { onCh(e.target.value); c.ksTick(); },
      style: { border: '1px solid ' + T.ln, background: T.sf, color: T.tx, padding: '8px 10px', fontSize: '13px', fontFamily: sans, width: '100%' }
    }, ...opts.map(o => el('option', { key: o[0], value: o[0] }, o[1])));
    return el('div', { style: { border: '1px solid ' + T.tx, padding: '20px 22px', background: T.sf, marginBottom: '18px' } },
      label('NOTE TO THE OFFICE', { borderBottom: '1px solid ' + T.ln, paddingBottom: '8px' }),
      el('div', { style: { fontSize: '12px', color: T.mu, margin: '10px 0' } }, 'Goes to the office for approval — nothing changes on documents until it’s signed off.'),
      el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' } },
        sel(jobId, jobsMeta.map(m => [m.id, m.name]), v => { s.jobId = v; }),
        sel(s.target, [['general', 'General'], ['schedule', 'Schedule'], ['estimate', 'Estimate'], ['draws', 'Draw schedule']], v => { s.target = v; })),
      el('textarea', {
        value: s.text, placeholder: 'What does the office need to know?',
        onChange: e => { s.text = e.target.value; c.ksTick(); },
        style: { width: '100%', minHeight: '70px', border: '1px solid ' + T.ln, padding: '10px 12px', fontSize: '13.5px', fontFamily: sans, background: T.bg, color: T.tx, resize: 'vertical' }
      }),
      el('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', marginTop: '8px' } },
        btn('Send to office', send, 'solid'),
        c._pmNoteSent ? el('span', { style: { fontSize: '12px', color: T.ac, fontWeight: 600 } }, '✓ sent') : null));
  }

  // ---------- HOME (the morning sheet) ----------
  function viewHome(c) {
    const role = c.state.role || 'admin';
    const jobsMeta = c.state.jobs || [];
    const detail = c.ksJobCache = c.ksJobCache || {};
    // lazily hydrate estimates for dashboard numbers
    for (const m of jobsMeta) {
      if (detail[m.id] === undefined) {
        detail[m.id] = null;
        c.ksApi('/jobs/' + m.id).then(j => { detail[m.id] = j; c.ksTick(); }).catch(() => { detail[m.id] = false; });
      }
    }

    const nowMs = Date.now(), yearAgoMs = nowMs - 365 * 86400000;
    let under = 0, active = 0, leftToInvoice = 0, completed12 = 0;
    const rows = [];
    jobsMeta.forEach((m, ix) => {
      const j = detail[m.id];
      const status = jobStatusOf(m, detail);
      let amt = '…', pct = 0, phase = '—', total = 0;
      if (j && j.estimate) {
        const t = estTotals(j.estimate);
        total = t.total; amt = fmt$0(t.total);
        if (status === 'active') {
          under += t.total; active++;
          let billed = 0;
          for (const d of ((j.draws) || [])) { if (d.status === 'PAID' || d.status === 'INVOICED') billed += total * (Number(d.pct) || 0) / 100; }
          leftToInvoice += Math.max(0, total - billed);
        }
        if (status === 'warranty' || status === 'archive') {
          const comp = j.warrantyStart ? new Date(j.warrantyStart + 'T00:00:00').getTime() : (m.updatedAt || 0);
          if (comp >= yearAgoMs) completed12 += t.total;
        }
      } else if (j) { amt = '—'; }
      const sched = (j && j.schedule) || [];
      let upcoming = [];
      if (sched.length) {
        const done = sched.filter(s => s.status === 'Complete').length;
        pct = Math.round(100 * (done + 0.5 * sched.filter(s => s.status === 'In Progress').length) / sched.length);
        const cur = sched.find(s => s.status === 'In Progress') || sched.find(s => s.status !== 'Complete');
        if (cur) phase = cur.task.replace(/^\d{4}\s*/, '');
        else if (done === sched.length && done > 0) phase = 'Complete';
        upcoming = sched.filter(s => s.status !== 'Complete').slice()
          .sort((a, b) => String(a.start || '9999').localeCompare(String(b.start || '9999'))).slice(0, 2)
          .map(s => ({ task: s.task.replace(/^\d{4}\s*/, ''), start: s.start, status: s.status }));
      }
      if (status === 'warranty' && j && j.warrantyStart) {
        phase = 'warranty since ' + new Date(j.warrantyStart + 'T00:00:00').toLocaleDateString();
        pct = 100;
      }
      rows.push({ m, ix, amt, pct, phase, status, upcoming });
    });

    const kpis = [
      { label: 'UNDER CONTRACT', value: fmt$0(under), sub: active + ' active project' + (active === 1 ? '' : 's') },
      { label: 'LEFT TO INVOICE', value: fmt$0(leftToInvoice), sub: 'across active jobs' },
      { label: 'COMPLETED · 12 MO', value: fmt$0(completed12), sub: 'contract value' }
    ];

    // week ahead: schedule rows across jobs touching the next 7 days
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const week = [];
    const dayName = d => ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()];
    for (const m of jobsMeta) {
      if (jobStatusOf(m, detail) !== 'active') continue; // only live projects make the week ahead
      const j = detail[m.id];
      for (const s of ((j && j.schedule) || [])) {
        const st = new Date(s.start + 'T00:00:00');
        const diff = (st - today) / 86400000;
        if (diff >= 0 && diff < 7) week.push({ d: st, day: dayName(st), task: s.task.replace(/^\d{4}\s*/, '') + (s.status === 'In Progress' ? ' (in progress)' : ' starts'), job: m.name });
      }
    }
    week.sort((a, b) => a.d - b.d);

    const kids = [];
    if (role === 'admin') {
      kids.push(el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3,auto)', justifyContent: 'start', borderTop: '1px solid ' + T.ln, borderBottom: '1px solid ' + T.ln, marginBottom: '26px', maxWidth: '600px' } },
        ...kpis.map((k, i) => el('div', { key: i, style: { padding: '11px 20px 12px 0', borderRight: i < 2 ? '1px solid ' + T.ln : 'none', marginRight: i < 2 ? '20px' : 0 } },
          label(k.label),
          el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '19px', marginTop: '4px', fontVariantNumeric: 'tabular-nums', color: T.tx } }, k.value),
          el('div', { style: { fontSize: '11px', color: T.mu, fontWeight: 600, marginTop: '2px', minHeight: '14px' } }, k.sub)))));
    } else {
      kids.push(el('div', { style: { borderTop: '2px solid ' + T.tx, borderBottom: '1px solid ' + T.ln, marginBottom: '34px', padding: '18px 0' } },
        label('FIELD VIEW'),
        el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '24px', marginTop: '6px', color: T.tx } },
          (function () { const n = rows.filter(r => r.status === 'active').length; return n + ' active project' + (n === 1 ? '' : 's'); })()),
        el('div', { style: { fontSize: '12.5px', color: T.mu, marginTop: '4px' } }, 'Schedules are yours to run — notes go to the office for sign-off.')));
    }

    kids.push(el('div', { className: 'ks-home-grid', style: { display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: '44px', alignItems: 'start' } },
      el('div', null,
        el('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' } },
          serifHead('On the books'),
          role === 'admin' ? btn('＋ New job', () => { c._newJob = null; c.go('KS:NewJob'); }, 'accent') : null),
        ...(function () {
          const jobRow = (r, n, dim) => el('div', {
            key: r.m.id,
            onClick: () => { c.openJob(r.m.id); c.go(role === 'admin' ? 'KS:Estimate' : 'KS:Schedule'); },
            style: { display: 'flex', alignItems: 'baseline', gap: '18px', padding: '15px 0', borderTop: '1px solid ' + T.ln, cursor: 'pointer', opacity: dim ? 0.55 : 1 }
          },
            el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '15px', color: T.mu, width: '28px', flex: '0 0 28px' } }, String(n).padStart(2, '0')),
            el('div', { style: { flex: 1, minWidth: 0 } },
              el('div', { style: { fontWeight: 700, fontSize: '15px', color: T.tx } }, r.m.name,
                r.m.id === c.state.jobId ? chip('OPEN') : null),
              el('div', { style: { fontSize: '12.5px', color: T.mu, marginTop: '1px' } }, 'phase — ', el('span', { style: { color: T.ac, fontWeight: 600 } }, r.phase)),
              (r.upcoming && r.upcoming.length && r.status === 'active') ? el('div', { style: { marginTop: '5px', display: 'flex', flexDirection: 'column', gap: '2px' } },
                ...r.upcoming.map((u, ui) => el('div', {
                  key: ui, title: 'Open schedule',
                  onClick: (e) => { e.stopPropagation(); c.openJob(r.m.id); c.go('KS:Schedule'); },
                  style: { fontSize: '11.5px', color: T.mu, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
                },
                  el('span', { style: { color: T.ac, fontWeight: 700 } }, u.status === 'In Progress' ? '▸ ' : '□ '),
                  u.task,
                  u.start ? el('span', { style: { opacity: 0.65 } }, '  ' + new Date(u.start + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) : null))) : null),
            el('div', { style: { width: '130px', height: '5px', background: T.s2, alignSelf: 'center' } },
              el('div', { style: { height: '100%', width: r.pct + '%', background: T.ac } })),
            role === 'admin' ? el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '17px', fontVariantNumeric: 'tabular-nums', color: T.tx, width: '110px', textAlign: 'right' } }, r.amt) : null,
            (role === 'admin' && r.status === 'active') ? el('span', { title: 'Note on the whiteboard for this job', onClick: e => { e.stopPropagation(); const t = window.prompt('Whiteboard note for ' + r.m.name + ':'); if (t && t.trim()) { c.ksLoadBoard(); if (!c.ksBoardCache) c.ksBoardCache = { notes: [] }; c.ksBoardCache.notes.unshift({ id: nid('bn'), text: t.trim(), items: null, jobId: r.m.id, by: (window.RidgelineSync && window.RidgelineSync.userName()) || 'office', ts: Date.now() }); c.ksSaveBoard(); c.ksTick(); } }, style: { color: T.ac, fontSize: '15px', cursor: 'pointer' } }, '☑') : null,
            role === 'admin' ? el('span', { title: 'Customer / settings', onClick: e => { e.stopPropagation(); c.openJob(r.m.id); c.go('KS:Customer'); }, style: { color: T.mu, fontSize: '15px', cursor: 'pointer' } }, '⚙') : null,
            role === 'admin' ? el('span', { title: 'Rename', onClick: e => { e.stopPropagation(); c.renameJobUI(r.m.id, r.m.name); }, style: { color: T.mu, fontSize: '12px', cursor: 'pointer' } }, '✎') : null,
            role === 'admin' ? el('span', { title: 'Delete job', onClick: e => { e.stopPropagation(); c.deleteJobUI(r.m.id, r.m.name); }, style: { color: T.mu, fontSize: '14px', cursor: 'pointer' } }, '×') : null);
          const out = [];
          let n = 0;
          const actives = rows.filter(r => r.status === 'active');
          if (actives.length) actives.forEach(r => out.push(jobRow(r, ++n, false)));
          else out.push(el('div', { style: { padding: '16px 0', borderTop: '1px solid ' + T.ln, fontSize: '13px', color: T.mu } }, 'No active projects — set one live on its Customer page.'));
          const groups = [['prospect', 'PROSPECTS'], ['warranty', 'WARRANTY'], ['archive', 'ARCHIVE']];
          for (const [sid, lbl] of groups) {
            const g = rows.filter(r => r.status === sid);
            if (!g.length) continue;
            out.push(label(lbl + ' — ' + g.length, { marginTop: '26px', marginBottom: '2px', paddingBottom: '6px' }));
            g.forEach(r => out.push(jobRow(r, ++n, sid === 'archive')));
          }
          return out;
        })()),
      el('div', null,
        role === 'admin' ? officeInboxCard(c, jobsMeta, detail) : null,
        role === 'pm' ? pmNoteCard(c) : null,
        el('div', { style: { border: '1px solid ' + T.tx, padding: '20px 22px', background: T.sf, marginBottom: '24px' } },
          label('WHITEBOARD', { borderBottom: '1px solid ' + T.ln, paddingBottom: '8px' }),
          (function () {
            c.ksLoadBoard();
            const notes = (c.ksBoardCache && c.ksBoardCache.notes) || [];
            const nag = notes.filter(n2 => n2.jobId);
            if (!notes.length) return el('div', { style: { padding: '12px 0', fontSize: '13px', color: T.mu } }, 'Board’s clear — brain-dump anything on the Whiteboard tab and drag it to a job.');
            return el('div', null,
              nag.length ? el('div', { style: { padding: '9px 12px', margin: '10px 0 4px 0', border: '1.5px solid ' + T.ac, background: T.bg, fontSize: '12.5px', color: T.tx, fontWeight: 600 } },
                '🔔 ' + nag.length + ' note' + (nag.length === 1 ? '' : 's') + ' assigned to a job but NOT scheduled') : null,
              ...notes.slice(0, 6).map((n2, i) => el('div', { key: i, onClick: () => c.go('KS:Board'), style: { display: 'flex', gap: '10px', alignItems: 'baseline', padding: '8px 0', borderBottom: '1px dashed ' + T.ln, cursor: 'pointer' } },
                el('span', { style: { color: n2.jobId ? T.ac : T.mu, fontWeight: 700, fontSize: '12px', flex: '0 0 auto' } }, n2.jobId ? '⚑' : '·'),
                el('div', { style: { flex: 1, minWidth: 0 } },
                  el('div', { style: { fontSize: '13.5px', color: T.tx, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, noteSummary(n2)),
                  n2.jobId ? el('div', { style: { fontSize: '11.5px', color: T.mu } }, ((c.state.jobs || []).find(m2 => m2.id === n2.jobId) || {}).name || '') : null))),
              el('div', { style: { marginTop: '10px' } }, btn('Open the whiteboard →', () => c.go('KS:Board'), 'accent')));
          })()),
        el('div', { style: { border: '1px solid ' + T.tx, padding: '22px 24px', background: T.sf } },
          label('THE WEEK AHEAD', { borderBottom: '1px solid ' + T.ln, paddingBottom: '8px' }),
          week.length ? week.slice(0, 7).map((w, i) => el('div', { key: i, style: { display: 'flex', gap: '14px', alignItems: 'baseline', padding: '11px 0', borderBottom: '1px dashed ' + T.ln } },
            el('div', { style: { width: '34px', flex: '0 0 34px', fontFamily: serif, fontWeight: 700, fontSize: '13px', color: T.ac } }, w.day),
            el('div', { style: { flex: 1 } },
              el('div', { style: { fontSize: '13.5px', fontWeight: 600, color: T.tx } }, w.task),
              el('div', { style: { fontSize: '11.5px', color: T.mu } }, w.job))))
            : el('div', { style: { padding: '14px 0', fontSize: '13px', color: T.mu } }, 'Nothing scheduled in the next 7 days. Dates come from each job’s Schedule worksheet.')))
    ));
    return wrap(kids);
  }

  // ---------- ESTIMATE (ledger table, editable) ----------
  function viewEstimate(c) {
    const est = c.jobEstimate;
    if (!est) {
      return wrap([el('div', { style: { border: '1px solid ' + T.ln, background: T.sf, padding: '26px 28px', maxWidth: '640px' } },
        el('div', { style: { fontSize: '14px', color: T.mu, lineHeight: 1.6 } },
          'This job doesn’t have a Sitely estimate yet — it’s from the workbook days. Start one now; the worksheets are untouched either way.'),
        el('div', { style: { marginTop: '14px', display: 'flex', gap: '10px' } },
          btn('Start from full catalog', () => { c.jobEstimate = snapshot(c.catalog, null); c.ksSaveJobData(); c.ksTick(); }, 'solid'),
          btn('Start blank', () => { c.jobEstimate = snapshot(c.catalog, []); c.ksSaveJobData(); c.ksTick(); })))]);
    }
    const S = est.settings;
    const tot = estTotals(est);
    const grid = '60px 1fr 64px 50px 104px 88px 118px 44px';
    const kids = [];

    // verification watermark: rough-quote lines stay flagged until touched or checked
    const unverified = est.items.reduce((a, it) => a + (it.excluded ? 0 : it.costLines.filter(l => l.verified === false).length), 0);
    if (unverified > 0) {
      kids.push(el('div', { style: { display: 'flex', alignItems: 'center', gap: '14px', border: '1.5px solid ' + T.ac, background: T.sf, padding: '12px 16px', marginBottom: '16px' } },
        el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '15px', color: T.ac, letterSpacing: '0.06em' } }, 'ROUGH QUOTE'),
        el('div', { style: { flex: 1, fontSize: '12.5px', color: T.tx } },
          unverified + ' line' + (unverified === 1 ? '' : 's') + ' not yet verified. Check each price before this goes into contract documents — edit a line or click its ✓ to clear the flag.'),
        btn('Verify all', () => { if (confirm('Mark all ' + unverified + ' rough lines as verified?')) { est.items.forEach(it => it.costLines.forEach(l => { if (l.verified === false) l.verified = true; })); c.ksSaveJobData(); c.ksTick(); } }, 'danger')));
    }

    kids.push(el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '22px', marginBottom: '18px', fontSize: '13px', color: T.mu, flexWrap: 'wrap' } },
      el('span', null, 'Markup ', cellInput(c, (S.defaultMarkupPct * 100).toFixed(1) + '%', v => { S.defaultMarkupPct = num(v) / 100; est.items.forEach(it => it.costLines.forEach(l => { l.markupPct = null; })); c.ksSaveJobData(); c.ksTick(); }, { w: '58px', align: 'right' })),
      el('span', null, 'Tax ', cellInput(c, (S.salesTaxPct * 100).toFixed(2) + '%', v => { S.salesTaxPct = num(v) / 100; est.items.forEach(it => it.costLines.forEach(l => { l.taxable = true; })); c.ksSaveJobData(); c.ksTick(); }, { w: '62px', align: 'right' })),
      el('span', null, el('strong', { style: { color: T.tx } }, String(est.items.filter(i => !i.excluded).length)), ' line items'),
      btn('⊕ Expand all', () => ksExpandAll(c, est.items.map(i => i.id))),
      btn('⊖ Collapse all', () => ksCollapseAll(c)),
      el('div', { style: { flex: 1 } }),
      btn('＋ Add from catalog', () => c.setState({ ksPicker: 'estimate' }), 'accent'),
      btn('＋ Blank item', () => {
        const cat0 = est.categories[0] || { id: null };
        const it = { id: nid('item'), code: '', categoryId: cat0.id, name: 'New item', type: 'spec', allowance: false, excluded: false, specText: '', costLines: [], order: est.items.length };
        est.items.push(it);
        c.state.ksOpen = Object.assign({}, (c.state.ksOpen && typeof c.state.ksOpen === 'object') ? c.state.ksOpen : {}, { [it.id]: true });
        c.ksSaveJobData(); c.ksTick();
      }, 'accent')));

    const head = el('div', { className: 'ks-est-head', style: { display: 'grid', gridTemplateColumns: grid, padding: '9px 0', borderBottom: '1px solid ' + T.tx, fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.14em', color: T.mu } },
      el('div', { className: 'ks-est-code' }, 'CODE'), el('div', { className: 'ks-est-name' }, 'ITEM'), el('div', { className: 'ks-est-lines', style: { textAlign: 'right' } }, 'LINES'),
      el('div', { className: 'ks-est-blank' }, ''), el('div', { className: 'ks-est-cost', style: { textAlign: 'right' } }, 'MY COST'), el('div', { className: 'ks-est-mk', style: { textAlign: 'right' } }, 'MARKUP'),
      el('div', { className: 'ks-est-total', style: { textAlign: 'right' } }, 'TOTAL'), el('div', { className: 'ks-est-actions' }, ''));

    const body = [head];
    for (const cat of est.categories) {
      const items = est.items.filter(i => i.categoryId === cat.id);
      if (!items.length) continue;
      let catTot = 0;
      const itemEls = [];
      for (const item of items) {
        const ic = itemCalc(item, S);
        if (!item.excluded) catTot += ic.total;
        const open = ksIsOpen(c, item.id);
        itemEls.push(el('div', { key: item.id, className: 'ks-est-row', style: { display: 'grid', gridTemplateColumns: grid, padding: '8px 0', borderBottom: '1px dotted ' + T.ln, fontSize: '13px', alignItems: 'baseline', opacity: item.excluded ? 0.45 : 1 } },
          el('div', { className: 'ks-est-code', style: { fontWeight: 700, color: T.ac, fontSize: '12px', fontVariantNumeric: 'tabular-nums' } }, item.code || '—'),
          el('div', { className: 'ks-est-name', style: { color: T.tx, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            el('span', { onClick: () => ksToggle(c, item.id), style: { cursor: 'pointer', fontWeight: 600, textDecoration: item.excluded ? 'line-through' : 'none' } }, (open ? '▾ ' : '▸ ') + item.name),
            item.allowance ? chip('ALLOWANCE' + (item.allowanceBudget ? ' · ' + (num(item.allowanceBudget.qty) || 1).toLocaleString('en-US') + ' ' + (item.allowanceBudget.unit || 'EA') : ''), () => openAllowanceDialog(c, item)) : null,
            item.excluded ? chip('EXCLUDED') : null,
            item.costLines.some(l => l.verified === false) ? chip('ROUGH') : null),
          el('div', { className: 'ks-est-lines', style: { textAlign: 'right', color: T.mu, fontVariantNumeric: 'tabular-nums' } }, String(item.costLines.length)),
          el('div', { className: 'ks-est-blank' }, ''),
          el('div', { className: 'ks-est-cost', style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: T.tx } }, fmt$(ic.cost)),
          el('div', { className: 'ks-est-mk', style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: T.mu } }, fmt$(ic.mkAmt)),
          el('div', { className: 'ks-est-total', style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: T.tx } }, fmt$(ic.total)),
          el('div', { className: 'ks-est-actions', style: { textAlign: 'right', whiteSpace: 'nowrap' } },
            iconBtn(item.excluded ? '↩' : '⊘', item.excluded ? 'Include in contract' : 'Exclude from contract', () => { item.excluded = !item.excluded; c.ksSaveJobData(); c.ksTick(); }),
            iconBtn('×', 'Delete item', () => { if (confirm('Delete "' + item.name + '" from this estimate?')) { est.items = est.items.filter(x => x !== item); c.ksSaveJobData(); c.ksTick(); } }))));
        if (open) itemEls.push(el('div', { key: item.id + '_d', style: { padding: '10px 0 18px 24px', borderBottom: '1px dotted ' + T.ln, background: T.sf } }, itemDetail(c, est, item)));
      }
      body.push(el('div', { key: cat.id, style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '12px 0 7px 0', borderBottom: '1px solid ' + T.ln } },
        el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '15px', color: T.tx } }, cat.code + ' — ' + cat.name),
        el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '15px', fontVariantNumeric: 'tabular-nums', color: T.ac } }, fmt$(catTot))));
      body.push(...itemEls);
    }

    body.push(el('div', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: '28px', padding: '18px 0', borderTop: '2px solid ' + T.tx, marginTop: '-1px', flexWrap: 'wrap' } },
      el('span', { style: { fontSize: '12px', color: T.mu, fontVariantNumeric: 'tabular-nums' } }, 'cost ' + fmt$(tot.cost) + '   ·   after markup ' + fmt$(tot.price) + '   ·   tax ' + fmt$(tot.tax)),
      label('CONTRACT TOTAL'),
      el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '28px', fontVariantNumeric: 'tabular-nums', color: T.tx } }, fmt$(tot.total))));

    kids.push(el('div', { style: { borderTop: '2px solid ' + T.tx } }, ...body));

    kids.push(allowanceDialog(c, est));

    if (c.state.ksPicker === 'estimate') kids.push(pickerOverlay(c, ids => {
      for (const id of ids) {
        const src = c.catalog.items.find(i => i.id === id);
        if (!src) continue;
        const copy = deepCopy(src); copy.id = nid('item'); copy.excluded = false;
        if (!est.categories.find(x => x.id === copy.categoryId)) {
          const srcCat = c.catalog.categories.find(x => x.id === copy.categoryId);
          if (srcCat) est.categories.push(deepCopy(srcCat));
          est.categories.sort((a, b) => (a.code > b.code ? 1 : -1));
        }
        est.items.push(copy);
      }
      c.ksSaveJobData(); c.setState({ ksPicker: null });
    }));

    return wrap(kids);
  }

  function itemDetail(c, est, item) {
    const S = est.settings;
    const grid = '1fr 58px 50px 96px 62px 54px 108px 24px';
    const rows = [el('div', { className: 'ks-cl-head', style: { display: 'grid', gridTemplateColumns: grid, padding: '5px 0', fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.12em', color: T.mu, borderBottom: '1px solid ' + T.ln } },
      el('div', { className: 'ks-cl-desc' }, 'COST LINE'), el('div', { className: 'ks-cl-qty', style: { textAlign: 'right' } }, 'QTY'), el('div', { className: 'ks-cl-unit' }, 'UNIT'),
      el('div', { className: 'ks-cl-cost', style: { textAlign: 'right' } }, 'UNIT COST'), el('div', { className: 'ks-cl-mk', style: { textAlign: 'right' } }, 'MK %'),
      el('div', { className: 'ks-cl-tax', style: { textAlign: 'center' } }, 'TAX'), el('div', { className: 'ks-cl-total', style: { textAlign: 'right' } }, 'TOTAL'), el('div', { className: 'ks-cl-del' }, ''))];
    item.costLines.forEach((l, idx) => {
      const lc = lineCalc(l, S);
      const rough = l.verified === false;
      const touch = fn => v => { fn(v); if (l.verified === false) { l.verified = true; } c.ksSaveJobData(); };
      rows.push(el('div', { key: l.id || idx, className: 'ks-cl-row', style: { display: 'grid', gridTemplateColumns: grid, padding: '3px 0', alignItems: 'center', borderBottom: rough ? '1px solid ' + T.ac : '1px dotted ' + T.ln, background: rough ? 'rgba(166,75,36,0.06)' : 'transparent' } },
        cellInput(c, l.desc, touch(v => { l.desc = v; }), { className: 'ks-cl-desc' }),
        cellInput(c, l.qty, touch(v => { l.qty = num(v); }), { w: '52px', align: 'right', className: 'ks-cl-qty' }),
        cellInput(c, l.unit, touch(v => { l.unit = v; }), { w: '44px', className: 'ks-cl-unit' }),
        cellInput(c, l.unitCost, touch(v => { l.unitCost = num(v); }), { w: '90px', align: 'right', className: 'ks-cl-cost' }),
        cellInput(c, ((l.markupPct != null ? l.markupPct : S.defaultMarkupPct) * 100).toFixed(1), touch(v => { l.markupPct = num(v) / 100; }), { w: '56px', align: 'right', className: 'ks-cl-mk' }),
        el('div', { className: 'ks-cl-tax', style: { textAlign: 'center' } }, taxPill(c, l, () => { if (l.verified === false) l.verified = true; c.ksSaveJobData(); })),
        el('div', { className: 'ks-cl-total', style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '13px', whiteSpace: 'nowrap' } },
          rough ? el('span', { title: 'Rough quote — click ✓ to verify', style: { color: T.ac, fontWeight: 700, marginRight: '6px', fontSize: '10px', letterSpacing: '0.08em' } }, 'ROUGH') : null,
          fmt$(lc.total)),
        el('div', { className: 'ks-cl-del', style: { textAlign: 'right', whiteSpace: 'nowrap' } },
          rough ? iconBtn('✓', 'Mark verified', () => { l.verified = true; c.ksSaveJobData(); c.ksTick(); }) : null,
          iconBtn('×', 'Remove line', () => { item.costLines.splice(idx, 1); c.ksSaveJobData(); c.ksTick(); }))));
    });
    return el('div', null,
      el('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' } },
        label('NAME'), cellInput(c, item.name, v => { item.name = (v && v.trim()) || 'Untitled item'; c.ksSaveJobData(); c.ksTick(); }, { w: '280px' }),
        label('CODE'), cellInput(c, item.code, v => { item.code = (v || '').trim(); c.ksSaveJobData(); c.ksTick(); }, { w: '90px' })),
      ...rows,
      el('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' } },
        btn('＋ Cost line', () => { item.costLines.push({ id: nid('cl'), desc: '', qty: 1, unit: 'LS', unitCost: 0, markupPct: null, taxable: false }); c.ksSaveJobData(); c.ksTick(); }, 'accent'),
        btn('＋ From price list', () => c.setState({ ksPricePick: item.id }), 'accent'),
        el('span', { style: { flex: 1 } }),
        el('label', { style: { fontSize: '12.5px', color: T.mu, cursor: 'pointer' } },
          el('input', {
            type: 'checkbox', checked: !!item.allowance,
            onChange: e => {
              if (e.target.checked) { openAllowanceDialog(c, item); }
              else if (confirm('Remove the allowance tag' + (item.costLines.some(l => l.alw) ? ' and its budget line' : '') + ' from "' + item.name + '"?')) { removeAllowance(c, item); c.ksTick(); }
              else c.ksTick();
            },
            style: { marginRight: '6px', verticalAlign: 'middle' }
          }),
          'Allowance item', item.allowanceBudget ? el('span', { style: { color: T.ac, fontWeight: 700 } }, '  ' + (num(item.allowanceBudget.qty) || 1).toLocaleString('en-US') + ' ' + (item.allowanceBudget.unit || 'EA') + ' @ ' + fmt$(num(item.allowanceBudget.price))) : null)),
      el('div', { style: { marginTop: '10px' } },
        label('SPECIFICATION — customer packet text', { marginBottom: '4px' }),
        el('textarea', {
          defaultValue: item.specText || '',
          onBlur: e => { item.specText = e.target.value; c.ksSaveJobData(); c.ksTouch(); },
          style: { width: '100%', minHeight: '64px', border: '1px solid ' + T.ln, padding: '9px', fontSize: '12.5px', fontFamily: sans, background: 'transparent', color: T.tx, resize: 'vertical' }
        })),
      c.state.ksPricePick === item.id ? priceListOverlay(c, pl => {
        item.costLines.push({ id: nid('cl'), desc: pl.desc, qty: 1, unit: pl.unit || 'EA', unitCost: pl.price || 0, markupPct: null, taxable: true });
        c.ksSaveJobData(); c.setState({ ksPricePick: null });
      }) : null);
  }

  // ---------- allowance budget (qty × unit × price — drives the estimate) ----------
  function openAllowanceDialog(c, item) {
    const b = item.allowanceBudget || {};
    c._alwDlg = { itemId: item.id, qty: b.qty != null ? b.qty : 1, unit: b.unit || 'EA', price: b.price != null ? b.price : '' };
    c.ksTick();
  }
  function applyAllowance(c, est, item, s) {
    const qty = Math.max(0.01, num(s.qty) || 1);
    const price = Math.max(0, num(s.price));
    const unit = (String(s.unit || 'EA').trim() || 'EA').toUpperCase();
    item.allowance = true;
    item.allowanceBudget = { qty, unit, price };
    let line = item.costLines.find(l => l.alw);
    if (!line) {
      line = { id: nid('cl'), alw: true, desc: 'Allowance budget', qty: 1, unit: 'EA', unitCost: 0, markupPct: null, taxable: true };
      item.costLines.push(line);
    }
    line.desc = 'Allowance budget';
    line.qty = qty; line.unit = unit; line.unitCost = price;
    if (line.verified === false) line.verified = true;
    c.ksSaveJobData();
  }
  function removeAllowance(c, item) {
    item.allowance = false;
    item.allowanceBudget = null;
    item.costLines = item.costLines.filter(l => !l.alw);
    c.ksSaveJobData();
  }
  function allowanceDialog(c, est) {
    const s = c._alwDlg;
    if (!s) return null;
    const item = est.items.find(i => i.id === s.itemId);
    if (!item) return null;
    const close = () => { c._alwDlg = null; c.ksTick(); };
    const inp = (key, lbl, ph) => el('div', null, label(lbl, { marginBottom: '4px' }),
      el('input', {
        defaultValue: s[key], placeholder: ph || '',
        onFocus: e => e.target.select(),
        onChange: e => { s[key] = e.target.value; c.ksTick(); },
        style: { width: '100%', border: '1px solid ' + T.ln, padding: '10px 11px', fontSize: '15px', fontFamily: sans, background: T.bg, color: T.tx }
      }));
    const liveQty = num(s.qty) || 1, livePrice = num(s.price);
    return el('div', { style: { position: 'fixed', inset: 0, zIndex: 85, background: 'rgba(20,16,12,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' } },
      el('div', { style: { background: T.sf, border: '1.5px solid ' + T.tx, width: '470px', maxWidth: '95vw', padding: '20px 22px', fontFamily: sans, color: T.tx } },
        el('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '4px' } },
          el('div', { style: { fontFamily: serif, fontWeight: 600, fontSize: '18px' } }, 'Allowance budget'),
          el('div', { style: { flex: 1 } }),
          el('span', { onClick: close, style: { cursor: 'pointer', color: T.mu, fontSize: '18px' } }, '✕')),
        el('div', { style: { fontSize: '12.5px', color: T.mu, marginBottom: '14px' } }, item.name),
        el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1.3fr', gap: '12px', marginBottom: '12px' } },
          inp('qty', 'QTY'),
          inp('unit', 'UNIT', 'EA · SF · LF…'),
          inp('price', '$ PER UNIT')),
        el('div', { style: { border: '1px solid ' + T.ln, background: T.bg, padding: '10px 13px', fontSize: '13px', marginBottom: '14px' } },
          el('b', null, 'Budget: '),
          liveQty.toLocaleString('en-US') + ' ' + (String(s.unit || 'EA').toUpperCase()) + ' @ ' + fmt$(livePrice) + '  =  ',
          el('b', { style: { fontVariantNumeric: 'tabular-nums' } }, fmt$(liveQty * livePrice)),
          el('div', { style: { fontSize: '11px', color: T.mu, marginTop: '3px' } }, 'Becomes this item’s cost line — markup and tax apply like any other line, and the total moves the estimate.')),
        el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
          btn('Save allowance', () => { applyAllowance(c, est, item, s); close(); }, 'solid'),
          item.allowance ? btn('Remove allowance', () => { if (confirm('Remove the allowance tag and its budget line from "' + item.name + '"?')) { removeAllowance(c, item); close(); } }, 'danger') : null,
          btn('Cancel', close))));
  }

  // ---------- overlays ----------
  function overlayShell(c, title, children, closeKey) {
    return el('div', { style: { position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(20,16,12,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' } },
      el('div', { style: { background: T.sf, border: '1.5px solid ' + T.tx, width: '580px', maxWidth: '96vw', maxHeight: '84vh', display: 'flex', flexDirection: 'column', fontFamily: sans, color: T.tx } },
        el('div', { style: { display: 'flex', alignItems: 'center', padding: '15px 20px', borderBottom: '2px solid ' + T.tx } },
          el('div', { style: { fontFamily: serif, fontWeight: 600, fontSize: '18px' } }, title),
          el('div', { style: { flex: 1 } }),
          el('span', { onClick: () => c.setState(closeKey), style: { cursor: 'pointer', color: T.mu, fontSize: '18px' } }, '✕')),
        el('div', { style: { overflow: 'auto', padding: '14px 20px' } }, ...children)));
  }

  function pickerOverlay(c, onAdd) {
    const sel = c._pickSel = c._pickSel || new Set();
    const groups = [];
    for (const cat of c.catalog.categories) {
      const items = c.catalog.items.filter(i => i.categoryId === cat.id);
      if (!items.length) continue;
      groups.push(el('div', { key: cat.id, style: { margin: '10px 0 3px 0', fontSize: '11px', letterSpacing: '0.12em', color: T.mu, fontWeight: 700 } }, cat.code + ' ' + cat.name.toUpperCase()));
      for (const it of items) {
        groups.push(el('label', { key: it.id, style: { display: 'flex', gap: '9px', alignItems: 'center', padding: '4px 4px', cursor: 'pointer', fontSize: '13.5px' } },
          el('input', { type: 'checkbox', defaultChecked: sel.has(it.id), onChange: e => { e.target.checked ? sel.add(it.id) : sel.delete(it.id); } }),
          el('span', { style: { fontWeight: 700, color: T.ac, fontSize: '11.5px', width: '38px' } }, it.code),
          el('span', null, it.name),
          it.allowance ? chip('ALW') : null));
      }
    }
    groups.push(el('div', { style: { marginTop: '16px', display: 'flex', gap: '10px' } },
      btn('Add selected', () => { const ids = [...sel]; c._pickSel = null; onAdd(ids); }, 'solid'),
      btn('Cancel', () => { c._pickSel = null; c.setState({ ksPicker: null }); })));
    return overlayShell(c, 'Add items from catalog', groups, { ksPicker: null });
  }

  function priceListOverlay(c, onPick) {
    const rows = [];
    let sec = null;
    for (const pl of (c.catalog.priceList || [])) {
      if (pl.section !== sec) { sec = pl.section; rows.push(el('div', { key: 's' + sec, style: { margin: '10px 0 3px 0', fontSize: '11px', letterSpacing: '0.12em', color: T.mu, fontWeight: 700 } }, sec)); }
      rows.push(el('div', { key: pl.id, onClick: () => onPick(pl), style: { display: 'flex', gap: '10px', padding: '6px 4px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px dotted ' + T.ln } },
        el('span', { style: { flex: 1 } }, pl.desc),
        el('span', { style: { color: T.mu, width: '44px' } }, pl.unit),
        el('span', { style: { fontVariantNumeric: 'tabular-nums', fontWeight: 700 } }, fmt$(pl.price))));
    }
    return overlayShell(c, 'Pick from price list', rows, { ksPricePick: null });
  }

  // ---------- SCHEDULE (task list default; gantt optional; template or worksheet mode) ----------
  function taskTable(c, rows, opts) {
    // shared editable task list — used by the job schedule and the master template editor
    opts = opts || {};
    const onChange = opts.onChange; // called after any mutation
    const showStatus = !!opts.showStatus;
    const grid = showStatus ? '26px 1fr 64px 190px 56px 96px 96px 110px 26px' : '26px 1fr 64px 190px 56px 26px';
    const head = el('div', { style: { display: 'grid', gridTemplateColumns: grid, gap: '0 8px', padding: '8px 0', borderBottom: '1px solid ' + T.tx, fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.12em', color: T.mu } },
      el('div', null, '#'), el('div', null, 'TASK'), el('div', { style: { textAlign: 'right' } }, 'DAYS'),
      el('div', null, 'AFTER (predecessor)'), el('div', { style: { textAlign: 'right' } }, 'LAG'),
      ...(showStatus ? [el('div', null, 'START'), el('div', null, 'FINISH'), el('div', null, 'STATUS'), el('div', null, '')] : [el('div', null, '')]));
    const insertAt = (ix) => {
      const prev = rows[ix];
      const nm = prompt('New task name:', ''); if (!nm || !nm.trim()) return;
      const nid2 = 't' + (Math.max(0, ...rows.map(x => parseInt(String(x.id).replace(/\D/g, '')) || 0)) + 1);
      const t = { id: nid2, group: (prev && prev.group) || 'Construction', days: 1, pred: prev ? prev.id : null, lag: 0, off: prev ? (prev.off || 0) : 0, status: 'Not Started', pct: 0 };
      if (rows.length && rows[0].task !== undefined) t.task = nm.trim(); else t.name = nm.trim();
      rows.splice(ix + 1, 0, t);
      onChange(); c.ksTick();
    };
    const insZone = (ix) => el('div', { key: 'iz' + ix + '_' + (rows[ix] ? rows[ix].id : 'top'), className: 'ks-insz' },
      el('div', { className: 'ks-insbtn', onClick: () => insertAt(ix), title: 'Insert a task here' },
        el('span', { style: { flex: 1, height: '1px', background: T.ac, opacity: 0.5 } }),
        el('span', { style: { color: T.ac, fontWeight: 700, fontSize: '12px', border: '1px solid ' + T.ac, lineHeight: '15px', width: '17px', height: '17px', flex: '0 0 17px', textAlign: 'center', borderRadius: '50%', background: T.sf } }, '＋'),
        el('span', { style: { flex: 1, height: '1px', background: T.ac, opacity: 0.5 } })));

    const body = [head];
    const doneCount = rows.filter(r => r.status === 'Complete').length;
    if (opts.hideDone && doneCount > 0) {
      body.push(el('div', { key: '_hidebar', style: { padding: '8px 0', borderBottom: '1px dotted ' + T.ln, fontSize: '12px', color: T.mu } },
        '✓ ' + doneCount + ' completed task' + (doneCount === 1 ? '' : 's') + ' hidden'));
    }
    let lastGroup = null;
    rows.forEach((r, ix) => {
      if (opts.hideDone && r.status === 'Complete') return;
      const name = r.task !== undefined ? 'task' : 'name';
      if (r.group !== lastGroup) {
        lastGroup = r.group;
        body.push(el('div', { key: 'g' + ix, style: { display: 'flex', alignItems: 'baseline', gap: '10px', padding: '13px 0 5px 0', borderBottom: '1px solid ' + T.ln } },
          el('span', { style: { fontFamily: serif, fontWeight: 700, fontSize: '14.5px', color: T.tx } }, r.group),
          (GROUP_CODES[r.group] || []).length ? el('span', { style: { fontSize: '9.5px', fontWeight: 700, letterSpacing: '0.08em', color: T.ac, border: '1px solid ' + T.ac, padding: '0 6px' } }, '⌂ ' + GROUP_CODES[r.group].join(' ')) : null));
      }
      const stName = r.status === 'Complete' ? 'done' : (r.status === 'In Progress' ? 'now' : 'up');
      body.push(el('div', { key: r.id, style: { display: 'grid', gridTemplateColumns: grid, gap: '0 8px', padding: '3px 0', alignItems: 'center', borderBottom: '1px dotted ' + T.ln, opacity: stName === 'done' ? 0.55 : 1 } },
        el('div', { style: { fontSize: '10.5px', color: T.mu, fontVariantNumeric: 'tabular-nums' } }, r.id.replace(/^t/, '')),
        cellInput(c, r[name], v => { r[name] = v; onChange(); }),
        stepper(c, () => Math.max(1, Math.round(Number(r.days)) || 1), v => { r.days = Math.max(1, v); onChange(); }, 1),
        el('select', {
          value: r.pred || '',
          onChange: e => { r.pred = e.target.value || null; onChange(); c.ksTick(); },
          style: { border: '1px solid ' + T.ln, padding: '4px', fontFamily: sans, fontSize: '11.5px', background: T.sf, color: T.tx, maxWidth: '190px' }
        },
          el('option', { value: '' }, '— start of job'),
          ...rows.filter(x => x.id !== r.id).map(x => el('option', { key: x.id, value: x.id }, x.id.replace(/^t/, '') + ' · ' + String(x.task !== undefined ? x.task : x.name).slice(0, 26)))),
        stepper(c, () => Math.max(0, Math.round(Number(r.lag)) || 0), v => { r.lag = Math.max(0, v); onChange(); }, 0),
        ...(showStatus ? [
          el('div', { style: { fontSize: '12px', fontVariantNumeric: 'tabular-nums', color: T.mu } }, r.start || '—'),
          el('div', { style: { fontSize: '12px', fontVariantNumeric: 'tabular-nums', color: T.mu } }, r.finish || '—'),
          el('span', {
            onClick: () => { r.status = r.status === 'Not Started' ? 'In Progress' : (r.status === 'In Progress' ? 'Complete' : 'Not Started'); r.pct = r.status === 'Complete' ? 1 : (r.status === 'In Progress' ? 0.5 : 0); onChange(); c.ksTick(); },
            style: { display: 'inline-block', textAlign: 'center', padding: '2px 8px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer', background: stName === 'now' ? T.ac : (stName === 'done' ? T.tx : 'transparent'), color: stName === 'up' ? T.mu : T.bg, border: '1px solid ' + (stName === 'up' ? T.ln : 'transparent'), whiteSpace: 'nowrap' }
          }, r.status.toUpperCase())
        ] : []),
        iconBtn('×', 'Remove task', () => { const i2 = rows.indexOf(r); if (i2 > -1 && confirm('Remove "' + (r.task || r.name) + '"?')) { rows.splice(i2, 1); onChange(); c.ksTick(); } })));
      body.push(insZone(ix));
    });
    body.push(el('div', { style: { marginTop: '10px', display: 'flex', gap: '14px' } },
      btn('＋ Add task', () => {
        const g = prompt('Group / phase for the new task:', lastGroup || 'Construction'); if (g == null) return;
        const nm = prompt('Task name:', 'New task'); if (!nm) return;
        const nid2 = 't' + (Math.max(0, ...rows.map(x => parseInt(String(x.id).replace(/\D/g, '')) || 0)) + 1);
        const t = { id: nid2, group: g.trim() || 'Construction', days: 1, pred: rows.length ? rows[rows.length - 1].id : null, lag: 0, off: 0, status: 'Not Started', pct: 0 };
        if (rows.length && rows[0].task !== undefined) t.task = nm.trim(); else t.name = nm.trim();
        rows.push(t); onChange(); c.ksTick();
      }, 'accent')));
    return el('div', { style: { borderTop: '2px solid ' + T.tx } }, ...body);
  }

  // ---------- schedule: undo + field-mode date moves ----------
  function schedSnapshot(c, labelTxt) {
    c._undoSched = { rows: deepCopy(c.jobSchedule || []), label: labelTxt, ts: Date.now() };
  }
  function undoToast(c) {
    const u = c._undoSched;
    if (!u || Date.now() - u.ts > 20000) return null;
    return el('div', { className: 'ks-undo', style: { position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: '22px', zIndex: 90, background: T.tx, color: T.bg, padding: '10px 16px', display: 'flex', gap: '14px', alignItems: 'center', boxShadow: '0 6px 24px rgba(0,0,0,0.3)', fontSize: '13px', fontFamily: sans, maxWidth: '92vw' } },
      el('span', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, u.label),
      el('span', { onClick: () => { c.jobSchedule = u.rows; c._undoSched = null; c.ksSaveJobData(); c.ksTick(); }, style: { color: T.bg, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', flex: '0 0 auto' } }, 'Undo'),
      el('span', { onClick: () => { c._undoSched = null; c.ksTick(); }, style: { cursor: 'pointer', opacity: 0.7, flex: '0 0 auto' } }, '✕'));
  }
  function moveTaskStart(c, r, newISO) {
    if (!newISO || newISO === r.start) return;
    schedSnapshot(c, 'Pinned "' + String(r.task).replace(/^\d+\s*/, '').slice(0, 34) + '" to ' + newISO);
    // Pin to the chosen date, overriding any predecessor/lag/offset dependencies.
    // Only this task's start & finish move; no cascade to other tasks.
    r.fixed = newISO;
    r.start = newISO;
    const days = Math.max(0, (r.days || 1) - 1);
    const fin = addWorkDays(new Date(newISO + 'T00:00:00Z'), days);
    r.finish = fin.toISOString().slice(0, 10);
    c.ksSaveJobData();
    c.ksTick();
  }

  // ---------- FIELD MODE (phone-first: check off, note, move the start) ----------
  function fieldModeView(c, rows) {
    const kids = [];
    const groups = [];
    let cur = null;
    for (const r of rows) { if (!cur || cur.g !== r.group) { cur = { g: r.group || 'Tasks', items: [] }; groups.push(cur); } cur.items.push(r); }
    const notesOpen = c._fmNotes = c._fmNotes || {};
    const showDone = c._fmShowDone = c._fmShowDone || {};
    const save = () => { c.ksSaveJobData(); c.ksTick(); };
    for (const g of groups) {
      const done = g.items.filter(r => r.status === 'Complete');
      const open = g.items.filter(r => r.status !== 'Complete');
      kids.push(el('div', { key: 'g' + g.g, style: { fontFamily: serif, fontWeight: 700, fontSize: '15px', color: T.tx, padding: '16px 0 6px 0', borderBottom: '1px solid ' + T.ln } }, g.g));
      if (done.length) {
        kids.push(el('div', {
          key: 'd' + g.g,
          onClick: () => { showDone[g.g] = !showDone[g.g]; c.ksTick(); },
          style: { fontSize: '12.5px', color: T.mu, padding: '8px 0', borderBottom: '1px dotted ' + T.ln, cursor: 'pointer' }
        }, (showDone[g.g] ? '▾ ' : '▸ ') + done.length + ' complete'));
      }
      const list = (showDone[g.g] ? done : []).concat(open);
      for (const r of list) {
        const isDone = r.status === 'Complete';
        kids.push(el('div', { key: r.id, style: { borderBottom: '1px dotted ' + T.ln, padding: '10px 0', opacity: isDone ? 0.55 : 1 } },
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '13px', flexWrap: 'wrap' } },
            el('input', {
              type: 'checkbox', checked: isDone,
              onChange: e => {
                schedSnapshot(c, (e.target.checked ? 'Checked off "' : 'Reopened "') + String(r.task).replace(/^\d+\s*/, '').slice(0, 34) + '"');
                r.status = e.target.checked ? 'Complete' : 'In Progress';
                r.pct = e.target.checked ? 1 : 0.5;
                save();
              },
              style: { width: '22px', height: '22px', flex: '0 0 22px', cursor: 'pointer', accentColor: T.ac }
            }),
            el('div', { style: { flex: 1, minWidth: '150px' } },
              el('div', { style: { fontSize: '15px', fontWeight: 600, color: T.tx, textDecoration: isDone ? 'line-through' : 'none' } }, String(r.task).replace(/^\d+\s*/, '')),
              r.status === 'In Progress' ? el('div', { style: { fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.1em', color: T.ac } }, 'IN PROGRESS') : null),
            el('input', {
              type: 'date', value: r.start || '',
              onChange: e => moveTaskStart(c, r, e.target.value),
              style: { border: '1px solid ' + T.ln, padding: '8px 9px', fontFamily: sans, fontSize: '13px', background: T.sf, color: T.tx }
            }),
            el('span', {
              onClick: () => { notesOpen[r.id] = !notesOpen[r.id]; c.ksTick(); },
              title: 'Notes',
              style: { cursor: 'pointer', fontSize: '17px', color: (r.note && r.note.trim()) ? T.ac : T.mu, padding: '4px 6px' }
            }, '✎')),
          notesOpen[r.id] ? el('textarea', {
            defaultValue: r.note || '',
            placeholder: 'Field notes for this task…',
            onBlur: e => { r.note = e.target.value; c.ksSaveJobData(); c.ksTouch(); },
            style: { width: '100%', minHeight: '64px', marginTop: '9px', border: '1px solid ' + T.ln, padding: '10px 12px', fontSize: '14px', fontFamily: sans, background: T.sf, color: T.tx, resize: 'vertical' }
          }) : (r.note && r.note.trim() ? el('div', { onClick: () => { notesOpen[r.id] = true; c.ksTick(); }, style: { fontSize: '12px', color: T.mu, marginTop: '5px', paddingLeft: '35px', cursor: 'pointer', whiteSpace: 'pre-wrap' } }, r.note) : null)));
      }
    }
    return el('div', { style: { maxWidth: '760px' } }, ...kids);
  }

  function viewSchedule(c) {
    const tpl = c.jobSchedule && c.jobSchedule.length ? c.jobSchedule : null;
    const rows = tpl || (c.ksJobCache && c.ksJobCache[c.state.jobId] && c.ksJobCache[c.state.jobId].schedule) || c.computeScheduleRows() || [];
    const gantt = !!c.state.ksGantt;
    let field = c.state.ksField;
    if (field === undefined) {
      try {
        const saved = localStorage.getItem('ks_field_mode');
        field = saved === null ? (window.innerWidth < 700) : saved === '1'; // phones start in field mode
      } catch (e) { field = false; }
    }
    let hideDone = c.state.ksHideDone;
    if (hideDone === undefined) { try { hideDone = localStorage.getItem('ks_hide_done') === '1'; } catch (e) { hideDone = false; } }
    const setField = v => { try { localStorage.setItem('ks_field_mode', v ? '1' : '0'); } catch (e) {} c.setState({ ksField: v }); };
    const setHide = v => { try { localStorage.setItem('ks_hide_done', v ? '1' : '0'); } catch (e) {} c.setState({ ksHideDone: v }); };
    const tgl = (labelTxt, on, onClick) => el('button', {
      onClick,
      style: { background: on ? T.ac : 'transparent', border: '1px solid ' + (on ? T.ac : T.ln), color: on ? '#FFFFFF' : T.mu, padding: '6px 13px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: sans }
    }, labelTxt);
    const kids = [];
    kids.push(el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap' } },
      tpl ? tgl('📱 Field mode', field, () => setField(!field)) : null,
      (tpl && !field) ? tgl(hideDone ? '✓ Completed hidden' : 'Hide completed', hideDone, () => setHide(!hideDone)) : null,
      el('div', { style: { flex: 1 } }),
      el('span', { style: { fontSize: '12.5px', color: T.mu } }, 'Permit-ready: '),
      el('input', {
        type: 'date', defaultValue: c.jobPermitReady || '',
        onChange: e => { if (e.target.value) c.ksSetPermitReady(e.target.value); },
        style: { border: '1px solid ' + T.ln, padding: '6px 8px', fontFamily: sans, fontSize: '12.5px', background: T.sf, color: T.tx }
      }),
      (tpl && !field) ? btn(gantt ? 'Task list' : 'Timeline view', () => c.setState({ ksGantt: !gantt }), 'line') : null,
      !tpl ? btn('Edit worksheet →', () => c.go('Schedule'), 'accent') : null));

    if (!rows.length) {
      kids.push(el('div', { style: { border: '1px solid ' + T.ln, background: T.sf, padding: '26px 28px', fontSize: '13.5px', color: T.mu, maxWidth: '640px' } },
        'No schedule yet. Pick a permit-ready date above and the full build schedule fills itself from your template — or use the Schedule worksheet the old way.'));
      return wrap(kids);
    }

    if (tpl && field) {
      kids.push(fieldModeView(c, rows));
      kids.push(undoToast(c));
      return wrap(kids);
    }

    if (tpl && !gantt) {
      kids.push(el('div', { style: { fontSize: '12.5px', color: T.mu, marginBottom: '10px' } }, 'Edit tasks, working days and dependencies — dates recompute instantly. Hover between rows to insert a task.'));
      kids.push(taskTable(c, rows, { showStatus: true, hideDone, onChange: () => c.ksRecompute() }));
      kids.push(undoToast(c));
      return wrap(kids);
    }

    const ms = d => new Date(d + 'T00:00:00').getTime();
    let min = Infinity, max = -Infinity;
    for (const r of rows) { min = Math.min(min, ms(r.start)); max = Math.max(max, ms(r.finish)); }
    max += 86400000 * 2; min -= 86400000;
    const span = Math.max(max - min, 86400000 * 14);
    const todayPos = Math.min(99, Math.max(0, 100 * (Date.now() - min) / span));

    // week header labels
    const weeks = [];
    const w0 = new Date(min); w0.setDate(w0.getDate() - w0.getDay());
    for (let t = w0.getTime(); t < max; t += 7 * 86400000) {
      const d = new Date(t);
      weeks.push((d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })).toUpperCase());
    }

    const cells = [];
    let lastGroup = null;
    rows.forEach((r, i) => {
      if (tpl && r.group && r.group !== lastGroup) {
        lastGroup = r.group;
        cells.push(el('div', { key: 'g' + i, style: { padding: '11px 12px 5px 0', borderBottom: '1px solid ' + T.ln, fontFamily: serif, fontWeight: 700, fontSize: '13.5px', color: T.tx, whiteSpace: 'nowrap', overflow: 'hidden' } },
          r.group,
          (r.codes || []).length ? el('span', { title: 'Mapped to estimate categories — watch these for the next draw', style: { marginLeft: '8px', fontSize: '9.5px', fontWeight: 700, letterSpacing: '0.08em', color: T.ac, border: '1px solid ' + T.ac, padding: '0 6px' } }, '⌂ ' + r.codes.join(' ')) : null));
        cells.push(el('div', { key: 'ge' + i, style: { borderBottom: '1px solid ' + T.ln } }));
      }
      const l = 100 * (ms(r.start) - min) / span;
      const w = Math.max(1.5, 100 * (ms(r.finish) + 86400000 - ms(r.start)) / span);
      const stName = r.status === 'Complete' ? 'done' : (r.status === 'In Progress' ? 'now' : 'up');
      const cycle = tpl ? () => {
        r.status = r.status === 'Not Started' ? 'In Progress' : (r.status === 'In Progress' ? 'Complete' : 'Not Started');
        r.pct = r.status === 'Complete' ? 1 : (r.status === 'In Progress' ? 0.5 : 0);
        c.ksSaveJobData(); c.ksTick();
      } : null;
      cells.push(el('div', { key: 'n' + i, style: { padding: '11px 12px 11px ' + (tpl ? '14px' : '0'), borderBottom: '1px dotted ' + T.ln, fontSize: '13px', fontWeight: 600, color: stName === 'done' ? T.mu : T.tx, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: stName === 'done' ? 'line-through' : 'none' } }, r.task.replace(/^\d+\s*/, '')));
      cells.push(el('div', { key: 'b' + i, onClick: cycle, style: { position: 'relative', borderBottom: '1px dotted ' + T.ln, cursor: tpl ? 'pointer' : 'default' } },
        el('div', { style: { position: 'absolute', left: todayPos + '%', top: 0, bottom: 0, width: '1px', background: T.ac } }),
        el('div', {
          title: r.task + '  ' + r.start + ' → ' + r.finish + (tpl ? '  (click to cycle status)' : ''),
          style: {
            position: 'absolute', left: l + '%', width: w + '%', top: '50%', transform: 'translateY(-50%)', height: '12px',
            background: stName === 'up' ? 'transparent' : (stName === 'done' ? T.tx : T.ac),
            border: stName === 'up' ? '1px solid ' + T.tx : 'none',
            opacity: stName === 'done' ? 0.3 : 1
          }
        })));
    });

    kids.push(el('div', { style: { display: 'grid', gridTemplateColumns: '210px 1fr', borderTop: '2px solid ' + T.tx } },
      el('div', { style: { padding: '10px 0', borderBottom: '1px solid ' + T.tx } }, label('TASK')),
      el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(' + weeks.length + ',1fr)', borderBottom: '1px solid ' + T.tx, padding: '10px 0', overflow: 'hidden' } },
        ...weeks.map((wk, i) => el('div', { key: i, style: { fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', color: T.mu, whiteSpace: 'nowrap' } }, wk))),
      ...cells));

    kids.push(el('div', { style: { display: 'flex', gap: '22px', fontSize: '12px', color: T.mu, marginTop: '14px', alignItems: 'center', flexWrap: 'wrap' } },
      el('span', { style: { display: 'flex', alignItems: 'center', gap: '7px' } }, el('span', { style: { width: '14px', height: '8px', background: T.tx, opacity: 0.3, display: 'inline-block' } }), 'Complete'),
      el('span', { style: { display: 'flex', alignItems: 'center', gap: '7px' } }, el('span', { style: { width: '14px', height: '8px', background: T.ac, display: 'inline-block' } }), 'In progress'),
      el('span', { style: { display: 'flex', alignItems: 'center', gap: '7px' } }, el('span', { style: { width: '14px', height: '8px', border: '1px solid ' + T.tx, display: 'inline-block' } }), 'Upcoming'),
      el('span', { style: { display: 'flex', alignItems: 'center', gap: '7px' } }, el('span', { style: { width: '1px', height: '12px', background: T.ac, display: 'inline-block' } }), 'Today')));

    return wrap(kids);
  }

  // ---------- CATALOG (items / prices / exclusions / templates tabs) ----------
  function viewCatalog(c) {
    const cat = c.catalog;
    if (!cat) return wrap([el('div', { style: { color: T.mu, padding: '40px 0' } }, 'Loading catalog…')]);
    const tab = c.state.ksCatTab || 'items';
    const tabs = el('div', { style: { display: 'flex', gap: '4px', marginBottom: '22px', borderBottom: '1px solid ' + T.ln, flexWrap: 'wrap' } },
      ...[['items', 'Items & specs'], ['prices', 'Price list'], ['excl', 'Exclusions']].map(t =>
        el('button', {
          onClick: () => c.setState({ ksCatTab: t[0] }),
          style: {
            background: 'transparent', border: 'none', padding: '8px 14px', fontFamily: sans, fontSize: '13.5px',
            fontWeight: tab === t[0] ? 700 : 500, color: tab === t[0] ? T.tx : T.mu, cursor: 'pointer',
            borderBottom: tab === t[0] ? '3px solid ' + T.ac : '3px solid transparent', marginBottom: '-1px'
          }
        }, t[1])));

    const kids = [tabs];

    if (tab === 'items') {
      kids.push(el('div', { style: { display: 'flex', gap: '16px', marginBottom: '6px' } },
        btn('＋ New item', () => {
          const c0 = cat.categories[0];
          cat.items.push({ id: nid('item'), code: '', categoryId: c0 ? c0.id : null, name: 'New item', type: 'spec', allowance: false, specText: '', costLines: [], order: cat.items.length });
          c.ksSaveCatalog(); c.ksTick();
        }, 'accent'),
        btn('＋ New category', () => {
          const name = prompt('Category name:'); if (!name) return;
          const code = prompt('Category code (e.g. 1600):', ''); if (code == null) return;
          cat.categories.push({ id: nid('cat'), code: code.trim(), name: name.trim(), order: cat.categories.length });
          c.ksSaveCatalog(); c.ksTick();
        }, 'accent'),
        btn('⊕ Expand all', () => ksExpandAll(c, cat.items.map(i => i.id))),
        btn('⊖ Collapse all', () => ksCollapseAll(c))));
      for (const cc of cat.categories) {
        const items = cat.items.filter(i => i.categoryId === cc.id);
        kids.push(el('div', { key: cc.id, style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '14px 0 6px 0', borderBottom: '1px solid ' + T.ln } },
          el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '15px', color: T.tx } }, cc.code + ' — ' + cc.name),
          iconBtn('delete', 'Delete category', () => { if (confirm('Delete category "' + cc.name + '"? Items move to the first category.')) { const first = cat.categories.find(x => x !== cc); cat.items.forEach(i => { if (i.categoryId === cc.id && first) i.categoryId = first.id; }); cat.categories = cat.categories.filter(x => x !== cc); c.ksSaveCatalog(); c.ksTick(); } })));
        for (const item of items) {
          const open = ksIsOpen(c, item.id);
          kids.push(el('div', { key: item.id, style: { display: 'flex', gap: '14px', alignItems: 'baseline', padding: '8px 0', borderBottom: '1px dotted ' + T.ln, fontSize: '13.5px' } },
            el('span', { style: { fontWeight: 700, color: T.ac, fontSize: '12px', width: '44px', flex: '0 0 44px' } }, item.code || '—'),
            el('span', { onClick: () => ksToggle(c, item.id), style: { cursor: 'pointer', fontWeight: 600, color: T.tx, flex: 1, minWidth: 0 } }, (open ? '▾ ' : '▸ ') + item.name, item.allowance ? chip('ALLOWANCE') : null),
            el('span', { style: { color: T.mu, fontSize: '12px' } }, (item.costLines || []).length + ' lines'),
            iconBtn('×', 'Delete from catalog', () => { if (confirm('Delete "' + item.name + '" from the catalog? Existing jobs keep their copy.')) { cat.items = cat.items.filter(x => x !== item); c.ksSaveCatalog(); c.ksTick(); } })));
          if (open) {
            kids.push(el('div', { key: item.id + '_d', style: { padding: '12px 0 18px 24px', borderBottom: '1px dotted ' + T.ln, background: T.sf } },
              el('div', { style: { display: 'flex', gap: '16px', marginBottom: '10px', alignItems: 'flex-end', flexWrap: 'wrap' } },
                el('div', { style: { flex: 2, minWidth: '220px' } }, label('ITEM NAME', { marginBottom: '3px' }), cellInput(c, item.name, v => { item.name = v; c.ksSaveCatalog(); })),
                el('div', { style: { width: '70px' } }, label('CODE', { marginBottom: '3px' }), cellInput(c, item.code, v => { item.code = v.trim(); c.ksSaveCatalog(); })),
                el('div', null, label('CATEGORY', { marginBottom: '3px' }),
                  el('select', {
                    defaultValue: item.categoryId,
                    onChange: e => { item.categoryId = e.target.value; c.ksSaveCatalog(); c.ksTick(); },
                    style: { border: '1px solid ' + T.ln, padding: '6px', fontFamily: sans, fontSize: '12.5px', background: 'transparent', color: T.tx }
                  }, ...cat.categories.map(x => el('option', { key: x.id, value: x.id }, x.code + ' ' + x.name)))),
                el('label', { style: { fontSize: '12.5px', color: T.mu, cursor: 'pointer', paddingBottom: '6px' } },
                  el('input', { type: 'checkbox', checked: !!item.allowance, onChange: e => { item.allowance = e.target.checked; c.ksSaveCatalog(); c.ksTick(); }, style: { marginRight: '6px', verticalAlign: 'middle' } }), 'Allowance')),
              catalogItemLines(c, cat, item),
              el('div', { style: { marginTop: '10px' } },
                label('SPECIFICATION TEXT', { marginBottom: '4px' }),
                el('textarea', {
                  defaultValue: item.specText || '',
                  onBlur: e => { item.specText = e.target.value; c.ksSaveCatalog(); c.ksTouch(); },
                  style: { width: '100%', minHeight: '70px', border: '1px solid ' + T.ln, padding: '9px', fontSize: '12.5px', fontFamily: sans, background: 'transparent', color: T.tx, resize: 'vertical' }
                }))));
          }
        }
      }
    }

    if (tab === 'prices') {
      kids.push(priceListEditor(c));
    }

    if (tab === 'excl') {
      kids.push(el('div', { style: { fontSize: '13px', color: T.mu, marginBottom: '10px' } }, 'Standard exclusions — copied into every new job’s customer packet.'));
      kids.push(el('div', { style: { marginBottom: '8px' } }, btn('＋ Add exclusion', () => { (cat.exclusions = cat.exclusions || []).push('New exclusion'); c.ksSaveCatalog(); c.ksTick(); }, 'accent')));
      (cat.exclusions || []).forEach((x, i) => {
        kids.push(el('div', { key: i, style: { display: 'flex', gap: '10px', alignItems: 'center', padding: '2px 0', borderBottom: '1px dotted ' + T.ln } },
          el('span', { style: { color: T.mu, fontSize: '11px', width: '22px', textAlign: 'right', flex: '0 0 22px' } }, (i + 1) + '.'),
          cellInput(c, x, v => { cat.exclusions[i] = v; c.ksSaveCatalog(); }),
          iconBtn('×', 'Remove', () => { cat.exclusions.splice(i, 1); c.ksSaveCatalog(); c.ksTick(); })));
      });
    }

    return wrap(kids);
  }

  function catalogItemLines(c, cat, item) {
    const S = cat.settings;
    const grid = '1fr 58px 50px 96px 62px 54px 24px';
    const rows = [el('div', { style: { display: 'grid', gridTemplateColumns: grid, padding: '5px 0', fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.12em', color: T.mu, borderBottom: '1px solid ' + T.ln } },
      el('div', null, 'COST LINE'), el('div', { style: { textAlign: 'right' } }, 'QTY'), el('div', null, 'UNIT'),
      el('div', { style: { textAlign: 'right' } }, 'UNIT COST'), el('div', { style: { textAlign: 'right' } }, 'MK %'), el('div', { style: { textAlign: 'center' } }, 'TAX'), el('div', null, ''))];
    for (const l of item.costLines) {
      rows.push(el('div', { key: l.id, style: { display: 'grid', gridTemplateColumns: grid, padding: '3px 0', alignItems: 'center', borderBottom: '1px dotted ' + T.ln } },
        cellInput(c, l.desc, v => { l.desc = v; c.ksSaveCatalog(); }),
        cellInput(c, l.qty, v => { l.qty = num(v); c.ksSaveCatalog(); }, { w: '52px', align: 'right' }),
        cellInput(c, l.unit, v => { l.unit = v; c.ksSaveCatalog(); }, { w: '44px' }),
        cellInput(c, l.unitCost, v => { l.unitCost = num(v); c.ksSaveCatalog(); }, { w: '90px', align: 'right' }),
        cellInput(c, ((l.markupPct != null ? l.markupPct : S.defaultMarkupPct) * 100).toFixed(1), v => { l.markupPct = num(v) / 100; c.ksSaveCatalog(); }, { w: '56px', align: 'right' }),
        el('div', { style: { textAlign: 'center' } }, taxPill(c, l, () => c.ksSaveCatalog())),
        iconBtn('×', 'Remove', () => { item.costLines = item.costLines.filter(x => x !== l); c.ksSaveCatalog(); c.ksTick(); })));
    }
    return el('div', null, ...rows,
      el('div', { style: { marginTop: '8px' } }, btn('＋ Cost line', () => { item.costLines.push({ id: nid('cl'), desc: '', qty: 1, unit: 'LS', unitCost: 0, markupPct: null, taxable: false }); c.ksSaveCatalog(); c.ksTick(); }, 'accent')));
  }

  // ---------- NEW JOB ----------
  function viewNewJob(c) {
    if (!c.ksTemplates) c.ksLoadTemplates();
    const st = c._newJob = c._newJob || { name: '', source: 'blank' };
    const opt = (value, labelTxt, sub) => el('label', { key: value, style: { display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '13px 16px', border: st.source === value ? '1.5px solid ' + T.tx : '1px solid ' + T.ln, cursor: 'pointer', marginBottom: '8px', background: st.source === value ? T.sf : 'transparent' } },
      el('input', { type: 'radio', name: 'njsrc', checked: st.source === value, onChange: () => { st.source = value; c.ksTick(); }, style: { marginTop: '3px' } }),
      el('div', null,
        el('div', { style: { fontWeight: 700, fontSize: '14px', color: T.tx } }, labelTxt),
        el('div', { style: { fontSize: '12.5px', color: T.mu } }, sub)));
    return wrap([el('div', { style: { maxWidth: '560px' } },
      label('JOB NAME', { marginBottom: '5px' }),
      el('input', {
        placeholder: 'e.g. Smith Residence — SFD', defaultValue: st.name,
        onBlur: e => { st.name = e.target.value; },
        onKeyDown: e => { if (e.key === 'Enter') e.target.blur(); },
        style: { width: '100%', border: '1px solid ' + T.ln, padding: '11px 12px', fontSize: '15px', fontFamily: sans, background: T.sf, color: T.tx, marginBottom: '20px' }
      }),
      label('START FROM', { marginBottom: '8px' }),
      opt('blank', 'Blank estimate', 'Empty — add items from the catalog as you go.'),
      opt('full', 'Entire catalog', 'Every catalog item; delete what doesn’t apply.'),
      ...(c.ksTemplates || []).map(t => opt('tpl:' + t.id, 'Template: ' + t.name, t.itemCount + ' items')),
      el('div', { style: { marginTop: '20px' } },
        label('PERMIT-READY DATE — optional', { marginBottom: '5px' }),
        el('input', {
          type: 'date', defaultValue: st.permit || '',
          onChange: e => { st.permit = e.target.value; },
          style: { border: '1px solid ' + T.ln, padding: '10px 12px', fontSize: '14px', fontFamily: sans, background: T.sf, color: T.tx }
        }),
        el('div', { style: { fontSize: '12px', color: T.mu, marginTop: '5px' } }, 'Key this in and the full build schedule fills itself from the schedule template below — client-ready from day one.')),
      el('div', { style: { marginTop: '14px' } },
        label('SCHEDULE TEMPLATE', { marginBottom: '5px' }),
        el('select', {
          defaultValue: st.schedTpl || 'main',
          onChange: e => { st.schedTpl = e.target.value; },
          style: { border: '1px solid ' + T.ln, padding: '10px 12px', fontSize: '14px', fontFamily: sans, background: T.sf, color: T.tx, minWidth: '260px' }
        },
          el('option', { value: 'main' }, '★ Main template'),
          ...((c.catalog && c.catalog.schedTemplates) || []).map(t => el('option', { key: t.id, value: t.id }, t.name))),
        el('div', { style: { fontSize: '12px', color: T.mu, marginTop: '5px' } }, 'Manage these under Templates → Schedule template.')),
      el('div', { style: { marginTop: '18px' } }, btn('Create job', () => c.ksCreateJob(), 'solid')))]);
  }

  // ---------- SETTINGS ----------
  function viewSettings(c) {
    const kids = [];
    const section = (title, sub, body) => el('div', { style: { marginBottom: '38px' } },
      serifHead(title, 21),
      el('div', { style: { fontSize: '13px', color: T.mu, margin: '3px 0 14px 0' } }, sub),
      ...body);

    // appearance: paper × accent, two menus
    const [curP, curA] = currentTheme();
    const paperCard = p => el('button', {
      key: p.id,
      onClick: () => { applyTheme(p.id, curA); c.ksTick(); },
      style: { background: p.v.sf, border: '1.5px solid ' + (curP === p.id ? T.ac : T.ln), padding: '13px 13px 11px 13px', cursor: 'pointer', textAlign: 'left' }
    },
      el('div', { style: { height: '26px', background: p.v.bg, border: '1px solid rgba(127,127,127,0.25)', marginBottom: '4px' } }),
      el('div', { style: { fontSize: '12px', fontWeight: 700, color: p.v.tx } }, p.name),
      el('div', { style: { fontSize: '10.5px', color: p.v.mu, marginTop: '1px' } }, p.tag));
    const accentCard = a => el('button', {
      key: a.id,
      onClick: () => { applyTheme(curP, a.id); c.ksTick(); },
      style: { background: T.sf, border: '1.5px solid ' + (curA === a.id ? T.ac : T.ln), padding: '13px 13px 11px 13px', cursor: 'pointer', textAlign: 'left' }
    },
      el('div', { style: { height: '26px', background: a.c, marginBottom: '4px' } }),
      el('div', { style: { fontSize: '12px', fontWeight: 700, color: T.tx } }, a.name));

    kids.push(section('Appearance', 'Pick a paper, pick an accent — the layout never changes.', [
      label('PAPER', { marginBottom: '8px', letterSpacing: '0.18em' }),
      el('div', { className: 'ks-theme-grid', style: { display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '10px', marginBottom: '18px' } }, ...PAPERS.map(paperCard)),
      label('ACCENT', { marginBottom: '8px', letterSpacing: '0.18em' }),
      el('div', { className: 'ks-theme-grid', style: { display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '10px' } }, ...ACCENTS.map(accentCard))
    ]));

    // estimating defaults
    if (c.catalog) {
      const S = c.catalog.settings;
      kids.push(section('Estimating defaults', 'Applied to every new job; any line can override.', [
        el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(140px,220px))', gap: '10px' } },
          el('div', { style: { border: '1px solid ' + T.ln, background: T.sf, padding: '14px 16px' } },
            label('DEFAULT MARKUP'),
            el('div', { style: { marginTop: '6px' } }, cellInput(c, (S.defaultMarkupPct * 100).toFixed(1) + '%', v => { S.defaultMarkupPct = num(v) / 100; c.ksSaveCatalog(); }, { w: '90px' }))),
          el('div', { style: { border: '1px solid ' + T.ln, background: T.sf, padding: '14px 16px' } },
            label('SALES TAX'),
            el('div', { style: { marginTop: '6px' } }, cellInput(c, (S.salesTaxPct * 100).toFixed(2) + '%', v => { S.salesTaxPct = num(v) / 100; c.ksSaveCatalog(); }, { w: '90px' }))))
      ]));
    }

    // company (read from workbook Settings sheet)
    let fields = [];
    try {
      fields = [
        { label: 'COMPANY', value: 'Ridgeline Construction' },
        { label: 'MAILING', value: String(c.wb.value('Settings', 'C40') || '') },
        { label: 'PHONE', value: String(c.wb.value('Settings', 'C41') || '') },
        { label: 'WEBSITE', value: 'www.ridgeline.construction', href: 'https://www.ridgeline.construction' },
        { label: 'EMAIL', value: 'info@ridgeline.construction', href: 'mailto:info@ridgeline.construction' }
      ];
    } catch (e) {}
    kids.push(section('Company', 'Printed at the head of every packet and estimate. Edit on the Settings & Takeoffs worksheet.', [
      el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 40px' } },
        ...fields.map((f, i) => el('div', { key: i, style: { display: 'flex', alignItems: 'baseline', gap: '16px', padding: '11px 0', borderBottom: '1px dotted ' + T.ln } },
          el('div', { style: { width: '110px', flex: '0 0 110px', fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.14em', color: T.mu } }, f.label),
          f.href
            ? el('a', { href: f.href, target: f.href.indexOf('mailto:') === 0 ? undefined : '_blank', rel: 'noopener', style: { fontSize: '13.5px', fontWeight: 600, color: T.ac, textDecoration: 'none', borderBottom: '1px dotted ' + T.ac } }, f.value)
            : el('div', { style: { fontSize: '13.5px', fontWeight: 600, color: T.tx } }, f.value))))
    ]));

    // team logins (project managers)
    if (c._usersCache === undefined) {
      c._usersCache = null;
      c.ksApi('/users').then(u => { c._usersCache = u; c.ksTick(); }).catch(() => { c._usersCache = false; });
    }
    const pms = Array.isArray(c._usersCache) ? c._usersCache.filter(u => u.role === 'pm') : [];
    const tm = c._teamForm = c._teamForm || { name: '', password: '', msg: '' };
    const tmInp = (ph, key, w) => el('input', {
      placeholder: ph, value: tm[key] || '',
      onChange: e => { tm[key] = e.target.value; c.ksTick(); },
      style: { border: '1px solid ' + T.ln, padding: '9px 11px', fontSize: '13px', fontFamily: sans, background: T.bg, color: T.tx, width: w || '180px' }
    });
    kids.push(section('Team logins', 'Project managers sign in with just their password — they get schedules and field notes, never pricing.', [
      pms.length
        ? el('div', { style: { marginBottom: '14px' } }, ...pms.map(u => el('div', { key: u.id, style: { display: 'flex', gap: '14px', alignItems: 'baseline', padding: '9px 0', borderBottom: '1px dotted ' + T.ln } },
          el('div', { style: { fontWeight: 700, fontSize: '13.5px', color: T.tx, flex: 1 } }, u.name),
          el('div', { style: { fontSize: '11px', color: T.mu, letterSpacing: '0.1em' } }, 'PROJECT MANAGER'),
          btn('Remove', async () => {
            if (!confirm('Remove ' + u.name + '’s login?')) return;
            try { await c.ksApi('/users/' + u.id, { method: 'DELETE' }); c._usersCache = undefined; c.ksTick(); } catch (e) { alert(e.message); }
          }, 'danger'))))
        : el('div', { style: { fontSize: '13px', color: T.mu, marginBottom: '14px' } }, 'No team logins yet.'),
      el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' } },
        tmInp('Name', 'name'),
        tmInp('Their password', 'password'),
        btn('＋ Add project manager', async () => {
          if (!tm.name.trim() || (tm.password || '').length < 4) { tm.msg = 'Name plus a password of 4+ characters.'; c.ksTick(); return; }
          try {
            await c.ksApi('/users', { method: 'POST', body: JSON.stringify({ role: 'pm', name: tm.name.trim(), password: tm.password }) });
            tm.msg = '✓ added — give them the site link and that password';
            tm.name = ''; tm.password = '';
            c._usersCache = undefined;
            c.ksTick();
          } catch (e) { tm.msg = e.message; c.ksTick(); }
        }, 'solid')),
      tm.msg ? el('div', { style: { fontSize: '12px', color: tm.msg.indexOf('✓') === 0 ? T.ac : '#B0392E', marginTop: '8px' } }, tm.msg) : null
    ]));

    // calendar & data
    if (c._feedToken === undefined) {
      c._feedToken = null;
      c.ksApi('/feed-token').then(r => { c._feedToken = r.token; c.ksTick(); }).catch(() => {});
    }
    const base = location.origin + '/api/feed/' + (c._feedToken || '…') + '/';
    const linkRow = (lbl, url) => el('div', { style: { marginBottom: '12px' } },
      label(lbl, { marginBottom: '4px' }),
      el('div', { style: { display: 'flex', gap: '8px' } },
        el('input', { readOnly: true, value: url, onFocus: e => e.target.select(), style: { flex: 1, border: '1px solid ' + T.ln, padding: '8px 10px', fontSize: '11.5px', fontFamily: 'ui-monospace,monospace', background: T.sf, color: T.mu } }),
        btn('Copy', () => { navigator.clipboard && navigator.clipboard.writeText(url); })));
    kids.push(section('Calendar & data', 'Schedules on your phone; the workbook always yours.', [
      el('div', { style: { fontSize: '13px', color: T.mu, lineHeight: 1.6, marginBottom: '14px' } },
        'Private subscription links — add one to Google Calendar (Settings → Add calendar → From URL), iPhone (Settings → Calendar → Accounts → Add Subscribed Calendar), or Outlook. Schedule changes flow there automatically. Treat the links like a password.'),
      linkRow('ALL JOBS — combined calendar', base + 'all.ics'),
      c.state.jobId ? linkRow('THIS JOB — ' + (((c.state.jobs || []).find(j => j.id === c.state.jobId) || {}).name || 'current'), base + c.state.jobId + '.ics') : null,
      el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '16px' } },
        btn('Download workbook .xlsx', () => c.ksExportXlsx()),
        btn('Back up all jobs (JSON)', async () => {
          try {
            const jobs = await c.ksApi('/jobs');
            const full = [];
            for (const m of jobs) full.push(await c.ksApi('/jobs/' + m.id));
            const cat = c.catalog;
            const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), catalog: cat, jobs: full }, null, 1)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'sitely-backup-' + new Date().toISOString().slice(0, 10) + '.json';
            a.click();
          } catch (e) { alert('Backup failed: ' + e.message); }
        }))
    ]));

    // companion apps
    const appCard = (name, sub, url, icon) => el('a', {
      key: name, href: url, target: '_blank', rel: 'noopener',
      style: { display: 'flex', gap: '14px', alignItems: 'center', border: '1px solid ' + T.ln, background: T.sf, padding: '14px 16px', textDecoration: 'none', minWidth: '240px' }
    },
      el('img', { src: icon, alt: name, style: { width: '38px', height: '38px', flex: '0 0 38px', borderRadius: '9px', objectFit: 'cover', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' } }),
      el('div', null,
        el('div', { style: { fontWeight: 700, fontSize: '14px', color: T.tx } }, name),
        el('div', { style: { fontSize: '12px', color: T.mu } }, sub)));
    kids.push(section('Companion apps', 'The rest of the Ridgeline toolbox — opens in a new tab.', [
      el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
        appCard('PocketBuilder', 'field calculators', 'https://pocketbuildercalculator.netlify.app', 'pb-icon.png'),
        appCard('YardStick', 'PDF plan takeoff', 'https://yardstickpdf.netlify.app/', 'ys-icon.png'))
    ]));

    // account
    kids.push(section('Account', '', [
      el('div', { style: { display: 'flex', gap: '10px' } },
        btn('Sign out on this device', () => { if (confirm('Sign out on this device?')) { window.RidgelineSync.logout(); c.setState({ needLogin: true }); } }))
    ]));

    return wrap(kids);
  }

  // ---------- SCHEDULE TEMPLATE (transcribed line-by-line from Zac's CoConstruct schedule) ----------
  // Dependency model: each task = [name, off, days, pred, lag]
  //   off  = workday offset from permit-ready (used when no predecessor)
  //   pred = id of the predecessor task (finish-to-start), lag = extra workdays after pred finishes
  // Task ids are assigned in order: t1, t2, … so preds reference earlier (or later) tasks stably.
  const SCHEDULE_TEMPLATE_V1 = [
    { g: 'Permits issued', codes: ['0100'], t: [
      ['Call locates', 0, 1], ["Water Fee's", 0, 1], ["Power fee's", 0, 1]] },
    { g: 'Excavation', codes: ['0100', '0200'], t: [
      ['Road Build/Clearing', 1, 2], ['Cut out for Foundation', 3, 3]] },
    { g: 'Foundation', codes: ['0200'], t: [
      ['Footings', 6, 3], ['Foundation Walls', 9, 3]] },
    { g: 'Backfill', codes: ['0200'], t: [
      ['Rain Drains', 12, 1], ['Main Backfill', 13, 1], ['Fill and grade in basement', 14, 1],
      ['Under ground plumbing', 15, 1], ['Basement concrete floor', 16, 6], ['Power line/temp power', 22, 1]] },
    { g: 'Septic', codes: ['0100'], t: [
      ['Tank install', 0, 1], ['Drain field', 0, 6], ['Final', 0, 7]] },
    { g: 'Construction', codes: ['0300'], t: [
      ['Lumber Delivery', 23, 1], ['Build Basement', 24, 2], ['Order doors and windows', 26, 1],
      ['Build floor', 26, 1], ['Frame Walls main story', 27, 4], ['Frame Roof', 31, 5],
      ['Final Pickup Framing', 36, 1], ['Shear nail inspection', 37, 1]] },
    { g: 'Roofing', codes: ['0500'], t: [
      ['Delivery', 36, 1], ['Install', 37, 3]] },
    { g: 'Rough-in Installations', codes: ['0600', '0700', '0800'], t: [
      ['Plumbing rough-in', 37, 5], ['Hvac rough-in', 42, 5], ['Electrical rough-in', 47, 5], ['Fireplace', 47, 1]] },
    { g: 'Siding', codes: ['0500'], t: [
      ['Vapor barrier', 38, 1], ['Window installation', 39, 1], ['Door installation', 39, 1],
      ['Siding delivery', 40, 5], ['Siding install', 45, 10]] },
    { g: 'Decks', codes: ['0500'], t: [
      ['Framing', 40, 3], ['Decking/railing', 55, 3]] },
    { g: 'Big Cleanup & QC Check', codes: [], t: [
      ['Walkthrough, Make list', 52, 1], ['Punch list Work, finish', 53, 2]] },
    { g: 'Combo Inspection', codes: ['0600', '0700', '0800'], t: [
      ['Inspect, fix, Inspect', 56, 2]] },
    { g: 'Insulation', codes: ['0900'], t: [
      ['Pre-insulate', 55, 1], ['Insulate walls/vaults', 58, 3], ['Insulation Inspection', 61, 1], ['Blow-in ceilings', 68, 1]] },
    { g: 'Sheetrock', codes: ['1000'], t: [
      ['Sheetrock Stock', 62, 1], ['Sheetrock Hanging', 63, 4], ['Nailing Inspection', 67, 1], ['Mud/texture', 68, 7]] },
    { g: 'Interior Paint', codes: ['1000'], t: [
      ['Walls and Ceilings', 77, 5]] },
    { g: 'Exterior finishes', codes: ['0500'], t: [
      ['Exterior Concrete', 55, 5], ['Exterior Painting', 55, 5]] },
    { g: 'Cabinets', codes: ['1200'], t: [
      ['Delivery', 82, 1], ['Install', 83, 1]] },
    { g: 'Countertops', codes: ['1200'], t: [
      ['Template', 84, 1], ['Install', 91, 1], ['Backsplash', 92, 3]] },
    { g: 'Flooring Install', codes: ['1100'], t: [
      ['Laminate', 82, 2], ['Tile', 84, 5], ['Tile Shower', 84, 4], ['Carpet', 87, 1]] },
    { g: 'Doors/Trim', codes: ['1200'], t: [
      ['Material Delivery', 82, 1], ['Install', 83, 1], ['Trim paint', 84, 3]] },
    { g: 'Plumbing, Electrical, HVAC finish', codes: ['0600', '0700', '0800'], t: [
      ['Electric trip 1', 84, 1], ['Finish Hvac', 82, 1], ['Electric trip 2', 94, 2], ['Finish Plumbing', 94, 1]] },
    { g: 'Bath Accessories', codes: ['1040'], t: [
      ['Handles', 87, 1], ['TP Holders, Towel Rods', 87, 1], ['Mirrors', 94, 1]] },
    { g: 'Appliances', codes: ['1300'], t: [
      ['Delivery', 84, 1], ['Install', 86, 1]] },
    { g: 'Final Touches, last 10%', codes: ['1500'], t: [
      ['Hvac Blower Door test', 88, 1],
      ['Water final', 89, 1], ['Sewer final', 90, 1], ['Electric final', 91, 1],
      ['Fire final', 92, 1], ['Building final', 93, 1], ['Final documents and invoice', 94, 1]] }
  ];

  // work-day math: offset 0 = permit-ready date (rolled forward to a weekday)
  function addWorkDays(date, n) {
    // all math in UTC so results don't shift with the device timezone
    const d = new Date(date.getTime());
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    let left = n;
    while (left > 0) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--;
    }
    return d;
  }
  function iso(d) { return d.toISOString().slice(0, 10); }

  // signed workday distance a→b (0 if same day)
  function workdayDelta(aISO, bISO) {
    const a = new Date(aISO + 'T00:00:00Z'), b = new Date(bISO + 'T00:00:00Z');
    if (isNaN(a) || isNaN(b) || a.getTime() === b.getTime()) return 0;
    const sign = b > a ? 1 : -1;
    let n = 0;
    const d = new Date(a);
    while (d.getTime() !== b.getTime()) {
      d.setUTCDate(d.getUTCDate() + sign);
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n += sign;
      if (Math.abs(n) > 2000) break;
    }
    return n;
  }

  // inclusive workday count a→b (min 1)
  function workdaysInclusive(aISO, bISO) {
    const a = new Date(aISO + 'T00:00:00Z'), b = new Date(bISO + 'T00:00:00Z');
    if (isNaN(a) || isNaN(b) || b < a) return 1;
    let n = 0;
    for (const d = new Date(a); d <= b; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++;
    }
    return Math.max(1, n);
  }

  // ---------- dependency-aware schedule (v2) ----------
  // Flat task list; groups carry estimate-category codes for draw tracking.
  const GROUP_CODES = {
    'Permits issued': ['0100'], 'Excavation': ['0100', '0200'], 'Foundation': ['0200'], 'Backfill': ['0200'],
    'Septic': ['0100'], 'Construction': ['0300'], 'Roofing': ['0500'], 'Rough-in Installations': ['0600', '0700', '0800'],
    'Siding': ['0500'], 'Decks': ['0500'], 'Big Cleanup & QC Check': [], 'Combo Inspection': ['0600', '0700', '0800'],
    'Insulation': ['0900'], 'Sheetrock': ['1000'], 'Interior Paint': ['1000'], 'Exterior finishes': ['0500'],
    'Cabinets': ['1200'], 'Countertops': ['1200'], 'Flooring Install': ['1100'], 'Doors/Trim': ['1200'],
    'Plumbing, Electrical, HVAC finish': ['0600', '0700', '0800'], 'Bath Accessories': ['1040'],
    'Appliances': ['1300'], 'Final Touches, last 10%': ['1500']
  };
  // [id, group, name, off, days, pred, lag]
  const DEFAULT_TEMPLATE_TASKS = [
    ['t1', 'Permits issued', 'Call locates', 0, 1, null, 0],
    ['t2', 'Permits issued', "Water Fee's", 0, 1, null, 0],
    ['t3', 'Permits issued', "Power fee's", 0, 1, null, 0],
    ['t4', 'Excavation', 'Road Build/Clearing', 1, 2, 't1', 0],
    ['t5', 'Excavation', 'Cut out for Foundation', 3, 3, 't4', 0],
    ['t6', 'Foundation', 'Footings', 6, 3, 't5', 0],
    ['t7', 'Foundation', 'Foundation Walls', 9, 3, 't6', 0],
    ['t8', 'Backfill', 'Rain Drains', 12, 1, 't7', 0],
    ['t9', 'Backfill', 'Main Backfill', 13, 1, 't8', 0],
    ['t10', 'Backfill', 'Fill and grade in basement', 14, 1, 't9', 0],
    ['t11', 'Backfill', 'Under ground plumbing', 15, 1, 't10', 0],
    ['t12', 'Backfill', 'Basement concrete floor', 16, 6, 't11', 0],
    ['t13', 'Backfill', 'Power line/temp power', 22, 1, 't12', 0],
    ['t14', 'Septic', 'Tank install', 0, 1, null, 0],
    ['t15', 'Septic', 'Drain field', 0, 6, null, 0],
    ['t16', 'Septic', 'Final', 0, 7, null, 0],
    ['t17', 'Construction', 'Lumber Delivery', 23, 1, 't13', 0],
    ['t18', 'Construction', 'Build Basement', 24, 2, 't17', 0],
    ['t19', 'Construction', 'Order doors and windows', 26, 1, 't18', 0],
    ['t20', 'Construction', 'Build floor', 26, 1, 't18', 0],
    ['t21', 'Construction', 'Frame Walls main story', 27, 4, 't20', 0],
    ['t22', 'Construction', 'Frame Roof', 31, 5, 't21', 0],
    ['t23', 'Construction', 'Final Pickup Framing', 36, 1, 't22', 0],
    ['t24', 'Construction', 'Shear nail inspection', 37, 1, 't23', 0],
    ['t25', 'Roofing', 'Delivery', 36, 1, 't22', 0],
    ['t26', 'Roofing', 'Install', 37, 3, 't25', 0],
    ['t27', 'Rough-in Installations', 'Plumbing rough-in', 37, 5, 't25', 0],
    ['t28', 'Rough-in Installations', 'Hvac rough-in', 42, 5, 't27', 0],
    ['t29', 'Rough-in Installations', 'Electrical rough-in', 47, 5, 't28', 0],
    ['t30', 'Rough-in Installations', 'Fireplace', 47, 1, 't28', 0],
    ['t31', 'Siding', 'Vapor barrier', 38, 1, 't24', 0],
    ['t32', 'Siding', 'Window installation', 39, 1, 't31', 0],
    ['t33', 'Siding', 'Door installation', 39, 1, 't31', 0],
    ['t34', 'Siding', 'Siding delivery', 40, 5, 't26', 0],
    ['t35', 'Siding', 'Siding install', 45, 10, 't34', 0],
    ['t36', 'Decks', 'Framing', 40, 3, 't33', 0],
    ['t37', 'Decks', 'Decking/railing', 55, 3, 't35', 0],
    ['t38', 'Big Cleanup & QC Check', 'Walkthrough, make list', 52, 1, 't29', 0],
    ['t39', 'Big Cleanup & QC Check', 'Punch list work, finish', 53, 2, 't38', 0],
    ['t40', 'Combo Inspection', 'Inspect, fix, Inspect', 56, 2, 't41', 0],
    ['t41', 'Insulation', 'Pre-insulate', 55, 1, 't39', 0],
    ['t42', 'Insulation', 'Insulate walls/vaults', 58, 3, 't40', 0],
    ['t43', 'Insulation', 'Insulation Inspection', 61, 1, 't42', 0],
    ['t44', 'Insulation', 'Blow-in ceilings', 68, 1, 't47', 0],
    ['t45', 'Sheetrock', 'Sheetrock Stock', 62, 1, 't43', 0],
    ['t46', 'Sheetrock', 'Sheetrock Hanging', 63, 4, 't45', 0],
    ['t47', 'Sheetrock', 'Nailing Inspection', 67, 1, 't46', 0],
    ['t48', 'Sheetrock', 'Mud/texture', 68, 7, 't47', 0],
    ['t49', 'Interior Paint', 'Walls and Ceilings', 77, 5, 't48', 2],
    ['t50', 'Exterior finishes', 'Exterior Concrete', 55, 5, 't35', 0],
    ['t51', 'Exterior finishes', 'Exterior Painting', 55, 5, 't35', 0],
    ['t52', 'Cabinets', 'Delivery', 82, 1, 't49', 0],
    ['t53', 'Cabinets', 'Install', 83, 1, 't52', 0],
    ['t54', 'Countertops', 'Template', 84, 1, 't53', 0],
    ['t55', 'Countertops', 'Install', 91, 1, 't54', 5],
    ['t56', 'Countertops', 'Backsplash', 92, 3, 't55', 0],
    ['t57', 'Flooring Install', 'Laminate', 82, 2, 't49', 0],
    ['t58', 'Flooring Install', 'Tile', 84, 5, 't57', 0],
    ['t59', 'Flooring Install', 'Tile Shower', 84, 4, 't57', 0],
    ['t60', 'Flooring Install', 'Carpet', 87, 1, 't63', 0],
    ['t61', 'Doors/Trim', 'Material Delivery', 82, 1, 't49', 0],
    ['t62', 'Doors/Trim', 'Install', 83, 1, 't61', 0],
    ['t63', 'Doors/Trim', 'Trim paint', 84, 3, 't62', 0],
    ['t64', 'Plumbing, Electrical, HVAC finish', 'Electric trip 1', 84, 1, 't53', 0],
    ['t65', 'Plumbing, Electrical, HVAC finish', 'Finish Hvac', 82, 1, 't49', 0],
    ['t66', 'Plumbing, Electrical, HVAC finish', 'Electric trip 2', 94, 2, 't56', 0],
    ['t67', 'Plumbing, Electrical, HVAC finish', 'Finish Plumbing', 94, 1, 't56', 0],
    ['t68', 'Bath Accessories', 'Handles', 87, 1, 't63', 0],
    ['t69', 'Bath Accessories', 'TP Holders, Towel Rods', 87, 1, 't63', 0],
    ['t70', 'Bath Accessories', 'Mirrors', 94, 1, 't56', 0],
    ['t71', 'Appliances', 'Delivery', 84, 1, 't53', 0],
    ['t72', 'Appliances', 'Install', 86, 1, 't71', 0],
    ['t73', 'Final Touches, last 10%', 'Hvac Blower Door test', 88, 1, 't60', 0],
    ['t74', 'Final Touches, last 10%', 'Water final', 89, 1, 't73', 0],
    ['t75', 'Final Touches, last 10%', 'Sewer final', 90, 1, 't74', 0],
    ['t76', 'Final Touches, last 10%', 'Electric final', 91, 1, 't75', 0],
    ['t77', 'Final Touches, last 10%', 'Fire final', 92, 1, 't76', 0],
    ['t78', 'Final Touches, last 10%', 'Building final', 93, 1, 't77', 0],
    ['t79', 'Final Touches, last 10%', 'Final documents and invoice', 94, 1, 't78', 0]
  ];

  function defaultTemplate() {
    return DEFAULT_TEMPLATE_TASKS.map(t => ({ id: t[0], group: t[1], name: t[2], off: t[3], days: t[4], pred: t[5], lag: t[6] }));
  }

  // ---------- AI example template: production single-family residence ----------
  // Synthesized from public production-builder phase sequences (Lennar / DR Horton style
  // dry-in → roughs → insulation → drywall → finishes flow) and a published MS Project
  // custom-home schedule (b4ubuild.com) with real predecessor logic. ~120 working days.
  const AI_SFR_TASKS = [
    ['a1', 'Pre-construction', 'Permits in hand / plan review done', 0, 1, null, 0],
    ['a2', 'Pre-construction', 'Order long-lead: trusses & windows', 0, 1, 'a1', 0],
    ['a3', 'Pre-construction', 'Temp power & construction entrance', 0, 1, 'a1', 0],
    ['a4', 'Pre-construction', 'Call locates', 0, 1, 'a1', 0],
    ['a5', 'Sitework', 'Clear & strip lot', 0, 2, 'a4', 0],
    ['a6', 'Sitework', 'Rough grade & pad prep', 0, 1, 'a5', 0],
    ['a7', 'Sitework', 'Stake foundation', 0, 1, 'a6', 0],
    ['a8', 'Sitework', 'Excavate foundation', 0, 2, 'a7', 0],
    ['a9', 'Foundation', 'Form & pour footings', 0, 2, 'a8', 0],
    ['a10', 'Foundation', 'Footing inspection', 0, 1, 'a9', 0],
    ['a11', 'Foundation', 'Foundation walls', 0, 4, 'a10', 0],
    ['a12', 'Foundation', 'Strip forms & waterproof', 0, 1, 'a11', 2],
    ['a13', 'Foundation', 'Foundation drains & gravel', 0, 1, 'a12', 0],
    ['a14', 'Foundation', 'Under-slab plumbing', 0, 2, 'a13', 0],
    ['a15', 'Foundation', 'Under-slab inspection', 0, 1, 'a14', 0],
    ['a16', 'Foundation', 'Backfill & compact', 0, 1, 'a15', 0],
    ['a17', 'Foundation', 'Slab prep — vapor barrier, mesh, termite', 0, 1, 'a16', 0],
    ['a18', 'Foundation', 'Pour slabs (basement / garage)', 0, 1, 'a17', 0],
    ['a19', 'Framing', 'Lumber drop #1', 0, 1, 'a16', 0],
    ['a20', 'Framing', 'Frame floor system', 0, 2, 'a19', 0],
    ['a21', 'Framing', 'Frame walls — main level', 0, 4, 'a20', 0],
    ['a22', 'Framing', 'Frame walls — upper level', 0, 3, 'a21', 0],
    ['a23', 'Framing', 'Set trusses / frame roof', 0, 3, 'a22', 0],
    ['a24', 'Framing', 'Roof sheathing & fascia', 0, 2, 'a23', 0],
    ['a25', 'Framing', 'House wrap', 0, 1, 'a24', 0],
    ['a26', 'Framing', 'Set windows & exterior doors', 0, 1, 'a25', 0],
    ['a27', 'Framing', 'Framing pickup & backing', 0, 2, 'a26', 0],
    ['a28', 'Dry-in', 'Roof dry-in (underlayment)', 0, 1, 'a24', 0],
    ['a29', 'Dry-in', 'Shingle roof', 0, 2, 'a28', 0],
    ['a30', 'Rough-ins', 'Plumbing top-out rough', 0, 4, 'a27', 0],
    ['a31', 'Rough-ins', 'HVAC rough & gas piping', 0, 4, 'a30', 0],
    ['a32', 'Rough-ins', 'Fireplace set', 0, 1, 'a31', 0],
    ['a33', 'Rough-ins', 'Electrical rough', 0, 4, 'a31', 0],
    ['a34', 'Rough-ins', 'Low-voltage / security rough', 0, 1, 'a33', 0],
    ['a35', 'Rough-ins', '4-way rough inspection', 0, 1, 'a34', 0],
    ['a36', 'Exterior finishes', 'Siding & exterior trim', 0, 7, 'a26', 0],
    ['a37', 'Exterior finishes', 'Exterior paint', 0, 4, 'a36', 0],
    ['a38', 'Exterior finishes', 'Gutters', 0, 1, 'a37', 0],
    ['a39', 'Insulation', 'Air seal & fire caulk', 0, 1, 'a35', 0],
    ['a40', 'Insulation', 'Insulate walls & batts', 0, 2, 'a39', 0],
    ['a41', 'Insulation', 'Insulation inspection', 0, 1, 'a40', 0],
    ['a42', 'Drywall', 'Stock & hang drywall', 0, 4, 'a41', 0],
    ['a43', 'Drywall', 'Drywall nail inspection', 0, 1, 'a42', 0],
    ['a44', 'Drywall', 'Tape, mud & texture', 0, 7, 'a43', 0],
    ['a45', 'Drywall', 'Blow-in attic insulation', 0, 1, 'a44', 0],
    ['a46', 'Interior finishes', 'Prime & first-coat paint', 0, 3, 'a44', 0],
    ['a47', 'Interior finishes', 'Interior doors & trim', 0, 4, 'a46', 0],
    ['a48', 'Interior finishes', 'Trim paint & wall finish coat', 0, 4, 'a47', 0],
    ['a49', 'Interior finishes', 'Set cabinets', 0, 2, 'a48', 0],
    ['a50', 'Interior finishes', 'Countertop template', 0, 1, 'a49', 0],
    ['a51', 'Interior finishes', 'Hard-surface flooring (tile / LVP)', 0, 4, 'a49', 0],
    ['a52', 'Interior finishes', 'Countertop install', 0, 1, 'a50', 5],
    ['a53', 'Interior finishes', 'Backsplash & tile shower finish', 0, 3, 'a52', 0],
    ['a54', 'Trim-out', 'Plumbing trim & fixtures', 0, 2, 'a53', 0],
    ['a55', 'Trim-out', 'Electrical trim & fixtures', 0, 2, 'a54', 0],
    ['a56', 'Trim-out', 'HVAC trim & set condenser', 0, 1, 'a55', 0],
    ['a57', 'Trim-out', 'Appliances delivered & set', 0, 1, 'a55', 0],
    ['a58', 'Trim-out', 'Mirrors, shower doors, bath hardware', 0, 1, 'a54', 0],
    ['a59', 'Trim-out', 'Carpet', 0, 1, 'a58', 0],
    ['a60', 'Trim-out', 'Door hardware & trim pickup', 0, 1, 'a57', 0],
    ['a61', 'Exterior flatwork', 'Driveway & flatwork', 0, 2, 'a37', 0],
    ['a62', 'Exterior flatwork', 'Final grade', 0, 1, 'a61', 0],
    ['a63', 'Exterior flatwork', 'Landscape & irrigation', 0, 2, 'a62', 0],
    ['a64', 'Exterior flatwork', 'Deck / porch rails', 0, 2, 'a36', 0],
    ['a65', 'Final', 'Interior detail clean', 0, 1, 'a59', 0],
    ['a66', 'Final', 'QC walk & punch list', 0, 1, 'a65', 0],
    ['a67', 'Final', 'Punch-out work', 0, 3, 'a66', 0],
    ['a68', 'Final', 'Blower door / energy test', 0, 1, 'a56', 0],
    ['a69', 'Final', 'Final inspections — all trades', 0, 2, 'a67', 0],
    ['a70', 'Final', 'Certificate of occupancy', 0, 1, 'a69', 0],
    ['a71', 'Final', 'Final clean & paint touch-up', 0, 1, 'a70', 0],
    ['a72', 'Final', 'Homeowner orientation walk', 0, 1, 'a71', 0],
    ['a73', 'Final', 'Closing / move-in', 0, 1, 'a72', 2]
  ];
  function aiSfrTemplate() {
    return AI_SFR_TASKS.map(t => ({ id: t[0], group: t[1], name: t[2], off: t[3], days: t[4], pred: t[5], lag: t[6] }));
  }

  // compute dated rows from a task-def list + anchor; multi-pass to resolve forward refs
  function computeSchedule(defs, permitReadyISO) {
    const anchor = new Date(permitReadyISO + 'T00:00:00Z');
    const fin = {}; // id -> finish Date
    const start = {};
    let pass = 0;
    let unresolved = defs.slice();
    while (unresolved.length && pass < defs.length + 2) {
      pass++;
      unresolved = unresolved.filter(t => {
        let s;
        if (t.fixed) {
          s = new Date(t.fixed + 'T00:00:00Z'); // pinned tasks (whiteboard etc.) keep their exact date
          if (isNaN(s)) s = addWorkDays(anchor, t.off || 0);
        } else if (t.pred && fin[t.pred] === undefined) {
          if (defs.find(x => x.id === t.pred)) return true; // wait for pred
          s = addWorkDays(anchor, t.off || 0); // dangling pred → anchor offset
        } else if (t.pred) {
          s = addWorkDays(fin[t.pred], 1 + (t.lag || 0));
        } else {
          s = addWorkDays(anchor, t.off || 0);
        }
        start[t.id] = s;
        fin[t.id] = addWorkDays(s, Math.max(0, (t.days || 1) - 1));
        return false;
      });
    }
    // anything stuck in a cycle: anchor it
    for (const t of unresolved) {
      start[t.id] = addWorkDays(anchor, t.off || 0);
      fin[t.id] = addWorkDays(start[t.id], Math.max(0, (t.days || 1) - 1));
    }
    return defs.map(t => ({
      id: t.id, task: t.name, group: t.group, codes: GROUP_CODES[t.group] || [],
      off: t.off || 0, days: t.days, pred: t.pred || null, lag: t.lag || 0,
      start: iso(start[t.id]), finish: iso(fin[t.id]),
      status: t.status || 'Not Started', pct: t.pct || 0,
      note: t.note || undefined, fixed: t.fixed || undefined
    }));
  }

  function generateSchedule(permitReadyISO, templateDefs) {
    return computeSchedule(templateDefs && templateDefs.length ? templateDefs : defaultTemplate(), permitReadyISO);
  }

  // ---------- ROUGH QUOTE (takeoff quantities → workbook engine → estimate) ----------
  const TAKEOFF_ROWS = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

  function estimateRowMap(wb) {
    // map workbook Estimate cost-line rows by parent item code + line description
    const map = [];
    let cur = null;
    for (let r = 6; r <= 129; r++) {
      const a = String(wb.value('Estimate', 'A' + r) || '').trim();
      const b = String(wb.value('Estimate', 'B' + r) || '').trim();
      if (/^\d{4}$/.test(a)) cur = a.endsWith('00') ? null : a;
      else if (b && cur && wb.rawCell('Estimate', 'M' + r)) map.push({ code: cur, desc: b, row: r });
    }
    return map;
  }

  function priceListEditor(c) {
    const cat = c.catalog;
    const parts = [];
    parts.push(el('div', { style: { marginBottom: '8px' } }, btn('＋ New price', () => { (cat.priceList = cat.priceList || []).push({ id: nid('pl'), section: 'OTHER', desc: 'New material', itemCode: '', unit: 'EA', price: 0, notes: '' }); c.ksSaveCatalog(); c.ksTick(); }, 'accent')));
    const grid = '130px 1fr 100px 54px 90px 1fr 24px';
    parts.push(el('div', { style: { display: 'grid', gridTemplateColumns: grid, padding: '8px 0', borderTop: '2px solid ' + T.tx, borderBottom: '1px solid ' + T.tx, fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.14em', color: T.mu } },
      el('div', null, 'SECTION'), el('div', null, 'DESCRIPTION'), el('div', null, 'CODE'), el('div', null, 'UNIT'), el('div', { style: { textAlign: 'right' } }, 'PRICE'), el('div', null, 'NOTES'), el('div', null, '')));
    for (const pl of (cat.priceList || [])) {
      parts.push(el('div', { key: pl.id, style: { display: 'grid', gridTemplateColumns: grid, padding: '3px 0', alignItems: 'center', borderBottom: '1px dotted ' + T.ln } },
        cellInput(c, pl.section, v => { pl.section = v; c.ksSaveCatalog(); }),
        cellInput(c, pl.desc, v => { pl.desc = v; c.ksSaveCatalog(); }),
        cellInput(c, pl.itemCode, v => { pl.itemCode = v; c.ksSaveCatalog(); }),
        cellInput(c, pl.unit, v => { pl.unit = v; c.ksSaveCatalog(); }, { w: '48px' }),
        cellInput(c, pl.price, v => { pl.price = num(v); c.ksSaveCatalog(); }, { w: '84px', align: 'right' }),
        cellInput(c, pl.notes, v => { pl.notes = v; c.ksSaveCatalog(); }),
        iconBtn('×', 'Delete', () => { cat.priceList = cat.priceList.filter(x => x !== pl); c.ksSaveCatalog(); c.ksTick(); })));
    }
    return el('div', null, ...parts);
  }

  // translate a workbook formula into plain-English reasoning:
  // Settings quantity refs → their labels + current values; price refs → item names.
  function translateFormula(wb, f) {
    if (!f) return '';
    let s = String(f);
    const qtyLabel = {};
    for (let r = 12; r <= 36; r++) {
      const lbl = String(wb.value('Settings', 'B' + r) || '').trim();
      if (lbl && !lbl.startsWith(' ')) qtyLabel['C' + r] = lbl;
    }
    s = s.replace(/'?Settings'?!\$?C\$?(\d+)/g, (m0, r) => {
      const lbl = qtyLabel['C' + r] || ('Settings C' + r);
      let v = wb.value('Settings', 'C' + r);
      if (typeof v === 'number' && v < 1 && v > 0) v = (v * 100).toFixed(1) + '%';
      return '⟨' + lbl + ' = ' + v + '⟩';
    });
    s = s.replace(/'Price Database'!\$?E\$?(\d+)/g, (m0, r) => {
      const d = String(wb.value('Price Database', 'B' + r) || 'price row ' + r);
      const p = Number(wb.value('Price Database', 'E' + r)) || 0;
      return '⟨' + d + ' @ $' + p.toLocaleString() + '⟩';
    });
    s = s.replace(/'?Estimate'?!\$?([A-M])\$?(\d+)/g, (m0, col, r) => {
      const d = String(wb.value('Estimate', 'B' + r) || 'row ' + r);
      return '⟨' + d + '⟩';
    });
    return s.replace(/^=/, '');
  }

  function viewRoughQuote(c) {
    const wb = c.wb;
    const sub = c.state.ksRoughTab || 'qty';
    const kids = [];
    kids.push(el('div', { style: { display: 'flex', gap: '4px', marginBottom: '18px', borderBottom: '1px solid ' + T.ln } },
      ...[['qty', 'Quantities & logic'], ['prices', 'Price list']].map(t =>
        el('button', {
          onClick: () => c.setState({ ksRoughTab: t[0] }),
          style: { background: 'transparent', border: 'none', padding: '8px 14px', fontFamily: sans, fontSize: '13.5px', fontWeight: sub === t[0] ? 700 : 500, color: sub === t[0] ? T.tx : T.mu, cursor: 'pointer', borderBottom: sub === t[0] ? '3px solid ' + T.ac : '3px solid transparent', marginBottom: '-1px' }
        }, t[1]))));

    if (sub === 'prices') {
      kids.push(el('div', { style: { fontSize: '13px', color: T.mu, marginBottom: '12px' } }, 'Supplier unit prices — the logic blocks below pull straight from these.'));
      kids.push(c.catalog ? priceListEditor(c) : el('div', { style: { color: T.mu } }, 'Loading catalog…'));
      return wrap(kids);
    }

    kids.push(el('div', { style: { fontSize: '13px', color: T.mu, lineHeight: 1.6, marginBottom: '18px', maxWidth: '760px' } },
      'Type the takeoff quantities from the plans; every line below prices itself exactly like the Excel template did — open a line’s ⓘ to see the reasoning. When the numbers look right, send them to the project estimate — each line arrives marked ',
      el('b', { style: { color: T.ac } }, 'ROUGH'), ' until you verify it.'));

    // form
    const fields = [];
    for (const r of TAKEOFF_ROWS) {
      const lbl = String(wb.value('Settings', 'B' + r) || '');
      if (!lbl) continue;
      const hint = String(wb.value('Settings', 'D' + r) || '');
      fields.push(el('div', { key: r, style: { display: 'flex', alignItems: 'baseline', gap: '12px', padding: '7px 0', borderBottom: '1px dotted ' + T.ln } },
        el('div', { style: { flex: '0 0 210px', fontSize: '13px', fontWeight: 600, color: T.tx } }, lbl),
        cellInput(c, wb.value('Settings', 'C' + r), v => { wb.setEdit('Settings', 'C' + r, num(v)); c.saveEdits(); }, { w: '90px', align: 'right' }),
        el('div', { style: { flex: 1, fontSize: '11.5px', color: T.mu } }, hint)));
    }

    // live category totals + per-line detail from workbook M column
    const catRows = [];
    const catLines = []; // [{cat, lines:[{row, desc, val, f}]}]
    let cur = null, curName = '', sum = 0, grand = 0, curLines = [];
    const flush = () => {
      if (cur && (sum > 0.005 || curLines.length)) {
        catRows.push([cur + ' — ' + curName, sum]);
        catLines.push({ cat: cur + ' — ' + curName, sum, lines: curLines });
      }
      sum = 0; curLines = [];
    };
    for (let r = 6; r <= 129; r++) {
      const a = String(wb.value('Estimate', 'A' + r) || '').trim();
      const b = String(wb.value('Estimate', 'B' + r) || '').trim();
      if (/^\d{4}$/.test(a) && a.endsWith('00')) { flush(); cur = a; curName = b; }
      else if (b && cur && wb.rawCell('Estimate', 'M' + r)) {
        const v = Number(wb.value('Estimate', 'M' + r)) || 0;
        const cell = wb.rawCell('Estimate', 'M' + r);
        sum += v; grand += v;
        curLines.push({ row: r, desc: b, val: v, f: cell && cell.f ? cell.f : null });
      }
    }
    flush();

    kids.push(el('div', { className: 'ks-home-grid', style: { display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '40px', alignItems: 'start' } },
      el('div', null,
        el('div', { style: { fontFamily: serif, fontWeight: 600, fontSize: '19px', color: T.tx, borderBottom: '2px solid ' + T.tx, paddingBottom: '8px', marginBottom: '4px' } }, 'Takeoff quantities'),
        ...fields),
      el('div', { style: { border: '1px solid ' + T.tx, background: T.sf, padding: '20px 22px', position: 'sticky', top: '90px' } },
        label('ROUGH QUOTE — LIVE', { borderBottom: '1px solid ' + T.ln, paddingBottom: '8px' }),
        ...catRows.map((x, i) => el('div', { key: i, style: { display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '7px 0', borderBottom: '1px dashed ' + T.ln, fontSize: '12.5px' } },
          el('span', { style: { color: T.tx } }, x[0]),
          el('span', { style: { fontVariantNumeric: 'tabular-nums', fontWeight: 600 } }, fmt$0(x[1])))),
        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 0 4px 0' } },
          label('SUGGESTED TOTAL'),
          el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '26px', fontVariantNumeric: 'tabular-nums', color: T.tx } }, fmt$0(grand))),
        el('div', { style: { marginTop: '14px' } },
          btn(c.jobEstimate ? 'Send rough quote → Estimate' : 'Start estimate from rough quote', () => c.ksApplyRoughQuote(), 'solid')),
        el('div', { style: { fontSize: '11.5px', color: T.mu, marginTop: '10px', lineHeight: 1.5 } },
          'Updates matching cost lines on this job’s estimate and flags every changed line ROUGH until verified.'))));

    // ---- line-by-line logic blocks ----
    const logicKids = [el('div', { style: { fontFamily: serif, fontWeight: 600, fontSize: '19px', color: T.tx, borderBottom: '2px solid ' + T.tx, paddingBottom: '8px', margin: '34px 0 4px 0' } }, 'Line-by-line — the reasoning behind every number')];
    for (const cl of catLines) {
      logicKids.push(el('div', { key: cl.cat, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 0 5px 0', borderBottom: '1px solid ' + T.ln } },
        el('span', { style: { fontFamily: serif, fontWeight: 700, fontSize: '14.5px', color: T.tx } }, cl.cat),
        el('span', { style: { fontFamily: serif, fontWeight: 700, fontSize: '14.5px', fontVariantNumeric: 'tabular-nums', color: T.ac } }, fmt$0(cl.sum))));
      for (const ln of cl.lines) {
        const open = c.state.ksLogicOpen === ln.row;
        logicKids.push(el('div', { key: 'l' + ln.row, style: { borderBottom: '1px dotted ' + T.ln } },
          el('div', { onClick: () => c.setState({ ksLogicOpen: open ? null : ln.row }), style: { display: 'flex', gap: '10px', alignItems: 'baseline', padding: '7px 0', cursor: ln.f ? 'pointer' : 'default', fontSize: '13px' } },
            el('span', { style: { color: T.ac, fontSize: '12px', width: '18px', flex: '0 0 18px', fontWeight: 700 } }, ln.f ? (open ? '▾' : 'ⓘ') : ''),
            el('span', { style: { flex: 1, color: T.tx } }, ln.desc),
            el('span', { style: { fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: T.tx } }, fmt$0(ln.val))),
          open && ln.f ? el('div', { style: { margin: '0 0 10px 28px', padding: '10px 14px', background: T.sf, border: '1px solid ' + T.ln, fontSize: '12px', lineHeight: 1.7, color: T.mu, fontFamily: 'ui-monospace,Menlo,monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' } },
            el('span', { style: { color: T.tx, fontFamily: sans, fontWeight: 700, fontSize: '11px', letterSpacing: '0.1em' } }, 'LOGIC:  '),
            translateFormula(wb, ln.f)) : null));
      }
    }
    kids.push(el('div', null, ...logicKids));

    return wrap(kids);
  }

  // ---------- DRAWS (modernized) ----------
  function defaultDraws() {
    return [
      { no: 1, name: 'Contract signing / mobilization', pct: 10, status: 'UPCOMING' },
      { no: 2, name: 'Foundation complete', pct: 20, status: 'UPCOMING' },
      { no: 3, name: 'Dry-in', pct: 15, status: 'UPCOMING' },
      { no: 4, name: 'Mechanicals passed', pct: 20, status: 'UPCOMING' },
      { no: 5, name: 'Drywall & interior finish', pct: 20, status: 'UPCOMING' },
      { no: 6, name: 'Final completion', pct: 15, status: 'UPCOMING' }
    ];
  }

  function viewDraws(c) {
    if (!c.jobDraws || !c.jobDraws.length) { c.jobDraws = defaultDraws(); }
    const draws = c.jobDraws;
    const contract = c.jobEstimate ? estTotals(c.jobEstimate).total : 0;
    const amt = d => contract * (Number(d.pct) || 0) / 100;
    let paid = 0, invoiced = 0;
    for (const d of draws) { if (d.status === 'PAID') paid += amt(d); if (d.status === 'INVOICED') invoiced += amt(d); }
    const remaining = contract - paid - invoiced;
    const pctSum = draws.reduce((a, d) => a + (Number(d.pct) || 0), 0);

    const kpi = (lbl, val, sub, acc) => el('div', { style: { padding: '20px 22px 22px 0', borderRight: '1px solid ' + T.ln, marginRight: '22px' } },
      label(lbl),
      el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '30px', marginTop: '8px', fontVariantNumeric: 'tabular-nums', color: acc ? T.ac : T.tx } }, val),
      el('div', { style: { fontSize: '12.5px', color: T.mu, marginTop: '4px' } }, sub));

    const kids = [];
    kids.push(el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', borderTop: '2px solid ' + T.tx, borderBottom: '1px solid ' + T.ln, marginBottom: '26px' } },
      kpi('DRAWN TO DATE', fmt$0(paid), contract ? Math.round(100 * paid / contract) + '% of contract' : '—'),
      kpi('OUTSTANDING', fmt$0(invoiced), 'invoiced, unpaid', true),
      kpi('REMAINING', fmt$0(remaining), draws.filter(d => d.status === 'UPCOMING').length + ' draws to final')));

    if (Math.round(pctSum) !== 100) kids.push(el('div', { style: { border: '1.5px solid ' + T.ac, background: T.sf, padding: '10px 14px', marginBottom: '14px', fontSize: '12.5px', color: T.tx } },
      'Draw percentages add to ' + pctSum + '% — adjust until they total 100%.'));

    const grid = '44px 1fr 90px 130px 130px 26px';
    kids.push(el('div', { style: { display: 'grid', gridTemplateColumns: grid, gap: '0 10px', padding: '8px 0', borderBottom: '1px solid ' + T.tx, fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.12em', color: T.mu } },
      el('div', null, '#'), el('div', null, 'DRAW'), el('div', { style: { textAlign: 'right' } }, '% OF K'), el('div', { style: { textAlign: 'right' } }, 'AMOUNT'), el('div', { style: { textAlign: 'right' } }, 'STATUS'), el('div', null, '')));
    draws.forEach((d, ix) => {
      kids.push(el('div', { key: ix, style: { display: 'grid', gridTemplateColumns: grid, gap: '0 10px', padding: '6px 0', alignItems: 'center', borderBottom: '1px dotted ' + T.ln } },
        el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '16px', color: T.ac } }, String(d.no)),
        cellInput(c, d.name, v => { d.name = v; c.ksSaveJobData(); }),
        cellInput(c, d.pct, v => { d.pct = num(v); c.ksSaveJobData(); }, { w: '70px', align: 'right' }),
        el('div', { style: { textAlign: 'right', fontFamily: serif, fontWeight: 700, fontSize: '15px', fontVariantNumeric: 'tabular-nums', color: T.tx } }, fmt$0(amt(d))),
        el('div', { style: { textAlign: 'right' } },
          el('span', {
            onClick: () => { d.status = d.status === 'UPCOMING' ? 'INVOICED' : (d.status === 'INVOICED' ? 'PAID' : 'UPCOMING'); c.ksSaveJobData(); c.ksTick(); },
            style: { display: 'inline-block', padding: '2px 10px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', cursor: 'pointer', background: d.status === 'INVOICED' ? T.ac : (d.status === 'PAID' ? T.tx : 'transparent'), color: d.status === 'UPCOMING' ? T.mu : T.bg, border: '1px solid ' + (d.status === 'UPCOMING' ? T.ln : 'transparent') }
          }, d.status)),
        iconBtn('×', 'Remove draw', () => { draws.splice(ix, 1); draws.forEach((x, i2) => x.no = i2 + 1); c.ksSaveJobData(); c.ksTick(); })));
    });
    kids.push(el('div', { style: { marginTop: '10px', display: 'flex', gap: '14px' } },
      btn('＋ Add draw', () => { draws.push({ no: draws.length + 1, name: 'New draw', pct: 0, status: 'UPCOMING' }); c.ksSaveJobData(); c.ksTick(); }, 'accent'),
      btn('Draws worksheet →', () => c.go('Draws'), 'accent')));
    return wrap(kids);
  }

  // ---------- job status ----------
  const JOB_STATUSES = [
    { id: 'active', name: 'Active project', desc: 'Job is live — on the combined calendar, the phone feeds, the week ahead, and draw tracking.' },
    { id: 'prospect', name: 'Prospect', desc: 'Quoting / pre-contract. Estimate and packet work as normal, but nothing hits the calendars until it goes live.' },
    { id: 'warranty', name: 'Warranty', desc: 'Build complete — kept handy for punch-list and warranty calls, off the day-to-day calendar.' },
    { id: 'archive', name: 'Archive', desc: 'Closed out. Tucked away at the bottom of Home; everything is still here if you ever need it.' }
  ];
  function jobStatusOf(meta, detail) {
    const j = detail && meta && detail[meta.id];
    return (j && j.status) || (meta && meta.status) || 'active';
  }
  const STATUS_TINT = { active: null, prospect: '#5B7A99', warranty: '#6B7A3A', archive: null };

  // ---------- per-job TO-DO LIST (admin + pm; never customers) ----------
  // Full-screen whiteboard overlay — shows job to-do list AND undated schedule tasks
  function todoWhiteboardModal(c) {
    if (!c._wbOpen) return null;
    const job = (c.state.jobs || []).find(j => j.id === c.state.jobId);
    const jobName = job ? job.name : 'Job To-Do List';
    // c.jobTodos: explicit to-do items (saved in job data as jobTodos array)
    const todos = c.jobTodos = c.jobTodos || [];
    // c.jobSchedule: schedule tasks — floating ones (no start date) are treated as to-dos
    const sched = c.jobSchedule = c.jobSchedule || [];
    const floatingTasks = sched.filter(t => !t.start || t.start === '');
    const wb = c._wbCap = c._wbCap || { newItem: '' };

    const saveClose = () => {
      c._wbOpen = false;
      c.ksSaveJobData(); // saves both jobTodos and jobSchedule
      c.ksTick();
    };
    const dismiss = () => { c._wbOpen = false; c.ksTick(); };
    const addItem = () => {
      const v = (wb.newItem || '').trim();
      if (!v) return;
      todos.push({ id: nid('td'), text: v, done: false });
      wb.newItem = '';
      c.ksTick();
    };

    // Count open items across both sources
    const openCount = todos.filter(t => !t.done).length
      + floatingTasks.filter(t => t.status !== 'Complete').length;
    const doneCount = todos.filter(t => !!t.done).length
      + floatingTasks.filter(t => t.status === 'Complete').length;

    const itemRow = (key, text, done, onToggle, onRemove) => el('div', {
      key,
      style: {
        display: 'flex', alignItems: 'center', gap: '18px',
        padding: '16px 20px', marginBottom: '10px',
        background: done ? T.s2 : T.sf,
        border: '1px solid ' + (done ? T.ln : T.ac),
        borderRadius: '4px', opacity: done ? 0.55 : 1,
        transition: 'opacity 0.15s, background 0.15s'
      }
    },
      el('input', {
        type: 'checkbox', checked: done,
        onChange: onToggle,
        style: { width: '28px', height: '28px', flex: '0 0 28px', cursor: 'pointer', accentColor: T.ac }
      }),
      el('span', {
        style: {
          flex: 1, fontSize: '18px', fontFamily: serif, lineHeight: 1.4, color: T.tx,
          textDecoration: done ? 'line-through' : 'none', wordBreak: 'break-word'
        }
      }, text),
      onRemove ? el('span', {
        title: 'Remove', onClick: onRemove,
        style: { color: T.mu, cursor: 'pointer', fontSize: '20px', padding: '2px 6px', flex: '0 0 auto', lineHeight: 1 }
      }, '×') : null);

    // Rows from explicit jobTodos
    const todoRows = todos.map((td, i) => itemRow(
      td.id || ('td' + i), td.text, !!td.done,
      e => { td.done = e.target.checked; c.ksTick(); },
      () => { c.jobTodos = todos.filter(x => x !== td); c.ksTick(); }
    ));

    // Rows from floating (undated) schedule tasks
    const schedRows = floatingTasks.map((t, i) => itemRow(
      t.id || ('sc' + i), t.task, t.status === 'Complete',
      e => { t.status = e.target.checked ? 'Complete' : 'Not Started'; t.pct = e.target.checked ? 100 : 0; c.ksTick(); },
      null // don't let whiteboard delete schedule tasks
    ));

    const allRows = [...schedRows, ...todoRows];

    return el('div', {
      style: {
        position: 'fixed', inset: 0, zIndex: 9999,
        background: T.bg, display: 'flex', flexDirection: 'column',
        fontFamily: sans, color: T.tx
      }
    },
      // Header bar
      el('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '18px',
          padding: '16px 28px', borderBottom: '2px solid ' + T.tx,
          background: T.bg, flexShrink: 0
        }
      },
        el('div', { style: { flex: 1 } },
          el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '22px', color: T.tx } }, jobName),
          el('div', { style: { fontSize: '13px', color: T.mu, marginTop: '3px' } },
            el('span', { style: { color: T.ac, fontWeight: 600 } }, openCount + ' open'), ' · ' + doneCount + ' done')),
        btn('✓ Save & Close', saveClose, 'accent'),
        el('span', {
          onClick: dismiss, title: 'Close without saving',
          style: { fontSize: '24px', cursor: 'pointer', color: T.mu, padding: '2px 8px', lineHeight: 1, marginLeft: '4px' }
        }, '×')),
      // Scrollable checklist
      el('div', {
        style: { flex: 1, overflowY: 'auto', padding: '28px', maxWidth: '720px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }
      },
        allRows.length
          ? el('div', null, ...allRows)
          : el('div', { style: { textAlign: 'center', fontSize: '15px', color: T.mu, marginTop: '60px' } }, 'Nothing here yet — add the first item below.')),
      // Add-item footer
      el('div', {
        style: {
          borderTop: '1px solid ' + T.ln, padding: '18px 28px',
          display: 'flex', gap: '12px', background: T.bg, flexShrink: 0,
          maxWidth: '720px', width: '100%', margin: '0 auto', boxSizing: 'border-box'
        }
      },
        el('input', {
          value: wb.newItem || '',
          onChange: e => { wb.newItem = e.target.value; c.ksTick(); },
          onKeyDown: e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } },
          placeholder: 'Add item and press Enter…',
          style: {
            flex: 1, padding: '12px 16px', fontSize: '16px',
            border: '1px solid ' + T.ln, background: T.sf, color: T.tx,
            fontFamily: sans, outline: 'none'
          }
        }),
        btn('Add', addItem, 'accent')));
  }

  function todoList(c) {
    const todos = c.jobTodos = c.jobTodos || [];
    let inputEl = null;
    const addTodo = () => { const v = (inputEl && inputEl.value || '').trim(); if (!v) return; todos.push({ id: nid('td'), text: v, done: false }); if (inputEl) inputEl.value = ''; c.ksSaveJobData(); c.ksTick(); };
    const open = todos.filter(t => !t.done).length;
    const rows = todos.map((td, i) => el('div', { key: td.id || i, style: { display: 'flex', alignItems: 'center', gap: '11px', padding: '8px 0', borderBottom: '1px dotted ' + T.ln } },
      el('input', { type: 'checkbox', checked: !!td.done, onChange: e => { td.done = e.target.checked; c.ksSaveJobData(); c.ksTick(); }, style: { width: '17px', height: '17px', flex: '0 0 17px', cursor: 'pointer', accentColor: T.ac } }),
      el('input', { defaultValue: td.text || '', onBlur: e => { td.text = e.target.value; c.ksSaveJobData(); }, style: { flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: '14px', fontFamily: sans, color: td.done ? T.mu : T.tx, textDecoration: td.done ? 'line-through' : 'none', padding: '3px 2px' } }),
      el('span', { title: 'Delete', onClick: () => { c.jobTodos = todos.filter(x => x !== td); c.ksSaveJobData(); c.ksTick(); }, style: { color: T.mu, cursor: 'pointer', fontSize: '15px', flex: '0 0 auto' } }, '×')));
    return el('div', { style: { maxWidth: '900px', marginBottom: '30px' } },
      todoWhiteboardModal(c),
      el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' } },
        serifHead('To-do list', 19),
        el('span', { style: { fontSize: '12.5px', color: T.mu } }, open + ' open' + (todos.length ? ' · ' + todos.length + ' total' : '')),
        el('span', { style: { flex: 1 } }),
        el('span', {
          onClick: () => { c._wbOpen = true; c._wbCap = { newItem: '' }; c.ksTick(); },
          title: 'Full-screen whiteboard — great for crew on a tablet or phone',
          style: {
            fontSize: '12px', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em',
            color: T.ac, border: '1px solid ' + T.ac, borderRadius: '3px',
            padding: '3px 11px', userSelect: 'none', alignSelf: 'center'
          }
        }, '⊞ Whiteboard')),
      el('div', { style: { height: '10px' } }),
      todos.length ? el('div', null, ...rows) : el('div', { style: { fontSize: '13px', color: T.mu, padding: '4px 0' } }, 'Nothing yet — add the first item below.'),
      el('div', { style: { display: 'flex', gap: '10px', marginTop: '12px' } },
        el('input', { ref: e => { inputEl = e; }, placeholder: 'Add a to-do…', onKeyDown: e => { if (e.key === 'Enter') { e.preventDefault(); addTodo(); } }, style: { flex: 1, border: '1px solid ' + T.ln, background: T.sf, padding: '9px 11px', fontSize: '14px', fontFamily: sans, color: T.tx } }),
        btn('Add', addTodo, 'accent')));
  }

  // ---------- per-job PLANS & FILES (upload to R2; admin uploads, admin+pm view) ----------
  function plansSection(c) {
    const plans = c.jobPlans = c.jobPlans || [];
    const role = c.state.role || 'admin';
    const fmtSize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    const tok = () => (window.RidgelineSync && window.RidgelineSync.token && window.RidgelineSync.token()) || '';
    const uploadPlan = async (file) => {
      try {
        const buf = await file.arrayBuffer();
        const res = await fetch('/api/jobs/' + c.state.jobId + '/plans', { method: 'POST', headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) }, body: buf });
        if (!res.ok) { const e = await res.json().catch(() => ({})); alert('Upload failed: ' + (e.error || res.status)); return; }
        plans.push(await res.json()); c.ksTick();
      } catch (e) { alert('Upload failed: ' + e.message); }
    };
    const viewPlan = async (p) => {
      try {
        const res = await fetch('/api/jobs/' + c.state.jobId + '/plans/' + p.id, { headers: { Authorization: 'Bearer ' + tok() } });
        if (!res.ok) { alert('Could not load file'); return; }
        c._planView = { url: URL.createObjectURL(await res.blob()), type: p.type, name: p.name }; c.ksTick();
      } catch (e) { alert('Could not load: ' + e.message); }
    };
    const deletePlan = async (p) => {
      if (!confirm('Delete "' + p.name + '"? This removes the file.')) return;
      await fetch('/api/jobs/' + c.state.jobId + '/plans/' + p.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok() } }).catch(() => {});
      c.jobPlans = plans.filter(x => x.id !== p.id); if (c._planView && c._planView.name === p.name) c._planView = null; c.ksTick();
    };
    const pv = c._planView;
    return el('div', { style: { maxWidth: '900px', marginBottom: '30px' } },
      el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px' } }, serifHead('Plans & files', 19),
        el('span', { style: { fontSize: '12.5px', color: T.mu } }, plans.length + ' file' + (plans.length === 1 ? '' : 's'))),
      el('div', { style: { height: '10px' } }),
      plans.length ? el('div', null, ...plans.map(p => el('div', { key: p.id, style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0', borderBottom: '1px dotted ' + T.ln } },
        el('div', { style: { flex: 1, minWidth: 0 } },
          el('div', { style: { fontSize: '14px', fontWeight: 600, color: T.tx, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, p.name),
          el('div', { style: { fontSize: '11.5px', color: T.mu } }, fmtSize(p.size || 0))),
        el('span', { onClick: () => viewPlan(p), style: { fontSize: '12.5px', fontWeight: 700, color: T.ac, cursor: 'pointer' } }, 'View'),
        role === 'admin' ? el('span', { onClick: () => deletePlan(p), title: 'Delete', style: { fontSize: '16px', color: T.mu, cursor: 'pointer' } }, '×') : null)))
        : el('div', { style: { fontSize: '13px', color: T.mu, padding: '4px 0' } }, 'No plans yet — upload a PDF or image.'),
      role === 'admin' ? el('label', { style: { display: 'inline-block', marginTop: '12px', cursor: 'pointer', border: '1px solid ' + T.ac, color: T.ac, fontWeight: 700, fontSize: '13px', padding: '8px 14px', fontFamily: sans } }, '⬆ Upload plan / file',
        el('input', { type: 'file', accept: '.pdf,image/*', onChange: e => { const f = e.target.files && e.target.files[0]; if (f) uploadPlan(f); e.target.value = ''; }, style: { display: 'none' } })) : null,
      pv ? el('div', { style: { marginTop: '16px' } },
        el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '6px' } },
          el('span', { style: { fontSize: '13px', fontWeight: 600, color: T.tx } }, pv.name),
          el('a', { href: pv.url, target: '_blank', rel: 'noopener', style: { fontSize: '12px', color: T.ac, textDecoration: 'none', borderBottom: '1px dotted ' + T.ac } }, 'Open in new tab ↗'),
          el('span', { onClick: () => { c._planView = null; c.ksTick(); }, style: { marginLeft: 'auto', fontSize: '12px', color: T.mu, cursor: 'pointer' } }, 'Close ✕')),
        (pv.type && pv.type.indexOf('image') === 0)
          ? el('img', { src: pv.url, style: { maxWidth: '100%', border: '1px solid ' + T.ln, display: 'block' } })
          : el('iframe', { src: pv.url, style: { width: '100%', height: '600px', border: '1px solid ' + T.ln, display: 'block' }, title: 'Plan' })) : null);
  }

  // ---------- THE WHITEBOARD (shared capture board — staff only) ----------
  function noteSummary(n) {
    const t = (n.text || '').trim();
    if (t) return t.split(/\n/)[0].slice(0, 60);
    if (n.items && n.items.length) return String(n.items[0].text || '').slice(0, 60);
    return '(empty note)';
  }
  function noteFullText(n) {
    const t = (n.text || '').trim();
    const items = (n.items && n.items.length) ? n.items.map(i => (i.done ? '☑ ' : '☐ ') + i.text).join('\n') : '';
    return (t + (t && items ? '\n' : '') + items).trim();
  }

  // ---------- whiteboard attachments (photos / PDFs / sketches) ----------
  const boardTok = () => (window.RidgelineSync && window.RidgelineSync.token && window.RidgelineSync.token()) || '';

  async function boardUploadFile(c, note, file) {
    try {
      const buf = await file.arrayBuffer();
      const headers = { Authorization: 'Bearer ' + boardTok(), 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name || 'file') };
      let meta;
      if (note.jobId) {
        const res = await fetch('/api/jobs/' + note.jobId + '/plans', { method: 'POST', headers, body: buf });
        if (!res.ok) { const e = await res.json().catch(() => ({})); alert('Upload failed: ' + (e.error || res.status)); return; }
        meta = await res.json(); meta.jobId = note.jobId;
        if (c.ksJobCache && c.ksJobCache[note.jobId] && Array.isArray(c.ksJobCache[note.jobId].plans)) c.ksJobCache[note.jobId].plans.push(meta);
        if (note.jobId === c.state.jobId && Array.isArray(c.jobPlans) && !c.jobPlans.find(p => p.id === meta.id)) c.jobPlans.push(meta);
      } else {
        const res = await fetch('/api/board-files', { method: 'POST', headers, body: buf });
        if (!res.ok) { const e = await res.json().catch(() => ({})); alert('Upload failed: ' + (e.error || res.status)); return; }
        meta = await res.json(); meta.jobId = null;
      }
      note.files = note.files || [];
      note.files.push({ id: meta.id, name: meta.name, size: meta.size, type: meta.type, jobId: meta.jobId || null });
      c.ksSaveBoard(); c.ksTick();
    } catch (e) { alert('Upload failed: ' + e.message); }
  }

  async function boardViewFile(c, f) {
    try {
      const url = f.jobId ? '/api/jobs/' + f.jobId + '/plans/' + f.id : '/api/board-files/' + f.id;
      const res = await fetch(url, { headers: { Authorization: 'Bearer ' + boardTok() } });
      if (!res.ok) { alert('Could not load the file'); return; }
      window.open(URL.createObjectURL(await res.blob()), '_blank');
    } catch (e) { alert('Could not load: ' + e.message); }
  }

  // when a note lands on a job, its loose attachments move into that job's Plans (note keeps the link)
  function boardMoveFiles(c, note, jobId) {
    for (const f of (note.files || [])) {
      if (f.jobId) continue;
      fetch('/api/board-files/' + f.id + '/move', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + boardTok(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId })
      }).then(r => (r.ok ? r.json() : null)).then(meta => {
        if (!meta) return;
        f.jobId = jobId;
        const cached = c.ksJobCache && c.ksJobCache[jobId];
        if (cached && Array.isArray(cached.plans) && !cached.plans.find(p => p.id === meta.id)) cached.plans.push(meta);
        if (jobId === c.state.jobId && Array.isArray(c.jobPlans) && !c.jobPlans.find(p => p.id === meta.id)) c.jobPlans.push(meta);
        c.ksSaveBoard(); c.ksTick();
      }).catch(() => {});
    }
  }

  // A checklist note stays LIVE on the whiteboard after it's scheduled (so the crew can keep
  // adding/checking items); the schedule row just carries a summary + a link back to the note.
  // A plain note keeps the old behavior: it moves off the board onto the schedule.
  function boardScheduleTask(c, note, jobId, startISO, dueISO) {
    const startD = startISO || dueISO;
    const finD = (startISO && dueISO && dueISO > startISO) ? dueISO : startD;
    const fileNames = (note.files || []).map(f => f.name);
    boardMoveFiles(c, note, jobId);
    const isChecklist = !!(note.items && note.items.length);
    const files = fileNames.length ? '\n📎 In Plans: ' + fileNames.join(', ') : '';
    const noteText = (isChecklist ? '☑ To-do checklist — open it on the Whiteboard to add or check off items.' : noteFullText(note)) + files;

    // Add a new schedule row, or update the existing linked one on reschedule (no duplicates).
    const applyToSchedule = (sched) => {
      let task = isChecklist && note.schedTaskId ? sched.find(t => t.id === note.schedTaskId) : null;
      if (task) {
        task.task = noteSummary(note); task.note = noteText;
        task.start = startD; task.finish = finD; task.fixed = startD; task.days = workdaysInclusive(startD, finD);
      } else {
        task = {
          id: nid('wb'), task: noteSummary(note), group: 'Whiteboard', codes: [],
          off: 0, days: workdaysInclusive(startD, finD), pred: null, lag: 0,
          start: startD, finish: finD, status: 'Not Started', pct: 0,
          fixed: startD, note: noteText, boardNoteId: isChecklist ? note.id : undefined
        };
        sched.push(task);
        if (isChecklist) note.schedTaskId = task.id;
      }
    };

    const finishNote = () => {
      if (isChecklist) {
        // keep the checklist on the board, tagged as scheduled + still editable
        note.jobId = jobId; note.schedStart = startD; note.schedFinish = finD;
        c.ksSaveBoard();
      } else {
        const b = c.ksBoardCache;
        if (b) { b.notes = (b.notes || []).filter(x => x.id !== note.id); c.ksSaveBoard(); }
      }
      c.ksTick();
    };

    if (jobId === c.state.jobId && Array.isArray(c.jobSchedule) && c.jobSchedule.length) {
      applyToSchedule(c.jobSchedule);
      c.ksSaveJobData();
      finishNote();
      return;
    }
    c.ksApi('/jobs/' + jobId).then(j => {
      const sched = Array.isArray(j.schedule) ? j.schedule : [];
      applyToSchedule(sched);
      if (c.ksJobCache && c.ksJobCache[jobId]) c.ksJobCache[jobId].schedule = sched;
      return c.ksApi('/jobs/' + jobId, { method: 'PUT', body: JSON.stringify({ schedule: sched }) });
    }).then(finishNote).catch(e => alert('Could not add to the schedule: ' + e.message));
  }

  function boardDialog(c, jobsMeta) {
    const dlg = c._boardDlg;
    if (!dlg) return null;
    const b = c.ksBoardCache || { notes: [] };
    const note = (b.notes || []).find(x => x.id === dlg.noteId);
    const close = () => { c._boardDlg = null; c.ksTick(); };
    if (!note) return null;
    const job = jobsMeta.find(m => m.id === dlg.jobId);
    const inp = (key, lbl) => el('div', null, label(lbl, { marginBottom: '4px' }),
      el('input', { type: 'date', defaultValue: dlg[key] || '', onChange: e => { dlg[key] = e.target.value; }, style: { width: '100%', border: '1px solid ' + T.ln, padding: '9px 10px', fontSize: '14px', fontFamily: sans, background: T.bg, color: T.tx } }));
    return el('div', { style: { position: 'fixed', inset: 0, zIndex: 85, background: 'rgba(20,16,12,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' } },
      el('div', { style: { background: T.sf, border: '1.5px solid ' + T.tx, width: '460px', maxWidth: '95vw', padding: '20px 22px', fontFamily: sans, color: T.tx } },
        el('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '12px' } },
          el('div', { style: { fontFamily: serif, fontWeight: 600, fontSize: '18px' } }, '→ ' + (job ? job.name : 'job')),
          el('div', { style: { flex: 1 } }),
          el('span', { onClick: close, style: { cursor: 'pointer', color: T.mu, fontSize: '18px' } }, '✕')),
        el('div', { style: { fontSize: '13px', color: T.tx, whiteSpace: 'pre-wrap', border: '1px solid ' + T.ln, background: T.bg, padding: '10px 12px', marginBottom: '14px', maxHeight: '110px', overflow: 'auto' } }, noteFullText(note) || '(empty)'),
        el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '8px' } }, inp('start', 'START DATE'), inp('due', 'DUE DATE — OPTIONAL')),
        el('div', { style: { fontSize: '11.5px', color: T.mu, marginBottom: '14px', lineHeight: 1.5 } },
          (note.items && note.items.length)
            ? 'This to-do list goes on the job schedule (and the calendars) as a summary — and stays right here on the Whiteboard so you can keep adding and checking off items.'
            : 'With a date it lands on the job schedule and the calendars. No date? It stays on the whiteboard and bugs you until it’s scheduled or done.'),
        el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
          btn((note.items && note.items.length) ? (note.schedStart ? 'Update schedule' : 'Put on schedule') : 'Add to schedule', () => {
            if (!dlg.start && !dlg.due) { alert('Pick a start (or due) date first — or choose "assign only".'); return; }
            boardScheduleTask(c, note, dlg.jobId, dlg.start || null, dlg.due || null);
            close();
          }, 'solid'),
          btn('Assign only — no date', () => { note.jobId = dlg.jobId; boardMoveFiles(c, note, dlg.jobId); c.ksSaveBoard(); close(); }),
          btn('Cancel', close, 'danger'))));
  }

  function boardNoteCard(c, n, jobsMeta, opts) {
    opts = opts || {};
    const saveB = () => { c.ksSaveBoard(); c.ksTick(); };
    const remove = (msg) => {
      if (!confirm(msg)) return;
      (n.files || []).forEach(f => { if (!f.jobId) fetch('/api/board-files/' + f.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + boardTok() } }).catch(() => {}); });
      c.ksBoardCache.notes = c.ksBoardCache.notes.filter(x => x !== n);
      saveB();
    };
    const jobName = n.jobId ? ((jobsMeta.find(m => m.id === n.jobId) || {}).name || 'job') : null;
    return el('div', {
      key: n.id,
      draggable: true,
      onDragStart: e => { try { e.dataTransfer.setData('text/plain', n.id); } catch (err) {} c._dragNote = n.id; },
      onDragEnd: () => { c._dragNote = null; },
      style: {
        border: '1px solid ' + T.ln, borderTop: '3px solid ' + (n.jobId ? T.ac : T.tx), background: T.sf,
        padding: '12px 14px 10px 14px', cursor: 'grab', boxShadow: '0 2px 8px rgba(35,30,22,0.09)',
        borderRadius: '10px', transform: 'rotate(' + (opts.rot || 0) + 'deg)', minWidth: 0
      }
    },
      n.text ? el('div', { style: { fontSize: '13.5px', color: T.tx, whiteSpace: 'pre-wrap', lineHeight: 1.5, wordBreak: 'break-word' } }, n.text) : null,
      (n.items && n.items.length) ? el('div', { style: { marginTop: n.text ? '7px' : 0 } },
        ...n.items.map(it => el('label', { key: it.id, style: { display: 'flex', gap: '8px', alignItems: 'baseline', fontSize: '13px', color: it.done ? T.mu : T.tx, padding: '2px 0', cursor: 'pointer', textDecoration: it.done ? 'line-through' : 'none' } },
          el('input', { type: 'checkbox', checked: !!it.done, onChange: e => { it.done = e.target.checked; saveB(); }, style: { accentColor: T.ac } }),
          el('span', null, it.text)))) : null,
      (n.files && n.files.length) ? el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' } },
        ...n.files.map(f => el('span', {
          key: f.id,
          onClick: e => { e.stopPropagation(); boardViewFile(c, f); },
          title: f.name + (f.jobId ? ' — saved in the job’s Plans' : ''),
          style: { fontSize: '11px', fontWeight: 600, color: T.ac, border: '1px solid ' + T.ln, borderRadius: '7px', padding: '2px 8px', cursor: 'pointer', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
        }, ((f.type || '').indexOf('image') === 0 ? '🖼 ' : '📄 ') + f.name))) : null,
      el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '9px', borderTop: '1px dotted ' + T.ln, paddingTop: '7px', flexWrap: 'wrap' } },
        el('span', { style: { fontSize: '10.5px', color: T.mu } }, (n.by ? n.by + ' · ' : '') + new Date(n.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
        jobName ? el('span', { style: { fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', color: T.ac, border: '1px solid ' + T.ac, padding: '0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '110px' } }, jobName.toUpperCase()) : null,
        n.schedStart ? el('span', { title: 'On the schedule — edit the list right here', style: { fontSize: '10px', fontWeight: 700, color: T.mu } }, '📅 ' + new Date(n.schedStart + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) : null,
        el('span', { style: { flex: 1 } }),
        n.jobId
          ? el('span', { onClick: () => { c._boardDlg = { noteId: n.id, jobId: n.jobId, start: n.schedStart || '', due: n.schedFinish || '' }; c.ksTick(); }, style: { fontSize: '11.5px', fontWeight: 700, color: T.ac, cursor: 'pointer' } }, n.schedStart ? '📅 Reschedule' : '📅 Schedule')
          : el('select', {
              value: '',
              onChange: e => { if (!e.target.value) return; c._boardDlg = { noteId: n.id, jobId: e.target.value }; c.ksTick(); },
              style: { border: '1px solid ' + T.ln, background: 'transparent', color: T.mu, fontSize: '11px', fontFamily: sans, maxWidth: '108px', padding: '2px' }
            }, el('option', { value: '' }, 'Send to…'), ...jobsMeta.map(m => el('option', { key: m.id, value: m.id }, m.name.slice(0, 24)))),
        el('label', { title: 'Attach photo / PDF', onClick: e => e.stopPropagation(), style: { cursor: 'pointer', color: T.mu, fontSize: '13px' } }, '📎',
          el('input', { type: 'file', accept: '.pdf,image/*', multiple: true, onChange: e => { const fl = e.target.files || []; for (let fi = 0; fi < fl.length; fi++) boardUploadFile(c, n, fl[fi]); e.target.value = ''; }, style: { display: 'none' } })),
        el('span', { onClick: () => remove('Mark this note done and take it off the board?'), title: 'Done — off the board', style: { color: T.ac, cursor: 'pointer', fontSize: '13px', fontWeight: 700 } }, '✓'),
        el('span', { onClick: () => remove('Delete this note?'), title: 'Delete note', style: { color: T.mu, cursor: 'pointer', fontSize: '14px' } }, '×')));
  }

  // ---------- simple sketch tool (finger/mouse drawing → PNG note) ----------
  function sketchDialog(c) {
    if (!c._sketchOpen) return null;
    const s = c._sketch = c._sketch || { color: '#26211A', size: 3 };
    const close = () => { c._sketchOpen = false; c._sketchCanvas = null; c.ksTick(); };
    const setRef = cv => {
      if (!cv || c._sketchCanvas === cv) return;
      c._sketchCanvas = cv;
      const scale = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight;
      cv.width = w * scale; cv.height = h * scale;
      const ctx = cv.getContext('2d');
      ctx.scale(scale, scale);
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      let drawing = false, lx = 0, ly = 0;
      const pos = ev => { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
      cv.onpointerdown = ev => { ev.preventDefault(); try { cv.setPointerCapture(ev.pointerId); } catch (e2) {} drawing = true; const p = pos(ev); lx = p[0]; ly = p[1]; };
      cv.onpointermove = ev => {
        if (!drawing) return;
        ev.preventDefault();
        const p = pos(ev);
        ctx.strokeStyle = s.color; ctx.lineWidth = s.size;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(p[0], p[1]); ctx.stroke();
        lx = p[0]; ly = p[1];
      };
      cv.onpointerup = cv.onpointercancel = () => { drawing = false; };
    };
    const clear = () => {
      const cv = c._sketchCanvas;
      if (!cv) return;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, cv.clientWidth, cv.clientHeight);
    };
    const save = () => {
      const cv = c._sketchCanvas;
      if (!cv) return;
      cv.toBlob(async blob => {
        if (!blob) { alert('Could not save the sketch.'); return; }
        if (!c.ksBoardCache) c.ksBoardCache = { notes: [] };
        const by = (window.RidgelineSync && window.RidgelineSync.userName()) || 'office';
        const note = { id: nid('bn'), text: '✏ Sketch — ' + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), items: null, jobId: null, by, ts: Date.now(), files: [] };
        c.ksBoardCache.notes.unshift(note);
        const file = new File([blob], 'sketch-' + new Date().toISOString().slice(0, 10) + '-' + Math.random().toString(36).slice(2, 6) + '.png', { type: 'image/png' });
        await boardUploadFile(c, note, file);
        c.ksSaveBoard();
        close();
      }, 'image/png');
    };
    const colorBtn = col => el('span', {
      key: col, onClick: () => { s.color = col; c.ksTick(); },
      style: { width: '26px', height: '26px', borderRadius: '50%', background: col, display: 'inline-block', cursor: 'pointer', border: s.color === col ? '3px solid ' + T.ac : '2px solid ' + T.ln, boxSizing: 'border-box' }
    });
    const sizeBtn = sz => el('span', {
      key: 's' + sz, onClick: () => { s.size = sz; c.ksTick(); },
      style: { width: '26px', height: '26px', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: s.size === sz ? '2px solid ' + T.ac : '1px solid ' + T.ln }
    }, el('span', { style: { width: sz * 2 + 'px', height: sz * 2 + 'px', borderRadius: '50%', background: T.tx, display: 'inline-block' } }));
    return el('div', { style: { position: 'fixed', inset: 0, zIndex: 88, background: 'rgba(20,16,12,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '14px' } },
      el('div', { style: { background: T.sf, border: '1.5px solid ' + T.tx, borderRadius: '14px', width: '760px', maxWidth: '97vw', padding: '16px 18px', fontFamily: sans, color: T.tx } },
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', flexWrap: 'wrap' } },
          el('div', { style: { fontFamily: serif, fontWeight: 600, fontSize: '18px' } }, '✏ Sketch'),
          colorBtn('#26211A'), colorBtn('#A64B24'), colorBtn('#2F5B93'),
          el('span', { style: { width: '10px' } }),
          sizeBtn(2), sizeBtn(4), sizeBtn(8),
          el('span', { style: { flex: 1 } }),
          btn('Clear', clear, 'danger'),
          el('span', { onClick: close, style: { cursor: 'pointer', color: T.mu, fontSize: '18px', padding: '0 4px' } }, '✕')),
        el('canvas', { ref: setRef, style: { width: '100%', height: '56vh', display: 'block', background: '#FFFFFF', border: '1px solid ' + T.ln, borderRadius: '10px', touchAction: 'none', cursor: 'crosshair' } }),
        el('div', { style: { display: 'flex', gap: '10px', marginTop: '12px' } },
          btn('Save to the board', save, 'solid'),
          btn('Cancel', close))));
  }

  function viewBoard(c) {
    c.ksLoadBoard();
    const jobsMeta = c.state.jobs || [];
    const detail = c.ksJobCache = c.ksJobCache || {};
    for (const m of jobsMeta) {
      if (detail[m.id] === undefined) {
        detail[m.id] = null;
        c.ksApi('/jobs/' + m.id).then(j => { detail[m.id] = j; c.ksTick(); }).catch(() => { detail[m.id] = false; });
      }
    }
    const notes = (c.ksBoardCache && c.ksBoardCache.notes) || [];
    const actives = jobsMeta.filter(m => jobStatusOf(m, detail) === 'active');
    const prospects = jobsMeta.filter(m => jobStatusOf(m, detail) === 'prospect');
    const nag = notes.filter(n => n.jobId);
    const loose = notes.filter(n => !n.jobId);
    const cap = c._boardCap = c._boardCap || { text: '', checklist: false, lines: [], focus: -1 };
    if (!Array.isArray(cap.lines)) cap.lines = [];
    if (cap.checklist) { while (cap.lines.length < 8) cap.lines.push(''); }

    const addNote = () => {
      if (!c.ksBoardCache) c.ksBoardCache = { notes: [] };
      const by = (window.RidgelineSync && window.RidgelineSync.userName()) || ((c.state.realRole || c.state.role || 'admin') === 'admin' ? 'office' : '');
      let note;
      if (cap.checklist) {
        const items = cap.lines.map(x => String(x).trim()).filter(Boolean);
        if (!items.length) return;
        note = { id: nid('bn'), text: '', items: items.map(x => ({ id: nid('bi'), text: x.replace(/^[-*•☐\[\]\s]+/, ''), done: false })), jobId: null, by, ts: Date.now() };
        cap.lines = []; cap.focus = -1;
      } else {
        const t = (cap.text || '').trim();
        if (!t) return;
        note = { id: nid('bn'), text: t, items: null, jobId: null, by, ts: Date.now() };
        cap.text = '';
      }
      c.ksBoardCache.notes.unshift(note);
      c.ksSaveBoard(); c.ksTick();
    };

    const jobDrop = (m, small) => el('div', {
      key: m.id,
      onDragOver: e => { e.preventDefault(); e.currentTarget.classList.add('ks-dropok'); },
      onDragLeave: e => { e.currentTarget.classList.remove('ks-dropok'); },
      onDrop: e => {
        e.preventDefault(); e.currentTarget.classList.remove('ks-dropok');
        let id = ''; try { id = e.dataTransfer.getData('text/plain'); } catch (err) {}
        id = id || c._dragNote;
        if (!id) return;
        c._boardDlg = { noteId: id, jobId: m.id };
        c._dragNote = null;
        c.ksTick();
      },
      onClick: () => { c.openJob(m.id); c.go((c.state.role === 'pm') ? 'KS:Schedule' : 'KS:Estimate'); },
      style: { border: '1px solid ' + T.ln, borderLeft: '4px solid ' + (small ? '#5B7A99' : T.ac), borderRadius: '10px', background: T.sf, padding: small ? '9px 11px' : '13px 14px', marginBottom: '8px', cursor: 'pointer' }
    },
      el('div', { style: { fontWeight: 700, fontSize: small ? '12.5px' : '14px', color: T.tx } }, m.name),
      el('div', { style: { fontSize: '10.5px', color: T.mu, marginTop: '2px' } }, small ? 'prospect — drop to assign' : 'drop a note here'));

    const checklistRows = () => el('div', { style: { minHeight: '46vh', paddingTop: '2px' } },
      ...cap.lines.map((v, i) => el('div', { key: 'cl' + i, style: { display: 'flex', alignItems: 'center', gap: '11px', padding: '3px 0', borderBottom: '1px dotted ' + T.ln } },
        el('input', { type: 'checkbox', checked: false, readOnly: true, tabIndex: -1, style: { width: '18px', height: '18px', flex: '0 0 18px', accentColor: T.ac, opacity: 0.5, pointerEvents: 'none' } }),
        el('input', {
          value: v,
          autoFocus: cap.focus === i,
          placeholder: i === 0 ? 'First to-do…' : '',
          onChange: e => { cap.lines[i] = e.target.value; c.ksTick(); },
          onFocus: () => { cap.focus = i; },
          onKeyDown: e => {
            if (e.key === 'Enter') { e.preventDefault(); if (i === cap.lines.length - 1) cap.lines.push(''); cap.focus = i + 1; c.ksTick(); }
          },
          style: { flex: 1, border: 'none', background: 'transparent', fontSize: '15.5px', fontFamily: sans, color: T.tx, outline: 'none', padding: '6px 2px' }
        }))));

    const kids = [];
    kids.push(el('div', { className: 'ks-board-grid', style: { display: 'grid', gridTemplateColumns: '210px 1fr 235px', gap: '26px', alignItems: 'start' } },
      el('div', null,
        label('ACTIVE JOBS', { marginBottom: '10px' }),
        ...(actives.length ? actives.map(m => jobDrop(m, false)) : [el('div', { style: { fontSize: '12px', color: T.mu } }, 'No active jobs')])),
      el('div', null,
        el('div', { style: { border: '2px solid ' + T.tx, borderRadius: '16px', background: T.sf, padding: '20px 24px', marginBottom: '20px', boxShadow: '0 3px 14px rgba(35,30,22,0.12)' } },
          cap.checklist ? checklistRows() : el('textarea', {
            value: cap.text,
            placeholder: 'Get it out of your head — type it here…',
            onChange: e => { cap.text = e.target.value; c.ksTick(); },
            onKeyDown: e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNote(); } },
            style: { width: '100%', minHeight: '46vh', border: 'none', background: 'transparent', fontSize: '16px', lineHeight: 1.6, fontFamily: sans, color: T.tx, resize: 'vertical', outline: 'none' }
          }),
          el('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', borderTop: '1px dotted ' + T.ln, paddingTop: '12px', marginTop: '8px', flexWrap: 'wrap' } },
            el('label', { style: { fontSize: '13px', color: T.mu, cursor: 'pointer' } },
              el('input', {
                type: 'checkbox', checked: !!cap.checklist,
                onChange: e => {
                  cap.checklist = e.target.checked;
                  if (cap.checklist) {
                    const fromText = (cap.text || '').split(/\n/).map(x => x.trim()).filter(Boolean);
                    if (fromText.length) { cap.lines = fromText; cap.text = ''; }
                    while (cap.lines.length < 8) cap.lines.push('');
                    cap.focus = cap.lines.findIndex(x => !String(x).trim());
                  } else {
                    const joined = cap.lines.map(x => String(x).trim()).filter(Boolean).join('\n');
                    if (joined) cap.text = joined;
                    cap.lines = []; cap.focus = -1;
                  }
                  c.ksTick();
                },
                style: { marginRight: '7px', verticalAlign: 'middle', accentColor: T.ac }
              }),
              'Checklist'),
            btn('✏ Sketch', () => { c._sketchOpen = true; c.ksTick(); }, 'accent'),
            el('label', { title: 'Attach a photo or PDF as a new note', style: { cursor: 'pointer', color: T.ac, fontSize: '13px', fontWeight: 700 } }, '📎 Photo / PDF',
              el('input', {
                type: 'file', accept: '.pdf,image/*', multiple: true,
                onChange: e => {
                  const fl = e.target.files || [];
                  if (!fl.length) return;
                  if (!c.ksBoardCache) c.ksBoardCache = { notes: [] };
                  const by = (window.RidgelineSync && window.RidgelineSync.userName()) || 'office';
                  const note = { id: nid('bn'), text: (cap.text || '').trim(), items: null, jobId: null, by, ts: Date.now(), files: [] };
                  c.ksBoardCache.notes.unshift(note);
                  cap.text = '';
                  for (let fi = 0; fi < fl.length; fi++) boardUploadFile(c, note, fl[fi]);
                  e.target.value = '';
                  c.ksSaveBoard(); c.ksTick();
                },
                style: { display: 'none' }
              })),
            el('span', { style: { flex: 1 } }),
            btn('Stick it on the board', addNote, 'solid'))),
        loose.length
          ? el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '14px' } },
              ...loose.map((n, i) => boardNoteCard(c, n, jobsMeta, { rot: (i % 3 === 0 ? -0.7 : (i % 3 === 1 ? 0.5 : 0)) })))
          : el('div', { style: { textAlign: 'center', color: T.mu, fontSize: '13px', padding: '20px 0' } }, 'The board is clear. Anything on your mind goes in the box — drag it to a job when it lands.')),
      el('div', null,
        label('PROSPECTS', { marginBottom: '10px' }),
        ...(prospects.length ? prospects.map(m => jobDrop(m, true)) : [el('div', { style: { fontSize: '12px', color: T.mu } }, 'No prospects')]),
        nag.length ? el('div', { style: { marginTop: '20px' } },
          label('🔔 NEEDS SCHEDULING — ' + nag.length, { color: T.ac, marginBottom: '9px' }),
          el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
            ...nag.map(n => boardNoteCard(c, n, jobsMeta, {})))) : null)));
    kids.push(boardDialog(c, jobsMeta));
    kids.push(sketchDialog(c));
    // paste a screenshot / photo / PDF anywhere on the board → becomes a note
    return el('div', {
      onPaste: e => {
        const fl = (e.clipboardData && e.clipboardData.files) || [];
        if (!fl.length) return;
        e.preventDefault();
        if (!c.ksBoardCache) c.ksBoardCache = { notes: [] };
        const by = (window.RidgelineSync && window.RidgelineSync.userName()) || 'office';
        const note = { id: nid('bn'), text: '', items: null, jobId: null, by, ts: Date.now(), files: [] };
        c.ksBoardCache.notes.unshift(note);
        for (let fi = 0; fi < fl.length; fi++) boardUploadFile(c, note, fl[fi]);
        c.ksSaveBoard(); c.ksTick();
      },
      style: { fontFamily: sans, color: T.tx }
    }, ...kids);
  }

  // ---------- CUSTOMERS (pick a file to work) ----------
  function viewCustomers(c) {
    const role = c.state.role || 'admin';
    const jobsMeta = c.state.jobs || [];
    const detail = c.ksJobCache = c.ksJobCache || {};
    for (const m of jobsMeta) {
      if (detail[m.id] === undefined) {
        detail[m.id] = null;
        c.ksApi('/jobs/' + m.id).then(j => { detail[m.id] = j; c.ksTick(); }).catch(() => { detail[m.id] = false; });
      }
    }
    c.ksLoadBoard();
    const bNotes = (c.ksBoardCache && c.ksBoardCache.notes) || [];
    const noteCountOf = id => bNotes.filter(n => n.jobId === id).length;
    const coll = c._custColl = c._custColl || { archive: true };
    const open = (m) => { c.openJob(m.id); c.go(role === 'admin' ? 'KS:Estimate' : 'KS:Schedule'); };
    const rowEl = (m, n, dim) => {
      const j = detail[m.id];
      let amt = '…', phase = '—', pct = 0;
      if (j && j.estimate) amt = fmt$0(estTotals(j.estimate).total); else if (j) amt = '—';
      const sched = (j && j.schedule) || [];
      if (sched.length) {
        const done = sched.filter(s => s.status === 'Complete').length;
        pct = Math.round(100 * (done + 0.5 * sched.filter(s => s.status === 'In Progress').length) / sched.length);
        const cur2 = sched.find(s => s.status === 'In Progress') || sched.find(s => s.status !== 'Complete');
        phase = cur2 ? cur2.task.replace(/^\d{4}\s*/, '') : (done ? 'Complete' : '—');
      }
      const cust = (j && j.customer) || {};
      return el('div', { key: m.id, onClick: () => open(m), style: { display: 'flex', alignItems: 'baseline', gap: '18px', padding: '15px 0', borderTop: '1px solid ' + T.ln, cursor: 'pointer', opacity: dim ? 0.55 : 1 } },
        el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '15px', color: T.mu, width: '28px', flex: '0 0 28px' } }, String(n).padStart(2, '0')),
        el('div', { style: { flex: 1, minWidth: 0 } },
          el('div', { style: { fontWeight: 700, fontSize: '15.5px', color: T.tx } }, m.name, m.id === c.state.jobId ? chip('OPEN') : null),
          el('div', { style: { fontSize: '12.5px', color: T.mu, marginTop: '1px' } }, (cust.name ? cust.name + ' · ' : '') + 'phase — ', el('span', { style: { color: T.ac, fontWeight: 600 } }, phase))),
        (function () {
          const nc = noteCountOf(m.id);
          return nc ? el('span', {
            title: nc + ' unscheduled whiteboard note' + (nc === 1 ? '' : 's') + ' — open To-dos',
            onClick: e => { e.stopPropagation(); c.openJob(m.id); c.go('KS:Todos'); },
            style: { fontSize: '11px', fontWeight: 700, color: T.ac, border: '1px solid ' + T.ac, borderRadius: '9px', padding: '1px 8px', cursor: 'pointer', whiteSpace: 'nowrap', alignSelf: 'center' }
          }, '⚑ ' + nc) : null;
        })(),
        el('div', { style: { width: '120px', height: '5px', background: T.s2, alignSelf: 'center' } }, el('div', { style: { height: '100%', width: pct + '%', background: T.ac } })),
        role === 'admin' ? el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '16px', fontVariantNumeric: 'tabular-nums', color: T.tx, width: '105px', textAlign: 'right' } }, amt) : null,
        role === 'admin' ? el('span', { title: 'Rename', onClick: e => { e.stopPropagation(); c.renameJobUI(m.id, m.name); }, style: { color: T.mu, fontSize: '12px', cursor: 'pointer' } }, '✎') : null,
        role === 'admin' ? el('span', { title: 'Delete job', onClick: e => { e.stopPropagation(); c.deleteJobUI(m.id, m.name); }, style: { color: T.mu, fontSize: '14px', cursor: 'pointer' } }, '×') : null);
    };
    const kids = [];
    kids.push(el('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' } },
      serifHead('Every customer, one list'),
      role === 'admin' ? btn('＋ New job', () => { c._newJob = null; c.go('KS:NewJob'); }, 'accent') : null));
    let n = 0, shown = 0;
    const groups = [['active', 'ACTIVE'], ['prospect', 'PROSPECTS'], ['warranty', 'WARRANTY'], ['archive', 'ARCHIVE']];
    for (const [sid, lbl] of groups) {
      const g = jobsMeta.filter(m => jobStatusOf(m, detail) === sid);
      if (!g.length) continue;
      const collapsible = sid !== 'active';
      const closed = collapsible && !!coll[sid];
      kids.push(el('div', {
        onClick: collapsible ? () => { coll[sid] = !coll[sid]; c.ksTick(); } : undefined,
        style: { display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: n || shown ? '26px' : '10px', paddingBottom: '6px', cursor: collapsible ? 'pointer' : 'default', userSelect: 'none' }
      },
        collapsible ? el('span', { style: { fontSize: '11px', color: T.mu } }, closed ? '▸' : '▾') : null,
        label(lbl + ' — ' + g.length)));
      shown++;
      if (closed) { n += g.length; continue; }
      g.forEach(m => kids.push(rowEl(m, ++n, sid === 'archive')));
    }
    if (!n && !shown) kids.push(el('div', { style: { padding: '16px 0', fontSize: '13px', color: T.mu } }, 'No jobs yet — hit "＋ New job" to start the first one.'));
    return wrap(kids);
  }

  // ---------- PLANS (own tab) & TO-DOS (whiteboard notes for this job) ----------
  function viewPlans(c) {
    return wrap([plansSection(c)]);
  }

  function viewTodos(c) {
    c.ksLoadBoard();
    const jobsMeta = c.state.jobs || [];
    const notes = ((c.ksBoardCache && c.ksBoardCache.notes) || []).filter(n => n.jobId === c.state.jobId);
    const addHere = () => {
      const t = prompt('New to-do for this job:');
      if (!t || !t.trim()) return;
      if (!c.ksBoardCache) c.ksBoardCache = { notes: [] };
      const by = (window.RidgelineSync && window.RidgelineSync.userName()) || 'office';
      c.ksBoardCache.notes.unshift({ id: nid('bn'), text: t.trim(), items: null, jobId: c.state.jobId, by, ts: Date.now() });
      c.ksSaveBoard(); c.ksTick();
    };
    const kids = [];
    kids.push(el('div', { style: { maxWidth: '900px', marginBottom: '26px' } },
      el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '14px' } },
        serifHead('From the whiteboard', 19),
        el('span', { style: { fontSize: '12.5px', color: T.mu } }, notes.length + ' unscheduled'),
        el('span', { style: { flex: 1 } }),
        btn('＋ Note for this job', addHere, 'accent')),
      el('div', { style: { height: '10px' } }),
      notes.length
        ? el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: '12px' } }, ...notes.map(n => boardNoteCard(c, n, jobsMeta, {})))
        : el('div', { style: { fontSize: '13px', color: T.mu } }, 'Nothing from the whiteboard is waiting on this job. Notes you assign land here until they get a date.')));
    kids.push(todoList(c));
    kids.push(boardDialog(c, jobsMeta));
    return wrap(kids);
  }

  // ---------- TEMPLATES (schedule template + estimate templates) ----------
  function viewTemplates(c) {
    const cat = c.catalog;
    if (!cat) return wrap([el('div', { style: { color: T.mu, padding: '40px 0' } }, 'Loading catalog…')]);
    const tab = c.state.ksTplTab || 'sched';
    const kids = [el('div', { style: { display: 'flex', gap: '4px', marginBottom: '22px', borderBottom: '1px solid ' + T.ln, flexWrap: 'wrap' } },
      ...[['sched', 'Schedule template'], ['tpl', 'Estimate templates']].map(t =>
        el('button', {
          onClick: () => c.setState({ ksTplTab: t[0] }),
          style: {
            background: 'transparent', border: 'none', padding: '8px 14px', fontFamily: sans, fontSize: '13.5px',
            fontWeight: tab === t[0] ? 700 : 500, color: tab === t[0] ? T.tx : T.mu, cursor: 'pointer',
            borderBottom: tab === t[0] ? '3px solid ' + T.ac : '3px solid transparent', marginBottom: '-1px'
          }
        }, t[1])))];

    if (tab === 'sched') {
      if (!cat.scheduleTemplate || !cat.scheduleTemplate.length) cat.scheduleTemplate = defaultTemplate();
      cat.schedTemplates = Array.isArray(cat.schedTemplates) ? cat.schedTemplates : [];
      const sel = c.state.ksSchedTplSel || 'main';
      const curT = sel === 'main' ? null : cat.schedTemplates.find(x => x.id === sel);
      const rows = curT ? curT.tasks : cat.scheduleTemplate;

      const selChip = (id, name2, isMain) => el('button', {
        key: id,
        onClick: () => c.setState({ ksSchedTplSel: id }),
        style: {
          background: (sel === id || (isMain && !curT && sel === 'main')) && (id === sel) ? T.tx : 'transparent',
          border: '1px solid ' + (sel === id ? T.tx : T.ln),
          color: sel === id ? T.bg : T.mu,
          padding: '6px 13px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', fontFamily: sans, borderRadius: '9px'
        }
      }, (isMain ? '★ ' : '') + name2);

      kids.push(el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px', alignItems: 'center' } },
        selChip('main', 'Main template', true),
        ...cat.schedTemplates.map(t => selChip(t.id, t.name, false)),
        btn('＋ New', () => {
          const name2 = prompt('Name the new schedule template (e.g. Shop, Commercial New, Commercial TI):');
          if (!name2 || !name2.trim()) return;
          const copy = confirm('Start from a copy of "' + (curT ? curT.name : 'Main template') + '"?\n\nOK = copy it   ·   Cancel = start blank');
          const t = { id: nid('stpl'), name: name2.trim(), tasks: copy ? deepCopy(rows) : [{ id: 't1', group: 'Phase 1', name: 'First task', off: 0, days: 1, pred: null, lag: 0 }] };
          cat.schedTemplates.push(t);
          c.ksSaveCatalog();
          c.setState({ ksSchedTplSel: t.id });
        }, 'accent'),
        cat.schedTemplates.find(t => t.id === 'ai_sfr') ? null : btn('✨ Add AI example — Production SFR', () => {
          cat.schedTemplates.push({ id: 'ai_sfr', name: 'AI example — Production SFR', tasks: aiSfrTemplate() });
          c.ksSaveCatalog();
          c.setState({ ksSchedTplSel: 'ai_sfr' });
        }, 'accent')));

      if (!curT) {
        kids.push(el('div', { style: { fontSize: '13px', color: T.mu, marginBottom: '14px', lineHeight: 1.6, maxWidth: '760px' } },
          'The master build schedule. Every new job with a permit-ready date starts from this by default — edit tasks, working days and dependencies here and every ',
          el('b', { style: { color: T.tx } }, 'future'), ' job adopts the changes. Existing jobs keep their own copy.'));
      } else {
        kids.push(el('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' } },
          el('div', { style: { fontSize: '13px', color: T.mu, flex: 1, minWidth: '240px' } },
            curT.id === 'ai_sfr'
              ? 'AI-researched production-builder sequence (~120 working days, dry-in → 4-way roughs → insulation → drywall → finishes). Steal from it freely — edits here don’t touch your main.'
              : 'Saved template — pick it on the New job page next to the permit-ready date.'),
          btn('Rename', () => { const n2 = prompt('Rename template:', curT.name); if (n2 && n2.trim()) { curT.name = n2.trim(); c.ksSaveCatalog(); c.ksTick(); } }),
          btn('Make this the MAIN', () => {
            if (!confirm('Replace the main template with "' + curT.name + '"?\n\nYour current main is kept as a backup template.')) return;
            cat.schedTemplates.push({ id: nid('stpl'), name: 'Previous main — ' + new Date().toLocaleDateString(), tasks: deepCopy(cat.scheduleTemplate) });
            cat.scheduleTemplate = deepCopy(curT.tasks);
            c.ksSaveCatalog();
            c.setState({ ksSchedTplSel: 'main' });
          }, 'line'),
          btn('Delete', () => { if (confirm('Delete schedule template "' + curT.name + '"?')) { cat.schedTemplates = cat.schedTemplates.filter(x => x !== curT); c.ksSaveCatalog(); c.setState({ ksSchedTplSel: 'main' }); } }, 'danger')));
      }

      kids.push(taskTable(c, rows, { showStatus: false, onChange: () => c.ksSaveCatalog() }));
      if (!curT) {
        kids.push(el('div', { style: { marginTop: '12px' } },
          btn('Reset to built-in template', () => { if (confirm('Replace your master schedule template with the built-in Ridgeline default?')) { cat.scheduleTemplate = defaultTemplate(); c.ksSaveCatalog(); c.ksTick(); } }, 'danger')));
      }
    }

    if (tab === 'tpl') {
      kids.push(el('div', { style: { fontSize: '13px', color: T.mu, marginBottom: '10px' } }, 'A template is a saved checklist of catalog items — new jobs start pre-loaded with them.'));
      kids.push(el('div', { style: { marginBottom: '14px' } }, btn('＋ New template', async () => {
        const name = prompt('Template name:', 'Standard Residential'); if (!name) return;
        const meta = await c.ksApi('/templates', { method: 'POST', body: JSON.stringify({ name: name.trim(), itemIds: cat.items.map(i => i.id) }) });
        c.ksTemplates = null; await c.ksLoadTemplates(); c.setState({ ksTplOpen: meta.id });
      }, 'accent')));
      if (!c.ksTemplates) { c.ksLoadTemplates(); kids.push(el('div', { style: { color: T.mu } }, 'Loading…')); }
      for (const t of (c.ksTemplates || [])) {
        const open = c.state.ksTplOpen === t.id;
        const body = [el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '12px' } },
          el('span', { onClick: () => c.setState({ ksTplOpen: open ? null : t.id }), style: { fontFamily: serif, fontWeight: 700, fontSize: '16px', color: T.tx, cursor: 'pointer' } }, (open ? '▾ ' : '▸ ') + t.name),
          chip(t.itemCount + ' ITEMS'),
          el('span', { style: { flex: 1 } }),
          iconBtn('rename', 'Rename', async () => { const n = prompt('Rename template:', t.name); if (n && n.trim()) { await c.ksApi('/templates/' + t.id, { method: 'PUT', body: JSON.stringify({ name: n.trim() }) }); c.ksTemplates = null; c.ksLoadTemplates(); } }),
          iconBtn('delete', 'Delete', async () => { if (confirm('Delete template "' + t.name + '"?')) { await c.ksApi('/templates/' + t.id, { method: 'DELETE' }); c.ksTemplates = null; c.ksLoadTemplates(); } }))];
        if (open) {
          if (!c._tplEdit || c._tplEdit.id !== t.id) {
            c._tplEdit = { id: t.id, ids: null };
            c.ksApi('/templates/' + t.id).then(full => { c._tplEdit = { id: t.id, ids: new Set(full.itemIds) }; c.ksTick(); });
            body.push(el('div', { style: { color: T.mu, marginTop: '8px' } }, 'Loading…'));
          } else if (c._tplEdit.ids) {
            const sel = c._tplEdit.ids;
            for (const cc of cat.categories) {
              const items = cat.items.filter(i => i.categoryId === cc.id);
              if (!items.length) continue;
              body.push(el('div', { style: { margin: '10px 0 2px 0', fontSize: '11px', letterSpacing: '0.12em', color: T.mu, fontWeight: 700 } }, cc.code + ' ' + cc.name.toUpperCase()));
              for (const it of items) {
                body.push(el('label', { key: it.id, style: { display: 'flex', gap: '9px', alignItems: 'center', padding: '3px 4px', fontSize: '13.5px', cursor: 'pointer' } },
                  el('input', { type: 'checkbox', checked: sel.has(it.id), onChange: e => { e.target.checked ? sel.add(it.id) : sel.delete(it.id); c.ksTick(); } }),
                  el('span', { style: { fontWeight: 700, color: T.ac, fontSize: '11.5px', width: '38px' } }, it.code),
                  el('span', null, it.name)));
              }
            }
            body.push(el('div', { style: { marginTop: '12px' } }, btn('Save template', async () => {
              await c.ksApi('/templates/' + t.id, { method: 'PUT', body: JSON.stringify({ itemIds: [...sel] }) });
              c.ksTemplates = null; c._tplEdit = null; c.ksLoadTemplates(); c.setState({ ksTplOpen: null });
            }, 'solid')));
          }
        }
        kids.push(el('div', { key: t.id, style: { borderTop: '1px solid ' + T.ln, padding: '12px 0' } }, ...body));
      }
    }
    return wrap(kids);
  }

  // ---------- CUSTOMER (per-job contact + status) ----------
  function viewCustomer(c) {
    const cust = c.jobCustomer = c.jobCustomer || { name: '', email: '', phone: '', address: '', notes: '' };
    if ((c.state.role || 'admin') === 'pm') {
      const info = (lbl, val, href) => val ? el('div', { style: { display: 'flex', gap: '14px', alignItems: 'baseline', padding: '9px 0', borderBottom: '1px dotted ' + T.ln } },
        el('div', { style: { width: '90px', flex: '0 0 90px', fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.14em', color: T.mu } }, lbl),
        href ? el('a', { href, style: { fontSize: '14px', fontWeight: 600, color: T.ac, textDecoration: 'none' } }, val)
             : el('div', { style: { fontSize: '14px', fontWeight: 600, color: T.tx } }, val)) : null;
      return wrap([
        el('div', { style: { maxWidth: '900px', marginBottom: '26px' } },
          serifHead('Job info', 19),
          el('div', { style: { height: '10px' } }),
          info('CUSTOMER', cust.name),
          info('PHONE', cust.phone, cust.phone ? 'tel:' + String(cust.phone).replace(/[^\d+]/g, '') : null),
          info('ADDRESS', cust.address)),
        (cust.address || '').trim() ? el('div', { style: { maxWidth: '900px' } }, serifHead('Job site', 19), el('div', { style: { height: '10px' } }),
          el('iframe', { key: 'pm-map-' + cust.address, src: 'https://maps.google.com/maps?q=' + encodeURIComponent(cust.address) + '&z=15&output=embed', style: { width: '100%', height: '260px', border: '1px solid ' + T.ln, display: 'block' }, loading: 'lazy', title: 'Job site map' })) : null
      ]);
    }
    const curStatus = c.jobStatus || 'active';
    const statusCard = s => el('div', {
      key: s.id,
      onClick: () => { c.ksSetJobStatus(s.id); },
      style: {
        border: (curStatus === s.id ? '2px solid ' + T.ac : '1px solid ' + T.ln),
        background: curStatus === s.id ? T.sf : 'transparent',
        padding: '13px 15px', cursor: 'pointer', position: 'relative'
      }
    },
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        el('span', { style: { width: '9px', height: '9px', borderRadius: '50%', display: 'inline-block', background: curStatus === s.id ? T.ac : T.ln } }),
        el('span', { style: { fontWeight: 700, fontSize: '13.5px', color: T.tx, letterSpacing: '0.02em' } }, s.name),
        curStatus === s.id ? el('span', { style: { marginLeft: 'auto', fontSize: '11px', fontWeight: 700, color: T.ac } }, '✓') : null),
      el('div', { style: { fontSize: '11.5px', color: T.mu, marginTop: '5px', lineHeight: 1.5 } }, s.desc));
    const field = (lbl, key, hint, wide) => el('div', { style: { marginBottom: '14px' } },
      label(lbl, { marginBottom: '4px' }),
      el(wide ? 'textarea' : 'input', {
        defaultValue: cust[key] || '',
        onBlur: e => { cust[key] = e.target.value; c.ksSaveJobData(); c.ksTouch(); },
        style: { width: '100%', border: '1px solid ' + T.ln, padding: '10px 12px', fontSize: '14px', fontFamily: sans, background: T.sf, color: T.tx, minHeight: wide ? '70px' : undefined, resize: wide ? 'vertical' : undefined }
      }),
      hint ? el('div', { style: { fontSize: '11.5px', color: T.mu, marginTop: '3px' } }, hint) : null);
    return wrap([
      el('div', { style: { maxWidth: '900px', marginBottom: '30px' } },
        serifHead('Project status', 19),
        el('div', { style: { fontSize: '12.5px', color: T.mu, margin: '4px 0 12px 0' } },
          'Only active projects show on the combined calendar, the subscription feeds, and the week ahead.'),
        el('div', { className: 'ks-theme-grid', style: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px' } },
          ...JOB_STATUSES.map(statusCard)),
        curStatus === 'warranty' ? el('div', { style: { display: 'flex', gap: '12px', alignItems: 'baseline', marginTop: '12px' } },
          label('WARRANTY STARTED'),
          el('input', {
            type: 'date', value: c.jobWarrantyStart || '',
            onChange: e => { c.jobWarrantyStart = e.target.value; c.ksSaveJobData(); c.ksTick(); },
            style: { border: '1px solid ' + T.ln, background: T.sf, color: T.tx, padding: '7px 10px', fontSize: '13px', fontFamily: sans }
          }),
          c.jobWarrantyStart ? el('span', { style: { fontSize: '12px', color: T.mu } },
            (function () { const d = Math.floor((Date.now() - new Date(c.jobWarrantyStart + 'T00:00:00').getTime()) / 86400000); return d >= 0 ? d + ' days in' : 'starts in ' + (-d) + ' days'; })()) : null) : null),
      el('div', { className: 'ks-home-grid', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', maxWidth: '900px' } },
      el('div', null,
        serifHead('Contact', 19),
        el('div', { style: { height: '12px' } }),
        field('CUSTOMER NAME', 'name'),
        field('EMAIL', 'email', 'Used for the customer portal invite and e-signature requests when those go live.'),
        field('PHONE', 'phone'),
        field('PROJECT ADDRESS', 'address'),
        (cust.address || '').trim() ? el('div', { style: { marginTop: '2px' } },
          el('iframe', {
            key: 'map-' + cust.address,
            src: 'https://maps.google.com/maps?q=' + encodeURIComponent(cust.address) + '&z=15&output=embed',
            style: { width: '100%', height: '300px', border: '1px solid ' + T.ln, display: 'block' },
            loading: 'lazy', referrerPolicy: 'no-referrer-when-downgrade', title: 'Job site map'
          }),
          el('a', {
            href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(cust.address),
            target: '_blank', rel: 'noopener',
            style: { display: 'inline-block', marginTop: '6px', fontSize: '12px', fontWeight: 600, color: T.ac, textDecoration: 'none', borderBottom: '1px dotted ' + T.ac }
          }, 'Open in Google Maps ↗')) : null),
      el('div', null,
        serifHead('Notes', 19),
        el('div', { style: { height: '12px' } }),
        field('PRIVATE NOTES', 'notes', 'Internal only — never shown to the customer.', true))
    ),
    portalAccessCard(c, cust)]);
  }

  // ---------- customer portal access (admin manages the customer's login) ----------
  function portalAccessCard(c, cust) {
    const jobId = c.state.jobId;
    if (!jobId) return null;
    if (c._usersCache === undefined) {
      c._usersCache = null;
      c.ksApi('/users').then(u => { c._usersCache = u; c.ksTick(); }).catch(() => { c._usersCache = false; });
    }
    const users = Array.isArray(c._usersCache) ? c._usersCache : [];
    const existing = users.find(u => u.role === 'customer' && (u.jobIds || []).indexOf(jobId) !== -1);
    const s = c._custAccess = c._custAccess || {};
    if (s._forJob !== jobId) { s._forJob = jobId; s.email = ''; s.password = ''; s.msg = ''; }
    const portal = c.jobPortal = c.jobPortal || { showSchedule: true, showDraws: true, showAllowances: true };

    const inp = (ph, key, type) => el('input', {
      type: type || 'text', placeholder: ph, value: s[key] || '',
      onChange: e => { s[key] = e.target.value; c.ksTick(); },
      style: { width: '100%', border: '1px solid ' + T.ln, padding: '10px 12px', fontSize: '13.5px', fontFamily: sans, background: T.bg, color: T.tx }
    });
    const toggle = (lbl, key, hint) => el('label', { style: { display: 'flex', gap: '9px', alignItems: 'baseline', fontSize: '13px', color: T.tx, cursor: 'pointer', marginBottom: '6px' } },
      el('input', {
        type: 'checkbox', checked: portal[key] !== false,
        onChange: e => { portal[key] = e.target.checked; c.jobPortal = portal; c.ksSaveJobData(); c.ksTick(); }
      }),
      el('span', null, el('b', null, lbl), ' — ', el('span', { style: { color: T.mu } }, hint)));

    const save = async () => {
      const email = (s.email || (existing && existing.email) || cust.email || '').trim().toLowerCase();
      if (!existing && !email) { s.msg = 'Enter the customer’s email first.'; c.ksTick(); return; }
      if (!existing && (s.password || '').length < 4) { s.msg = 'Pick a password (4+ characters).'; c.ksTick(); return; }
      try {
        if (existing) {
          if ((s.password || '').length >= 4) await c.ksApi('/users/' + existing.id, { method: 'PUT', body: JSON.stringify({ password: s.password }) });
          s.msg = '✓ updated';
        } else {
          await c.ksApi('/users', { method: 'POST', body: JSON.stringify({ role: 'customer', name: cust.name || email, email, password: s.password, jobIds: [jobId] }) });
          s.msg = '✓ login created — send them the site link, their email, and that password';
        }
        s.password = '';
        c._usersCache = undefined;
        c.ksTick();
      } catch (e) { s.msg = e.message; c.ksTick(); }
    };
    const remove = async () => {
      if (!existing || !confirm('Remove ' + (existing.email || existing.name) + '’s access?')) return;
      try { await c.ksApi('/users/' + existing.id, { method: 'DELETE' }); c._usersCache = undefined; c.ksTick(); } catch (e) { alert(e.message); }
    };

    return el('div', { style: { maxWidth: '900px', marginTop: '34px', border: '1px solid ' + T.tx, background: T.sf, padding: '22px 24px' } },
      serifHead('Customer portal access', 19),
      el('div', { style: { fontSize: '12.5px', color: T.mu, margin: '4px 0 14px 0' } },
        'They sign in at this same site with their email + password and see a read-only view of this job. You choose what shows:'),
      el('div', { className: 'ks-home-grid', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' } },
        el('div', null,
          existing
            ? el('div', { style: { fontSize: '13.5px', color: T.tx, marginBottom: '10px' } }, '✓ Portal login active for ', el('b', null, existing.email))
            : el('div', { style: { marginBottom: '10px' } }, inp('Customer email', 'email', 'email')),
          el('div', { style: { marginBottom: '10px' } }, inp(existing ? 'New password (optional)' : 'Portal password', 'password', 'text')),
          el('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' } },
            btn(existing ? 'Update password' : 'Create login', save, 'solid'),
            existing ? btn('Remove access', remove, 'danger') : null),
          s.msg ? el('div', { style: { fontSize: '12px', color: s.msg.indexOf('✓') === 0 ? T.ac : '#B0392E', marginTop: '9px' } }, s.msg) : null),
        el('div', null,
          label('WHAT THEY SEE', { marginBottom: '10px' }),
          toggle('Schedule & progress', 'showSchedule', 'live task list with status and a progress bar'),
          toggle('Draw schedule', 'showDraws', 'contract total, draws paid, remaining balance'),
          toggle('Allowances', 'showAllowances', 'allowance budgets with qty, unit and rate'),
          el('div', { style: { fontSize: '11.5px', color: T.mu, marginTop: '10px', lineHeight: 1.5 } }, 'Estimate, specs, internal costs, notes and worksheets are never shown on the portal.'))));
  }

  // ---------- COMBINED CALENDAR (all jobs) ----------
  function viewCalAll(c) {
    const jobsMeta = c.state.jobs || [];
    const detail = c.ksJobCache = c.ksJobCache || {};
    for (const m of jobsMeta) {
      if (detail[m.id] === undefined) {
        detail[m.id] = null;
        c.ksApi('/jobs/' + m.id).then(j => { detail[m.id] = j; c.ksTick(); }).catch(() => { detail[m.id] = false; });
      }
    }
    const excl = c._calExcl = c._calExcl || new Set();
    // first load: leave prospects / warranty / archived jobs unchecked
    for (const m of jobsMeta) {
      if (jobStatusOf(m, detail) !== 'active' && !(c._calSeen && c._calSeen.has(m.id))) excl.add(m.id);
      (c._calSeen = c._calSeen || new Set()).add(m.id);
    }
    const weeksN = c.state.ksCalWeeks || 2;

    // monday of current week (UTC)
    const now = new Date();
    const mon = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    while (mon.getUTCDay() !== 1) mon.setUTCDate(mon.getUTCDate() - 1);

    const jobColor = ix => ['var(--ac)', '#5B7A99', '#6B7A3A', '#8A5A50', '#4A6670', '#7A5A85'][ix % 6];
    const tasksOn = dayISO => {
      const out = [];
      const dow = new Date(dayISO + 'T00:00:00Z').getUTCDay();
      const wkend = dow === 0 || dow === 6;
      jobsMeta.forEach((m, ix) => {
        if (excl.has(m.id)) return;
        const j = detail[m.id];
        for (const s of ((j && j.schedule) || [])) {
          if (s.start > dayISO || dayISO > s.finish) continue;
          // weekends stay clean — only tasks deliberately pinned to that weekend day show
          if (wkend && s.start !== dayISO && s.finish !== dayISO) continue;
          out.push({ job: m.name, color: jobColor(ix), task: s.task, status: s.status });
        }
      });
      return out;
    };

    const kids = [];
    kids.push(el('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' } },
      ...jobsMeta.map((m, ix) => el('label', { key: m.id, style: { display: 'flex', gap: '7px', alignItems: 'center', fontSize: '12.5px', color: T.tx, cursor: 'pointer', border: '1px solid ' + T.ln, padding: '5px 10px', background: excl.has(m.id) ? 'transparent' : T.sf, opacity: excl.has(m.id) ? 0.5 : 1 } },
        el('input', { type: 'checkbox', checked: !excl.has(m.id), onChange: e => { e.target.checked ? excl.delete(m.id) : excl.add(m.id); c.ksTick(); } }),
        el('span', { style: { width: '10px', height: '10px', background: jobColor(ix), display: 'inline-block' } }),
        m.name)),
      el('div', { style: { flex: 1 } }),
      label('WEEKS'),
      ...[2, 3, 4].map(n => el('button', {
        key: n, onClick: () => c.setState({ ksCalWeeks: n }),
        style: { border: '1px solid ' + (weeksN === n ? T.tx : T.ln), background: weeksN === n ? T.tx : 'transparent', color: weeksN === n ? T.bg : T.mu, padding: '5px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: sans }
      }, String(n)))));

    const dows = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    kids.push(el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderTop: '2px solid ' + T.tx, borderLeft: '1px solid ' + T.ln } },
      ...dows.map(d => el('div', { key: d, style: { padding: '8px 10px', borderRight: '1px solid ' + T.ln, borderBottom: '1px solid ' + T.tx, fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.14em', color: T.mu } }, d)),
      ...Array.from({ length: weeksN * 7 }, (_, i) => {
        const d = new Date(mon.getTime() + i * 86400000);
        const dayISO = d.toISOString().slice(0, 10);
        const isToday = dayISO === new Date().toISOString().slice(0, 10);
        const items = tasksOn(dayISO);
        return el('div', { key: i, style: { minHeight: '92px', padding: '7px 9px', borderRight: '1px solid ' + T.ln, borderBottom: '1px solid ' + T.ln, background: isToday ? T.s2 : (d.getUTCDay() === 0 || d.getUTCDay() === 6 ? T.sf : 'transparent') } },
          el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '13px', color: isToday ? T.ac : T.mu, marginBottom: '5px' } }, String(d.getUTCDate())),
          ...items.map((t, k) => el('div', { key: k, title: t.job + ' — ' + t.task, style: { display: 'flex', gap: '6px', alignItems: 'baseline', fontSize: '11px', marginBottom: '3px', opacity: t.status === 'Complete' ? 0.45 : 1 } },
            el('span', { style: { width: '7px', height: '7px', flex: '0 0 7px', background: t.color, display: 'inline-block', alignSelf: 'center' } }),
            el('span', { style: { color: T.tx, lineHeight: 1.25 } }, t.task.replace(/^\d+\s*/, '')))));
      })));
    kids.push(el('div', { style: { fontSize: '11.5px', color: T.mu, marginTop: '10px' } }, 'Every job, one calendar — tiles grow to fit the day. Uncheck a job to hide it.'));
    return wrap(kids);
  }

  // ---------- CLIENT HOME (customer portal, read-only) ----------
  // Admin "view as customer" preview gets the full job doc — shape it like the portal's sanitized doc.
  function adaptCustomerJob(j) {
    if (!j || j.progressPct !== undefined || !j.estimate) return j;
    const rows = j.schedule || [];
    const done = rows.filter(r => r.status === 'Complete').length;
    const inP = rows.filter(r => r.status === 'In Progress').length;
    const pct = rows.length ? Math.round(100 * (done + 0.5 * inP) / rows.length) : 0;
    const cur = rows.find(r => r.status === 'In Progress') || rows.find(r => r.status !== 'Complete');
    const contract = estTotals(j.estimate).total;
    const portal = j.portal || {};
    return {
      id: j.id, name: j.name,
      progressPct: pct,
      phase: cur ? String(cur.task).replace(/^\d{4}\s*/, '') : (done ? 'Complete' : null),
      schedule: portal.showSchedule !== false ? rows : null,
      draws: (portal.showDraws !== false && Array.isArray(j.draws)) ? j.draws.map(d => ({ no: d.no, name: d.name, status: d.status, amt: Math.round(contract * (Number(d.pct) || 0)) / 100 })) : null,
      contractTotal: portal.showDraws !== false ? contract : null,
      allowances: portal.showAllowances !== false ? (j.estimate.items || []).filter(i => i.allowance && !i.excluded).map(i => ({ name: i.name, code: i.code, budget: i.allowanceBudget || null, total: itemCalc(i, j.estimate.settings).total })) : null
    };
  }

  function clientHome(c) {
    const jobsMeta = c.state.jobs || [];
    const detail = c.ksJobCache = c.ksJobCache || {};
    for (const m of jobsMeta) {
      if (detail[m.id] === undefined) {
        detail[m.id] = null;
        c.ksApi('/jobs/' + m.id).then(j => { detail[m.id] = j; c.ksTick(); }).catch(() => { detail[m.id] = false; });
      }
    }
    const statusChip = s => el('span', {
      style: {
        fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', padding: '2px 8px',
        border: '1px solid ' + T.ln, color: s === 'Complete' ? T.bg : (s === 'In Progress' ? T.ac : T.mu),
        background: s === 'Complete' ? T.tx : 'transparent', whiteSpace: 'nowrap'
      }
    }, (s || 'Not Started').toUpperCase());

    const kids = [];
    if (!jobsMeta.length) {
      kids.push(el('div', { style: { border: '1px solid ' + T.ln, background: T.sf, padding: '26px 28px', maxWidth: '560px' } },
        el('div', { style: { fontSize: '14px', color: T.mu, lineHeight: 1.6 } },
          'No projects are linked to this login yet — give Ridgeline a call and we’ll get you connected.')));
    }
    for (const m of jobsMeta) {
      let j = detail[m.id];
      if (!j) { kids.push(el('div', { key: m.id, style: { padding: '20px 0', color: T.mu, fontSize: '13px' } }, 'Loading ' + m.name + '…')); continue; }
      if (c.state.realRole === 'admin') j = adaptCustomerJob(j);
      const paid = (j.draws || []).filter(d => d.status === 'PAID').reduce((a, d) => a + (d.amt || 0), 0);
      kids.push(el('div', { key: m.id, style: { marginBottom: '44px' } },
        el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '16px', borderBottom: '2px solid ' + T.tx, paddingBottom: '10px', marginBottom: '4px', flexWrap: 'wrap' } },
          serifHead(j.name, 24),
          el('div', { style: { flex: 1 } }),
          j.phase ? el('div', { style: { fontSize: '13px', color: T.mu } }, 'current phase — ', el('span', { style: { color: T.ac, fontWeight: 600 } }, j.phase)) : null),
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 0', borderBottom: '1px solid ' + T.ln } },
          label('PROGRESS'),
          el('div', { style: { flex: 1, height: '7px', background: T.s2 } },
            el('div', { style: { height: '100%', width: (j.progressPct || 0) + '%', background: T.ac } })),
          el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '16px', color: T.tx, width: '48px', textAlign: 'right' } }, (j.progressPct || 0) + '%')),
        j.schedule ? el('div', { style: { marginTop: '22px' } },
          serifHead('Schedule', 17),
          el('div', { style: { marginTop: '8px', borderTop: '1px solid ' + T.ln } },
            ...(function () {
              const out = []; let lastGroup = null;
              for (const r of j.schedule) {
                if (r.group && r.group !== lastGroup) {
                  lastGroup = r.group;
                  out.push(el('div', { key: 'g' + r.id, style: { fontFamily: serif, fontWeight: 600, fontSize: '13.5px', color: T.tx, padding: '12px 0 4px 0' } }, r.group));
                }
                out.push(el('div', { key: r.id, style: { display: 'flex', gap: '12px', alignItems: 'baseline', padding: '6px 0', borderBottom: '1px dotted ' + T.ln, opacity: r.status === 'Complete' ? 0.6 : 1 } },
                  el('div', { style: { flex: 1, fontSize: '13px', color: T.tx } }, r.task),
                  el('div', { style: { fontSize: '12px', color: T.mu, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } }, r.start + ' → ' + r.finish),
                  statusChip(r.status)));
              }
              return out;
            })())) : null,
        j.draws ? el('div', { style: { marginTop: '26px' } },
          serifHead('Draw schedule', 17),
          el('div', { style: { display: 'flex', gap: '26px', margin: '10px 0 6px 0', flexWrap: 'wrap' } },
            el('div', null, label('CONTRACT'), el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '20px', color: T.tx } }, fmt$0(j.contractTotal || 0))),
            el('div', null, label('PAID TO DATE'), el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '20px', color: T.tx } }, fmt$0(paid))),
            el('div', null, label('REMAINING'), el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '20px', color: T.tx } }, fmt$0((j.contractTotal || 0) - paid)))),
          el('div', { style: { borderTop: '2px solid ' + T.tx } },
            ...j.draws.map(d => el('div', { key: d.no, style: { display: 'flex', gap: '14px', alignItems: 'baseline', padding: '9px 0', borderBottom: '1px dotted ' + T.ln } },
              el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '13px', color: T.mu, width: '22px' } }, String(d.no)),
              el('div', { style: { flex: 1, fontSize: '13px', color: T.tx } }, d.name),
              el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '14px', color: T.tx, fontVariantNumeric: 'tabular-nums' } }, fmt$0(d.amt || 0)),
              statusChip(d.status === 'PAID' ? 'Complete' : (d.status === 'INVOICED' ? 'In Progress' : 'Not Started'))))))
          : null,
        (j.allowances && j.allowances.length) ? el('div', { style: { marginTop: '26px' } },
          serifHead('Allowances', 17),
          el('div', { style: { fontSize: '12px', color: T.mu, margin: '6px 0 8px 0' } }, 'Budgets included in your contract — differences at selection are billed or credited.'),
          el('div', { style: { borderTop: '2px solid ' + T.tx } },
            ...j.allowances.map((a, ai) => el('div', { key: ai, style: { display: 'flex', gap: '14px', alignItems: 'baseline', padding: '8px 0', borderBottom: '1px dotted ' + T.ln } },
              el('div', { style: { flex: 1, fontSize: '13px', color: T.tx } }, a.name,
                a.budget ? el('span', { style: { color: T.mu, fontSize: '12px' } }, '  —  ' + (num(a.budget.qty) || 1).toLocaleString('en-US') + ' ' + (a.budget.unit || 'EA') + ' @ ' + fmt$(num(a.budget.price))) : null),
              el('div', { style: { fontFamily: serif, fontWeight: 700, fontSize: '14px', fontVariantNumeric: 'tabular-nums', color: T.tx } }, fmt$0(a.total || 0)))))) : null));
    }
    kids.push(el('div', { style: { borderTop: '1px solid ' + T.ln, paddingTop: '14px', fontSize: '12.5px', color: T.mu } },
      'Questions? Ridgeline Construction · 360-200-1716 · info@ridgeline.construction · www.ridgeline.construction'));
    return wrap(kids);
  }

  window.Keystone = {
    lineCalc, itemCalc, estTotals, ensureCatalog, snapshot, nid, deepCopy,
    THEMES, PAPERS, ACCENTS, applyTheme, currentTheme, defaultDraws, taskTable,
    generateSchedule, computeSchedule, defaultTemplate, GROUP_CODES, estimateRowMap,
    views: {
      home: viewHome, estimate: viewEstimate, schedule: viewSchedule,
      catalog: viewCatalog, newJob: viewNewJob, settings: viewSettings,
      rough: viewRoughQuote, draws: viewDraws, customer: viewCustomer, calAll: viewCalAll,
      board: viewBoard, customers: viewCustomers, templates: viewTemplates,
      plans: viewPlans, todos: viewTodos,
      clientHome: clientHome
    }
  };
})();
