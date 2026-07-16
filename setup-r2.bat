@echo off
title R2 bucket setup
cd /d "C:\Users\zac\Claude\Projects\xcell redesign to html\ridgeline-app"
echo Creating R2 bucket "ridgeline-plans"...
call npx wrangler r2 bucket create ridgeline-plans
echo.
echo ============================================
echo   If you see "Created bucket" above, you're good.
echo   If it says R2 must be enabled, enable R2 (free) in the
echo   Cloudflare dashboard then run this again.
echo ============================================
pause
