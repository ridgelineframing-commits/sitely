// Schedule engine + built-in templates for the Functions/MCP side. This mirrors the browser
// engine in public/keystone.js so the MCP can build a job's schedule from a template. The task
// arrays and generators are kept byte-for-byte in sync with keystone.js by
// test/schedule-engine-parity.test.mjs — if you change one, change the other.

export function addWorkDays(date, n) {
  const d = new Date(date.getTime());
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  let left = n;
  while (left > 0) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--; }
  return d;
}
export function subWorkDays(date, n) {
  const d = new Date(date.getTime());
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  let left = n;
  while (left > 0) { d.setUTCDate(d.getUTCDate() - 1); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--; }
  return d;
}
function iso(d) { return d.toISOString().slice(0, 10); }

// Compute dated rows from a task-def list + anchor (multi-pass to resolve forward refs).
export function computeSchedule(defs, permitReadyISO) {
  const anchor = new Date(permitReadyISO + 'T00:00:00Z');
  const fin = {}, start = {};
  let pass = 0, unresolved = defs.slice();
  while (unresolved.length && pass < defs.length + 2) {
    pass++;
    unresolved = unresolved.filter(t => {
      let s;
      if (t.fixed) {
        s = new Date(t.fixed + 'T00:00:00Z');
        if (isNaN(s)) s = addWorkDays(anchor, t.off || 0);
      } else if (t.pred && fin[t.pred] === undefined) {
        if (defs.find(x => x.id === t.pred)) return true;
        s = addWorkDays(anchor, t.off || 0);
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
  for (const t of unresolved) {
    start[t.id] = addWorkDays(anchor, t.off || 0);
    fin[t.id] = addWorkDays(start[t.id], Math.max(0, (t.days || 1) - 1));
  }
  return defs.map(t => ({
    id: t.id, task: t.name, group: t.group, codes: [],
    off: t.off || 0, days: t.days, pred: t.pred || null, lag: t.lag || 0,
    start: iso(start[t.id]), finish: iso(fin[t.id]),
    status: t.status || 'Not Started', pct: t.pct || 0,
    note: t.note || undefined, fixed: t.fixed || undefined
  }));
}

export function templateGroups(tasks) {
  const seen = new Set(), out = [];
  for (const t of (tasks || [])) { const g = t.group || 'Tasks'; if (!seen.has(g)) { seen.add(g); out.push(g); } }
  return out;
}
export function filterTemplateByGroups(tasks, keep) {
  const byId = {}; for (const t of tasks) byId[t.id] = t;
  const survives = t => keep.has(t.group || 'Tasks');
  const nearestKeptPred = (t) => {
    let p = t.pred; const guard = new Set();
    while (p && byId[p] && !guard.has(p)) { guard.add(p); if (survives(byId[p])) return p; p = byId[p].pred; }
    return null;
  };
  return tasks.filter(survives).map(t => Object.assign({}, t, { pred: nearestKeptPred(t) }));
}

// ---- built-in templates (mirror of keystone.js) ----
const LONG_BUILD_TASKS = [
  ['b1', 'Permits issued', 'Call locates', null, 1, 0],
  ['b2', 'Permits issued', 'Water / power fees & applications', null, 1, 0],
  ['b3', 'Excavation', 'Clearing & road build', 'b1', 4, 1],
  ['b4', 'Excavation', 'Cut / rough grade for foundation', 'b3', 4, 1],
  ['b5', 'Well drilling/install', 'Well permit & locate', 'b1', 1, 0],
  ['b6', 'Well drilling/install', 'Drill well', 'b5', 5, 2],
  ['b7', 'Well drilling/install', 'Set pump & pressure tank', 'b6', 2, 1],
  ['b8', 'Well drilling/install', 'Waterline trench to house', 'b7', 2, 0],
  ['b9', 'Well drilling/install', 'Well flow & potability test', 'b8', 1, 2],
  ['b10', 'Septic', 'Perc test & soil evaluation', 'b1', 2, 0],
  ['b11', 'Septic', 'Septic design & permit', 'b10', 3, 6],
  ['b12', 'Septic', 'Excavate & set tank', 'b11', 2, 1],
  ['b13', 'Septic', 'Drain / leach field install', 'b12', 4, 1],
  ['b14', 'Septic', 'Backfill & septic inspection', 'b13', 2, 1],
  ['b15', 'Foundation', 'Footings', 'b4', 3, 1],
  ['b16', 'Foundation', 'Stem / foundation walls', 'b15', 4, 1],
  ['b17', 'Foundation', 'Foundation inspection & strip', 'b16', 1, 1],
  ['b18', 'Backfill', 'Waterproof & perimeter drains', 'b17', 2, 0],
  ['b19', 'Backfill', 'Backfill & compact', 'b18', 2, 1],
  ['b20', 'Backfill', 'Under-slab plumbing', 'b19', 2, 0],
  ['b21', 'Backfill', 'Slab / basement floor', 'b20', 3, 1],
  ['b22', 'Construction', 'Lumber delivery', 'b21', 1, 2],
  ['b23', 'Construction', 'Frame floor system', 'b22', 3, 0],
  ['b24', 'Construction', 'Frame walls', 'b23', 6, 0],
  ['b25', 'Construction', 'Frame roof / trusses', 'b24', 5, 0],
  ['b26', 'Construction', 'Sheathing & dry-in', 'b25', 3, 0],
  ['b27', 'Construction', 'Frame / shear inspection', 'b26', 1, 1],
  ['b28', 'Roofing', 'Roofing delivery', 'b26', 1, 0],
  ['b29', 'Roofing', 'Roofing install', 'b28', 4, 1],
  ['b30', 'Rough-in Installations', 'Plumbing rough-in', 'b27', 5, 1],
  ['b31', 'Rough-in Installations', 'HVAC rough-in', 'b30', 5, 1],
  ['b32', 'Rough-in Installations', 'Electrical rough-in', 'b31', 5, 1],
  ['b33', 'Rough-in Installations', 'Fireplace / gas line', 'b31', 2, 0],
  ['b34', 'Rough-in Installations', 'Low-voltage / security', 'b32', 2, 0],
  ['b35', 'Rough-in Installations', 'Rough-in inspections', 'b32', 2, 1],
  ['b36', 'Windows, Doors & Siding', 'Windows & exterior doors', 'b26', 3, 1],
  ['b37', 'Windows, Doors & Siding', 'House wrap / weather barrier', 'b36', 2, 0],
  ['b38', 'Windows, Doors & Siding', 'Siding delivery', 'b29', 1, 0],
  ['b39', 'Windows, Doors & Siding', 'Siding install', 'b38', 8, 1],
  ['b40', 'Exterior stone', 'Stone material delivery', 'b37', 1, 1],
  ['b41', 'Exterior stone', 'Lath & scratch coat', 'b40', 3, 1],
  ['b42', 'Exterior stone', 'Exterior stone veneer install', 'b41', 6, 1],
  ['b43', 'Exterior stone', 'Grout, point & seal', 'b42', 2, 1],
  ['b44', 'Exterior finishes', 'Exterior paint', 'b39', 4, 1],
  ['b45', 'Insulation', 'Insulate walls & vaults', 'b35', 3, 1],
  ['b46', 'Insulation', 'Insulation inspection', 'b45', 1, 1],
  ['b47', 'Sheetrock', 'Drywall stock', 'b46', 1, 0],
  ['b48', 'Sheetrock', 'Hang drywall', 'b47', 4, 0],
  ['b49', 'Sheetrock', 'Nail / screw inspection', 'b48', 1, 1],
  ['b50', 'Sheetrock', 'Tape, mud & texture', 'b49', 7, 1],
  ['b51', 'Interior Paint', 'Prime & paint walls / ceilings', 'b50', 5, 2],
  ['b52', 'Interior stone', 'Interior stone / tile prep', 'b51', 2, 1],
  ['b53', 'Interior stone', 'Fireplace stone surround', 'b52', 3, 1],
  ['b54', 'Interior stone', 'Feature wall / interior stone install', 'b53', 3, 0],
  ['b55', 'Interior stone', 'Seal & clean interior stone', 'b54', 1, 1],
  ['b56', 'Cabinets', 'Cabinet delivery', 'b51', 1, 2],
  ['b57', 'Cabinets', 'Cabinet install', 'b56', 3, 0],
  ['b58', 'Countertops', 'Template countertops', 'b57', 1, 1],
  ['b59', 'Countertops', 'Fabricate & install', 'b58', 2, 7],
  ['b60', 'Countertops', 'Backsplash', 'b59', 2, 0],
  ['b61', 'Flooring Install', 'Tile floors & showers', 'b51', 5, 1],
  ['b62', 'Flooring Install', 'Hardwood / laminate', 'b61', 3, 0],
  ['b63', 'Doors/Trim', 'Interior doors & trim delivery', 'b51', 1, 1],
  ['b64', 'Doors/Trim', 'Install doors & trim', 'b63', 4, 0],
  ['b65', 'Doors/Trim', 'Trim paint & touch-up', 'b64', 3, 0],
  ['b66', 'Flooring Install', 'Carpet', 'b65', 2, 0],
  ['b67', 'Plumbing, Electrical, HVAC finish', 'HVAC finish & set equipment', 'b57', 2, 1],
  ['b68', 'Plumbing, Electrical, HVAC finish', 'Electrical trim & fixtures', 'b57', 3, 1],
  ['b69', 'Plumbing, Electrical, HVAC finish', 'Plumbing trim & fixtures', 'b60', 2, 1],
  ['b70', 'Appliances', 'Appliance delivery', 'b57', 1, 0],
  ['b71', 'Appliances', 'Appliance install', 'b70', 1, 1],
  ['b72', 'Bath Accessories', 'Mirrors, glass & accessories', 'b69', 2, 1],
  ['b73', 'Exterior flatwork', 'Driveway & flatwork', 'b44', 4, 1],
  ['b74', 'Exterior flatwork', 'Final grade & landscape', 'b73', 4, 1],
  ['b75', 'Final Touches, last 10%', 'Final clean', 'b65', 2, 1],
  ['b76', 'Final Touches, last 10%', 'QC walk & punch list', 'b75', 2, 0],
  ['b77', 'Final Touches, last 10%', 'Punch-out work', 'b76', 4, 0],
  ['b78', 'Final Touches, last 10%', 'Blower door / energy test', 'b77', 1, 0],
  ['b79', 'Final Touches, last 10%', 'Final inspections — all trades', 'b77', 2, 1],
  ['b80', 'Final Touches, last 10%', 'Certificate of occupancy', 'b79', 1, 1],
  ['b81', 'Final Touches, last 10%', 'Homeowner orientation & closeout', 'b80', 2, 1]
];
const LONG_BUILD_BASE_WD = 124;
export function longBuildTemplate(variant) {
  const target = variant === 150 ? 150 : 180;
  const f = target / LONG_BUILD_BASE_WD;
  const defs = LONG_BUILD_TASKS.map(t => ({
    id: t[0], group: t[1], name: t[2], off: 0, pred: t[3],
    days: Math.max(1, Math.round(t[4] * f)), lag: Math.max(0, Math.round(t[5] * f))
  }));
  const rows = computeSchedule(defs, '2001-01-01');
  let minS = Infinity, maxF = -Infinity, lastId = null;
  for (const r of rows) {
    const s = +new Date(r.start + 'T00:00:00Z'), fi = +new Date(r.finish + 'T00:00:00Z');
    if (s < minS) minS = s;
    if (fi > maxF) { maxF = fi; lastId = r.id; }
  }
  let wd = 0;
  for (let t = minS; t <= maxF; t += 86400000) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) wd++; }
  const deficit = target - wd;
  if (deficit > 0 && lastId) { const last = defs.find(d => d.id === lastId); if (last) last.days += deficit; }
  return defs;
}

const COMMERCIAL_TI_TASKS = [
  ['c1', 'Planning', 'Lease signed / project kickoff', null, 1, 0],
  ['c2', 'Planning', 'Design & cabinet/fixture plans', 'c1', 5, 0],
  ['c3', 'Planning', 'Permitting — Plumbing & TI', 'c2', 4, 0],
  ['c4', 'Construction', 'Wall demo', 'c3', 1, 0],
  ['c5', 'Construction', 'Concrete cutting', 'c4', 1, 0],
  ['c6', 'Construction', 'Underground plumbing', 'c5', 3, 0],
  ['c7', 'Construction', 'Plumbing inspection', 'c6', 1, 0],
  ['c8', 'Construction', 'Concrete patch', 'c7', 2, 0],
  ['c9', 'Construction', 'HVAC / refrigeration', 'c8', 3, 0],
  ['c10', 'Construction', 'Roof penetrations', 'c8', 1, 0],
  ['c11', 'Construction', 'HVAC inspection', 'c9', 1, 0],
  ['c12', 'Construction', 'Rough electrical', 'c8', 5, 0],
  ['c13', 'Construction', 'Electrical inspection', 'c12', 1, 0],
  ['c14', 'Construction', 'Building inspection (cover)', 'c13', 1, 1],
  ['c15', 'Construction', 'Drywall', 'c14', 5, 0],
  ['c16', 'Construction', 'Cabinet install', 'c15', 2, 0],
  ['c17', 'Construction', 'Countertop template', 'c16', 1, 0],
  ['c18', 'Construction', 'Countertop install', 'c17', 1, 3],
  ['c19', 'Construction', 'Tile', 'c16', 4, 0],
  ['c20', 'Construction', 'Interior paint', 'c15', 2, 0],
  ['c21', 'Construction', 'Floor stain / polish', 'c19', 3, 0],
  ['c22', 'Construction', 'Plumbing trim-out', 'c18', 1, 0],
  ['c23', 'Construction', 'Equipment install', 'c18', 2, 0],
  ['c24', 'Construction', 'Electrical trim-out', 'c18', 2, 0],
  ['c25', 'Final inspections', 'Final cleaning', 'c21', 1, 0],
  ['c26', 'Final inspections', 'Plumbing final', 'c25', 1, 0],
  ['c27', 'Final inspections', 'Electrical final', 'c26', 1, 0],
  ['c28', 'Final inspections', 'Fire final', 'c27', 1, 0],
  ['c29', 'Final inspections', 'Building final', 'c28', 1, 0],
  ['c30', 'Final inspections', 'Punch list & closeout', 'c29', 3, 0],
  ['c31', 'Final inspections', 'Final walkthrough & handover', 'c30', 2, 0]
];
export function commercialTITemplate() {
  return COMMERCIAL_TI_TASKS.map(t => ({ id: t[0], group: t[1], name: t[2], off: 0, pred: t[3], days: t[4], lag: t[5] }));
}

// Resolve a template reference (id, name, or 'main') to its task defs against a catalog document.
export function templateDefsFor(catalog, ref) {
  const r = String(ref == null ? 'main' : ref).trim();
  const low = r.toLowerCase();
  const list = (catalog && catalog.schedTemplates) || [];
  const hit = list.find(x => x.id === r || String(x.name || '').toLowerCase() === low);
  if (hit && Array.isArray(hit.tasks) && hit.tasks.length) return hit.tasks;
  if (low === 'main' || low === 'main template' || low === '★ main template') return (catalog && catalog.scheduleTemplate) || null;
  if (r === 'build_150' || low === 'ridgeline 150-day build' || low === '150' || low === '150-day') return longBuildTemplate(150);
  if (r === 'build_180' || low === 'ridgeline 180-day build' || low === '180' || low === '180-day') return longBuildTemplate(180);
  if (r === 'commercial_ti' || low === 'commercial ti' || low === 'commercial') return commercialTITemplate();
  return null;
}
