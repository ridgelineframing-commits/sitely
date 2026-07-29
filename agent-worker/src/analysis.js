const DAY = 86400000;

function isoToday(now) {
  return new Date(now == null ? Date.now() : now).toISOString().slice(0, 10);
}

function cleanTask(value) {
  return String(value || '').replace(/^\d{4}\s*/, '').trim();
}

function proposal(kind, title, summary, action, baseVersion, source) {
  return {
    id: crypto.randomUUID(),
    kind,
    title,
    summary,
    action: action || null,
    source: source || null,
    baseVersion: Math.max(1, Number(baseVersion) || 1),
    status: 'pending',
    createdAt: Date.now()
  };
}

function scheduleSignals(job, today) {
  const rows = Array.isArray(job.schedule) ? job.schedule : [];
  const cutoff = new Date(today + 'T00:00:00Z').getTime() + 14 * DAY;
  const overdue = rows.filter(r => r.status !== 'Complete' && r.finish && r.finish < today);
  const tentative = rows.filter(r => {
    if (r.status === 'Complete' || r.confirmed || !r.start) return false;
    const ts = new Date(r.start + 'T00:00:00Z').getTime();
    return ts >= new Date(today + 'T00:00:00Z').getTime() && ts <= cutoff;
  });
  return { overdue, tentative };
}

function fileKind(name) {
  const n = String(name || '').toLowerCase();
  if (/site|plot|survey|civil/.test(n)) return 'site/civil';
  if (/struct|framing|truss|beam/.test(n)) return 'structural';
  if (/elect|plumb|mech|hvac|mep/.test(n)) return 'MEP';
  if (/finish|interior|cabinet|floor/.test(n)) return 'finishes';
  if (/permit|revision|addendum/.test(n)) return 'permit/revision';
  return 'general plan';
}

export function analyzeProject(job, board, options) {
  const now = options && options.now;
  const today = isoToday(now);
  const version = Math.max(1, Number(job.version) || 1);
  const { overdue, tentative } = scheduleSignals(job, today);
  const pendingNotes = (Array.isArray(job.pendingNotes) ? job.pendingNotes : []).filter(n => n.status === 'pending');
  const todos = (Array.isArray(job.todos) ? job.todos : []).filter(t => !t.done);
  const boardNotes = (board && Array.isArray(board.notes) ? board.notes : []).filter(n => n.jobId === job.id);
  const unsigned = (Array.isArray(job.changeOrders) ? job.changeOrders : []).filter(co => co.status === 'sent' && !co.signedAt);
  const unverified = [];
  for (const item of ((job.estimate && job.estimate.items) || [])) {
    for (const line of (item.costLines || [])) {
      if (line.verified === false) unverified.push({ item: item.name, line: line.desc || line.id });
    }
  }

  const briefItems = [];
  if (overdue.length) briefItems.push(overdue.length + ' schedule task' + (overdue.length === 1 ? ' is' : 's are') + ' overdue');
  if (tentative.length) briefItems.push(tentative.length + ' near-term date' + (tentative.length === 1 ? ' needs' : 's need') + ' subcontractor confirmation');
  if (pendingNotes.length) briefItems.push(pendingNotes.length + ' field note' + (pendingNotes.length === 1 ? ' needs' : 's need') + ' office review');
  if (unsigned.length) briefItems.push(unsigned.length + ' change order' + (unsigned.length === 1 ? ' is' : 's are') + ' awaiting signature');
  if (unverified.length) briefItems.push(unverified.length + ' estimate price' + (unverified.length === 1 ? ' is' : 's are') + ' unverified');
  if (!briefItems.length) briefItems.push('No urgent exceptions found');

  const proposals = [];
  for (const r of overdue.slice(0, 8)) {
    proposals.push(proposal(
      'schedule-risk',
      'Resolve overdue task: ' + cleanTask(r.task),
      'Scheduled through ' + r.finish + ' and still marked ' + (r.status || 'not complete') + '.',
      null,
      version,
      { scheduleTaskId: r.id }
    ));
  }
  for (const r of tentative.slice(0, 8)) {
    proposals.push(proposal(
      'schedule-risk',
      'Confirm near-term date: ' + cleanTask(r.task),
      'Starts ' + r.start + ' but the date is not marked firm with the subcontractor.',
      null,
      version,
      { scheduleTaskId: r.id }
    ));
  }
  for (const n of pendingNotes.slice(0, 10)) {
    proposals.push(proposal(
      'field-task',
      'Turn field note into a tracked task',
      String(n.text || '').slice(0, 500),
      { type: 'add-todo', text: String(n.text || '').slice(0, 500), sourceId: n.id },
      version,
      { pendingNoteId: n.id }
    ));
  }
  for (const n of pendingNotes.filter(n => n.target === 'estimate' || n.target === 'draws').slice(0, 5)) {
    proposals.push(proposal(
      'change-order',
      'Draft a change order from field scope',
      String(n.text || '').slice(0, 800),
      { type: 'draft-change-order', title: 'Field scope change', desc: String(n.text || '').slice(0, 2000), amount: 0, days: 0, sourceId: n.id },
      version,
      { pendingNoteId: n.id }
    ));
  }
  for (const p of (Array.isArray(job.plans) ? job.plans : []).slice(0, 20)) {
    proposals.push(proposal(
      'plan-intake',
      'Classify ' + String(p.name || 'uploaded file'),
      'Suggested filing category: ' + fileKind(p.name) + '. Review before using it for takeoff.',
      null,
      version,
      { fileId: p.id, category: fileKind(p.name) }
    ));
  }
  if (unverified.length) {
    proposals.push(proposal(
      'estimate-review',
      'Verify estimate pricing',
      unverified.slice(0, 8).map(x => x.item + ': ' + x.line).join('; '),
      null,
      version,
      { count: unverified.length }
    ));
  }

  const nextTasks = (Array.isArray(job.schedule) ? job.schedule : [])
    .filter(r => r.status !== 'Complete' && r.start)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .slice(0, 4)
    .map(r => cleanTask(r.task));
  const customerDraft = [
    'This week on ' + job.name + ':',
    nextTasks.length ? 'Upcoming work includes ' + nextTasks.join(', ') + '.' : 'The schedule currently has no upcoming dated tasks.',
    overdue.length ? 'We are actively resolving ' + overdue.length + ' schedule item' + (overdue.length === 1 ? '' : 's') + '.' : 'No overdue schedule items are showing.',
    'Please contact the Ridgeline team with any questions.'
  ].join(' ');
  proposals.push(proposal(
    'customer-update',
    'Draft weekly customer update',
    customerDraft,
    null,
    version,
    { generatedFrom: 'schedule' }
  ));

  return {
    generatedAt: Date.now(),
    jobId: job.id,
    jobName: job.name,
    brief: {
      headline: briefItems[0],
      items: briefItems.slice(0, 6),
      counts: {
        overdue: overdue.length,
        tentative: tentative.length,
        pendingNotes: pendingNotes.length,
        openTodos: todos.length + boardNotes.length,
        unsignedChangeOrders: unsigned.length,
        unverifiedPrices: unverified.length
      }
    },
    proposals
  };
}

export function applyProposal(job, item) {
  if (!item || !item.action) return { changed: false, job };
  if (item.action.type === 'add-todo') {
    job.todos = Array.isArray(job.todos) ? job.todos : [];
    if (!job.todos.some(t => t.agentSourceId === item.action.sourceId)) {
      job.todos.push({
        id: crypto.randomUUID(),
        text: String(item.action.text || '').slice(0, 500),
        done: false,
        agentSourceId: item.action.sourceId
      });
      return { changed: true, job };
    }
  }
  if (item.action.type === 'draft-change-order') {
    job.changeOrders = Array.isArray(job.changeOrders) ? job.changeOrders : [];
    if (!job.changeOrders.some(co => co.agentSourceId === item.action.sourceId)) {
      job.changeOrders.push({
        id: crypto.randomUUID(),
        no: job.changeOrders.length + 1,
        title: String(item.action.title || 'Proposed change').slice(0, 200),
        desc: String(item.action.desc || '').slice(0, 4000),
        amount: Math.round((Number(item.action.amount) || 0) * 100) / 100,
        days: Math.round(Number(item.action.days) || 0),
        status: 'draft',
        createdAt: Date.now(),
        agentSourceId: item.action.sourceId
      });
      return { changed: true, job };
    }
  }
  return { changed: false, job };
}
