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
    jobs: [], jobId: null, job: null, tab: 'schedule',
    schedFilter: 'all', collapsed: {}, notesOpen: {}, estOpen: {},
    board: null
  };

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

  async function selectJob(id, opts) {
    opts = opts || {};
    S.jobId = id;
    RS.setActiveJob(id);
    updateJobName();
    try { S.job = await RS.getJob(id); } catch (e) { S.job = null; }
    if (!opts.silent) { S.tab = 'schedule'; S.schedFilter = 'all'; setActiveTabBtn(); render(); }
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

  function openAssignSheet(noteId) {
    // Active jobs only — a whiteboard note can't be pinned to a prospect/warranty/archive job.
    const html = '<div class="sheet-label">Assign to job</div><div id="as-list"></div>';
    openSheet(html, sheet => {
      qs('#as-list', sheet).innerHTML = S.jobs.map(j => '<div class="jobrow" data-id="' + esc(j.id) + '"><span class="name">' + esc(j.name) + '</span></div>').join('') || '<div class="list-empty">No active jobs.</div>';
      on(sheet, 'click', '.jobrow', async (e, row) => {
        const notes = (S.board && S.board.notes) || [];
        const n = notes.find(x => x.id === noteId);
        if (n) n.jobId = row.getAttribute('data-id');
        await saveBoardNotes(notes);
        closeSheet();
        if (S.tab === 'board') renderBoardTab(qs('#content'));
      });
    });
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

  function renderScheduleTab(c) {
    if (!S.jobId || !S.job) return noJobPrompt(c, 'Schedule');
    const rows = S.job.schedule || [];
    let html = '<div class="screen-title">Schedule</div><div class="screen-sub">Every task on one timeline</div>' +
      '<div class="status-row"><span class="synced">✓ Synced</span></div>';
    if (!rows.length) {
      html += '<div class="card" style="margin-top:18px;">No schedule yet for this job — build one from the desktop app.</div>';
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

  // ================= BOARD TAB =================
  async function loadBoard() { try { S.board = await RS.api('/board'); } catch (e) { S.board = { notes: [] }; } }
  async function saveBoardNotes(notes) { await RS.api('/board', { method: 'PUT', body: JSON.stringify({ notes }) }); S.board.notes = notes; }

  async function renderBoardTab(c) {
    c.innerHTML = '<div class="screen-title">Board</div><div class="screen-sub">Loading…</div>';
    if (!S.board) await loadBoard();
    // guard against a tab switch that happened while we were awaiting
    if (S.tab !== 'board') return;
    const notes = (S.board && S.board.notes) || [];
    let html = '<div class="screen-title">Board</div><div class="screen-sub">' + (S.job ? esc(S.job.name) : 'Company-wide') + '</div>';

    // ---------- Job To-Do section ----------
    if (S.job) {
      const floatingTasks = (S.job.schedule || []).filter(t => !t.start || t.start === '');
      const jobTodos = S.job.jobTodos || [];
      if (floatingTasks.length || jobTodos.length) {
        const openCount = floatingTasks.filter(t => t.status !== 'Complete').length + jobTodos.filter(t => !t.done).length;
        html += '<div class="phase-head" style="margin-top:18px;"><h3>To-Do List</h3>' +
          '<div class="count">' + openCount + ' open</div></div>';
        for (const t of floatingTasks) {
          const done = t.status === 'Complete';
          html += '<div class="checklist-item" style="padding:10px 0;border-bottom:1px solid var(--hair-row);">' +
            '<input type="checkbox" class="check todo-sched-chk" data-id="' + esc(t.id) + '" ' + (done ? 'checked' : '') + '>' +
            '<div class="txt ' + (done ? 'done' : '') + '">' + esc(String(t.task || '').replace(/^\d+\s*/, '')) + '</div></div>';
        }
        for (const td of jobTodos) {
          html += '<div class="checklist-item" style="padding:10px 0;border-bottom:1px solid var(--hair-row);">' +
            '<input type="checkbox" class="check todo-item-chk" data-id="' + esc(td.id) + '" ' + (td.done ? 'checked' : '') + '>' +
            '<div class="txt ' + (td.done ? 'done' : '') + '">' + esc(td.text || '') + '</div></div>';
        }
      }
    }

    html += '<div class="card" style="margin-top:18px;"><textarea id="bw-new-text" placeholder="Get it out of your head — type it here…" style="min-height:76px;"></textarea>' +
      '<button class="btn btn-fill btn-block" id="bw-add-btn" style="margin-top:10px;">Stick it on the board</button></div>';
    if (!notes.length) html += '<div class="list-empty">The board is clear.</div>';
    else {
      const byName = id => { const j = S.jobs.find(x => x.id === id); return j ? j.name : null; };
      html += notes.slice().reverse().map(n => {
        let inner = '<div class="note-card" data-id="' + esc(n.id) + '">';
        if (n.text) inner += '<div class="txt">' + esc(n.text) + '</div>';
        if (Array.isArray(n.items)) inner += n.items.map(i => '<div class="checklist-item">' +
          '<input type="checkbox" class="check ck-item" data-note="' + esc(n.id) + '" data-item="' + esc(i.id) + '" ' + (i.done ? 'checked' : '') + '>' +
          '<div class="txt ' + (i.done ? 'done' : '') + '">' + esc(i.text) + '</div>' +
          '<button class="ck-del-item" data-note="' + esc(n.id) + '" data-item="' + esc(i.id) + '" aria-label="Remove item" style="flex:0 0 auto;background:none;border:none;color:var(--faint1);font-size:15px;line-height:1;padding:4px 6px;cursor:pointer;">✕</button>' +
          '</div>').join('');
        // Add-to-list: any note can grow a checklist (a plain reminder becomes one on first add).
        inner += '<div class="row" style="margin-top:8px;gap:6px;">' +
          '<input type="text" class="ck-add-input" data-note="' + esc(n.id) + '" placeholder="Add an item…" style="flex:1;font-size:15px;padding:9px 11px;">' +
          '<button class="btn btn-sm ck-add-btn" data-note="' + esc(n.id) + '" style="flex:0 0 auto;">Add</button>' +
          '</div>';
        inner += '<div class="row wrap meta" style="margin-top:10px;gap:8px;">' +
          '<span class="spacer">' + esc(n.by || '') + ' · ' + (n.ts ? new Date(n.ts).toLocaleDateString() : '') + '</span>' +
          '<button class="btn btn-sm bw-assign-btn" data-id="' + esc(n.id) + '">' + (n.jobId ? '⌂ ' + esc(byName(n.jobId) || 'assigned') : 'Assign to job') + '</button>' +
          '<button class="btn btn-sm bw-del-btn" data-id="' + esc(n.id) + '" style="color:var(--bad);border-color:var(--bad);">Delete</button>' +
          '</div></div>';
        return inner;
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

    // Schedule
    on(c, 'click', '.chip', (e, chip) => { const f = chip.getAttribute('data-filter'); if (!f) return; S.schedFilter = f; renderScheduleTab(c); });
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

  // ================= INIT =================
  bindDelegation();
  if (RS.token()) showMain(); else showLogin();
})();
