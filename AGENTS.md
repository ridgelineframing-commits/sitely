# Working in this repo

Sitely is Ridgeline's project-management app (estimate, schedule, draws, customer
packet). It is **in daily production use by a real construction company** — Zac
runs his jobs on it. A broken deploy is not an inconvenience, it is a workday.

Read `CLAUDE.md` first. It is the full operating manual for this codebase and
this file does not repeat it. What follows is only the set of things that have
actually broken, or that will break silently if you change them.

## Before you start

```bash
npm test          # 125 tests, node:test, no install needed. All must pass.
```

If they don't pass before your change, say so rather than working on top of red.

## How work ships

`edit → PR → merge to main → Cloudflare Pages auto-publishes`. That is the only
deploy path. **Never run `wrangler pages deploy`** — direct-uploading a local
copy has overwritten a newer git deploy before, which is why `deploy.bat` was
deleted. Merging is the deploy.

Open a PR. Do not push to `main` unless Zac asks for a hotfix.

## The mistake that has already been made here

In July 2026 a change added optimistic concurrency to `PUT /api/jobs/:id`:
missing `baseVersion` → **428**, stale one → **409**. It was good work, correctly
tested, and it updated Sitely's own client.

It still broke production for nine hours, because **this API has a second caller
in a different repo.** `Diligent-web/src/sitely.js` writes job schedules here,
was not updated, and every write failed. Sitely's tests were green the whole
time.

So: **before changing anything under `functions/api/`, ask who else calls it.**
Known external callers:

| Caller | Where | What it touches |
|---|---|---|
| Diligent-web | `src/sitely.js` in the `Diligent-web` repo | `GET/PUT /api/jobs/:id`, `GET/PUT /api/board` |
| Sitely Field | `public/field/app.js` (this repo, via `public/sync.js`) | jobs, board, schedule |
| Android widgets | `android/` (this repo) | `GET /api/jobs`, `GET /api/jobs/:id` |
| MCP connector | `functions/mcp/[[path]].js` (this repo) | writes KV directly, bypasses the API |

If a change to a request or response shape would break one of those, **stop and
tell Zac** rather than fixing it unilaterally in another repo.

## Things that must not change

These read like leftover branding or tidy-up opportunities. They are live
identifiers.

- **`unbothered-sync`** — the D1 database behind multi-device texting.
- **`ridgeline-workspace`** — the Cloudflare Pages project.
- **KV key names** (`job:<id>`, `jobs:index`, `board`, `users`, `session:<token>`,
  `mcptoken`, `sig:*`) — renaming any of them orphans live data.
- **Cost-code strings** in the estimate templates — they are the join key
  between the Bid Builder and the estimate.

## Invariants with real money behind them

- **Only `approved` change orders count toward the contract.** `changeOrderTotal`
  / `jobContractTotal` (server) and `approvedCOTotal` / `contractWithCOs`
  (client) are the single source of that math, and every draw bills against it.
- **Signature fields are server-owned.** `sanitizeChangeOrders` carries
  `signedAt`/`signedBy`/`signatureId` over from the stored copy and ignores what
  a PUT sends. That is what stops an admin write forging a signature. Do not
  "simplify" it into trusting the request body.
- **Only the owner may create, re-key or delete an administrator** — enforced
  server-side in `users/index.js` and `users/[id].js`, not just hidden in the UI.
- **Sign-in matches email and username, never the display name.** A name is
  printed on packets and shown to customers, so matching it makes accounts
  addressable by something public — and since `find` takes the first hit, two
  people named "Mike" would lock the second out entirely.

## Two files that must stay in sync

`public/keystone.js` and `functions/api/_schedule.js` hold the same schedule
engine — the client needs it and the MCP needs it server-side. Change one and
you must change the other; `test/schedule-engine-parity.test.mjs` fails
otherwise. That test is not being fussy, it is the whole reason schedules built
by Claude on the phone match schedules built in the browser.

## Where to edit

`ridgeline-app/public/` is the deployed app. **`keystone-design/` is an older
diverged copy — do not edit it.** Changing the wrong one produces a change that
tests clean and does nothing in production.

## Gotcha the sandbox will hand you

The bash mount sometimes serves a **stale, truncated `keystone.js`**, so
`node --check` reports a syntax error in a file that is actually fine. Use the
file-read tools rather than trusting bash on that one file.

## Definition of done

- `npm test` green, with a **new test for the behavior you changed**. Guard tests
  (proving the thing you must NOT do stays impossible) are worth more here than
  happy-path tests.
- A PR that says what broke, why, and what you deliberately did not do.
- If you found a second problem while fixing the first, say so instead of
  silently expanding scope.
