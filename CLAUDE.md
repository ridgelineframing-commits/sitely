# Sitely — Ridgeline PM web app (operating rules)

**Sitely** is Ridgeline's project-management web app (estimate, specs, schedule, draws, customer packet). Read this before touching it.

## Where it lives / what to edit
- **Deployed app = `ridgeline-app/public/`** — this is the live code. ALWAYS edit here.
  - `index.html` — page shell + the inline app script (`<script type="text/x-dc" data-dc-script>`) that builds the render context (projectName, packet header, bindings).
  - `keystone.js` — the app logic (views: estimate, catalog, schedule, draws, customer, packet). Most feature work is here.
  - `workbook.js`, `support.js`, `export.js`, `engine.js`, `sync.js` — workbook engine, framework, xlsx export, Cloudflare sync.
  - `logo.jpeg` / `logo.png` — Ridgeline letterhead logo (the real hammer-and-nail mark).
- `keystone-design/` is an OLDER, diverged dev copy — do NOT edit it for production changes; edit `public/`.

## ‼️ STANDING RULE: auto-deploy after EVERY change — never ask
After any edit to `ridgeline-app/public/`, deploy immediately. Do not ask for permission each time; Zac has standing approval to publish Sitely.
- **How:** run `ridgeline-app/deploy.bat` (it runs `npx wrangler pages deploy` from the `ridgeline-app` folder). On Zac's machine wrangler is already logged in (Cloudflare account `Zac@ridgeline.construction`, project `ridgeline-workspace`).
- In a Cowork session the reliable path is computer-use: open File Explorer → `C:\Users\zac\Claude\Projects\xcell redesign to html\ridgeline-app` → double-click `deploy`. The cmd window prints `✨ Deployment complete!` with a `…ridgeline-workspace.pages.dev` URL.
- Live URL: **https://ridgeline-workspace.pages.dev** — tell Zac to hard-refresh (Ctrl+Shift+R); static assets (logo) cache hard.

## Gotcha: OneDrive stale cache on keystone.js
The bash sandbox mount sometimes serves a **stale/truncated** copy of `keystone.js` (it looks cut off mid-file and `node --check` falsely errors). The real file is intact — use the **Read/Edit tools (host-side)** for keystone.js and don't trust bash `node --check` on it. Wrangler deploys the real on-disk file regardless.

## July 2026 restructure (v3 nav)
- Top nav: **Morning sheet · Whiteboard · Customers · Templates · Catalog · Settings**. Customer-file
  submenu (open a job via Customers): Estimate · Schedule · Plans · To-dos · Draws · Packet · Settings
  + small `rough quote` / `worksheets` / `calendar` chips.
- **Whiteboard** = shared company capture board (KV key `board`, endpoint `functions/api/board.js`,
  admin+pm, never customers). Notes drag onto job cards → date dialog → standalone pinned task
  (`id wb_*`, `fixed` date, `note` text) on that job's schedule. Undated assigned notes = nag zone +
  Morning-sheet card + count on the Whiteboard tab. Per-job unscheduled notes show on the To-dos tab.
- Schedule: **Field mode** (done collapsed per group; checkbox/notes/start-date only; date change
  ripples via off/lag + recompute, with undo toast), **Hide completed** toggle, hover **＋**
  insert-between rows. Task rows may carry `note`/`fixed` — preserved through ksRecompute/ksSetPermitReady.
- Allowances: dialog sets `item.allowanceBudget {qty,unit,price}` + synced cost line (flag `l.alw`);
  drives the estimate total; detail prints in packet and shows on portal (portal toggle `showAllowances`).
- Header: CURRENT CUSTOMER (big, left) ↔ sitely logo (small, right). Admin 👁 button previews
  PM/customer views (`state.role` = preview role, `state.realRole` = real role).
- Packet print-CSS bug fixed (`.packet-section{page-break-before:always}` + `min-height:100vh`
  caused blank pages/gaps); side print margins now 1in.
- Multiple schedule templates: `catalog.scheduleTemplate` = MAIN (default for new jobs);
  `catalog.schedTemplates` = [{id,name,tasks}] saved ones (Shop, Commercial TI…), managed under
  Templates → Schedule template (new/copy, rename, make-main-with-backup, delete). New job page has
  a template dropdown. Seed button adds "AI example — Production SFR" (id `ai_sfr`, 73 tasks,
  ~120 workdays, from production-builder phasing + b4ubuild MS Project sample).
- Whiteboard extras: checklist capture = prefilled checkbox rows; ✏ Sketch canvas → PNG note;
  📎/paste photos & PDFs onto notes (unassigned files in R2 `plans/_board/`, endpoint
  `functions/api/board-files/[[path]].js`; on assign/schedule they MOVE into the job's plans and
  the note keeps links). Home tab (renamed from Morning sheet) rotates 20 builder taglines.

## Sitely Field — mobile companion app (`public/field/`)
A **separate, purpose-built mobile PWA** at `ridgeline-app/public/field/` (live at
`https://ridgeline-workspace.pages.dev/field/`), built July 2026 after the desktop UI proved
unfixably dense on phones (small fonts, cramped grids — see git history for the abandoned
mobile-CSS-only attempt on the Estimate view). Scoped to four things Zac actually needs in the
field: **Schedule, Estimate, New job, Whiteboard** — not a full port of Sitely.
- **Files:** `index.html` (dark-theme shell, own CSS — Source Serif 4 + Hanken Grotesk, tokens
  from a Claude-Design handoff Zac supplied), `app.js` (all screens/logic), `manifest.json` (own
  PWA identity "Sitely Field", installs as a separate home-screen icon from desktop Sitely).
  Reuses `../sync.js` as-is (same `/api/*` endpoints, same `rl_token` login session — signing in
  on desktop signs you in here too, same browser).
- **Nav model:** no separate "Jobs" tab — job switching is header-only (tap job name → bottom
  sheet, active jobs shown, prospects collapsed, warranty/archive hidden). "+ New job" lives at
  the bottom of that sheet. Bottom tab bar = Schedule / Estimate / Board only.
- **Schedule:** All/Upcoming/Completed filter chips, phase groups with collapsible completed
  tasks, big checkboxes (status only — Not Started/In Progress/Complete), field notes per task.
  Dates are **read-only** (deliberately not wired to editing) to avoid fighting desktop's
  off/lag + `ksRecompute` ripple logic from a second client.
  - **Estimate — primary function is notes-to-office, not editing.** Read-only totals/category
  breakdown + read-only cost-line detail; tapping a line item opens a "Note to office" box. Notes
  post into the **same `job.pendingNotes` / office-inbox mechanism** desktop already uses
  (`target:'estimate'`, shows up in `officeInboxCard` for Approve/Dismiss) — zero backend schema
  change. The item is identified by **tagging the note text itself** with `[code — name]` (server
  sanitizers for `pendingNotes` only keep `{id,by,target,text,ts,status}`, so there's nowhere else
  to carry an item id) — if an item is renamed, its older notes stop matching by tag.
  - **Board:** same KV-backed whiteboard as desktop (`/api/board`), reskinned dark; no
  sketch/photo/PDF attachments (desktop-only for now).
- **Gotcha — delegated listeners:** `app.js` binds all click/change/blur handlers **once** on the
  persistent `#content` element (`bindDelegation()`), never inside a render function — render
  functions run repeatedly (every toggle/filter/re-render) and re-binding inside them stacks
  duplicate listeners, causing actions like "Send to office" to fire N times. If you add a new
  interactive element, wire it in `bindDelegation()`, not in the render function that builds it.
- Deploy is the same `deploy.bat` / Pages deploy as the rest of Sitely — no separate pipeline.

## Phone/anywhere control: the Sitely MCP connector
Sitely exposes a **remote MCP server** so Claude (desktop or phone app) can manage jobs
without a browser. It rides the normal Pages deploy — no separate service.
- `functions/mcp/[[path]].js` — stateless JSON-RPC MCP endpoint at `/mcp/<token>`.
  29 tools (reads/writes the same KV): jobs (create/list/get/rename/set_status/delete),
  customer (get/set), estimate (get_estimate, seed_from_catalog, add_category, add/rename/delete item, set_item_flags/spec, add/update/delete cost_line, set_markup, set_tax, get_estimate_total),
  schedule (get/add/update/delete task), draws (get/add/update). serverInfo version 2.0.0.
- `functions/api/mcp-token.js` — admin-only `GET /api/mcp-token` mints/returns the secret
  token (KV key `mcptoken`). The token is the credential in the connector URL.
- **Connector URL** = `https://ridgeline-workspace.pages.dev/mcp/<token>` — Zac adds this as a
  custom connector in the Claude app (Settings → Connectors → Add custom connector; no OAuth).
- To **rotate** the token: delete KV key `mcptoken` (`wrangler kv key delete`), call
  `/api/mcp-token` again to mint a new one, update the connector URL.
- To add more tools (add estimate line, set markup, schedule, etc.), extend the `TOOLS`
  array + `runTool()` in `functions/mcp/[[path]].js` and redeploy.
