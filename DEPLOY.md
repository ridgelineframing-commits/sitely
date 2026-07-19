# Ridgeline Workspace — Deploy Guide

Your Excel-replacement app, upgraded to a real hosted web app:

- **Cloud storage** — every edit saves to Cloudflare's database (KV) automatically. localStorage is now just an offline cache; nothing is lost if you clear your browser or switch devices.
- **Multiple jobs** — a JOBS section in the sidebar; each job keeps its own set of edits. Create, rename, delete, switch.
- **Password sign-in** — one password (you pick it below), works on any device, stays signed in ~90 days per device.
- **Mobile** — sidebar becomes a slide-out drawer under 900px width. Works in any phone browser; add it to your home screen and it feels like an app.
- **Offline-safe** — if you edit with no signal, changes queue on the device and push automatically when you're back online.
- **Excel round-trip unchanged** — Download .xlsx still works exactly as before, per job.

Cost: $0/month on Cloudflare's free tier (limits are far above what one company will ever hit).

---

## One-time setup (~10 minutes)

You need Node.js installed (https://nodejs.org, LTS version, default options).

**1. Create a free Cloudflare account**
Go to https://dash.cloudflare.com/sign-up — email + password, free plan.

**2. Open a terminal** (Windows: press Start, type `cmd`) and go to this folder:
```
cd "C:\Users\zac\Claude\Projects\xcell redesign to html\ridgeline-app"
```

**3. Log the tool into your Cloudflare account** (browser window opens — click Allow):
```
npx wrangler login
```

**4. Create the storage bucket:**
```
npx wrangler kv namespace create RIDGELINE_KV
```
This prints an `id = "xxxxxxxx..."` line. Open `wrangler.toml` in Notepad and replace
`PASTE_KV_NAMESPACE_ID_HERE` with that id. Save.

**5. Create the site and deploy:**
```
npx wrangler pages project create ridgeline-workspace --production-branch main
npx wrangler pages deploy
```

**6. Set your sign-in password** (you'll be prompted to type it — pick something strong):
```
npx wrangler pages secret put APP_PASSWORD --project-name ridgeline-workspace
```

**7. Done.** Your app is live at:
```
https://ridgeline-workspace.pages.dev
```
Open it, sign in, and your old edits from the browser version are automatically imported as "Job 1".

## On your phone

Open the same URL in Safari/Chrome, sign in once, then use **Share → Add to Home Screen**. It launches full-screen like a native app.

## Updating the app later — git only

Deploys are **automatic and git-only**: when a change is merged to the `main` branch on GitHub,
Cloudflare Pages (connected to this repo) builds and publishes it within ~1 minute. That is the
single source of truth — you don't run anything by hand, and there is no manual upload step.

The normal flow is: make the change on a branch → open a pull request → merge it → the site
updates itself. (There is no `deploy.bat` anymore — direct-uploading a stale local copy is exactly
what used to overwrite the live site with an old version, so that path was removed.)

If you ever need an emergency hotfix without a PR, commit and push straight to `main` — it still
goes through the same git integration and deploys. Never run `wrangler pages deploy` by hand.

## Notes

- **Changing the password:** re-run step 6, then redeploy (step 5's second command). Existing signed-in devices stay signed in; use "Sign out" in the sidebar footer if needed.
- **Conflicts:** if two devices edit the same job at the same time, last save wins. For a one-person company this is fine; say the word if you ever want proper merge handling.
- **Backups:** your data is one small JSON object per job in Cloudflare KV, plus a copy cached on each device. For belt-and-suspenders, occasionally hit "Download .xlsx" per job — that file is a complete backup Excel can open.
- **Custom domain (optional):** in the Cloudflare dashboard → Pages → ridgeline-workspace → Custom domains, you can attach e.g. `jobs.ridgeline.construction`.
