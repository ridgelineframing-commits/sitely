# Sitely — Ridgeline PM web app (operating rules)

**Sitely** is Ridgeline's project-management web app (estimate, specs, schedule, draws, customer packet). Read this before touching it.

## Where it lives / what to edit
- **Deployed app = `ridgeline-app/public/`** — this is the live code. ALWAYS edit here.
  - `index.html` — page shell + the inline app script (`<script type="text/x-dc" data-dc-script>`) that builds the render context (projectName, packet header, bindings).
  - `keystone.js` — the app logic (views: estimate, catalog, schedule, draws, customer, packet). Most feature work is here.
  - `workbook.js`, `support.js`, `export.js`, `engine.js`, `sync.js` — workbook engine, framework, xlsx export, Cloudflare sync.
  - `logo.jpeg` / `logo.png` — Ridgeline letterhead logo (the real hammer-and-nail mark).
- `keystone-design/` is an OLDER, diverged dev copy — do NOT edit it for production changes; edit `public/`.

## ‼️ Deploy model — GIT-ONLY, single source of truth
The Cloudflare Pages project `ridgeline-workspace` is **git-connected**: merging a PR to `main`
builds and publishes production automatically (~1 min; the Cloudflare bot comments the deploy on
every PR). **This is the only deploy path** — `edit → PR → merge → auto-deploy`. Zac has standing
approval to publish; nothing is deployed by hand.
- **No manual `wrangler pages deploy`.** The old `deploy.bat` was deleted (Jul 2026) because
  direct-uploading a stale local copy from the OneDrive folder kept overwriting the newer git
  deploy — the "it published an old version" incidents. If a hotfix is ever needed without a PR,
  push straight to `main` (still goes through the git integration); never direct-upload.
- Live URL: **https://ridgeline-workspace.pages.dev** — tell Zac to hard-refresh (Ctrl+Shift+R);
  static assets (logo/icons) and the service worker cache hard.
- Cloudflare account `Zac@ridgeline.construction`, project `ridgeline-workspace`. `wrangler` is
  still used for one-time infra (KV/R2/secrets, see `setup-r2.bat` / DEPLOY.md), just not for deploys.

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
- Longer build templates (auto-seeded once into `schedTemplates`, respect deletion via
  `catalog.schedSeed`): **Ridgeline 150-day build** (`build_150`) and **180-day build**
  (`build_180`), 81 tasks each. Both generated from one `LONG_BUILD_TASKS` base by
  `longBuildTemplate(150|180)`, which scales durations/lag to the working-day target and pads the
  terminal task so the critical path lands exactly on 150 / 180 (verified in
  `test/schedule-templates.test.mjs`). They add four trades as their own toggleable categories:
  **Well drilling/install, Septic, Exterior stone, Interior stone**.
- **Choose categories before committing a template**: new-job page and a schedule **↻ Template**
  dialog (admin) show an "include categories" checklist of the template's phases; unchecked groups
  are dropped and predecessors rewired around them (`templateGroups` / `filterTemplateByGroups` /
  `applyGroupSelection`). The ↻ Template dialog also **replaces an existing schedule** from a
  template (Undo toast after) — used to rebuild a stale/uneditable schedule.
- Schedule table is **fully editable** (`taskTable` with `showStatus`): duration (renamed from
  "days"), predecessor, lag, **and start & finish dates**. Typing a start/finish pins the task
  (`r.fixed`); a typed finish pulls the start back by the duration (`subWorkDays`); editing
  pred/lag clears the pin so the dependency drives it. Every edit calls `ksRecompute` so changes
  **ripple** to dependents, with a `schedSnapshot` Undo. (Field mode stays deliberately minimal:
  check-off + start-date + notes.)
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
  the bottom of that sheet. Bottom tab bar = **Board (home) / Schedule / Estimate** — Board is the
  default landing tab (the app is primarily a company to-do/whiteboard tracker).
- **Admin job:** a permanent company-wide job named `Admin` is auto-created on boot
  (`ensureAdminJob`, detected by name, created via `RS.createJob` — needs an admin session; PMs
  silently skip on 403). No estimate, open-ended (no schedule template), just a home for notes/tasks
  dropped onto it so they flow into the main schedule/feed.
- **Whiteboard layout (same model as desktop):** the **notepad** (capture textarea + "Stick it on
  the board") is the dominant thing at the top; below it, **every note is a compact summary row**
  (`noteSummaryHtml`: type icon 📝/☑/📎 · title = first line or checklist label · job & due badges ·
  by/date · x/y checklist count). Tap a row to expand it into the full editable note (`noteBodyHtml`
  — text, checklist add/remove, Reassign/Delete), tracked in `S.noteOpen`. There is **no** per-job
  to-do section and **no** "everything-due" feed on the board (both removed — they were dominating
  the field screen). The desktop whiteboard uses the same collapse-to-summary model via
  `boardNoteRow` (click a row → expands the existing `boardNoteCard`; still draggable to a job).
- **Radial drag-to-assign (Board):** long-press a note **summary row** (~340ms) → the screen dims + zooms
  out (`#main.zoomed`) and every active job fans out as a ring of bubbles (`.rbubble`, Admin
  tinted blue) around a floating ghost of the note. Drag onto a job, release, and a **due-date-only**
  sheet (`askDueDate` — no start/end) pops. On confirm (`assignNoteToJob`): the card stays on the
  board tagged with `jobId`+`dueDate`, AND — when a due date is set — a pinned single-day
  `wb_*` task (`group:'Whiteboard'`, `fixed`=due, `boardNoteId`) is upserted onto that job's
  schedule via `upsertJobTask` (dedup by the note's `schedTaskId`). Pointer-event driven, offline-safe
  saves; a movement threshold before the hold fires means vertical scrolling still works. The
  `Send to job`/`Reassign` button is the tap fallback (job picker → same due-date sheet). Board
  notes persist `dueDate`+`schedTaskId` (board sanitizer extended).
- **Schedule:** All/Upcoming/Completed filter chips, phase groups with collapsible completed
  tasks, big checkboxes (status only — Not Started/In Progress/Complete), field notes per task.
  Start-date **is editable** in the field: changing it pins that task via `r.fixed` (the same
  flag desktop's `ksRecompute` preserves), so a field date change survives desktop recompute
  and doesn't ripple onto dependents. Saves go through the offline cache like every other edit.
  **Add a task in the field** via the `＋ Add task` button (`openAddTaskSheet` → `addTaskToSchedule`):
  name + phase (pick an existing group or "＋ New phase") + optional start date. Dated → pinned
  single day (`fixed`); undated → a floating to-do. Inserted next to its phase so groups stay
  contiguous. Works even on a job with no schedule yet.
  - **Estimate — primary function is notes-to-office, not editing.** Read-only totals/category
  breakdown + read-only cost-line detail; tapping a line item opens a "Note to office" box. Notes
  post into the **same `job.pendingNotes` / office-inbox mechanism** desktop already uses
  (`target:'estimate'`, shows up in `officeInboxCard` for Approve/Dismiss) — zero backend schema
  change. The item is identified by **tagging the note text itself** with `[code — name]` (server
  sanitizers for `pendingNotes` only keep `{id,by,target,text,ts,status}`, so there's nowhere else
  to carry an item id) — if an item is renamed, its older notes stop matching by tag.
  - **Board:** same KV-backed whiteboard as desktop (`/api/board`), reskinned dark; no
  sketch/photo/PDF attachments (desktop-only for now). Checklist notes (to-do lists) are
  **editable in the field**: each note card has an "Add an item…" input (click Add or press
  Enter) and a ✕ per item to remove it — a plain reminder becomes a checklist on first add.
  Adds/removes go through `saveBoardNotes` (PUT `/api/board`) with optimistic UI + rollback on
  failure; handlers (`.ck-add-btn`/`.ck-add-input`/`.ck-del-item`) are wired in `bindDelegation()`.
- **Gotcha — delegated listeners:** `app.js` binds all click/change/blur handlers **once** on the
  persistent `#content` element (`bindDelegation()`), never inside a render function — render
  functions run repeatedly (every toggle/filter/re-render) and re-binding inside them stacks
  duplicate listeners, causing actions like "Send to office" to fire N times. If you add a new
  interactive element, wire it in `bindDelegation()`, not in the render function that builds it.
- Deploy is the same git-integration Pages deploy as the rest of Sitely (merge to `main`) — no separate pipeline.

## Installable (PWA) — service workers
Both apps are installable PWAs. `public/sw.js` (scope `/`) and `public/field/sw.js` (scope
`/field/`) are registered from their respective `index.html` heads. Strategy is **network-first,
cache-fallback**: online users always get fresh code + data (behaves exactly like no SW); offline
users get the last-seen app shell. `/api` and `/mcp` GETs are **never cached** (data stays live),
and non-GET/cross-origin requests pass straight through. A registered SW + the manifest + HTTPS is
what makes Chrome/Android offer "Install app"; without a SW the browser won't prompt. Both apps
also show an in-app **`#install-cta`** button that reveals itself on the `beforeinstallprompt`
event (and hides on `appinstalled`) — a menu-free way to install, and a live signal that Chrome
considers the app installable. For a true
sideloadable APK there's a native wrapper in **`android/`** (see below) — no PWABuilder needed.

## Android wrappers (`android/`)
Thin native **WebView wrappers** that load the live site so Sitely installs as a real Android app
(sideload) even on devices that won't install the PWA. One Gradle project, two flavors:
`field` (Sitely Field → `/field/`, pkg `com.ridgeline.sitely.field`) and `desktop` (Sitely → `/`,
pkg `com.ridgeline.sitely`) — different package ids so both install side by side. The start URL is
a per-flavor `BuildConfig.START_URL`; `MainActivity` just loads it, so **app content always tracks
the git deploy** — the wrapper rarely needs rebuilding. Prebuilt **debug-signed** APKs are checked
in at `android/dist/*.apk` for immediate sideloading (not Play-Store signing). Rebuild with
`./gradlew assembleFieldDebug` / `assembleDesktopDebug` (needs JDK 17–21 + Android SDK platform 34,
path in the git-ignored `local.properties`). Blob downloads (schedule JPEG/PDF share) are handled
natively — `MainActivity` intercepts `blob:`/`data:` URLs, reads the bytes in-page, and writes them
to the device Downloads via `MediaStore` (no permission on Android 10+); the shared
`schedule-share.js` also uses `navigator.share` first in plain browsers/PWA. Rebuild the APKs after
touching `MainActivity` (native change, unlike web content). Release/Play-Store build = add a
signing config (keystore out of git).

## Phone/anywhere control: the Sitely MCP connector
Sitely exposes a **remote MCP server** so Claude (desktop or phone app) can manage jobs
without a browser. It rides the normal Pages deploy — no separate service.
- `functions/mcp/[[path]].js` — stateless JSON-RPC MCP endpoint at `/mcp/<token>`.
  34 tools (reads/writes the same KV + R2): jobs (create/list/get/rename/set_status/delete),
  customer (get/set), estimate (get_estimate, seed_from_catalog, add_category, add/rename/delete item, set_item_flags/spec, add/update/delete cost_line, set_markup, set_tax, get_estimate_total),
  schedule (get/add/update/delete task), draws (get/add/update), files (list_files, upload_file —
  base64 bytes → R2 `plans/<jobId>/<fileId>` + `job.plans`, mirrors the web Plans upload; ~20MB
  cap over MCP), whiteboard (get_board, add_board_note, delete_board_note — reads/writes KV key
  `board`; add_board_note takes text and/or a checklist, and an optional job+due_date that also pins
  a single-day `wb_*`/`Whiteboard`-group schedule task, mirroring the app's drag-to-assign).
  serverInfo version 2.2.0.
- `functions/api/mcp-token.js` — admin-only `GET /api/mcp-token` mints/returns the secret
  token (KV key `mcptoken`). The token is the credential in the connector URL.
- **Connector URL** = `https://ridgeline-workspace.pages.dev/mcp/<token>` — Zac adds this as a
  custom connector in the Claude app (Settings → Connectors → Add custom connector; no OAuth).
- To **rotate** the token: delete KV key `mcptoken` (`wrangler kv key delete`), call
  `/api/mcp-token` again to mint a new one, update the connector URL.
- To add more tools (add estimate line, set markup, schedule, etc.), extend the `TOOLS`
  array + `runTool()` in `functions/mcp/[[path]].js` and redeploy.
