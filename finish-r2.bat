@echo off
title Finish R2 + Deploy
cd /d "C:\Users\zac\Claude\Projects\xcell redesign to html\ridgeline-app"
echo === Step 1: create R2 bucket ===
call npx wrangler r2 bucket create ridgeline-plans
echo.
echo === Step 2: deploy ===
call npx wrangler pages deploy
echo.
echo ============================================
echo   Done. Look for "Deployment complete!" above.
echo ============================================
pause
