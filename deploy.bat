@echo off
title Sitely Deploy
cd /d "C:\Users\zac\Claude\Projects\xcell redesign to html\ridgeline-app"

echo ============================================
echo   Sitely deploy
echo ============================================
echo.
echo NOTE: Merging a pull request to 'main' on GitHub already deploys the site
echo automatically (~1 min). You normally do NOT need this script.
echo It is a manual fallback and will refuse to publish anything older than main,
echo so the live site can never go backwards.
echo.

if not exist ".git\" (
  echo [!] This folder is not a git clone, so I cannot confirm it matches main.
  echo     One-time fix: clone the repo into a fresh folder and deploy from there:
  echo         git clone https://github.com/ridgelineframing-commits/sitely.git
  echo     Deploying the current local files as-is for now...
  echo.
  call npx wrangler pages deploy
  goto :done
)

echo Fetching latest main from GitHub...
git fetch origin main || goto :giterr
echo Fast-forwarding local checkout to origin/main...
git pull --ff-only origin main || goto :stale

echo.
echo Uploading current main to Cloudflare Pages...
call npx wrangler pages deploy
goto :done

:stale
echo.
echo *** DEPLOY ABORTED - your local copy is not a clean match for main. ***
echo You have local commits or edits that were never pushed. Push them through
echo GitHub (which auto-deploys), or run 'git stash' to set them aside, then retry.
echo This guard is exactly what stops an old local copy from overwriting the live site.
echo.
pause
goto :eof

:giterr
echo.
echo *** Could not reach GitHub to verify you are up to date. ***
echo Check your internet / git sign-in, then retry. Not deploying a possibly-stale copy.
echo.
pause
goto :eof

:done
echo.
echo ============================================
echo   Done! Hard-refresh the site (Ctrl+Shift+R).
echo   This window closes in 15 seconds.
echo ============================================
timeout /t 15
