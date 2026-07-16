# Keystone Field — merging the Job Progress app into Keystone

## Roles & portal plan (added 2026-07-04, build in the portal round)
Three login levels, one app:
1. **Admin (Zac)** — everything, as today. Approves PM notes.
2. **Project manager** — logs in with own password.
   - CAN freely: edit the Schedule (dates, status, % complete) — changes sync + hit calendar feeds immediately, no approval.
   - CAN propose: notes on the Estimate and Draw schedule — saved as *pending notes*, visible to admin with an Approve / Reject queue (badge on Home). Nothing shows on customer-facing documents until approved.
   - CANNOT: change pricing, catalog, templates, settings, or see internal markup columns (configurable).
3. **Customer** — per-job private link or email+password.
   - Sees only what admin flags visible: packet content (specs/estimate/allowances/exclusions), optionally schedule + progress.
   - E-signature flow: review locked proposal → type name + draw signature → stored with timestamp + document hash (ESIGN/UETA-style audit trail). Change orders and selections sign-offs first; primary contracts pending attorney check.

Implementation sketch: `users` KV doc {id, role, passHash, jobIds?}; session tokens carry role; API middleware gates writes by role; `job.pendingNotes[]` + approval endpoints; customer tokens are per-job read-scoped.

## The idea in one line
Your Netlify dashboard becomes **Keystone Field**: the phone-first face of Keystone —
same jobs, same database, same login — for updating progress from the truck instead of
building estimates at the desk.

## Why merge (what's wrong with two separate apps)
The Job Progress app stores everything in the phone's browser (localStorage) — one dropped
phone or cleared browser and it's gone, and the office never sees updates without a manual
backup. It also needs a Google Cloud OAuth setup for calendar sync and a "pending Excel
updates" log that a human re-keys into workbooks. Keystone already solved all three:
cloud storage, one password, calendar feeds, and no Excel re-keying.

## What each side brings
| From Job Progress (field) | From Keystone (office) |
|---|---|
| Job cards with progress % rulers | Jobs, estimates, catalog, templates |
| Current phase / status + target finish | Schedule rows (drive the calendar feeds) |
| Action steps & milestones | Customer packet, xlsx export |
| Quick-sketch tool (pen/line/box/arrow) | Cloud KV storage + password login |
| Blueprint / Clean card themes | ICS calendar feeds (no Google OAuth needed) |
| PWA install + offline | Offline edit queue with auto-sync |

## Architecture (small, because Keystone did the heavy lifting)
- **One backend.** Field reads/writes the same `/api/jobs/:id` — no new database.
- **Job model gains a `field` section:** `{ progressPct, phase, targetFinish, steps:[{text,done}], notes, sketches:[{png-base64, caption, date}] }` — saved with the job like `estimate` and `schedule` already are.
- **Field page** at the same URL (`/field.html` or auto-detected on phones): job cards with
  progress rulers, tap to update %, phase, steps; sketch canvas attaches drawings to a job
  (and optionally a calendar day).
- **Calendar:** milestones/steps with dates become schedule rows → they appear in the
  existing ICS feeds automatically. The Google-OAuth setup from the old README is never needed.
- **Office visibility:** Keystone desktop gets a read-out of field data per job (progress bar
  next to the job name, latest phase on the Estimate header) — the office always knows where
  every job stands.
- **Migration:** one-time import button reads a Job Progress backup JSON and creates/updates
  Keystone jobs from it.

## What dies happily
- localStorage-only data (replaced by KV + offline cache)
- Google Cloud OAuth client setup (replaced by ICS feeds)
- "Pending Excel updates" log (Keystone *is* the workbook now)
- Separate Netlify hosting (one Cloudflare app, one URL, one password)

## Zac's additions (2026-07-04) — build after the new UI comes back
1. **Companion app launcher** — app-style icons on the main UI linking to:
   - PocketBuilder Calculator — https://pocketbuildercalculator.netlify.app
   - YardStick PDF (plan takeoff) — https://yardstickpdf.netlify.app/
   Likely home: sidebar footer or a small "TOOLS" group; on the phone dashboard, icons in the header.
2. **Landing page / dashboard (the "field update" view)** — first thing you see after sign-in:
   every current job as a card with progress, current phase, and *little update notes when
   something changed* — especially calendar/schedule changes ("Framing moved to Mon 7/13").
   Implementation note: keep a small per-job changelog (last ~20 changes with dates) written
   whenever schedule rows or estimate totals change, so the dashboard can show "what's new"
   without the office writing anything by hand.

## Build order
1. **Phase 1 — Field core:** `field` data on jobs + phone-first Field page (cards, progress,
   phase, steps, target finish). Import from Job Progress backup.
2. **Phase 2 — Sketches:** canvas tool ported from the dashboard app; drawings saved to the job,
   attachable to schedule dates (they ride the ICS feed as event descriptions/links).
3. **Phase 3 — Office integration:** field status surfaced across Keystone desktop; field
   updates shown in the job list; optional "daily log" per job.

Design note: Phase 1 can incorporate whatever visual direction comes back from the
Claude Design session, so the field view is born with the new look.
