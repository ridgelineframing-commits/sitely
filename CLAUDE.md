# Sitely — Ridgeline PM web app (operating rules)

**Sitely** is Ridgeline's project-management web app (estimate, specs, schedule, draws, customer packet). Read this before touching it.

## Where it lives / what to edit
- **Deployed app = `ridgeline-app/public/`** — this is the live code. ALWAYS edit here.
  - `index.html` — page shell + the inline app script (`<script type="text/x-dc" data-dc-script>`) that builds the render context (projectName, packet header, bindings).
  - `keystone.js` — the app logic (views: estimate, catalog, schedule, draws, customer, packet). Most feature work is here.
  - `quote-engine.js` — **native estimating engine** (`window.QuoteEngine`): material takeoff,
    package pricing, vendor sheet, and the 14-category bid. See "Bid Builder" below.
  - `workbook.js`, `support.js`, `export.js`, `engine.js`, `sync.js` — workbook engine, framework, xlsx export, Cloudflare sync.
    (The workbook is legacy: the Bid Builder no longer uses it — only the old worksheets/xlsx export do.)
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

## July 2026 restructure (v3 nav → v4 "Projects" nav)
- Top nav (v5): **Home · Whiteboard · Schedules · Templates · Catalog · Settings** (PM: Home ·
  Whiteboard · Schedules). The header is slim —
  sitely logo left (→ Home), tabs, preview eye + avatar right. The old header "CURRENT CUSTOMER"
  job dropdown, the external-app icon links, AND the short-lived Projects page were all REMOVED —
  **Home is the hub** (job list with Active open, Prospects labeled, Warranty + Archive collapsed;
  no row numbers; Admin renders as a slim catch-all row at the bottom). Home's h1 is a
  time-of-day greeting; a **"$ visible/hidden" privacy toggle** (localStorage `ks_hide_money`)
  masks every dollar figure. The WHITEBOARD card on Home is live: quick-capture input + notes
  drag onto job rows (opens the board's assign/date dialog in place). A job is only ever "open"
  INSIDE its own screens — `go()` clears `jobId` on every top-level page, boot doesn't auto-open
  for staff (customer portal still does). Job screens carry a leading **◂ job-name breadcrumb
  chip** (now in the title row — see "Job screen layout" below), then the submenu. The dead
  Calculators / Takeoffs-worksheet settings chips are gone. Settings extras: **company logo upload**
  (`catalog.branding.logo` dataURL → packet header via `{{ packetLogo }}`, 400KB cap) and the
  appearance "Paper" menu renamed **Background** with two mid-tones (Stone light-warm, Dusk soft
  dark — `dark:true` flag drives accent variants). Estimate-template starters **"All"** and
  **"Garage / Shop"** (drops 0140/0150/0610/0620/1110/1120/1230/1240) auto-seed once via
  `catalog.estTplSeed`. Card surfaces (home cards, dialogs, inbox, Bid Builder panels) got a
  rounded-corner pass.
- **Every to-do IS a whiteboard note** (one system): a job's To-dos tab = the Whiteboard filtered
  to that job (subtitle says so); the Whiteboard has job filter chips (Unassigned · per-job with
  counts) showing the same slice. The legacy per-job `job.todos` list UI (`todoList` /
  `todoWhiteboardModal`) was REMOVED — a one-click banner on To-dos migrates leftovers into a
  board checklist note (API still accepts `body.todos` for compat). All-jobs calendar picker
  shows active jobs + a "▸ N more" expander (dashed chips + status tags for non-active).
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
- **Sitely dialogs** (`sysDialog`/`ksPrompt`/`ksConfirm`, rendered at the root via `{{ ksDialog }}`):
  every browser `prompt()`/`confirm()` in keystone + index.html was swept into centered, themed
  dialogs (multi-field support — e.g. catalog New category/New item ask code + name, enabling
  C100-style commercial code series). Built-in schedule templates renamed **120/150/180-day SFD
  build** (ids unchanged; `ensureLongTemplates` migrates old names in place, `ai_sfr` now
  auto-seeds too) with old-name aliases kept in `templateDefsFor`. Settings gains **Built-in
  templates restore** (clears `schedSeed`/`estTplSeed`) and **two-slot Company branding**:
  main logo (packets & documents ONLY — the sitely mark is permanent in the header, the old
  `branding.appLogo` header override was removed) and **square icon** (`branding.icon` →
  replaces the initials in the header profile circle for staff + runtime favicon/apple-touch
  swap; later the per-company PWA/APK icon).
- **Schedules hub** (Jul 2026, route `KS:SchedHub`, view `viewSchedHub`) — the PM's working home
  base, tab right after Whiteboard (admin + pm). Split layout `.ks-hub-grid` (calendar left,
  projects rail right; stacks under 1100px): 2/3/4-week all-active-jobs calendar
  (`c.state.ksHubWeeks`, shared renderer `calendarStrip` — **work-week Mon–Fri only**, 5
  `minmax(0,1fr)` columns so it always fits its box) with **weather** per day
  (Open-Meteo, free/no-key: geocoding + 16-day forecast; city = 2nd comma part of the first
  active job's customer address via `wxCityOf`; cached 3h in `_wx`, silently absent
  offline/headless; `wxLabel` reports "no forecast for X" instead of hanging on "fetching"),
  and a projects rail (active rows with "now:/next:" task summaries →
  click opens that job's Schedule; prospects & warranty/archive behind expanders; Admin
  pinned dashed at bottom → To-dos). Each rail row (incl. Admin) has a **calendar on/off
  square** on the right (`calToggle`, stops click propagation so it doesn't open the job) —
  solid = drawn, dashed = hidden; the choice persists in localStorage `ks_hub_cal_vis` and
  defaults to active jobs + Admin, so a prospect/warranty job can be toggled ON too.
  Hub itself is read-only — you pick a project to edit.
- **Schedule view styles** (job schedule, non-field): segmented **List · Timeline · Calendar ·
  Agenda** chips (`c.state.ksSchedView`; old `ksGantt` flag maps to timeline). List = the
  editable grid; Timeline = the gantt; Calendar = `calendarStrip` for this job (2/3/4/6 weeks
  via `ksJobCalWeeks`, weather from the job's own address); Agenda = chronological
  day-grouped run-of-show (Upcoming / 3-week lookahead / Everything filters, clickable
  status pills, firm ✓/? chips). A dashed **TO-DOS & NOTES strip** (`schedTodoStrip`) sits
  under the schedule toolbar: this job's board-note chips (click → To-dos tab) + ＋ Add.
- **Vendor sheet ⇄ Excel**: Price book tab (and Material estimate tab) get **⤓ Export for
  Excel (.csv)** and **⤒ Import completed sheet**. CSV columns `sku_id,group,description,
  unit,qty,your_price` (BOM'd UTF-8; qty always 1) — `sku_id` + column ORDER are the import
  contract (UI warns loudly). Import (`parseCsv`/`applyVendorCsv`, exported for tests)
  matches by sku_id, updates `catalog.priceBook` prices, ignores blanks, rejects
  negatives/garbage, and reports updated/blank/unrecognized in an info dialog
  (`sysDialog` gained an `infoOnly` opt that hides Cancel).
- **Commercial TI template** (`commercial_ti`, "Commercial TI", 31 tasks, also auto-seeded),
  modeled on the Red Leaf TI schedule: three toggleable phases — **Planning** (~2 wks / 10 wd),
  **Construction** (30 wd) and **Final inspections** (~2 wks / 10 wd), 50 working days total.
- The schedule engine + all three built-in templates are mirrored in **`functions/api/_schedule.js`**
  (ESM) so the **MCP** can build schedules server-side; kept byte-for-byte in sync with keystone by
  `test/schedule-engine-parity.test.mjs`. Change one → change the other.
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
  check-off + due-date + notes.)
- **The TASK column is the point of the table** — it lost its width once the accessibility pass
  grew the controls around it (36px steppers, 40px icon buttons) past the fixed-column budget.
  It's now `minmax(150px,1.6fr)` with every other column budgeted tight, every cell `minWidth:0`
  so it can shrink inside its track, and the table scrolls horizontally below ~830px instead of
  clipping. Desktop steppers (`.ks-step-btn`) and `.ks-icon-btn` are compact again; the phone
  media query in `index.html` grows both back to 44px touch targets. `test/schedule-table.test.mjs`
  pins the column floor, the fixed-track budget, the stepper size and the phone overrides.
- **One date in the field = the DUE date.** Field mode (desktop `moveTaskDue`) and Sitely Field's
  task rows show a single date, and that date is the task's **finish** — typing one pulls the
  start back by the duration (`subWorkDays`) and pins the derived start (`r.fixed`) so a desktop
  `ksRecompute` preserves it and it doesn't ripple onto dependents. The full List view still
  edits START and FINISH separately.
- **Firm-date flag** (`r.confirmed`) — schedules are living documents, so every task carries
  "date confirmed with the sub?": ✓ solid green chip = firm, ? dashed = tentative (`firmChip`,
  FIRM column in `taskTable`, chips in desktop field mode + field app rows, dashed bars/outline
  on the timeline, dashed square + ? on the company calendar). Survives `computeSchedule` /
  `ksRecompute` passthrough (both engines — parity file too); MCP `update_schedule_task` takes
  `confirmed` (serverInfo 2.3.1).
- **Bid Builder + material list (Jul 2026, renamed from "rough quote")** — `public/quote-engine.js`
  replaced the emulated-Excel workbook for estimating. Built from a line-by-line interview with Zac
  (spec artifact in the Jul 2026 session). Key shape:
  - UI names (data keys unchanged — `job.roughQuote`, `catalog.priceBook`, route `KS:Rough`,
    `ksApplyRoughNative`): the feature is the **Bid Builder** (highlighted `⚡ Bid Builder` chip in
    the job submenu), tabs **Takeoff · Material list · The bid · Price list**. Estimate lines it
    prices are flagged **UNVERIFIED** (was ROUGH) until confirmed. `RQ_LINE_NOTE` (exported) holds a
    plain-English basis note for EVERY engine line key — `test/bid-builder.test.mjs` fails if a new
    engine line lands without one, and also fails if "rough quote"/"price book & rates"/legacy-Excel
    copy reappears anywhere in public/.
  - **Two standalone workflows** off one `job.takeoff`: the optional **Material list**
    (5 packages — floor/wall/roof/siding/deck — per-piece SKUs from `catalog.priceBook`, waste
    explicit in `catalog.quoteRates.waste`; prints a **vendor order list** and a **qty-1 vendor
    pricing sheet**) and the **bid** (14 categories; material-package lines source
    **material → per-SF backup → manual**; 7 sub-quote lines — trusses/windows/hvac/plumbing/
    electrical/cabinets/countertops — take a keyed quote in `job.roughQuote.quotes`, else backup).
  - **Template-first**: an empty-estimate job prompts for the estimate template on the quote tab
    (`ksAdoptEstimateTemplate`); **Send → estimate** updates matching items by cost code
    (`RQ_ITEM_CODE`/`RQ_ITEM_NAME` maps, lines flagged ROUGH via `verified:false`, `rqKey` marks
    engine-managed cost lines); **Overwrite** additionally creates missing categories/items; both
    snapshot to `c._undoEst` for Undo. Amounts are contract-level — reverse-priced through
    markup+tax (`ksApplyRoughNative` in index.html).
  - `catalog.priceBook` + `catalog.quoteRates` auto-seed on first use (`ensureQuoteData`); the
    Catalog → prices tab and Rough-quote → Price book tab edit the SAME book that drives the math.
    Porta-potty = monthly rate × schedule months; permit = % of estimate valuation (allowance
    fallback). Tests: `test/quote-engine.test.mjs` (16). serverInfo/api: `job.takeoff` +
    `job.roughQuote` persist via the admin PUT allowlist.
- **Job screen layout (Jul 2026)**: the open job reads as a `◂ name` chip in the **title row**
  (left of the sync note, `showJobCrumb`/`jobCrumb` in syncVals) — not as the first submenu chip.
  Submenu order is Estimate · ⚡ Bid Builder · Schedule · To-dos · Plans · Draws, with Packet +
  Settings pushed right (`mkChip` gained a `solid` opt for the one accent CTA). The **worksheets
  and calendar chips were deleted** (legacy/redundant), along with the "Edit worksheet →" and
  "Draws worksheet →" buttons; the legacy xlsx export survives in Settings labeled as legacy.
- **Schedule toolbar** is two rows: view styles + Field mode + Hide completed on top; PERMIT-READY
  date + ↻ Template + ⤓ Share below a hairline. **To-dos & notes moved into a collapsible right
  sidebar** (`schedTodoSidebar`, `.ks-sched-grid`, localStorage `ks_sched_side`; collapsed state
  shows a `☰ To-dos & notes (N)` button in row 1). viewSchedule composes via a `done()` helper that
  splits toolbar rows from body content so every view style shares the sidebar.
- **Admins & the owner**: the APP_PASSWORD login is the **owner / super administrator**
  (`session.owner`, `RidgelineSync.isOwner()`, labeled OWNER · SUPER ADMIN in Settings → Team
  logins). `/api/users` now accepts `role:'admin'` — admin logins sign in with just a password like
  PMs and get full app access, but **only the owner may create, re-key or delete an administrator**
  (enforced in `users/index.js` POST + `users/[id].js` PUT/DELETE, not just hidden in the UI), so
  admins can't lock each other out.
- **Sitely Field view styles**: Schedule tab gains **List · Weeks · Agenda** chips. Weeks = 2/3/4
  work weeks (Mon–Fri) of day blocks; Agenda = the next 30 days. Day blocks are "unbound" — every
  task renders and the block grows (`.day-block`/`.day-task` CSS, no truncation). The avatar now
  opens a **Settings sheet** with per-job on/off toggles for those views + the widgets, persisted in
  the same localStorage key as the desktop hub (`ks_hub_cal_vis`, shared origin) and pushed to the
  native layer via `window.SitelyWidget.setJobVisibility`.
- **Android home-screen widgets** (`android/`, alongside the existing Whiteboard widget): **Sitely
  Agenda — 30 days** (`AgendaWidget`) and **Sitely Look Ahead — 2–4 weeks** (`WeeksWidget`, tap the
  `2w/3w/4w` chip in its header to cycle; span in `WidgetData.KEY_WEEKS`). Both render through one
  `ScheduleFactory` (MODE_AGENDA / MODE_WEEKS) that pulls `/api/jobs` + `/api/jobs/:id` with the
  bridged token, skips empty days, marks TODAY, shows firm ✓ / tentative ?, and honors the job
  toggles mirrored into `WidgetData.KEY_JOBVIS` (non-active jobs need an explicit ON).
  `MainActivity` captures `ks_hub_cal_vis` on every page finish and exposes the `SitelyWidget`
  JS bridge. **Native change → APKs rebuilt** (`android/dist/*.apk`).
- **Bid Builder flow (Jul 2026)**: creating a job now offers to start the Bid Builder right after
  you name it (`ksCreateJob` → ksConfirm → `KS:Rough`). Tabs read as the order you work —
  **1 · Takeoff › 2 · The bid** on the left, then a divider, then the reference tabs
  (Material list, Price list) pushed right. The Takeoff tab ends in a **✓ Done — price the bid →**
  button. The two apply buttons were the single most confusing thing on the screen, so
  `applyButtons()` now counts how many bid lines find a matching cost code on the estimate and
  tags the right one **DO THIS ONE** ("Update the estimate" normally; "Rebuild the estimate from
  this bid" when nothing matches), each with a sentence saying what it does to your data.
- **Money is accounting-formatted** in every editable cell (`fmt$2` → `$1,234.56`). Two decimals
  matter: `num()` strips `$`/`,` so a formatted value round-trips EXACTLY, and the commit guards
  compare against the stored number, so focusing and blurring a cell can no longer drift a price
  or silently flip an UNVERIFIED line to verified.
- **Per-job price overrides**: editing a price on the Bid Builder's Price list tab asks where it
  belongs — **master list** (writes `catalog.priceBook`) or **this job only**
  (`job.roughQuote.priceOverrides[skuId]`, marked ★ with a clear-all button). `ksQuoteContext`
  builds an effective price book from the overrides, so the material math follows them while the
  master book stays clean. `sysDialog` gained `altLabel`/`altCb` (third button) and `cancelLabel`.
- **Vendor quote expiration**: `catalog.priceQuote = {vendor, updated, expires, remindedFor}`.
  Importing a completed vendor sheet asks how long the pricing is good for; the Price list tab
  carries a status bar (good through / expiring / expired) and `checkQuoteExpiry` prompts **once
  per expiration date** to download a fresh sheet to send out (guarded by `remindedFor`, ticks on
  the next frame since it fires during a render).
- **Estimate item editor de-spreadsheeted**: the expanded item is a rounded card with real labeled
  fields (item name, cost code, live item total), sentence-case column heads, currency/percent
  cells, an accent bar + one-line explanation on UNVERIFIED rows, and a proper
  "WHAT THE CUSTOMER READS" spec box. `btn()` variants are rounded now, app-wide.
- **Customer packet fixes (Jul 2026)**: category **subtotals now ride on the category header row**
  (the standalone "Subtotal — X" rows are gone, so the estimate reads as a running tally); a local
  `money()` helper pins **maximumFractionDigits: 2** (the packet had been printing `$19,277.028`
  to customers); print margins are generous (`0.9in 1in`) with denser `.packet-section td` padding — wide
  white edges, tight rows — and the on-screen preview padding matches; and the SCHEDULE section now prints the
  **real `job.schedule`** grouped by phase with per-phase date spans, a ✓ on complete tasks and a
  "dates are our working plan" note — it used to print the retired spreadsheet's Schedule sheet.
  `test/packet.test.mjs` lifts `ksPacketSections` straight out of index.html and pins all of this.
- **Change orders (Jul 2026)** — `job.changeOrders = [{id,no,title,desc,amount,days,status,
  createdAt,sentAt,signedAt,signedBy,signatureId}]`, statuses draft → sent → approved → declined.
  Route `KS:Changes` / `viewChangeOrders`. **Only `approved` COs count**: `changeOrderTotal` /
  `jobContractTotal` (server, `_lib.js`) and `approvedCOTotal` / `contractWithCOs` (client) are the
  single source of that math. They surface in three places — a block at the BOTTOM of the estimate
  (after the original scope; unsigned ones show flagged AWAITING SIGNATURE but aren't counted), a
  breakdown on the **draw sheet** (original contract + each approved CO = "contract today", and
  every draw % bills against that), and the customer portal (`jobForCustomer` sends sent+approved,
  never drafts). **Signature fields are server-owned**: `sanitizeChangeOrders` in
  `functions/api/jobs/[id].js` carries `signedAt`/`signedBy`/`signatureId` over from the stored copy
  and ignores whatever a PUT sends, so an admin write can't forge a signature; a signed CO is also
  frozen in the UI (edit attempts explain to write a superseding CO instead).
- **Job screens use a left sidebar** (`jobNav` in keystone, bound as `{{ ksJobNav }}`): two stacked
  header rows read as competing headers, so the job's screens moved down the side. The controller
  still builds `wsChips`; `jobNav` splits them at the `ml:'auto'` marker into main screens and
  tools (Bid Builder / Packet / Settings) with a hairline between. `.ks-job-grid` is
  `176px minmax(0,1fr)`; under 860px the sidebar lies back down into a scrolling chip row.
- **Native e-signature (Jul 2026)** — ported from Zac's **Signet** repo
  (`ridgelineframing-commits/signet`), which is the same Cloudflare shape; its token/hash
  helpers and recipient+audit model came over nearly as-is. **What differs:** Signet keeps
  envelopes in D1 and mails invites via Resend; Sitely has no D1 binding, so a request is a KV
  doc and you hand the customer the link yourself (no email sending yet).
  - `functions/api/_sign.js` — the core. KV layout `sig:<id>` (request + append-only `audit`),
    `sigtok:<token>` → id, `sigjob:<jobId>` → [ids]. `newToken` (32 random bytes, url-safe),
    `sha256Hex`, `hashIp` (salted — the raw IP is NEVER stored). `signRequest` captures the five
    things that make a signature defensible in one shot: intent (typed name), consent (ticked
    box), attribution (name/email/ipHash/userAgent), the **docHash** of exactly what was shown,
    and the timestamp. `publicView` (signer) strips token/audit/ipHash/email; `adminView`
    (office) keeps the record but drops the signature bitmap.
  - `functions/api/sign/[[path]].js` — PUBLIC: `GET /api/sign/<token>` (marks viewed),
    `POST` to sign, `POST …/decline`. The token IS the credential — `_middleware.js` exempts
    `/api/sign/` (trailing slash; `/api/signatures` stays admin-gated). **A signed change order
    flips to approved HERE**, server-side, which is why a client PUT can't forge one.
  - `functions/api/signatures/index.js` — admin: list per job, create (returns `link`), and
    DELETE = void (a signed record is never deleted, voiding is the reversal and stays in history).
  - `public/sign/index.html` — the signer page: document summary, typed name, canvas signature
    pad (pointer events, devicePixelRatio-scaled), explicit consent sentence, decline path, and a
    printable "signed — thank you" state. Served at `/sign/<token>` via `public/_redirects`
    (`/sign/* → /sign/index.html 200`), since Pages would otherwise 404 on the token.
  - Office UI lives on the change-order card: `sendForSignature` mints the request and shows the
    copyable link; `signLinkFor` shows SIGNATURE SENT/VIEWED/SIGNED/DECLINED with the signer,
    timestamp and document-hash prefix.
  - **Not built yet:** emailing the link, contract templates + document assembly, and signing
    draw requests (the primitive takes `kind:'draw'` already).
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
  The **due date is editable** in the field: the one date on a task row is its `finish`, and
  typing one walks the start back by the duration (`subWorkDays`) and pins that start via
  `r.fixed` (the same flag desktop's `ksRecompute` preserves), so a field date change survives
  desktop recompute and doesn't ripple onto dependents. Saves go through the offline cache like
  every other edit.
  **Add a task in the field** via the `＋ Add task` button (`openAddTaskSheet` → `addTaskToSchedule`):
  name + phase (pick an existing group or "＋ New phase") + optional due date. Dated → pinned
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

## Contractors, bid invitations, and schedule ownership
- `catalog.contractors` is the lean shared contractor directory: company, contact, email, phone,
  trade, notes, and active. Admins edit/import it under Catalog → Contractors; PM catalog reads
  receive contact fields but no pricing.
- Job bid invitations live in `job.bidRequests`. The Bid Builder creates a read-only token link at
  `/bid/<jobId>/<requestId>/<token>` containing the scope and only the selected `job.plans` files.
  `/api/bid/*` is public because the unguessable token is the credential. It has no form, upload,
  tracking, automatic email, or estimate capture: Sitely opens a prepared `mailto:` draft, the
  contractor emails the estimate back, and the office manually records amount/date/notes/selection.
- Contractor assignment is intentionally separate from schedule rows in `job.taskContractors`
  (`taskId -> contractorId`). This prevents another schedule writer from stripping assignments.
- **Ownership rule:** the server `job.schedule` is the source of truth; desktop and Sitely Field edit
  it through the same due-date/completion/confirmation rules (`public/schedule-actions.js`); Android
  widgets are read-only cached consumers and never write schedule state.
- Desktop Field view and Sitely Field show the task due date plus explicit Confirmed/Tentative state.
  Field sign-in requires the staff email/username, and sync conflicts must be explicitly reloaded;
  neither surface may claim “Synced” during an offline/error/conflict state.

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
  36 tools (reads/writes the same KV + R2): jobs (create/list/get/rename/set_status/delete),
  customer (get/set), estimate (get_estimate — `include_specs` prints each item's customer-facing
  spec text, **get_estimate_template** — dumps the MASTER template out of KV `catalog`: categories,
  items, which are allowances (+ allowance budget), spec text, and the standard exclusions,
  seed_from_catalog, add_category, add/rename/delete item, set_item_flags/spec, add/update/delete cost_line, set_markup, set_tax, get_estimate_total),
  schedule (get/add/update/delete task, **apply_schedule_template** — build/replace a job's whole
  schedule from a template id/name + start_date, with optional exclude_categories; uses the shared
  `functions/api/_schedule.js` engine), draws (get/add/update), files (list_files, upload_file —
  base64 bytes → R2 `plans/<jobId>/<fileId>` + `job.plans`, mirrors the web Plans upload; ~20MB
  cap over MCP), whiteboard (get_board, add_board_note, delete_board_note — reads/writes KV key
  `board`; add_board_note takes text and/or a checklist, and an optional job+due_date that also pins
  a single-day `wb_*`/`Whiteboard`-group schedule task, mirroring the app's drag-to-assign).
  serverInfo version 2.4.0.
- `functions/api/mcp-token.js` — admin-only `GET /api/mcp-token` mints/returns the secret
  token (KV key `mcptoken`). The token is the credential in the connector URL.
- **Connector URL** = `https://ridgeline-workspace.pages.dev/mcp/<token>` — Zac adds this as a
  custom connector in the Claude app (Settings → Connectors → Add custom connector; no OAuth).
- To **rotate** the token: delete KV key `mcptoken` (`wrangler kv key delete`), call
  `/api/mcp-token` again to mint a new one, update the connector URL.
- To add more tools (add estimate line, set markup, schedule, etc.), extend the `TOOLS`
  array + `runTool()` in `functions/mcp/[[path]].js` and redeploy.
