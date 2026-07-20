(function () {
  'use strict';
  const RS = window.RidgelineSync;

  // ---------- tiny helpers ----------
  function nid(prefix) { return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmt$(n) { n = Number(n) || 0; return '$' + Math.round(n).toLocaleString('en-US'); }
  function fmtDate(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[2] + '/' + m[3] + '/' + m[1]) : iso;
  }
  // Add n workdays to an ISO date string, returns ISO string
  function addWorkDays(isoDate, n) {
    if (!isoDate || n <= 0) return isoDate || '';
    const d = new Date(isoDate + 'T00:00:00Z');
    let added = 0;
    while (added < n) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) added++;
    }
    return d.toISOString().slice(0, 10);
  }
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  // Delegated listener bound ONCE on a stable ancestor (e.g. #content, which never
  // gets replaced — only its innerHTML does). Never call `on()` from inside a render
  // function that runs more than once, or handlers stack and fire multiple times.
  function on(root, evt, sel, fn) {
    root.addEventListener(evt, e => {
      const t = e.target && e.target.closest ? e.target.closest(sel) : null;
      if (t && root.contains(t)) fn(e, t);
    }, evt === 'blur' || evt === 'focus');
  }

  // ---------- money math — mirrors functions/api/_lib.js estContractTotal ----------
  function lineCalc(l, settings) {
    const cost = (Number(l.qty) || 0) * (Number(l.unitCost) || 0);
    const mk = l.markupPct != null ? Number(l.markupPct) : (Number(settings.defaultMarkupPct) || 0);
    const price = cost * (1 + mk);
    const total = price + (l.taxable ? price * (Number(settings.salesTaxPct) || 0) : 0);
    return { cost, mkAmt: price - cost, total };
  }
  function itemCalc(item, settings) {
    let cost = 0, total = 0;
    if (!item.excluded) {
      for (const l of (item.costLines || [])) { const lc = lineCalc(l, settings); cost += lc.cost; total += lc.total; }
    }
    return { cost, total };
  }
  function estTotals(est) {
    const S = est.settings || {};
    let cost = 0, total = 0;
    for (const it of (est.items || [])) { const ic = itemCalc(it, S); cost += ic.cost; total += ic.total; }
    return { cost, total };
  }
  function itemTag(it) { return (it.code ? it.code + ' — ' : '') + it.name; }
  // Field app is scoped to active jobs only — prospects/warranty/archive never appear here,
  // never selectable, never a note-send target. Filter at the single point jobs enter state.
  function isActiveJob(j) { return (j.status || 'active') === 'active'; }
  async function loadActiveJobs() { const all = await RS.listJobs(); return (all || []).filter(isActiveJob); }

  // ---------- state ----------
  const S = {
    jobs: [], jobId: null, job: null, tab: 'board',   // Board is the home screen
    schedFilter: 'all', collapsed: {}, notesOpen: {}, estOpen: {},
    board: null, noteOpen: {}
  };
  function isAdminJob(j) { return !!j && String(j.name || '').trim().toLowerCase() === 'admin'; }

  // ================= LOGIN =================
  function showLogin() { qs('#login-screen').classList.remove('hidden'); qs('#main').classList.add('hidden'); }
  function showMain() { qs('#login-screen').classList.add('hidden'); qs('#main').classList.remove('hidden'); boot(); }

  qs('#login-btn').addEventListener('click', doLogin);
  qs('#login-pw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  async function doLogin() {
    const pw = qs('#login-pw').value;
    if (!pw) return;
    qs('#login-err').textContent = '';
    try { await RS.login(pw); qs('#login-pw').value = ''; showMain(); }
    catch (e) { qs('#login-err').textContent = 'Wrong password.'; }
  }
  qs('#avatar').addEventListener('click', () => {
    if (!confirm('Sign out?')) return;
    RS.logout();
    showLogin();
  });

  RS.onAuthFail = () => showLogin();
  RS.onStatus = s => {
    const dot = qs('#sync-dot');
    const colors = { saving: '#d9b46a', saved: '#79c07a', offline: '#c98b6b', error: '#c98b6b', '': '#79c07a' };
    dot.style.background = colors[s] || '#79c07a';
    dot.title = { saving: 'Saving…', saved: 'Synced', offline: 'Offline — will sync', error: 'Sync error' }[s] || 'Synced';
  };

  // ================= BOOT =================
  async function boot() {
    try { S.jobs = await loadActiveJobs(); } catch (e) { S.jobs = []; }
    await ensureAdminJob();
    const active = RS.activeJob();
    // Only auto-restore the saved job if it's still in the active-jobs list — if it was
    // moved to prospect/warranty/archive since last use, don't silently show it.
    if (active && S.jobs.find(j => j.id === active)) await selectJob(active, { silent: true });
    else { S.jobId = null; S.job = null; updateJobName(); }
    render();
  }

  function updateJobName() {
    const j = S.jobs.find(x => x.id === S.jobId);
    qs('#job-name').textContent = j ? j.name : 'Select a job';
  }

  // One permanent company-wide "Admin" job: no estimate, open-ended, a place to drop notes/tasks
  // that feed the main schedule. Auto-created once (needs an admin session; PMs quietly skip on 403).
  async function ensureAdminJob() {
    if (S.jobs.some(isAdminJob)) return;
    try {
      await RS.createJob('Admin');
      S.jobs = await loadActiveJobs();
      updateJobName();
    } catch (e) { /* non-admin (403) or offline — the admin's session will have created it */ }
  }

  async function selectJob(id, opts) {
    opts = opts || {};
    S.jobId = id;
    RS.setActiveJob(id);
    updateJobName();
    try { S.job = await RS.getJob(id); } catch (e) { S.job = null; }
    if (!opts.silent) { S.schedFilter = 'all'; setActiveTabBtn(); render(); }
  }

  // ================= SHEET (job picker / assign) ================
  function openSheet(html, onRender) {
    closeSheet();
    const scrim = document.createElement('div');
    scrim.id = 'scrim';
    const sheet = document.createElement('div');
    sheet.id = 'jobsheet';
    sheet.innerHTML = '<div class="grab"></div>' + html;
    document.body.appendChild(scrim);
    document.body.appendChild(sheet);
    scrim.addEventListener('click', closeSheet);
    if (onRender) onRender(sheet);
  }
  function closeSheet() {
    const s = qs('#jobsheet'); if (s) s.remove();
    const sc = qs('#scrim'); if (sc) sc.remove();
  }

  qs('#job-switch').addEventListener('click', openJobSheet);
  function openJobSheet() {
    // Active jobs only — no prospects/warranty/archive shown here, ever.
    let html = '<div class="sheet-label">Switch job</div><div id="js-active"></div>' +
      '<div style="margin-top:16px;"><button class="btn btn-dashed btn-block" id="js-newjob-btn">＋ New job</button>' +
      '<div id="js-newjob-form" class="hidden" style="margin-top:10px;">' +
      '<input type="text" id="js-newjob-name" placeholder="Job name">' +
      '<div class="row" style="margin-top:10px;"><button class="btn btn-sm" id="js-newjob-cancel">Cancel</button><span class="spacer"></span><button class="btn btn-fill btn-sm" id="js-newjob-create">Create</button></div>' +
      '</div></div>';
    openSheet(html, sheet => {
      const rowHtml = j => '<div class="jobrow" data-id="' + esc(j.id) + '"><span class="name" style="color:' + (j.id === S.jobId ? 'var(--accent)' : 'var(--serif-warm1)') + '">' + esc(j.name) + (j.id === S.jobId ? ' ✓' : '') + '</span></div>';
      qs('#js-active', sheet).innerHTML = S.jobs.length ? S.jobs.map(rowHtml).join('') : '<div class="list-empty">No active jobs.</div>';
      on(sheet, 'click', '.jobrow', (e, row) => { closeSheet(); selectJob(row.getAttribute('data-id')); });
      qs('#js-newjob-btn', sheet).addEventListener('click', () => {
        qs('#js-newjob-form', sheet).classList.remove('hidden');
        qs('#js-newjob-name', sheet).focus();
      });
      qs('#js-newjob-cancel', sheet).addEventListener('click', () => qs('#js-newjob-form', sheet).classList.add('hidden'));
      qs('#js-newjob-create', sheet).addEventListener('click', async () => {
        const name = qs('#js-newjob-name', sheet).value.trim();
        if (!name) return;
        try {
          const meta = await RS.createJob(name);
          S.jobs = await loadActiveJobs();
          closeSheet();
          await selectJob(meta.id);
        } catch (e) { alert('Could not create job: ' + e.message); }
      });
    });
  }

  // Tap fallback for the long-press drag gesture: pick a job, then a due date.
  function openAssignSheet(noteId) {
    // Active jobs only — a whiteboard note can't be pinned to a prospect/warranty/archive job.
    const html = '<div class="sheet-label">Send to a job</div><div id="as-list"></div>';
    openSheet(html, sheet => {
      qs('#as-list', sheet).innerHTML = S.jobs.map(j => '<div class="jobrow" data-id="' + esc(j.id) + '"><span class="name">' + esc(j.name) + '</span></div>').join('') || '<div class="list-empty">No active jobs.</div>';
      on(sheet, 'click', '.jobrow', (e, row) => {
        const jobId = row.getAttribute('data-id');
        closeSheet();
        askDueDate(due => assignNoteToJob(noteId, jobId, due));
      });
    });
  }

  // Due-date-only prompt (no start/end — just a due date, or skip it).
  function askDueDate(onPick) {
    const html = '<div class="due-sheet"><div class="sheet-label">Due date</div>' +
      '<div class="due-sub">When is this due? Set a date or skip it.</div>' +
      '<input type="date" id="due-inp">' +
      '<div class="row"><button class="btn btn-block" id="due-skip">No due date</button>' +
      '<button class="btn btn-fill btn-block" id="due-set">Set date</button></div></div>';
    openSheet(html, sheet => {
      const inp = qs('#due-inp', sheet);
      qs('#due-set', sheet).onclick = () => { const v = inp.value; closeSheet(); onPick(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null); };
      qs('#due-skip', sheet).onclick = () => { closeSheet(); onPick(null); };
    });
  }

  // Assign a board note to a job. Keeps the card on the board (tagged + due date shown) AND,
  // when a due date is set, pins a dated to-do onto that job's schedule so it flows into the feed.
  async function assignNoteToJob(noteId, jobId, dueISO) {
    const notes = (S.board && S.board.notes) || [];
    const n = notes.find(x => x.id === noteId);
    if (!n) return;
    n.jobId = jobId;
    n.dueDate = dueISO || null;
    try {
      if (dueISO) n.schedTaskId = await upsertJobTask(jobId, n, dueISO);
      await saveBoardNotes(notes);
    } catch (e) {
      alert('Could not save (you may be offline). Try again when you have signal.');
    }
    if (S.tab === 'board') renderBoardTab(qs('#content'));
  }

  function noteHeadline(n) {
    const t = String(n.text || '').trim();
    if (t) return t.split('\n')[0].slice(0, 80);
    if (Array.isArray(n.items) && n.items.length) return '☑ To-do (' + n.items.length + ')';
    return 'Board note';
  }
  function noteFull(n) {
    let t = String(n.text || '').trim();
    if (Array.isArray(n.items) && n.items.length) {
      t += (t ? '\n' : '') + n.items.map(i => (i.done ? '☑ ' : '☐ ') + i.text).join('\n');
    }
    return t;
  }
  // Create (or move, if already linked) the note's pinned single-day task on a job's schedule.
  async function upsertJobTask(jobId, note, dueISO) {
    const upsert = (sched) => {
      let task = note.schedTaskId ? sched.find(t => t.id === note.schedTaskId) : null;
      if (task) {
        task.task = noteHeadline(note); task.note = noteFull(note);
        task.start = dueISO; task.finish = dueISO; task.fixed = dueISO; task.days = 1;
      } else {
        task = { id: nid('wb'), task: noteHeadline(note), group: 'Whiteboard', codes: [], off: 0,
          days: 1, pred: null, lag: 0, start: dueISO, finish: dueISO, status: 'Not Started', pct: 0,
          fixed: dueISO, note: noteFull(note), boardNoteId: note.id };
        sched.push(task);
      }
      return task.id;
    };
    if (jobId === S.jobId && S.job) {
      if (!Array.isArray(S.job.schedule)) S.job.schedule = [];
      const id = upsert(S.job.schedule);
      RS.saveJob(S.jobId, { schedule: S.job.schedule });
      return id;
    }
    const j = await RS.getJob(jobId);
    const sched = Array.isArray(j.schedule) ? j.schedule : [];
    const id = upsert(sched);
    RS.saveJob(jobId, { schedule: sched });
    return id;
  }

  // ================= RADIAL DRAG-TO-ASSIGN =================
  // Long-press a board note → the screen dims/zooms out and every active job fans out in a ring
  // of bubbles around your note. Drag onto one, release, and you're asked for a due date.
  let radial = null;
  let radialEndAt = 0;   // timestamp of the last drag-assign, so the follow-up click doesn't toggle expand

  function onNotePointerDown(e) {
    if (e.button != null && e.button !== 0) return;           // primary / touch only
    if (radial) return;
    const card = e.target.closest && e.target.closest('.note-card');
    if (!card) return;
    if (e.target.closest('input,textarea,button,select,a,.check')) return;  // let controls work
    const noteId = card.getAttribute('data-id');
    const note = ((S.board && S.board.notes) || []).find(x => x.id === noteId);
    if (!note || !S.jobs.length) return;
    radial = { noteId, note, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY,
      active: false, bubbles: [], ghost: null, hot: null };
    radial.holdTimer = setTimeout(() => { if (radial && !radial.active) activateRadial(); }, 340);
    window.addEventListener('pointermove', onRadialMove, { passive: false });
    window.addEventListener('pointerup', onRadialUp);
    window.addEventListener('pointercancel', onRadialUp);
  }

  function activateRadial() {
    if (!radial) return;
    const jobs = S.jobs.slice();
    if (!jobs.length) { teardownRadial(); return; }
    radial.active = true;
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
    qs('#main').classList.add('zoomed');

    const W = window.innerWidth, H = window.innerHeight;
    const cx = W / 2, cy = H * 0.46;
    const R = Math.max(104, Math.min(W, H) * 0.34);
    const overlay = document.createElement('div');
    overlay.id = 'radial';
    overlay.innerHTML = '<div class="scrim"></div><div class="hint">Drag onto a job · release to assign</div>';

    const n = jobs.length;
    jobs.forEach((j, i) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI / n);
      const bx = cx + R * Math.cos(ang), by = cy + R * Math.sin(ang);
      const el = document.createElement('div');
      el.className = 'rbubble' + (isAdminJob(j) ? ' admin' : '');
      el.style.left = bx + 'px'; el.style.top = by + 'px';
      el.innerHTML = '<div class="lbl">' + esc(String(j.name || '').slice(0, 26)) + '</div>';
      overlay.appendChild(el);
      radial.bubbles.push({ id: j.id, el, cx: bx, cy: by, r: 46 });
    });
    const ghost = document.createElement('div');
    ghost.className = 'ghost';
    ghost.textContent = noteHeadline(radial.note);
    ghost.style.left = radial.x + 'px'; ghost.style.top = radial.y + 'px';
    overlay.appendChild(ghost);
    radial.ghost = ghost;
    document.body.appendChild(overlay);
  }

  function onRadialMove(e) {
    if (!radial) return;
    radial.x = e.clientX; radial.y = e.clientY;
    if (!radial.active) {
      const dx = e.clientX - radial.startX, dy = e.clientY - radial.startY;
      if (dx * dx + dy * dy > 144) teardownRadial();          // moved >12px before hold → it's a scroll
      return;
    }
    e.preventDefault();
    if (radial.ghost) { radial.ghost.style.left = radial.x + 'px'; radial.ghost.style.top = radial.y + 'px'; }
    let hot = null, best = Infinity;
    for (const b of radial.bubbles) {
      const dx = radial.x - b.cx, dy = radial.y - b.cy, d2 = dx * dx + dy * dy;
      const within = d2 <= (b.r + 16) * (b.r + 16);
      if (within && d2 < best) { best = d2; hot = b; }
    }
    for (const b of radial.bubbles) b.el.classList.toggle('hot', b === hot);
    radial.hot = hot;
  }

  function onRadialUp() {
    if (!radial) return;
    const active = radial.active, hot = radial.hot, noteId = radial.noteId;
    const jobId = hot ? hot.id : null;
    teardownRadial();
    if (active && jobId) askDueDate(due => assignNoteToJob(noteId, jobId, due));
  }

  function teardownRadial() {
    if (!radial) return;
    if (radial.active) radialEndAt = Date.now();
    clearTimeout(radial.holdTimer);
    window.removeEventListener('pointermove', onRadialMove);
    window.removeEventListener('pointerup', onRadialUp);
    window.removeEventListener('pointercancel', onRadialUp);
    radial = null;
    const overlay = qs('#radial'); if (overlay) overlay.remove();
    const main = qs('#main'); if (main) main.classList.remove('zoomed');
  }

  // ================= TABS =================
  function setActiveTabBtn() { qsa('#tabs button').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === S.tab)); }
  on(qs('#tabs'), 'click', 'button', (e, btn) => {
    S.tab = btn.getAttribute('data-tab');
    setActiveTabBtn();
    closeSheet();
    render();
  });

  function render() {
    setActiveTabBtn();
    const c = qs('#content');
    if (S.tab === 'schedule') return renderScheduleTab(c);
    if (S.tab === 'estimate') return renderEstimateTab(c);
    if (S.tab === 'board') return renderBoardTab(c);
  }

  function noJobPrompt(c, msg) {
    c.innerHTML = '<div class="screen-title">' + esc(msg) + '</div><div class="screen-sub">Pick a job to get started.</div>' +
      '<button class="btn btn-fill btn-block" id="pick-job-btn" style="margin-top:18px;">Choose a job</button>';
    qs('#pick-job-btn').onclick = openJobSheet;
  }

  // ================= SCHEDULE TAB =================
  function saveSchedule() { RS.saveJob(S.jobId, { schedule: S.job.schedule }); }

  // Add a task to the open job's schedule. Dated → pinned single day (survives desktop recompute
  // via `fixed`); undated → a floating to-do. Inserted next to its phase so groups stay contiguous.
  function addTaskToSchedule(name, group, startISO) {
    if (!S.job) return;
    if (!Array.isArray(S.job.schedule)) S.job.schedule = [];
    group = group || 'Tasks';
    const task = { id: nid('ft'), task: name, group: group, codes: [], off: 0,
      days: startISO ? 1 : 0, pred: null, lag: 0,
      start: startISO || '', finish: startISO || '', status: 'Not Started', pct: 0 };
    if (startISO) task.fixed = startISO;
    const sched = S.job.schedule;
    let idx = -1;
    for (let i = 0; i < sched.length; i++) if ((sched[i].group || 'Tasks') === group) idx = i;
    if (idx >= 0) sched.splice(idx + 1, 0, task); else sched.push(task);
    saveSchedule();
    renderScheduleTab(qs('#content'));
  }

  function openAddTaskSheet() {
    if (!S.job) return;
    const groups = [];
    for (const t of (S.job.schedule || [])) { const g = t.group || 'Tasks'; if (groups.indexOf(g) < 0) groups.push(g); }
    const hasGroups = groups.length > 0;
    const sub = 'font-size:13px;color:var(--faint1);margin:12px 0 6px;';
    const html = '<div class="sheet-label">Add task</div>' +
      '<input type="text" id="at-name" placeholder="Task name">' +
      '<div style="' + sub + '">Phase</div>' +
      (hasGroups
        ? '<select id="at-group">' + groups.map(g => '<option value="' + esc(g) + '">' + esc(g) + '</option>').join('') + '<option value="__new">＋ New phase…</option></select>'
        : '') +
      '<input type="text" id="at-newgroup" class="' + (hasGroups ? 'hidden' : '') + '" placeholder="Phase name (e.g. Framing)" style="margin-top:8px;">' +
      '<div style="' + sub + '">Start date (optional)</div>' +
      '<input type="date" id="at-date">' +
      '<div class="row" style="margin-top:16px;gap:10px;"><button class="btn btn-block" id="at-cancel">Cancel</button>' +
      '<button class="btn btn-fill btn-block" id="at-save">Add task</button></div>';
    openSheet(html, sheet => {
      const grpSel = qs('#at-group', sheet);
      const newGrp = qs('#at-newgroup', sheet);
      if (grpSel) grpSel.onchange = () => { newGrp.classList.toggle('hidden', grpSel.value !== '__new'); };
      const nm = qs('#at-name', sheet); if (nm) nm.focus();
      qs('#at-cancel', sheet).onclick = closeSheet;
      qs('#at-save', sheet).onclick = () => {
        const name = qs('#at-name', sheet).value.trim();
        if (!name) { qs('#at-name', sheet).focus(); return; }
        const group = (grpSel && grpSel.value !== '__new') ? grpSel.value : (newGrp.value.trim() || 'Tasks');
        const d = qs('#at-date', sheet).value;
        closeSheet();
        addTaskToSchedule(name, group, /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '');
      };
    });
  }

  function renderScheduleTab(c) {
    if (!S.jobId || !S.job) return noJobPrompt(c, 'Schedule');
    const rows = S.job.schedule || [];
    let html = '<div class="screen-title">Schedule</div><div class="screen-sub">Every task on one timeline</div>' +
      '<div class="status-row"><span class="synced">✓ Synced</span></div>';
    if (!rows.length) {
      html += '<div class="card" style="margin-top:18px;">No schedule yet for this job — add the first task below or build one from the desktop app.</div>';
      html += '<button class="btn btn-fill btn-block" id="sch-add" style="margin-top:12px;">＋ Add task</button>';
      c.innerHTML = html;
      return;
    }
    const filters = [['all', 'All'], ['upcoming', 'Upcoming'], ['done', 'Completed']];
    html += '<div class="row wrap" style="gap:8px;margin-top:16px;">' +
      filters.map(([k, l]) => '<button class="chip ' + (S.schedFilter === k ? 'active' : '') + '" data-filter="' + k + '">' + l + '</button>').join('') + '</div>';
    // Share the schedule as an image (to text) or PDF (to email) — reflects the current filter.
    if (window.ScheduleShare) html += '<div class="row wrap" style="gap:8px;margin-top:8px;">' +
      '<button class="chip" id="share-jpeg">⤓ Text (JPEG)</button>' +
      '<button class="chip" id="share-pdf">⤓ PDF</button>' +
      '<button class="chip ' + (S.shareCollapse ? 'active' : '') + '" id="share-collapse">Phases only</button>' +
      '</div>';
    html += '<button class="btn btn-dashed btn-block" id="sch-add" style="margin-top:10px;">＋ Add task</button>';

    const groups = [];
    let cur = null;
    for (const r of rows) { const g = r.group || 'Tasks'; if (!cur || cur.g !== g) { cur = { g, items: [] }; groups.push(cur); } cur.items.push(r); }

    for (const g of groups) {
      const done = g.items.filter(r => r.status === 'Complete');
      const open = g.items.filter(r => r.status !== 'Complete');
      html += '<div class="phase-head"><h3>' + esc(g.g) + '</h3><div class="count">' + done.length + '/' + g.items.length + '</div></div>';

      if (S.schedFilter === 'done') {
        if (!done.length) continue;
        html += done.map(r => taskRowHtml(r, true)).join('');
        continue;
      }
      if (S.schedFilter === 'upcoming') {
        if (!open.length) { html += '<div class="muted" style="padding:10px 0;font-size:13px;">All caught up.</div>'; continue; }
        html += open.map(r => taskRowHtml(r, false)).join('');
        continue;
      }
      // 'all'
      const key = S.jobId + ':' + g.g;
      const isOpen = !!S.collapsed[key];
      if (done.length) html += '<div class="collapse-toggle ' + (isOpen ? 'open' : '') + '" data-collapse="' + esc(key) + '"><span class="caret">▶</span>' + done.length + ' complete</div>';
      if (isOpen) html += done.map(r => taskRowHtml(r, true)).join('');
      html += open.map(r => taskRowHtml(r, false)).join('');
    }
    c.innerHTML = html;
  }

  function taskRowHtml(r, isDone) {
    const noteOpen = !!S.notesOpen[r.id];
    const hasNote = r.note && r.note.trim();
    return '<div class="task-row" data-id="' + esc(r.id) + '">' +
      '<input type="checkbox" class="check task-check" ' + (isDone ? 'checked' : '') + '>' +
      '<div class="body">' +
      '<div class="task-name ' + (isDone ? 'done' : '') + '">' + esc(String(r.task || '').replace(/^\d+\s*/, '')) + '</div>' +
      (noteOpen ? '<textarea class="task-note-box" placeholder="Field notes for this task…">' + esc(r.note || '') + '</textarea>'
        : (hasNote ? '<div class="task-note">' + esc(r.note) + '</div>' : '')) +
      '</div>' +
      '<input type="date" class="task-date-inp ' + (isDone ? 'done' : '') + '" data-id="' + esc(r.id) + '" value="' + esc(r.start || '') + '">' +
      '<button class="note-toggle" style="color:' + (hasNote ? 'var(--accent)' : 'var(--faint1)') + ';">✎</button>' +
      '</div>';
  }

  // ================= ESTIMATE TAB =================
  function renderEstimateTab(c) {
    if (!S.jobId || !S.job) return noJobPrompt(c, 'Estimate');
    const est = S.job.estimate;
    if (!est) {
      c.innerHTML = '<div class="screen-title">Estimate</div><div class="screen-sub">' + esc(S.job.name) + '</div>' +
        '<div class="card" style="margin-top:18px;">No estimate yet for this job — start one from the desktop app.</div>';
      return;
    }
    const set = est.settings || {};
    const tot = estTotals(est);
    const lineCount = (est.items || []).filter(i => !i.excluded).length;
    S.job.pendingNotes = S.job.pendingNotes || [];

    let html = '<div class="screen-title">Estimate</div><div class="screen-sub">' + esc(S.job.name) + '</div>' +
      '<div class="total-card"><div class="lbl">Total estimate</div><div class="num">' + fmt$(tot.total) + '</div>' +
      '<div class="note">' + lineCount + ' line item' + (lineCount === 1 ? '' : 's') + '</div></div>';

    const categories = est.categories && est.categories.length ? est.categories : [{ id: null, code: '', name: 'Items' }];
    for (const cat of categories) {
      const items = (est.items || []).filter(i => (i.categoryId || null) === (cat.id || null));
      if (!items.length) continue;
      let catTot = 0;
      for (const it of items) { const ic = itemCalc(it, set); if (!it.excluded) catTot += ic.total; }
      html += '<div class="cat-head"><h3>' + esc(cat.code ? cat.code + ' — ' + cat.name : cat.name) + '</h3><div class="amt">' + fmt$(catTot) + '</div></div>';
      for (const it of items) {
        const ic = itemCalc(it, set);
        const open = !!S.estOpen[it.id];
        const notes = S.job.pendingNotes.filter(n => n.target === 'estimate' && n.text.indexOf('[' + itemTag(it) + ']') === 0);
        html += '<div class="est-row" data-item="' + esc(it.id) + '"><div class="nm">' + (open ? '▾' : '▸') + ' ' + esc(it.name) + (notes.length ? ' <span style="color:var(--accent);">✎' + notes.length + '</span>' : '') + '</div><div class="amt">' + fmt$(ic.total) + '</div></div>';
        if (open) html += renderEstDetail(it, set, notes);
      }
    }
    c.innerHTML = html;
  }

  function renderEstDetail(it, set, notes) {
    let h = '<div class="est-detail">';
    for (const l of (it.costLines || [])) {
      const lc = lineCalc(l, set);
      h += '<div class="cl-line"><span class="d">' + esc(l.desc || '—') + ' <span class="muted">' + esc(l.qty) + ' ' + esc(l.unit) + '</span></span><span>' + fmt$(lc.total) + '</span></div>';
    }
    if (!(it.costLines || []).length) h += '<div class="muted" style="font-size:13px;padding:6px 0;">No cost lines yet.</div>';
    if (notes.length) {
      h += '<div class="notes-log">';
      for (const n of notes) {
        const bodyTxt = n.text.replace(/^\[[^\]]*\]\s*/, '');
        h += '<div class="n"><div class="txt">' + esc(bodyTxt) + '</div><div class="meta"><span class="pill pill-' + n.status + '">' + esc(n.status) + '</span>' + esc(n.by || '') + ' · ' + new Date(n.ts).toLocaleDateString() + '</div></div>';
      }
      h += '</div>';
    }
    h += '<textarea class="note-input" data-item="' + esc(it.id) + '" placeholder="Note to office — price change, field condition, customer request…" style="margin-top:10px;min-height:64px;"></textarea>' +
      '<button class="btn btn-fill btn-sm note-send-btn" data-item="' + esc(it.id) + '" style="margin-top:8px;">Send to office</button>' +
      '</div>';
    return h;
  }

  // ================= BOARD / WHITEBOARD TAB =================
  // A compact summary of a note: type icon + title (first line / checklist) + job & due badges.
  function noteTitle(n) {
    const t = String(n.text || '').trim();
    if (t) return t.split('\n')[0];
    if (Array.isArray(n.items) && n.items.length) {
      return n.items[0].text + (n.items.length > 1 ? '  +' + (n.items.length - 1) : '');
    }
    return 'Note';
  }
  function noteSummaryHtml(n, byName, open) {
    const isCheck = Array.isArray(n.items) && n.items.length;
    const icon = (n.files && n.files.length) ? '📎' : (isCheck ? '☑' : '📝');
    const done = isCheck ? n.items.filter(i => i.done).length : 0;
    const allDone = isCheck && done === n.items.length;
    let badges = '';
    if (n.jobId) badges += '<span class="note-assigned">⌂ ' + esc(byName(n.jobId) || 'assigned') + '</span>';
    if (n.dueDate) badges += '<span class="note-due">◷ ' + esc(fmtDate(n.dueDate)) + '</span>';
    badges += '<span class="note-by">' + esc(n.by || '') + (n.ts ? ' · ' + new Date(n.ts).toLocaleDateString() : '') + '</span>';
    return '<div class="note-sum" data-id="' + esc(n.id) + '">' +
      '<span class="note-ic">' + icon + '</span>' +
      '<div class="note-sum-main"><div class="note-sum-title' + (allDone ? ' done' : '') + '">' + esc(noteTitle(n)) + '</div>' +
      '<div class="note-sum-meta">' + badges + '</div></div>' +
      (isCheck ? '<span class="note-count">' + done + '/' + n.items.length + '</span>' : '') +
      '<span class="note-caret">' + (open ? '▾' : '▸') + '</span></div>';
  }
  // The expanded, editable note (full text + checklist add/remove + assign/delete).
  function noteBodyHtml(n) {
    let inner = '';
    if (n.text) inner += '<div class="txt">' + esc(n.text) + '</div>';
    if (Array.isArray(n.items)) inner += n.items.map(i => '<div class="checklist-item">' +
      '<input type="checkbox" class="check ck-item" data-note="' + esc(n.id) + '" data-item="' + esc(i.id) + '" ' + (i.done ? 'checked' : '') + '>' +
      '<div class="txt ' + (i.done ? 'done' : '') + '">' + esc(i.text) + '</div>' +
      '<button class="ck-del-item" data-note="' + esc(n.id) + '" data-item="' + esc(i.id) + '" aria-label="Remove item" style="flex:0 0 auto;background:none;border:none;color:var(--faint1);font-size:15px;line-height:1;padding:4px 6px;cursor:pointer;">✕</button>' +
      '</div>').join('');
    inner += '<div class="row" style="margin-top:8px;gap:6px;">' +
      '<input type="text" class="ck-add-input" data-note="' + esc(n.id) + '" placeholder="Add an item…" style="flex:1;font-size:15px;padding:9px 11px;">' +
      '<button class="btn btn-sm ck-add-btn" data-note="' + esc(n.id) + '" style="flex:0 0 auto;">Add</button></div>';
    inner += '<div class="row wrap" style="margin-top:12px;gap:8px;">' +
      '<button class="btn btn-sm bw-assign-btn" data-id="' + esc(n.id) + '">' + (n.jobId ? 'Reassign' : 'Send to job') + '</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm bw-del-btn" data-id="' + esc(n.id) + '" style="color:var(--bad);border-color:var(--bad);">Delete</button></div>';
    return inner;
  }

  async function loadBoard() { try { S.board = await RS.api('/board'); } catch (e) { S.board = { notes: [] }; } }
  async function loadBoard() { try { S.board = await RS.api('/board'); } catch (e) { S.board = { notes: [] }; } }
  async function saveBoardNotes(notes) { await RS.api('/board', { method: 'PUT', body: JSON.stringify({ notes }) }); S.board.notes = notes; }

  async function renderBoardTab(c) {
    c.innerHTML = '<div class="screen-title">Board</div><div class="screen-sub">Loading…</div>';
    if (!S.board) await loadBoard();
    // guard against a tab switch that happened while we were awaiting
    if (S.tab !== 'board') return;
    const notes = (S.board && S.board.notes) || [];
    const byName = id => { const j = S.jobs.find(x => x.id === id); return j ? j.name : null; };
    let html = '<div class="screen-title">Whiteboard</div><div class="screen-sub">Company capture board</div>';

    // ---------- Notepad — the dominant thing on the screen ----------
    html += '<div class="notepad"><div class="notepad-eyebrow">NOTEPAD</div>' +
      '<textarea id="bw-new-text" placeholder="Get it out of your head — type it here…"></textarea>' +
      '<button class="btn btn-fill btn-block" id="bw-add-btn">Stick it on the board</button></div>';

    // ---------- All notes, as compact summaries (tap to open) ----------
    html += '<div class="notes-head"><h3>All notes</h3><div class="count">' + notes.length + '</div></div>';
    if (!notes.length) html += '<div class="list-empty">The board is clear.</div>';
    else {
      html += '<div class="drag-hint" style="margin:-2px 0 8px;">Tap a note to open it · hold &amp; drag to send it to a job.</div>';
      html += notes.slice().reverse().map(n => {
        const open = !!S.noteOpen[n.id];
        return '<div class="note-card' + (open ? ' open' : '') + '" data-id="' + esc(n.id) + '">' +
          noteSummaryHtml(n, byName, open) +
          (open ? '<div class="note-body">' + noteBodyHtml(n) + '</div>' : '') +
          '</div>';
      }).join('');
    }
    c.innerHTML = html;
    qs('#bw-add-btn').onclick = async (ev) => {
      const btn = ev.currentTarget;
      const ta = qs('#bw-new-text');
      const text = ta.value.trim();
      if (!text || btn.disabled) return;
      const note = { id: nid('n'), text, items: null, jobId: S.jobId || null, by: RS.userName() || 'Field', ts: Date.now() };
      const updated = ((S.board && S.board.notes) || []).concat([note]);
      btn.disabled = true;
      try {
        await saveBoardNotes(updated);   // only clear the box once it's actually saved
        ta.value = '';
        renderBoardTab(c);
      } catch (err) {
        btn.disabled = false;
        alert('Could not save to the board (you may be offline). Your text is still here — try again when you have signal.');
      }
    };
  }

  // ================= DELEGATED HANDLERS (bound ONCE — never inside a render fn) =================
  function bindDelegation() {
    const c = qs('#content');

    // Long-press a board note to fan out the jobs and drag it onto one (bound once).
    c.addEventListener('pointerdown', onNotePointerDown);

    // Tap a note summary to expand/collapse the full note (ignored just after a drag-assign).
    on(c, 'click', '.note-sum', (e, row) => {
      if (Date.now() - radialEndAt < 500) return;
      const id = row.getAttribute('data-id');
      S.noteOpen[id] = !S.noteOpen[id];
      renderBoardTab(c);
    });

    // Schedule
    on(c, 'click', '.chip', (e, chip) => { const f = chip.getAttribute('data-filter'); if (!f) return; S.schedFilter = f; renderScheduleTab(c); });
    on(c, 'click', '#sch-add', () => openAddTaskSheet());
    const shareOpts = () => ({ hideCompleted: S.schedFilter === 'upcoming', collapseToPhases: !!S.shareCollapse });
    on(c, 'click', '#share-jpeg', () => { if (window.ScheduleShare && S.job) window.ScheduleShare.downloadJpeg(S.job, shareOpts()); });
    on(c, 'click', '#share-pdf', () => { if (window.ScheduleShare && S.job) window.ScheduleShare.downloadPdf(S.job, shareOpts()); });
    on(c, 'click', '#share-collapse', () => { S.shareCollapse = !S.shareCollapse; renderScheduleTab(c); });
    on(c, 'click', '.collapse-toggle', (e, t) => { const k = t.getAttribute('data-collapse'); S.collapsed[k] = !S.collapsed[k]; renderScheduleTab(c); });
    on(c, 'change', '.task-check', (e, chk) => {
      if (!S.job) return;
      const r = (S.job.schedule || []).find(x => x.id === chk.closest('.task-row').getAttribute('data-id'));
      if (!r) return;
      r.status = chk.checked ? 'Complete' : 'In Progress';
      r.pct = chk.checked ? 1 : 0.5;
      saveSchedule();
      renderScheduleTab(c);
    });
    on(c, 'click', '.note-toggle', (e, btn) => { const id = btn.closest('.task-row').getAttribute('data-id'); S.notesOpen[id] = !S.notesOpen[id]; renderScheduleTab(c); });
    on(c, 'change', '.task-date-inp', (e, inp) => {
      if (!S.job) return;
      const newISO = inp.value;
      const r = (S.job.schedule || []).find(x => x.id === inp.getAttribute('data-id'));
      if (!r || !newISO || newISO === r.start) return;
      // Pin to chosen date — no dependency cascade
      r.fixed = newISO;
      r.start = newISO;
      r.finish = addWorkDays(newISO, Math.max(0, (r.days || 1) - 1));
      saveSchedule();
      renderScheduleTab(c);
    });
    on(c, 'blur', '.task-note-box', (e, ta) => {
      if (!S.job) return;
      const r = (S.job.schedule || []).find(x => x.id === ta.closest('.task-row').getAttribute('data-id'));
      if (!r) return;
      r.note = ta.value;
      saveSchedule();
    });

    // Estimate
    on(c, 'click', '.est-row', (e, row) => { const id = row.getAttribute('data-item'); S.estOpen[id] = !S.estOpen[id]; renderEstimateTab(c); });
    on(c, 'click', '.note-send-btn', (e, btn) => {
      if (!S.job || !S.job.estimate) return;
      const itemId = btn.getAttribute('data-item');
      const it = (S.job.estimate.items || []).find(i => i.id === itemId);
      const ta = qs('.note-input[data-item="' + itemId + '"]', c);
      const text = ta ? ta.value.trim() : '';
      if (!it || !text) return;
      const note = { id: nid('n'), by: RS.userName() || 'Field', target: 'estimate', text: '[' + itemTag(it) + '] ' + text, ts: Date.now(), status: 'pending' };
      S.job.pendingNotes = S.job.pendingNotes || [];
      S.job.pendingNotes.push(note);
      // Route through the offline cache (dirty-flag + reconnect retry), never a bare PUT that
      // silently drops the note when there's no signal in the field — this is the app's main job.
      RS.saveJob(S.jobId, { pendingNotes: S.job.pendingNotes });
      renderEstimateTab(c);
    });

    // Board — to-do checklist (floating schedule tasks)
    on(c, 'change', '.todo-sched-chk', (e, chk) => {
      if (!S.job) return;
      const r = (S.job.schedule || []).find(x => x.id === chk.getAttribute('data-id'));
      if (!r) return;
      r.status = chk.checked ? 'Complete' : 'In Progress';
      r.pct = chk.checked ? 1 : 0.5;
      const txt = chk.closest('.checklist-item').querySelector('.txt');
      if (txt) txt.classList.toggle('done', chk.checked);
      RS.saveJob(S.jobId, { schedule: S.job.schedule });
    });
    // Board — to-do checklist (jobTodos items)
    on(c, 'change', '.todo-item-chk', (e, chk) => {
      if (!S.job) return;
      const td = (S.job.jobTodos || []).find(x => x.id === chk.getAttribute('data-id'));
      if (!td) return;
      td.done = chk.checked;
      const txt = chk.closest('.checklist-item').querySelector('.txt');
      if (txt) txt.classList.toggle('done', chk.checked);
      RS.saveJob(S.jobId, { jobTodos: S.job.jobTodos });
    });

    // Board
    on(c, 'change', '.ck-item', async (e, chk) => {
      const notes = (S.board && S.board.notes) || [];
      const n = notes.find(x => x.id === chk.getAttribute('data-note'));
      if (!n) return;
      const it = (n.items || []).find(i => i.id === chk.getAttribute('data-item'));
      if (it) it.done = chk.checked;
      try { await saveBoardNotes(notes); }
      catch (err) { if (it) it.done = !chk.checked; chk.checked = !chk.checked; alert('Could not save — you may be offline.'); }
    });
    // Board — add an item to a note's checklist (edit an existing to-do list from the field)
    async function addBoardItem(btn) {
      const noteId = btn.getAttribute('data-note');
      const inp = qs('.ck-add-input[data-note="' + noteId + '"]', c);
      const text = inp ? inp.value.trim() : '';
      if (!text || btn.disabled) return;
      const notes = (S.board && S.board.notes) || [];
      const n = notes.find(x => x.id === noteId);
      if (!n) return;
      const hadItems = Array.isArray(n.items);
      const prevLen = hadItems ? n.items.length : 0;
      if (!hadItems) n.items = [];
      n.items.push({ id: nid('i'), text, done: false });
      btn.disabled = true;
      try { await saveBoardNotes(notes); renderBoardTab(c); }
      catch (err) {
        n.items.splice(prevLen); if (!hadItems) n.items = null; // roll back the optimistic add
        btn.disabled = false;
        alert('Could not save (you may be offline). Your text is still here — try again when you have signal.');
      }
    }
    on(c, 'click', '.ck-add-btn', (e, btn) => addBoardItem(btn));
    on(c, 'keydown', '.ck-add-input', (e, inp) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const btn = qs('.ck-add-btn[data-note="' + inp.getAttribute('data-note') + '"]', c);
      if (btn) addBoardItem(btn);
    });
    on(c, 'click', '.ck-del-item', async (e, t) => {
      const noteId = t.getAttribute('data-note'), itemId = t.getAttribute('data-item');
      const notes = (S.board && S.board.notes) || [];
      const n = notes.find(x => x.id === noteId);
      if (!n || !Array.isArray(n.items)) return;
      const idx = n.items.findIndex(i => i.id === itemId);
      if (idx < 0) return;
      const removed = n.items.splice(idx, 1)[0];
      try { await saveBoardNotes(notes); renderBoardTab(c); }
      catch (err) { n.items.splice(idx, 0, removed); alert('Could not remove — you may be offline.'); }
    });
    on(c, 'click', '.bw-del-btn', async (e, t) => {
      if (!confirm('Remove this note?')) return;
      const notes = ((S.board && S.board.notes) || []).filter(n => n.id !== t.getAttribute('data-id'));
      try { await saveBoardNotes(notes); renderBoardTab(c); }
      catch (err) { alert('Could not remove — you may be offline.'); }
    });
    on(c, 'click', '.bw-assign-btn', (e, t) => openAssignSheet(t.getAttribute('data-id')));
  }

  // ================= PWA INSTALL =================
  // Chrome fires 'beforeinstallprompt' only when the app qualifies to be installed. We stash it and
  // reveal an in-app "Install app" button, so you don't have to hunt through the browser menu.
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    const b = qs('#install-cta'); if (b) b.classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    const b = qs('#install-cta'); if (b) b.classList.add('hidden');
  });
  (function () {
    const b = qs('#install-cta'); if (!b) return;
    b.addEventListener('click', async () => {
      if (!deferredInstall) return;
      b.classList.add('hidden');
      deferredInstall.prompt();
      try { await deferredInstall.userChoice; } catch (e) {}
      deferredInstall = null;
    });
  })();

  // ================= INIT =================
  bindDelegation();
  if (RS.token()) showMain(); else showLogin();
})();
