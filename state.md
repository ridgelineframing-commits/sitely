# Sitely — current state

_Snapshot of where the Sitely web app stands. Pairs with `CLAUDE.md` (operating rules)._
Last updated: 2026-07-07.

## What it is
**Sitely** = Ridgeline's project-management web app: estimate, specifications, schedule, draws,
customer packet (print/PDF), per-job to-dos, and plan/file uploads. Replaces CoConstruct.
- **Live:** https://ridgeline-workspace.pages.dev  (Cloudflare Pages, project `ridgeline-workspace`)
- **Roles:** admin (you), pm (field crew — schedule/notes/to-dos only), customer (read-only portal).

## Where the code lives
- **`ridgeline-app/public/`** — the deployed app. Edit here.
  - `index.html` — shell + inline app script (render context, top bar, tabs, packet).
  - `keystone.js` — all app logic/views (home, estimate, schedule, draws, customer, catalog, packet).
  - `workbook.js`, `support.js`, `export.js`, `engine.js`, `sync.js` — engine, framework, xlsx export, sync.
  - `logo.jpeg` — real Ridgeline letterhead logo.
- **`ridgeline-app/functions/`** — Cloudflare Pages Functions (the backend API).
  - `api/*` — jobs, catalog, users, login, feed (calendar), **jobs/[id]/plans/** (R2 plan upload), **mcp-token**.
  - `mcp/[[path]].js` — the remote MCP server (phone/desktop control).
- `keystone-design/` — OLD diverged dev copy; do NOT deploy from it.

## Storage
- **KV** `RIDGELINE_KV` (id 5e92d933…): jobs, catalog, users, sessions.
- **R2** bucket `ridgeline-plans`: uploaded plan/file bytes (metadata lives on the job doc as `job.plans`).

## Deploy
Standing rule: after ANY change to `public/`, deploy immediately — run `ridgeline-app/deploy.bat`
(`npx wrangler pages deploy`). Hard-refresh (Ctrl+Shift+R) — assets cache hard.
Gotcha: OneDrive sometimes hands wrangler a **stale keystone.js** — if a deploy uploads the old file,
open keystone.js, save it, and redeploy (or wait for OneDrive to finish syncing).

## What's live now
- Estimate ledger (editable), per-line **Override Total** column, expand-all/collapse-all, editable item name+code.
- Global **Markup/Tax** apply to every cost line.
- Packet printout: real logo, header reads the **job name**, no EST#, cost-code column tight, ¼" extra print margins.
- **Morning sheet (home):** small KPI strip (Under Contract / Left to Invoice / Completed 12mo), "On the books"
  list with per-job next-2-tasks, **☑ add-to-do** + **⚙ customer/settings** + rename/delete icons per active job,
  Week Ahead, aggregate open **To-dos** card. Sitely logo AND Home tab → morning sheet.
- **Customer page** (reached via ⚙): to-do list, **Plans & files** (R2 upload/view/delete), site map from address,
  contact, private notes, status, portal access.
- **Schedule / Draws** pages; to-do list also shown on Schedule.
- **MCP connector** (`/mcp/<token>`, 29 tools) for phone/desktop control of jobs/estimate/schedule/draws.

## Recent work
- Imported **Davi Residence - Shop** (from the 2025-07-27 estimate, sheet 2): 11 categories, 24 items,
  36 cost lines, 9 allowances, 5 draws, contract $184,572.74. All cost codes + values preserved.
- Shipped R2 plan upload end-to-end (verified upload→list→download→delete).

## Open items / next ideas
- The 1×1 estimate-logic pass (richer per-line derivations) — deferred.
- Draw model has no date field (dates are embedded in draw names) — could add one.
- QuickBooks acct-codes (col I of estimates) aren't carried into Sitely line items — add a field if wanted.
- House-plan viewer polish (thumbnails, multi-page nav).
