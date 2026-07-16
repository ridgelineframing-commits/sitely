# Sitely

**Every site, sorted.** A construction-project workspace for Ridgeline Construction —
estimating, scheduling, draws, and a client/field portal — that grew out of an Excel
template into a hosted web app.

It runs entirely on **Cloudflare Pages**: a static, no-build frontend in `public/`,
serverless [Pages Functions](https://developers.cloudflare.com/pages/functions/) in
`functions/`, and a single **Workers KV** namespace for storage. Free-tier hosting,
offline-first, installable as a PWA.

---

## Architecture at a glance

```
Browser (SPA, no bundler)  ──fetch──►  /api/* Pages Functions  ──►  Workers KV (RIDGELINE_KV)
  public/*.js, index.html                functions/api/**/*.js         jobs, catalog, users, sessions
      │
      ├─ localStorage cache  (offline-first; last-write-wins)
      └─ .xlsx round-trip     (import/export the original workbook in-browser)
```

### Frontend (`public/`)

Hand-authored JS loaded with plain `<script>` tags — no build step, React via the
`support.js` runtime shim.

| File | Role |
|------|------|
| `index.html` | SPA shell, root component, tab routing, login, role-gated nav |
| `support.js` | Generated `dc-runtime` shim: bootstraps React/ReactDOM, parses the `<x-dc>` markup |
| `workbook.js` | The original Excel template serialized to JSON (`window.RIDGELINE_WB`) |
| `engine.js` | Hand-written Excel **formula engine** (tokenizer → parser → evaluator) |
| `export.js` | Hand-written **.xlsx export** (ZIP + CRC32) that patches the original workbook XML |
| `keystone.js` | Catalog / estimate / schedule / draws / dashboard + pricing math + theming |
| `sync.js` | `RidgelineSync` — cloud persistence + offline cache |
| `catalog-seed.json` | First-run seed for the cost catalog |

### Backend (`functions/api/`)

File-based routing; each file exports `onRequestGet/Post/Put/Delete`. Storage is one KV
namespace (`RIDGELINE_KV`) — no SQL.

| Route | Purpose |
|-------|---------|
| `_middleware.js` | Auth gate for all `/api/*` except `/api/login` and `/api/feed/*` |
| `login.js` | Password sign-in for the three roles |
| `jobs/` | Job CRUD + index |
| `catalog.js` | Cost catalog (admin write; pricing stripped for other roles) |
| `templates/` | Estimate templates (admin only) |
| `users/` | User management (admin only) |
| `feed-token.js`, `feed/` | Unauthenticated iCalendar (`.ics`) feeds for calendar apps |
| `_lib.js` | Shared auth helpers + role-aware sanitizers (`jobForPm`, `jobForCustomer`) |

**Roles:** `admin` (the `APP_PASSWORD` secret) · `pm` (unique per-user password;
schedule/notes only) · `customer` (email + password; read-only portal scoped to `jobIds`).

KV key layout: `session:<token>`, `users`, `job:<id>` + `jobs:index`, `catalog`,
`template:<id>` + `templates:index`, `feedtoken`.

---

## Local development

```bash
npm install                 # installs wrangler
echo 'APP_PASSWORD = "dev-password"' > .dev.vars   # local-only secret (gitignored)
npm run dev                 # wrangler pages dev — serves public/ + functions/ with a local KV
```

`npm run dev` reads the bindings from `wrangler.toml`, so the `/api/*` Functions and a
local KV namespace work end to end. `.dev.vars` supplies secrets locally (never committed).

## Tests

```bash
npm test        # node --test — no extra dependencies
```

The `test/` suite runs against the real modules (no mocks of our own code): the formula
engine, the `.xlsx` export round-trip, estimate/pricing math (client vs. server parity),
the auth middleware's session revocation, the self-healing jobs index, and the PM
estimate/notes views. CI (`.github/workflows/ci.yml`) runs these plus a syntax sweep on
every pull request.

## Deploy

```bash
npm run deploy              # wrangler pages deploy
```

First-time setup (Cloudflare account, KV namespace, project creation, `APP_PASSWORD`
secret, custom domain) is documented step by step in [`DEPLOY.md`](./DEPLOY.md).
Windows users can double-click `deploy.bat`.

## Data & backups

Each job is one small JSON object in KV, mirrored to each device's `localStorage`.
Conflicts on a single job are last-write-wins; the jobs **index** self-heals if a
concurrent write ever drops an entry. For a durable snapshot, use **Settings → Back up
all jobs (JSON)** (catalog + every job in one file) or **Download .xlsx** per job. There
is no scheduled/automated backup.

## Notes

- **`public/support.js` is vendored, generated output.** Its header points at a separate
  `dc-runtime` TypeScript project (`bun run build`) that is not part of this repo. Treat
  `support.js` as a build artifact — don't hand-edit it; regenerate it from that source.
- **Money display.** The client (`keystone.js`) and server (`functions/api/_lib.js`)
  compute pricing identically (there's a parity test). Figures are rounded only for
  display, so the shown per-line/category amounts can differ from the rounded contract
  total by a cent — this is intentional; the underlying math is exact.
- **Sessions** last 90 days (sliding) but are re-validated live against the user store, so
  deleting a user, changing their password, or changing a customer's job scope takes
  effect immediately.
