// Sitely MCP server (Model Context Protocol, stateless Streamable-HTTP / JSON-RPC).
// URL:  /mcp/<token>   where <token> === KV 'mcptoken' (minted by GET /api/mcp-token, admin only).
// Lets Claude (desktop or phone, via a custom connector) manage Sitely end-to-end.
//
// This route lives OUTSIDE /api, so the /api Bearer middleware does not apply — the
// secret in the URL path is the credential (same model as the calendar feed).
import { estContractTotal, scheduleProgress } from '../api/_lib.js';

const PROTO = '2025-06-18';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version'
};
const JH = Object.assign({ 'Content-Type': 'application/json' }, CORS);
const ok = (id, result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: JH });
const rerr = (id, code, message, status) => new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), { status: status || 200, headers: JH });

const JOB_STATUSES = ['active', 'prospect', 'warranty', 'archive'];
const TASK_STATUSES = ['Not Started', 'In Progress', 'Complete', 'On Hold'];
const DRAW_STATUSES = ['UPCOMING', 'INVOICED', 'PAID'];
const nid = (p) => p + '-' + crypto.randomUUID().slice(0, 8);
const money = n => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toFrac = v => { const n = Number(v); if (!isFinite(n)) return 0; return n > 1 ? n / 100 : n; }; // 15 -> .15, 0.15 -> .15
const cap = (v, n) => String(v == null ? '' : v).slice(0, n); // clamp untrusted free-text length
const MAX_JOBS = 2000; // guard against a runaway create_job loop bloating jobs:index
function tsEqual(a, b) { // constant-time string compare for the connector token
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function getIndex(env) {
  const raw = await env.RIDGELINE_KV.get('jobs:index');
  try { return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}
async function loadJob(env, id) {
  const raw = await env.RIDGELINE_KV.get('job:' + String(id || ''));
  return raw ? JSON.parse(raw) : null;
}
async function saveJob(env, job) {
  job.updatedAt = Date.now();
  await env.RIDGELINE_KV.put('job:' + job.id, JSON.stringify(job));
  const index = await getIndex(env);
  const editCount = (job.estimate && Array.isArray(job.estimate.items)) ? job.estimate.items.length : 0;
  const m = index.find(x => x.id === job.id);
  if (m) { m.name = job.name; m.status = job.status || 'active'; m.updatedAt = job.updatedAt; m.editCount = editCount; }
  else index.push({ id: job.id, name: job.name, status: job.status || 'active', updatedAt: job.updatedAt, editCount });
  await env.RIDGELINE_KV.put('jobs:index', JSON.stringify(index));
}
function ensureEst(job) {
  if (!job.estimate) job.estimate = { settings: { defaultMarkupPct: 0.15, salesTaxPct: 0.079 }, categories: [], items: [], exclusions: [] };
  const e = job.estimate;
  if (!e.settings) e.settings = { defaultMarkupPct: 0.15, salesTaxPct: 0.079 };
  if (!Array.isArray(e.categories)) e.categories = [];
  if (!Array.isArray(e.items)) e.items = [];
  return e;
}
function findItem(est, itemId) { return est.items.find(i => i.id === itemId || i.code === itemId || i.name === itemId); }
function catFor(est, ref) {
  if (!ref) return est.categories[0] || null;
  return est.categories.find(c => c.id === ref || c.code === ref || (c.name || '').toLowerCase() === String(ref).toLowerCase()) || null;
}

// ---- tool definitions ----
const S = (props, req) => ({ type: 'object', properties: props, required: req || [] });
const str = (d) => ({ type: 'string', description: d });
const numf = (d) => ({ type: 'number', description: d });
const boolf = (d) => ({ type: 'boolean', description: d });

const TOOLS = [
  // Jobs
  { name: 'create_job', description: 'Create a new job/project. Use for "add/create/start a job". Returns the id.', inputSchema: S({ name: str('Job / project name'), status: { type: 'string', enum: JOB_STATUSES, description: 'defaults to active' } }, ['name']) },
  { name: 'list_jobs', description: 'List all jobs (name, status, id, last updated).', inputSchema: S({ status: { type: 'string', enum: JOB_STATUSES, description: 'optional filter' } }) },
  { name: 'get_job', description: 'Full summary of one job: status, customer, estimate total, schedule progress, counts. Accepts id OR name.', inputSchema: S({ job: str('job id or name') }, ['job']) },
  { name: 'rename_job', description: 'Rename a job.', inputSchema: S({ job: str('job id or name'), name: str('new name') }, ['job', 'name']) },
  { name: 'set_job_status', description: 'Change a job status (active, prospect, warranty, archive).', inputSchema: S({ job: str('job id or name'), status: { type: 'string', enum: JOB_STATUSES } }, ['job', 'status']) },
  { name: 'delete_job', description: 'Permanently delete a job. Ask the user to confirm first.', inputSchema: S({ job: str('job id or name'), confirm: boolf('must be true to delete') }, ['job', 'confirm']) },
  // Customer
  { name: 'get_customer', description: "Get a job's customer contact info.", inputSchema: S({ job: str('job id or name') }, ['job']) },
  { name: 'set_customer', description: "Set/update a job's customer contact (only provided fields change).", inputSchema: S({ job: str('job id or name'), name: str(''), phone: str(''), address: str(''), email: str('') }, ['job']) },
  // Estimate structure
  { name: 'get_estimate', description: 'List the estimate: categories, items (with per-item totals), and grand total.', inputSchema: S({ job: str('job id or name') }, ['job']) },
  { name: 'seed_estimate_from_catalog', description: "Fill a job's estimate from the master catalog. mode 'full' copies all items, 'blank' clears it.", inputSchema: S({ job: str('job id or name'), mode: { type: 'string', enum: ['full', 'blank'] } }, ['job']) },
  { name: 'add_category', description: 'Add an estimate category (cost-code group).', inputSchema: S({ job: str('job id or name'), code: str('e.g. 0600'), name: str('e.g. Framing') }, ['job', 'name']) },
  { name: 'add_item', description: 'Add a line item to the estimate under a category (created if missing).', inputSchema: S({ job: str('job id or name'), name: str('item name'), category: str('category code or name; defaults to first'), code: str('item cost code'), allowance: boolf('is this an allowance') }, ['job', 'name']) },
  { name: 'rename_item', description: 'Rename an item and/or change its code.', inputSchema: S({ job: str('job id or name'), item: str('item id, code, or name'), name: str('new name'), code: str('new code') }, ['job', 'item']) },
  { name: 'set_item_flags', description: 'Mark an item as allowance and/or excluded from contract.', inputSchema: S({ job: str('job id or name'), item: str('item id/code/name'), allowance: boolf(''), excluded: boolf('') }, ['job', 'item']) },
  { name: 'set_item_spec', description: "Set an item's specification text (shown in the customer packet).", inputSchema: S({ job: str('job id or name'), item: str('item id/code/name'), spec_text: str('') }, ['job', 'item', 'spec_text']) },
  { name: 'delete_item', description: 'Delete an item from the estimate.', inputSchema: S({ job: str('job id or name'), item: str('item id/code/name') }, ['job', 'item']) },
  // Cost lines + pricing
  { name: 'add_cost_line', description: 'Add a cost line to an item (qty x unit cost). markup_pct/taxable optional.', inputSchema: S({ job: str('job id or name'), item: str('item id/code/name'), desc: str('line description'), qty: numf('quantity'), unit: str('e.g. EA, LF, SF, LS'), unit_cost: numf('cost per unit'), markup_pct: numf('percent, e.g. 15; omit to inherit the job markup'), taxable: boolf('') }, ['job', 'item', 'unit_cost']) },
  { name: 'update_cost_line', description: 'Update fields on a cost line (only provided fields change).', inputSchema: S({ job: str('job id or name'), item: str('item id/code/name'), line_id: str('cost line id'), desc: str(''), qty: numf(''), unit: str(''), unit_cost: numf(''), markup_pct: numf('percent, e.g. 15'), taxable: boolf('') }, ['job', 'item', 'line_id']) },
  { name: 'delete_cost_line', description: 'Delete a cost line from an item.', inputSchema: S({ job: str('job id or name'), item: str('item id/code/name'), line_id: str('') }, ['job', 'item', 'line_id']) },
  { name: 'set_markup', description: 'Set the job-wide markup %; applies to every cost line. e.g. 15 for 15%.', inputSchema: S({ job: str('job id or name'), markup_pct: numf('percent, e.g. 15') }, ['job', 'markup_pct']) },
  { name: 'set_tax', description: 'Set the job-wide sales tax %; marks every line taxable. e.g. 7.9 for 7.9%.', inputSchema: S({ job: str('job id or name'), tax_pct: numf('percent, e.g. 7.9') }, ['job', 'tax_pct']) },
  { name: 'get_estimate_total', description: 'Cost / markup / tax / contract-total breakdown for a job.', inputSchema: S({ job: str('job id or name') }, ['job']) },
  // Schedule
  { name: 'get_schedule', description: "List a job's schedule tasks with status and %.", inputSchema: S({ job: str('job id or name') }, ['job']) },
  { name: 'add_schedule_task', description: 'Add a schedule task. Dates are YYYY-MM-DD.', inputSchema: S({ job: str('job id or name'), task: str('task name'), start: str('YYYY-MM-DD'), finish: str('YYYY-MM-DD'), status: { type: 'string', enum: TASK_STATUSES }, group: str('phase/group') }, ['job', 'task']) },
  { name: 'update_schedule_task', description: 'Update a schedule task (status, %, dates).', inputSchema: S({ job: str('job id or name'), task: str('task id or name'), status: { type: 'string', enum: TASK_STATUSES }, pct: numf('0-100'), start: str('YYYY-MM-DD'), finish: str('YYYY-MM-DD') }, ['job', 'task']) },
  { name: 'delete_schedule_task', description: 'Delete a schedule task.', inputSchema: S({ job: str('job id or name'), task: str('task id or name') }, ['job', 'task']) },
  // Draws
  { name: 'get_draws', description: "List a job's draw schedule (name, %, status, $ of contract).", inputSchema: S({ job: str('job id or name') }, ['job']) },
  { name: 'add_draw', description: 'Add a draw (name, % of contract).', inputSchema: S({ job: str('job id or name'), name: str(''), pct: numf('percent of contract, e.g. 10'), status: { type: 'string', enum: DRAW_STATUSES } }, ['job', 'name', 'pct']) },
  { name: 'update_draw', description: 'Update a draw by its number (status, %, name).', inputSchema: S({ job: str('job id or name'), no: numf('draw number'), status: { type: 'string', enum: DRAW_STATUSES }, pct: numf('percent'), name: str('') }, ['job', 'no']) },

  // Files (a job's Plans folder)
  { name: 'list_files', description: "List the files in a job's Plans folder (name, size, type, id).", inputSchema: S({ job: str('job id or name') }, ['job']) },
  { name: 'upload_file', description: "Upload a file (plan, PDF, photo, doc) into a job's Plans folder. Provide the file bytes base64-encoded in content_base64 (a data: URL is also accepted). ~20MB max over MCP — use the web app for larger files.", inputSchema: S({ job: str('job id or name'), filename: str('file name including extension, e.g. site-plan.pdf'), content_base64: str('the file contents, base64-encoded'), content_type: str('MIME type e.g. application/pdf or image/jpeg; optional, guessed from the extension if omitted') }, ['job', 'filename', 'content_base64']) },

  // Whiteboard (the shared company capture board — staff only, never customers)
  { name: 'get_board', description: 'List the notes on the shared company Whiteboard (text or checklist, job assignment, due date, id).', inputSchema: S({}) },
  { name: 'add_board_note', description: 'Put a note on the shared company Whiteboard. Pass text for a plain note and/or checklist (a list of to-do items). Optionally assign it to a job with a due_date — that also pins a single-day task on that job’s schedule so it hits the feed (same as dragging a note onto a job in the app).', inputSchema: S({ text: str('the note text'), checklist: { type: 'array', items: { type: 'string' }, description: 'to-do items — makes this a checklist note' }, job: str('optional job id or name to assign the note to'), due_date: str('optional due date YYYY-MM-DD (only used together with job)') }) },
  { name: 'delete_board_note', description: 'Remove a note from the shared company Whiteboard by its id (from get_board).', inputSchema: S({ note_id: str('the board note id') }, ['note_id']) }
];

async function resolveJob(env, ref) {
  let job = await loadJob(env, ref);
  if (job) return job;
  const index = await getIndex(env);
  const meta = index.find(j => (j.name || '').toLowerCase() === String(ref || '').toLowerCase());
  return meta ? loadJob(env, meta.id) : null;
}

async function runTool(env, name, a) {
  a = a || {};
  // ---- jobs ----
  if (name === 'create_job') {
    if ((await getIndex(env)).length >= MAX_JOBS) return 'Job limit reached (' + MAX_JOBS + '). Delete or archive jobs before creating more.';
    const jobName = String(a.name || '').trim().slice(0, 120) || 'Untitled Job';
    const status = JOB_STATUSES.indexOf(a.status) >= 0 ? a.status : 'active';
    const job = { id: crypto.randomUUID(), name: jobName, edits: {}, status, updatedAt: Date.now() };
    await saveJob(env, job);
    return 'Created job "' + jobName + '" (' + status + '). id: ' + job.id;
  }
  if (name === 'list_jobs') {
    let index = await getIndex(env);
    index.sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
    if (a.status) index = index.filter(j => (j.status || 'active') === a.status);
    if (!index.length) return 'No jobs.';
    return index.map(j => '• ' + j.name + ' — ' + (j.status || 'active') + '  (id ' + j.id + ')').join('\n');
  }
  const needJob = ['get_job','rename_job','set_job_status','delete_job','get_customer','set_customer','get_estimate','seed_estimate_from_catalog','add_category','add_item','rename_item','set_item_flags','set_item_spec','delete_item','add_cost_line','update_cost_line','delete_cost_line','set_markup','set_tax','get_estimate_total','get_schedule','add_schedule_task','update_schedule_task','delete_schedule_task','get_draws','add_draw','update_draw','list_files','upload_file'];
  let job = null;
  if (needJob.indexOf(name) >= 0) { job = await resolveJob(env, a.job); if (!job) return 'No job found for "' + a.job + '". Use list_jobs to see ids/names.'; }

  if (name === 'get_job') {
    const est = job.estimate; const total = estContractTotal(est);
    const prog = scheduleProgress(job.schedule); const c = job.customer || {};
    const items = est && Array.isArray(est.items) ? est.items.length : 0;
    return [
      job.name + ' — ' + (job.status || 'active') + '  (id ' + job.id + ')',
      'Customer: ' + (c.name || '—') + (c.phone ? ' · ' + c.phone : '') + (c.address ? ' · ' + c.address : ''),
      'Estimate: ' + items + ' items · contract ' + money(total),
      'Schedule: ' + (prog.pct || 0) + '% · ' + (prog.phase || 'not started'),
      'Draws: ' + (Array.isArray(job.draws) ? job.draws.length : 0)
    ].join('\n');
  }
  if (name === 'rename_job') { job.name = String(a.name || '').trim().slice(0, 120) || job.name; await saveJob(env, job); return 'Renamed to "' + job.name + '".'; }
  if (name === 'set_job_status') { if (JOB_STATUSES.indexOf(a.status) < 0) return 'Invalid status.'; job.status = a.status; await saveJob(env, job); return 'Set "' + job.name + '" to ' + a.status + '.'; }
  if (name === 'delete_job') {
    // Reversible by design: over MCP this ARCHIVES the job (data kept) rather than permanently
    // destroying it. A model-supplied confirm=true is not a safe gate for irreversible loss, and
    // stored free-text (customer names, specs) can carry injected instructions. Permanent
    // deletion remains available in the desktop app with a real human confirmation.
    if (job.status === 'archive') return 'Job "' + job.name + '" is already archived. Permanent deletion is only available in the desktop app.';
    job.status = 'archive';
    await saveJob(env, job);
    return 'Archived job "' + job.name + '" (reversible — set it active again anytime). Permanent deletion is desktop-only.';
  }
  // ---- customer ----
  if (name === 'get_customer') { const c = job.customer || {}; return job.name + ' customer:\nName: ' + (c.name || '—') + '\nPhone: ' + (c.phone || '—') + '\nEmail: ' + (c.email || '—') + '\nAddress: ' + (c.address || '—'); }
  if (name === 'set_customer') {
    const c = job.customer || {};
    const CAPS = { name: 120, phone: 40, address: 200, email: 120 };
    ['name', 'phone', 'address', 'email'].forEach(k => { if (a[k] !== undefined && a[k] !== null) c[k] = cap(a[k], CAPS[k]); });
    job.customer = c; await saveJob(env, job);
    return 'Updated customer for "' + job.name + '": ' + (c.name || '—') + (c.phone ? ' · ' + c.phone : '') + (c.email ? ' · ' + c.email : '');
  }
  // ---- estimate structure ----
  if (name === 'get_estimate') {
    const est = ensureEst(job); const lines = [];
    for (const cat of est.categories) {
      const its = est.items.filter(i => i.categoryId === cat.id);
      lines.push((cat.code ? cat.code + ' ' : '') + cat.name);
      for (const it of its) {
        let t = 0; for (const l of (it.costLines || [])) { const mk = l.markupPct != null ? l.markupPct : (est.settings.defaultMarkupPct || 0); const cost = (Number(l.qty) || 0) * (Number(l.unitCost) || 0); const price = cost * (1 + mk); t += price + (l.taxable ? price * (est.settings.salesTaxPct || 0) : 0); }
        lines.push('   ' + (it.code ? it.code + ' ' : '') + it.name + (it.allowance ? ' (allowance)' : '') + (it.excluded ? ' (excluded)' : '') + ' — ' + money(t) + '  [item ' + it.id + ', ' + (it.costLines || []).length + ' lines]');
      }
    }
    const orphan = est.items.filter(i => !est.categories.find(c => c.id === i.categoryId));
    orphan.forEach(it => lines.push('   ' + it.name + '  [item ' + it.id + ']'));
    lines.push('CONTRACT TOTAL: ' + money(estContractTotal(est)));
    return lines.length ? lines.join('\n') : 'Empty estimate.';
  }
  if (name === 'seed_estimate_from_catalog') {
    if (a.mode === 'blank') { job.estimate = { settings: (job.estimate && job.estimate.settings) || { defaultMarkupPct: 0.15, salesTaxPct: 0.079 }, categories: [], items: [], exclusions: [] }; await saveJob(env, job); return 'Cleared the estimate.'; }
    const raw = await env.RIDGELINE_KV.get('catalog'); if (!raw) return 'No catalog found.';
    const cat = JSON.parse(raw);
    job.estimate = { settings: Object.assign({ defaultMarkupPct: 0.15, salesTaxPct: 0.079 }, cat.settings || {}), categories: JSON.parse(JSON.stringify(cat.categories || [])), items: JSON.parse(JSON.stringify(cat.items || [])), exclusions: JSON.parse(JSON.stringify(cat.exclusions || [])) };
    await saveJob(env, job);
    return 'Seeded estimate from catalog: ' + job.estimate.items.length + ' items in ' + job.estimate.categories.length + ' categories.';
  }
  if (name === 'add_category') {
    const est = ensureEst(job);
    if (est.categories.length >= 300) return 'Category limit reached on this job.';
    const c = { id: nid('cat'), code: cap(a.code, 20).trim(), name: cap(a.name, 80).trim() || 'Category', order: est.categories.length };
    est.categories.push(c); await saveJob(env, job);
    return 'Added category "' + c.name + '"' + (c.code ? ' (' + c.code + ')' : '') + '.';
  }
  if (name === 'add_item') {
    const est = ensureEst(job);
    let cat = catFor(est, a.category);
    if (!cat) { cat = { id: nid('cat'), code: String(a.category && /^\d/.test(a.category) ? a.category : '').trim(), name: (a.category && !/^\d+$/.test(a.category)) ? a.category : 'General', order: est.categories.length }; est.categories.push(cat); }
    if (est.items.length >= 2000) return 'Item limit reached on this job.';
    const it = { id: nid('item'), code: cap(a.code, 40).trim(), categoryId: cat.id, name: cap(a.name, 120).trim() || 'New item', type: 'spec', allowance: !!a.allowance, excluded: false, specText: '', costLines: [], order: est.items.length };
    est.items.push(it); await saveJob(env, job);
    return 'Added item "' + it.name + '" under ' + cat.name + '. item id: ' + it.id;
  }
  if (['rename_item','set_item_flags','set_item_spec','delete_item','add_cost_line','update_cost_line','delete_cost_line'].indexOf(name) >= 0) {
    const est = ensureEst(job); const it = findItem(est, a.item);
    if (!it) return 'No item "' + a.item + '" in this estimate. Use get_estimate for ids.';
    if (name === 'rename_item') { if (a.name != null) it.name = cap(a.name, 120).trim() || it.name; if (a.code != null) it.code = cap(a.code, 40).trim(); await saveJob(env, job); return 'Item now: ' + (it.code ? it.code + ' ' : '') + it.name; }
    if (name === 'set_item_flags') { if (a.allowance != null) it.allowance = !!a.allowance; if (a.excluded != null) it.excluded = !!a.excluded; await saveJob(env, job); return 'Updated "' + it.name + '": allowance=' + !!it.allowance + ', excluded=' + !!it.excluded; }
    if (name === 'set_item_spec') { it.specText = cap(a.spec_text, 4000); await saveJob(env, job); return 'Set spec text for "' + it.name + '".'; }
    if (name === 'delete_item') { est.items = est.items.filter(x => x !== it); await saveJob(env, job); return 'Deleted item "' + it.name + '".'; }
    if (!Array.isArray(it.costLines)) it.costLines = [];
    if (name === 'add_cost_line') {
      if (it.costLines.length >= 500) return 'Cost-line limit reached on this item.';
      const l = { id: nid('cl'), desc: cap(a.desc, 300), qty: Number(a.qty) || 1, unit: cap(a.unit || 'LS', 20), unitCost: Number(a.unit_cost) || 0, markupPct: a.markup_pct != null ? toFrac(a.markup_pct) : null, taxable: !!a.taxable };
      it.costLines.push(l); await saveJob(env, job);
      return 'Added cost line to "' + it.name + '": ' + (l.desc || '(no desc)') + ' — ' + l.qty + ' ' + l.unit + ' @ ' + money(l.unitCost) + '. line id: ' + l.id;
    }
    const line = it.costLines.find(l => l.id === a.line_id);
    if (!line) return 'No cost line "' + a.line_id + '" on "' + it.name + '".';
    if (name === 'update_cost_line') {
      if (a.desc != null) line.desc = cap(a.desc, 300);
      if (a.qty != null) line.qty = Number(a.qty) || 0;
      if (a.unit != null) line.unit = cap(a.unit, 20);
      if (a.unit_cost != null) line.unitCost = Number(a.unit_cost) || 0;
      if (a.markup_pct != null) line.markupPct = toFrac(a.markup_pct);
      if (a.taxable != null) line.taxable = !!a.taxable;
      await saveJob(env, job); return 'Updated cost line on "' + it.name + '".';
    }
    if (name === 'delete_cost_line') { it.costLines = it.costLines.filter(l => l !== line); await saveJob(env, job); return 'Deleted cost line from "' + it.name + '".'; }
  }
  // Default markup/tax only — do NOT overwrite per-line markup overrides or force every line
  // taxable (that silently rewrites the contract total; taxability is a per-line flag).
  if (name === 'set_markup') { const est = ensureEst(job); est.settings.defaultMarkupPct = toFrac(a.markup_pct); await saveJob(env, job); return 'Default markup set to ' + (est.settings.defaultMarkupPct * 100).toFixed(1) + '% (applies to lines without their own markup). New total: ' + money(estContractTotal(est)); }
  if (name === 'set_tax') { const est = ensureEst(job); est.settings.salesTaxPct = toFrac(a.tax_pct); await saveJob(env, job); return 'Sales tax set to ' + (est.settings.salesTaxPct * 100).toFixed(2) + '% (applies to lines marked taxable). New total: ' + money(estContractTotal(est)); }
  if (name === 'get_estimate_total') {
    const est = ensureEst(job); let cost = 0, price = 0, tax = 0;
    for (const it of est.items) { if (it.excluded) continue; for (const l of (it.costLines || [])) { const c = (Number(l.qty) || 0) * (Number(l.unitCost) || 0); const mk = l.markupPct != null ? l.markupPct : (est.settings.defaultMarkupPct || 0); const p = c * (1 + mk); cost += c; price += p; tax += l.taxable ? p * (est.settings.salesTaxPct || 0) : 0; } }
    return job.name + ':\nCost ' + money(cost) + '\nAfter markup ' + money(price) + '\nTax ' + money(tax) + '\nCONTRACT TOTAL ' + money(price + tax);
  }
  // ---- schedule ----
  if (name === 'get_schedule') {
    const rows = Array.isArray(job.schedule) ? job.schedule : [];
    if (!rows.length) return 'No schedule yet.';
    return rows.map(r => '• ' + r.task + (r.start ? ' [' + r.start + '→' + (r.finish || '?') + ']' : '') + ' — ' + (r.status || 'Not Started') + (r.pct ? ' ' + Math.round((r.pct <= 1 ? r.pct * 100 : r.pct)) + '%' : '') + '  (id ' + r.id + ')').join('\n');
  }
  if (name === 'add_schedule_task') {
    if (!Array.isArray(job.schedule)) job.schedule = [];
    if (job.schedule.length >= 2000) return 'Schedule task limit reached on this job.';
    const t = { id: nid('t'), task: cap(a.task, 200).trim() || 'Task', group: cap(a.group || 'Construction', 80), start: a.start || null, finish: a.finish || null, status: TASK_STATUSES.indexOf(a.status) >= 0 ? a.status : 'Not Started', pct: 0, days: 1, pred: null };
    job.schedule.push(t); await saveJob(env, job);
    return 'Added task "' + t.task + '" (' + t.status + '). id: ' + t.id;
  }
  if (name === 'update_schedule_task' || name === 'delete_schedule_task') {
    const rows = Array.isArray(job.schedule) ? job.schedule : [];
    const t = rows.find(r => r.id === a.task || (r.task || '').toLowerCase() === String(a.task || '').toLowerCase());
    if (!t) return 'No task "' + a.task + '".';
    if (name === 'delete_schedule_task') { job.schedule = rows.filter(r => r !== t); await saveJob(env, job); return 'Deleted task "' + t.task + '".'; }
    if (a.status != null) { if (TASK_STATUSES.indexOf(a.status) < 0) return 'Invalid status.'; t.status = a.status; if (a.status === 'Complete') t.pct = 1; }
    if (a.pct != null) t.pct = Number(a.pct) > 1 ? Number(a.pct) / 100 : Number(a.pct);
    if (a.start != null) t.start = a.start;
    if (a.finish != null) t.finish = a.finish;
    await saveJob(env, job); return 'Updated task "' + t.task + '" — ' + (t.status || 'Not Started') + '.';
  }
  // ---- draws ----
  if (name === 'get_draws') {
    const draws = Array.isArray(job.draws) ? job.draws : [];
    if (!draws.length) return 'No draws yet.';
    const contract = estContractTotal(job.estimate);
    return draws.map(d => '#' + d.no + ' ' + d.name + ' — ' + (Number(d.pct) || 0) + '% (' + money(contract * (Number(d.pct) || 0) / 100) + ') · ' + (d.status || 'UPCOMING')).join('\n');
  }
  if (name === 'add_draw') {
    if (!Array.isArray(job.draws)) job.draws = [];
    if (job.draws.length >= 200) return 'Draw limit reached on this job.';
    const no = (job.draws.reduce((m, d) => Math.max(m, Number(d.no) || 0), 0)) + 1;
    const d = { no, name: cap(a.name, 120).trim() || ('Draw ' + no), pct: Number(a.pct) || 0, status: DRAW_STATUSES.indexOf(a.status) >= 0 ? a.status : 'UPCOMING' };
    job.draws.push(d); await saveJob(env, job);
    return 'Added draw #' + no + ' "' + d.name + '" (' + d.pct + '%).';
  }
  if (name === 'update_draw') {
    const draws = Array.isArray(job.draws) ? job.draws : [];
    const d = draws.find(x => Number(x.no) === Number(a.no));
    if (!d) return 'No draw #' + a.no + '.';
    if (a.status != null) { if (DRAW_STATUSES.indexOf(a.status) < 0) return 'Invalid status.'; d.status = a.status; }
    if (a.pct != null) d.pct = Number(a.pct);
    if (a.name != null) d.name = cap(a.name, 120);
    await saveJob(env, job); return 'Updated draw #' + d.no + ' — ' + (d.status || 'UPCOMING') + ', ' + (d.pct || 0) + '%.';
  }
  // ---- files (Plans folder) ----
  if (name === 'list_files') {
    const plans = Array.isArray(job.plans) ? job.plans : [];
    if (!plans.length) return job.name + ' has no files in Plans yet.';
    return job.name + ' — ' + plans.length + ' file' + (plans.length === 1 ? '' : 's') + ':\n' +
      plans.map(f => '• ' + f.name + '  (' + Math.max(1, Math.round((Number(f.size) || 0) / 1024)) + ' KB, ' + (f.type || 'file') + ')  id ' + f.id).join('\n');
  }
  if (name === 'upload_file') {
    if (!env.PLANS) return 'File storage is not set up (R2 bucket "ridgeline-plans" missing).';
    if (Array.isArray(job.plans) && job.plans.length >= 500) return 'This job already has 500 files (the max). Remove some in the desktop app first.';
    const b64 = String(a.content_base64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    if (!b64) return 'No file content — pass the bytes base64-encoded in content_base64.';
    let bytes;
    try {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch (e) { return 'content_base64 is not valid base64.'; }
    if (!bytes.length) return 'The decoded file is empty.';
    if (bytes.length > 20 * 1024 * 1024) return 'File is ' + Math.round(bytes.length / 1048576) + 'MB — over the 20MB MCP limit. Upload larger files from the web app (Plans tab).';
    const fname = cap(a.filename || 'file', 200).trim() || 'file';
    const type = cap(a.content_type || guessMime(fname), 100) || 'application/octet-stream';
    const fileId = crypto.randomUUID();
    await env.PLANS.put('plans/' + job.id + '/' + fileId, bytes, { httpMetadata: { contentType: type }, customMetadata: { name: fname } });
    const meta = { id: fileId, name: fname, size: bytes.length, type, uploadedAt: Date.now() };
    job.plans = Array.isArray(job.plans) ? job.plans : [];
    job.plans.push(meta);
    job.updatedAt = Date.now();
    await saveJob(env, job);
    return 'Uploaded "' + fname + '" (' + Math.max(1, Math.round(bytes.length / 1024)) + ' KB) to ' + job.name + "'s Plans. File id " + fileId + '.';
  }
  // ---- whiteboard (shared company capture board) ----
  if (name === 'get_board') {
    const notes = await loadBoard(env);
    if (!notes.length) return 'The Whiteboard is empty.';
    const index = await getIndex(env);
    const jobName = jid => { const m = index.find(j => j.id === jid); return m ? m.name : jid; };
    return notes.map(n => {
      const bits = [];
      if (n.jobId) bits.push('→ ' + jobName(n.jobId));
      if (n.dueDate) bits.push('due ' + n.dueDate);
      if (Array.isArray(n.items) && n.items.length) bits.push(n.items.filter(i => i.done).length + '/' + n.items.length + ' done');
      if (n.by) bits.push('by ' + n.by);
      return '• ' + boardHeadline(n) + (bits.length ? '  (' + bits.join(' · ') + ')' : '') + '  [id ' + n.id + ']';
    }).join('\n');
  }
  if (name === 'add_board_note') {
    const text = cap(a.text, 4000).trim();
    const items = (Array.isArray(a.checklist) ? a.checklist : [])
      .map(t => cap(t, 500).trim()).filter(Boolean).slice(0, 100)
      .map(t => ({ id: crypto.randomUUID().slice(0, 8), text: t, done: false }));
    if (!text && !items.length) return 'Give the note some text or a checklist of items.';
    const notes = await loadBoard(env);
    if (notes.length >= 500) return 'The Whiteboard is full (500 notes). Clear some first.';
    const note = { id: crypto.randomUUID(), text, items: items.length ? items : null, jobId: null, dueDate: null, schedTaskId: null, by: 'Claude', ts: Date.now() };
    let extra = '';
    if (a.job) {
      const j = await resolveJob(env, a.job);
      if (!j) return 'Note not added — no job found for "' + a.job + '". Use list_jobs, or omit job to just add it to the board.';
      note.jobId = j.id;
      const due = /^\d{4}-\d{2}-\d{2}$/.test(a.due_date || '') ? a.due_date : null;
      note.dueDate = due;
      // Mirror the app's drag-to-assign: a due date pins a single-day Whiteboard task on the job schedule.
      if (due) {
        if (!Array.isArray(j.schedule)) j.schedule = [];
        const task = { id: nid('wb'), task: boardHeadline(note), group: 'Whiteboard', codes: [], off: 0, days: 1, pred: null, lag: 0, start: due, finish: due, status: 'Not Started', pct: 0, fixed: due, note: boardFull(note), boardNoteId: note.id };
        j.schedule.push(task);
        note.schedTaskId = task.id;
        await saveJob(env, j);
      }
      extra = ' → ' + j.name + (due ? ' (due ' + due + ', pinned on the schedule)' : '');
    }
    notes.push(note);
    await saveBoard(env, notes);
    return 'Added to the Whiteboard: "' + boardHeadline(note) + '"' + extra + '. id ' + note.id;
  }
  if (name === 'delete_board_note') {
    const notes = await loadBoard(env);
    const n = notes.find(x => x.id === a.note_id);
    if (!n) return 'No board note "' + a.note_id + '". Use get_board for ids.';
    await saveBoard(env, notes.filter(x => x !== n));
    return 'Removed "' + boardHeadline(n) + '" from the Whiteboard.';
  }
  throw new Error('Unknown tool: ' + name);
}

// ---- whiteboard helpers ----
async function loadBoard(env) {
  const raw = await env.RIDGELINE_KV.get('board');
  try { const b = raw ? JSON.parse(raw) : null; return (b && Array.isArray(b.notes)) ? b.notes : []; }
  catch (e) { return []; }
}
async function saveBoard(env, notes) {
  await env.RIDGELINE_KV.put('board', JSON.stringify({ notes: notes.slice(0, 500) }));
}
function boardHeadline(n) {
  const t = String(n.text || '').trim();
  if (t) return t.split('\n')[0].slice(0, 80);
  if (Array.isArray(n.items) && n.items.length) return '☑ To-do (' + n.items.length + ')';
  return 'Board note';
}
function boardFull(n) {
  let t = String(n.text || '').trim();
  if (Array.isArray(n.items) && n.items.length) t += (t ? '\n' : '') + n.items.map(i => (i.done ? '☑ ' : '☐ ') + i.text).join('\n');
  return t;
}

function guessMime(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = m ? m[1] : '';
  const map = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', heic: 'image/heic', svg: 'image/svg+xml', txt: 'text/plain', csv: 'text/csv',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    zip: 'application/zip', dwg: 'application/acad', dxf: 'image/vnd.dxf'
  };
  return map[ext] || 'application/octet-stream';
}

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const seg = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const token = seg[0] || '';
  const expected = await env.RIDGELINE_KV.get('mcptoken');
  if (!expected || !tsEqual(token, expected)) return rerr(null, -32001, 'unauthorized', 401);
  if (request.method !== 'POST') return rerr(null, -32600, 'Use POST (JSON-RPC).', 405);
  let msg;
  try { msg = await request.json(); } catch (e) { return rerr(null, -32700, 'Parse error', 400); }
  const id = msg && msg.id, method = msg && msg.method, p = (msg && msg.params) || {};
  if (method === 'initialize') return ok(id, { protocolVersion: p.protocolVersion || PROTO, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'Sitely', version: '2.2.0' } });
  if (typeof method === 'string' && method.indexOf('notifications/') === 0) return new Response(null, { status: 202, headers: CORS });
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') return ok(id, { tools: TOOLS });
  if (method === 'tools/call') {
    try { const text = await runTool(env, p.name, p.arguments); return ok(id, { content: [{ type: 'text', text }] }); }
    catch (e) { return ok(id, { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }); }
  }
  if (id === undefined || id === null) return new Response(null, { status: 202, headers: CORS });
  return rerr(id, -32601, 'Method not found: ' + method);
}
