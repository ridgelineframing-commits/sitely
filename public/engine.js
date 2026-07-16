/* Ridgeline workbook formula engine — evaluates the Excel formulas exported in workbook.js */
(function () {
  'use strict';

  const EPOCH = Date.UTC(1899, 11, 30);
  const DAY = 86400000;
  const serialToDate = s => new Date(EPOCH + Math.round(s) * DAY);
  const dateToSerial = d => Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - EPOCH) / DAY);
  const todaySerial = () => { const n = new Date(); return Math.round((Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - EPOCH) / DAY); };

  function colToNum(c) { let n = 0; for (let i = 0; i < c.length; i++) n = n * 26 + c.charCodeAt(i) - 64; return n; }
  function numToCol(n) { let s = ''; while (n > 0) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s; }

  // ---------- Tokenizer ----------
  function tokenize(src) {
    const toks = []; let i = 0;
    const n = src.length;
    while (i < n) {
      const ch = src[i];
      if (ch === ' ' || ch === '\n' || ch === '\t') { i++; continue; }
      if (ch === '"') { let j = i + 1, s = ''; while (j < n) { if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; } else break; } else { s += src[j]; j++; } } toks.push({ t: 'str', v: s }); i = j + 1; continue; }
      if (ch === "'") { let j = i + 1, s = ''; while (j < n && src[j] !== "'") { s += src[j]; j++; } // sheet name
        // expect !
        i = j + 1; toks.push({ t: 'sheet', v: s }); if (src[i] === '!') i++; continue; }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1]))) {
        let j = i; while (j < n && /[0-9.]/.test(src[j])) j++;
        if (src[j] === 'E' || src[j] === 'e') { let k = j + 1; if (src[k] === '+' || src[k] === '-') k++; while (k < n && /[0-9]/.test(src[k])) k++; j = k; }
        toks.push({ t: 'num', v: parseFloat(src.slice(i, j)) }); i = j; continue;
      }
      if (/[A-Za-z_$]/.test(ch)) {
        let j = i; while (j < n && /[A-Za-z0-9_.$]/.test(src[j])) j++;
        let word = src.slice(i, j);
        if (src[j] === '!') { toks.push({ t: 'sheet', v: word }); i = j + 1; continue; }
        if (src[j] === '(') { toks.push({ t: 'fn', v: word.toUpperCase() }); i = j; continue; }
        // cell ref or boolean
        const up = word.toUpperCase();
        if (up === 'TRUE') { toks.push({ t: 'bool', v: true }); i = j; continue; }
        if (up === 'FALSE') { toks.push({ t: 'bool', v: false }); i = j; continue; }
        toks.push({ t: 'ref', v: word }); i = j; continue;
      }
      if (ch === '<' && src[i + 1] === '=') { toks.push({ t: 'op', v: '<=' }); i += 2; continue; }
      if (ch === '>' && src[i + 1] === '=') { toks.push({ t: 'op', v: '>=' }); i += 2; continue; }
      if (ch === '<' && src[i + 1] === '>') { toks.push({ t: 'op', v: '<>' }); i += 2; continue; }
      if ('+-*/^&=<>%(),:;'.includes(ch)) { toks.push({ t: 'op', v: ch }); i++; continue; }
      i++; // skip unknown
    }
    return toks;
  }

  // ---------- Parser (precedence climbing) ----------
  function parse(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];

    function parseExpr(minPrec) {
      let left = parseUnary();
      for (;;) {
        const t = peek();
        if (!t || t.t !== 'op') break;
        const prec = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 }[t.v];
        if (prec === undefined || prec < minPrec) break;
        next();
        const right = parseExpr(prec + 1);
        left = { t: 'bin', op: t.v, l: left, r: right };
      }
      return left;
    }
    function parseUnary() {
      const t = peek();
      if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) { next(); const e = parseUnary(); return t.v === '-' ? { t: 'neg', e } : e; }
      return parsePostfix();
    }
    function parsePostfix() {
      let e = parseAtom();
      while (peek() && peek().t === 'op' && peek().v === '%') { next(); e = { t: 'pct', e }; }
      return e;
    }
    function parseAtom() {
      const t = next();
      if (!t) return { t: 'num', v: 0 };
      if (t.t === 'num') return { t: 'num', v: t.v };
      if (t.t === 'str') return { t: 'str', v: t.v };
      if (t.t === 'bool') return { t: 'bool', v: t.v };
      if (t.t === 'op' && t.v === '(') { const e = parseExpr(1); if (peek() && peek().v === ')') next(); return e; }
      if (t.t === 'fn') {
        next(); // (
        const args = [];
        if (peek() && !(peek().t === 'op' && peek().v === ')')) {
          args.push(parseExpr(1));
          while (peek() && peek().t === 'op' && (peek().v === ',' || peek().v === ';')) { next(); args.push(parseExpr(1)); }
        }
        if (peek() && peek().v === ')') next();
        return { t: 'call', fn: t.v, args };
      }
      if (t.t === 'sheet') {
        const r = next(); // ref
        return finishRef(r ? r.v : 'A1', t.v);
      }
      if (t.t === 'ref') return finishRef(t.v, null);
      return { t: 'num', v: 0 };
    }
    function finishRef(refStr, sheet) {
      // range?
      if (peek() && peek().t === 'op' && peek().v === ':') {
        next();
        let endSheet = sheet, endTok = next();
        if (endTok && endTok.t === 'sheet') { endSheet = endTok.v; endTok = next(); }
        return { t: 'range', sheet, a: parseRef(refStr), b: parseRef(endTok ? endTok.v : refStr) };
      }
      return { t: 'cell', sheet, r: parseRef(refStr) };
    }
    return parseExpr(1);
  }
  function parseRef(s) {
    const m = /^\$?([A-Za-z]+)\$?([0-9]+)$/.exec(s);
    if (!m) return { c: 1, r: 1 };
    return { c: colToNum(m[1].toUpperCase()), r: parseInt(m[2], 10) };
  }

  // ---------- Evaluator ----------
  const ERR = code => ({ __err: code });
  const isErr = v => v && typeof v === 'object' && v.__err;

  function toNum(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') { const n = parseFloat(v); if (!isNaN(n) && /^\s*-?[\d.]+([eE][+-]?\d+)?\s*$/.test(v)) return n; throw ERR('#VALUE!'); }
    if (isErr(v)) throw v;
    return 0;
  }
  function toStr(v) { if (v == null) return ''; if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'; if (isErr(v)) throw v; return String(v); }

  function cmp(a, b, op) {
    if (isErr(a)) throw a; if (isErr(b)) throw b;
    let r;
    const an = typeof a === 'number', bn = typeof b === 'number';
    if (a == null) a = bn ? 0 : '';
    if (b == null) b = an ? 0 : '';
    if (typeof a === 'string' && typeof b === 'string') { const x = a.toLowerCase(), y = b.toLowerCase(); r = x < y ? -1 : x > y ? 1 : 0; }
    else if (typeof a === 'number' && typeof b === 'number') r = a < b ? -1 : a > b ? 1 : 0;
    else if (typeof a === 'boolean' || typeof b === 'boolean') { const x = a === true ? 1 : a === false ? 0 : -1; const y = b === true ? 1 : b === false ? 0 : -1; r = x - y; }
    else { // number vs string: in Excel, text > number
      r = (typeof a === 'string') ? 1 : -1;
    }
    switch (op) { case '=': return r === 0; case '<>': return r !== 0; case '<': return r < 0; case '>': return r > 0; case '<=': return r <= 0; case '>=': return r >= 0; }
  }

  function broadcast(a, b, f) {
    const aa = Array.isArray(a), ba = Array.isArray(b);
    if (!aa && !ba) return f(a, b);
    const len = Math.max(aa ? a.length : 0, ba ? b.length : 0);
    const out = new Array(len);
    for (let i = 0; i < len; i++) out[i] = f(aa ? a[i] : a, ba ? b[i] : b);
    return out;
  }

  class Workbook {
    constructor(data) {
      this.data = data;
      this.sheetIdx = {};
      data.sheets.forEach((s, i) => { this.sheetIdx[s.name.toUpperCase()] = i; });
      this.edits = {}; // 'Sheet!A1' -> raw value (number|string|null)
      this.astCache = {};
      this.gen = 0;
      this.memo = new Map();
      this.stack = new Set();
    }
    sheet(name) { const i = this.sheetIdx[String(name).toUpperCase()]; return i === undefined ? null : this.data.sheets[i]; }
    rawCell(sheetName, ref) {
      const key = sheetName + '!' + ref;
      const sh = this.sheet(sheetName);
      const cell = sh ? sh.cells[ref] : undefined;
      if (Object.prototype.hasOwnProperty.call(this.edits, key)) {
        const ev = this.edits[key];
        return { f: undefined, v: ev, s: cell ? cell.s : 0, edited: true };
      }
      return cell || null;
    }
    setEdit(sheetName, ref, value) { this.edits[sheetName + '!' + ref] = value; this.invalidate(); }
    clearEdits() { this.edits = {}; this.invalidate(); }
    invalidate() { this.gen++; this.memo = new Map(); }

    value(sheetName, ref) {
      const key = sheetName + '!' + ref;
      if (this.memo.has(key)) return this.memo.get(key);
      if (this.stack.has(key)) return 0; // cycle guard
      const cell = this.rawCell(sheetName, ref);
      let v;
      if (!cell) v = null;
      else if (cell.f !== undefined && !cell.edited) {
        this.stack.add(key);
        try {
          let ast = this.astCache[cell.f];
          if (!ast) { ast = parse(cell.f); this.astCache[cell.f] = ast; }
          v = this.evalNode(ast, sheetName);
          if (Array.isArray(v)) v = v[0];
        } catch (e) {
          v = isErr(e) ? e : ERR('#ERROR!');
        }
        this.stack.delete(key);
      } else {
        v = cell.v === undefined ? null : cell.v;
        // coerce plain numeric strings, but NEVER leading-zero codes like "0100"
        if (typeof v === 'string' && v !== '' && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v.trim())) v = +v.trim();
      }
      this.memo.set(key, v);
      return v;
    }

    rangeValues(sheetName, a, b) {
      const out = [];
      const r1 = Math.min(a.r, b.r), r2 = Math.max(a.r, b.r);
      const c1 = Math.min(a.c, b.c), c2 = Math.max(a.c, b.c);
      for (let c = c1; c <= c2; c++) for (let r = r1; r <= r2; r++) out.push(this.value(sheetName, numToCol(c) + r));
      // Excel iterates row-major for ranges in SUMPRODUCT; order irrelevant for our fns except INDEX/MATCH (column vectors). Use row-major:
      if (c2 > c1 && r2 > r1) { // 2D: rebuild row-major
        out.length = 0;
        for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(this.value(sheetName, numToCol(c) + r));
      }
      return out;
    }

    evalNode(n, ctxSheet) {
      switch (n.t) {
        case 'num': return n.v;
        case 'str': return n.v;
        case 'bool': return n.v;
        case 'neg': { const v = this.evalNode(n.e, ctxSheet); return broadcast(v, 0, (x) => -toNum(x)); }
        case 'pct': { const v = this.evalNode(n.e, ctxSheet); return broadcast(v, 0, (x) => toNum(x) / 100); }
        case 'cell': return this.value(n.sheet || ctxSheet, numToCol(n.r.c) + n.r.r);
        case 'range': return this.rangeValues(n.sheet || ctxSheet, n.a, n.b);
        case 'bin': {
          const op = n.op;
          if (op === '&') { const l = this.evalNode(n.l, ctxSheet), r = this.evalNode(n.r, ctxSheet); return broadcast(l, r, (a, b) => toStr(a) + toStr(b)); }
          if ('=<>'.includes(op[0]) || op === '<=' || op === '>=' || op === '<>') {
            const l = this.evalNode(n.l, ctxSheet), r = this.evalNode(n.r, ctxSheet);
            return broadcast(l, r, (a, b) => cmp(a, b, op));
          }
          const l = this.evalNode(n.l, ctxSheet), r = this.evalNode(n.r, ctxSheet);
          return broadcast(l, r, (a, b) => {
            const x = toNum(a), y = toNum(b);
            switch (op) { case '+': return x + y; case '-': return x - y; case '*': return x * y; case '/': if (y === 0) throw ERR('#DIV/0!'); return x / y; case '^': return Math.pow(x, y); }
          });
        }
        case 'call': return this.callFn(n.fn, n.args, ctxSheet);
      }
      return null;
    }

    flatten(args, ctxSheet) {
      const out = [];
      for (const a of args) { const v = this.evalNode(a, ctxSheet); if (Array.isArray(v)) out.push(...v); else out.push(v); }
      return out;
    }

    callFn(fn, args, cs) {
      const ev = a => this.evalNode(a, cs);
      switch (fn) {
        case 'IF': { const c = ev(args[0]); const cond = Array.isArray(c) ? !!toNum(c[0]) : (typeof c === 'boolean' ? c : !!toNum(c)); return cond ? (args[1] ? ev(args[1]) : true) : (args[2] !== undefined ? ev(args[2]) : false); }
        case 'IFERROR': { try { const v = ev(args[0]); if (isErr(v)) return ev(args[1]); return v; } catch (e) { return ev(args[1]); } }
        case 'SUM': { let s = 0; for (const v of this.flatten(args, cs)) { if (typeof v === 'number') s += v; else if (typeof v === 'string' && v !== '' && !isNaN(+v)) s += +v; else if (typeof v === 'boolean') s += v ? 1 : 0; else if (isErr(v)) throw v; } return s; }
        case 'MAX': { let m = null; for (const v of this.flatten(args, cs)) { if (typeof v === 'number') m = m === null ? v : Math.max(m, v); if (isErr(v)) throw v; } return m === null ? 0 : m; }
        case 'MIN': { let m = null; for (const v of this.flatten(args, cs)) { if (typeof v === 'number') m = m === null ? v : Math.min(m, v); if (isErr(v)) throw v; } return m === null ? 0 : m; }
        case 'COUNT': { let c = 0; for (const v of this.flatten(args, cs)) if (typeof v === 'number') c++; return c; }
        case 'SQRT': { const v = toNum(ev(args[0])); if (v < 0) throw ERR('#NUM!'); return Math.sqrt(v); }
        case 'ABS': return Math.abs(toNum(ev(args[0])));
        case 'ROUND': { const v = toNum(ev(args[0])), d = args[1] ? toNum(ev(args[1])) : 0; const m = Math.pow(10, d); return Math.round(v * m) / m; }
        case 'CEILING': { const v = toNum(ev(args[0])); const sig = args[1] ? toNum(ev(args[1])) : 1; if (sig === 0) return 0; return Math.ceil(v / sig) * sig; }
        case 'FLOOR': { const v = toNum(ev(args[0])); const sig = args[1] ? toNum(ev(args[1])) : 1; if (sig === 0) return 0; return Math.floor(v / sig) * sig; }
        case 'ISNUMBER': { const v = ev(args[0]); return typeof v === 'number'; }
        case 'TODAY': return todaySerial();
        case 'EDATE': { const s = toNum(ev(args[0])), m = toNum(ev(args[1])); const d = serialToDate(s); const nd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, 1)); const targetDay = d.getUTCDate(); const last = new Date(Date.UTC(nd.getUTCFullYear(), nd.getUTCMonth() + 1, 0)).getUTCDate(); nd.setUTCDate(Math.min(targetDay, last)); return dateToSerial(nd); }
        case 'WEEKDAY': { const s = toNum(ev(args[0])); const type = args[1] ? toNum(ev(args[1])) : 1; const dow = serialToDate(s).getUTCDay(); // 0=Sun
          if (type === 2) return dow === 0 ? 7 : dow; if (type === 3) return dow === 0 ? 6 : dow - 1; return dow + 1; }
        case 'WORKDAY': { let s = Math.round(toNum(ev(args[0]))); let d = Math.round(toNum(ev(args[1]))); const step = d >= 0 ? 1 : -1; let n = Math.abs(d);
          while (n > 0) { s += step; const w = serialToDate(s).getUTCDay(); if (w !== 0 && w !== 6) n--; } return s; }
        case 'NETWORKDAYS': { let a = Math.round(toNum(ev(args[0]))), b = Math.round(toNum(ev(args[1]))); if (a > b) { const t = a; a = b; b = t; } let c = 0; for (let s = a; s <= b; s++) { const w = serialToDate(s).getUTCDay(); if (w !== 0 && w !== 6) c++; } return c; }
        case 'SUMPRODUCT': { const arrs = args.map(a => { const v = ev(a); return Array.isArray(v) ? v : [v]; }); const len = Math.max(...arrs.map(a => a.length)); let s = 0; for (let i = 0; i < len; i++) { let p = 1; for (const a of arrs) { const v = a.length === 1 ? a[0] : a[i]; let x; if (typeof v === 'boolean') x = v ? 1 : 0; else if (typeof v === 'number') x = v; else x = 0; p *= x; } s += p; } return s; }
        case 'SUMIF': { const rng = ev(args[0]); const crit = ev(args[1]); const sumr = args[2] ? ev(args[2]) : rng; let s = 0; const list = Array.isArray(rng) ? rng : [rng]; const sl = Array.isArray(sumr) ? sumr : [sumr]; for (let i = 0; i < list.length; i++) if (matchCrit(list[i], crit)) { const v = sl[i]; if (typeof v === 'number') s += v; } return s; }
        case 'COUNTIF': { const rng = ev(args[0]); const crit = ev(args[1]); let c = 0; const list = Array.isArray(rng) ? rng : [rng]; for (const v of list) if (matchCrit(v, crit)) c++; return c; }
        case 'MATCH': { const target = ev(args[0]); const rng = ev(args[1]); const type = args[2] !== undefined ? toNum(ev(args[2])) : 1; const list = Array.isArray(rng) ? rng : [rng];
          if (type === 0) { for (let i = 0; i < list.length; i++) { try { if (cmp(list[i] == null ? '' : list[i], target == null ? '' : target, '=')) return i + 1; } catch (e) {} } throw ERR('#N/A'); }
          let best = -1; for (let i = 0; i < list.length; i++) { const v = list[i]; if (v == null) continue; try { if (cmp(v, target, '<=')) best = i; else break; } catch (e) {} } if (best < 0) throw ERR('#N/A'); return best + 1; }
        case 'INDEX': { const a = args[0]; if (a.t !== 'range') { const v = ev(a); const nIdx = toNum(ev(args[1])); return Array.isArray(v) ? v[nIdx - 1] : v; }
          const sheetN = a.sheet || cs; const r1 = Math.min(a.a.r, a.b.r), c1 = Math.min(a.a.c, a.b.c); const r2 = Math.max(a.a.r, a.b.r), c2 = Math.max(a.a.c, a.b.c);
          const rowN = toNum(ev(args[1])); const colN = args[2] ? toNum(ev(args[2])) : 1;
          if (c2 === c1) return this.value(sheetN, numToCol(c1) + (r1 + rowN - 1));
          if (r2 === r1) return this.value(sheetN, numToCol(c1 + rowN - 1) + r1);
          return this.value(sheetN, numToCol(c1 + colN - 1) + (r1 + rowN - 1)); }
        case 'AND': { for (const v of this.flatten(args, cs)) if (!toNum(v)) return false; return true; }
        case 'OR': { for (const v of this.flatten(args, cs)) if (toNum(v)) return true; return false; }
        default: throw ERR('#NAME?');
      }
    }
  }

  function matchCrit(v, crit) {
    if (typeof crit === 'string' && /^(<=|>=|<>|<|>|=)/.test(crit)) {
      const m = /^(<=|>=|<>|<|>|=)(.*)$/.exec(crit);
      let rhs = m[2]; const num = parseFloat(rhs);
      if (!isNaN(num) && /^-?[\d.]+$/.test(rhs.trim())) rhs = num;
      try { return cmp(v == null ? (typeof rhs === 'number' ? 0 : '') : v, rhs, m[1]); } catch (e) { return false; }
    }
    try { return cmp(v == null ? (typeof crit === 'number' ? 0 : '') : v, crit == null ? '' : crit, '='); } catch (e) { return false; }
  }

  // ---------- Formatting ----------
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function fmtNum(v, dec, thousands) {
    const neg = v < 0; let x = Math.abs(v);
    let s = dec === null ? String(Math.round(x * 100) / 100) : x.toFixed(dec);
    if (thousands) { const parts = s.split('.'); parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); s = parts.join('.'); }
    return (neg ? '-' : '') + s;
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function formatValue(v, nfId, numFmts) {
    if (v === null || v === undefined || v === '') return '';
    if (isErr(v)) return v.__err;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'string') return v;
    const code = numFmts && numFmts[nfId] !== undefined ? numFmts[nfId] : null;
    const d = () => serialToDate(v);
    switch (nfId) {
      case 165: return fmtNum(v, 0, true);
      case 166: { const r = Math.round(v * 10) / 10; return Number.isInteger(r) ? fmtNum(r, 0, true) : fmtNum(r, 1, true); }
      case 167: return fmtNum(v * 100, 1, false) + '%';
      case 172: return fmtNum(v * 100, 0, false) + '%';
      case 176: return fmtNum(v, 1, true);
      case 170: case 177: return (v < 0 ? '($' + fmtNum(-v, 2, true) + ')' : '$' + fmtNum(v, 2, true));
      case 178: return (v < 0 ? '($' + fmtNum(-v, 0, true) + ')' : '$' + fmtNum(v, 0, true));
      case 179: return v === 0 ? '—' : (v > 0 ? '+' : '-') + fmtNum(Math.abs(v) * 100, 1, false) + '%';
      case 168: { const dd = d(); return DOW[dd.getUTCDay()] + ' ' + pad2(dd.getUTCMonth() + 1) + '/' + pad2(dd.getUTCDate()) + '/' + dd.getUTCFullYear(); }
      case 171: { const dd = d(); return DOW[dd.getUTCDay()] + ' ' + pad2(dd.getUTCMonth() + 1) + '/' + pad2(dd.getUTCDate()) + '/' + String(dd.getUTCFullYear()).slice(2); }
      case 169: { const dd = d(); return pad2(dd.getUTCMonth() + 1) + '/' + pad2(dd.getUTCDate()) + '/' + dd.getUTCFullYear(); }
      case 175: { const dd = d(); return pad2(dd.getUTCMonth() + 1) + '/' + pad2(dd.getUTCDate()) + '/' + String(dd.getUTCFullYear()).slice(2); }
      case 173: { const dd = d(); return MONTHS[dd.getUTCMonth()] + ' ' + dd.getUTCDate(); }
      case 174: { const dd = d(); return String(dd.getUTCDate()); }
      case 9: return fmtNum(v * 100, 0, false) + '%';
      case 10: return fmtNum(v * 100, 2, false) + '%';
      case 14: { const dd = d(); return (dd.getUTCMonth() + 1) + '/' + dd.getUTCDate() + '/' + dd.getUTCFullYear(); }
      default: {
        if (code && /%/.test(code)) return fmtNum(v * 100, 1, false) + '%';
        if (code && /\$/.test(code)) return '$' + fmtNum(v, 2, true);
        if (code && /[ymd]/i.test(code) && /\//.test(code)) { const dd = d(); return pad2(dd.getUTCMonth() + 1) + '/' + pad2(dd.getUTCDate()) + '/' + dd.getUTCFullYear(); }
        // general
        if (Number.isInteger(v)) return String(v);
        const r = Math.round(v * 10000) / 10000;
        return String(r);
      }
    }
  }

  window.RidgelineEngine = { Workbook, formatValue, colToNum, numToCol, serialToDate, dateToSerial, todaySerial, isErr };
})();
