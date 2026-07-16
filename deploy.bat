@echo off
title Keystone Deploy
cd /d "C:\Users\zac\Claude\Projects\xcell redesign to html\ridgeline-app"
echo ============================================
echo   Deploying Keystone to Cloudflare...
echo ============================================
call npx wrangler pages deploy
echo.
echo ============================================
echo   Done! Hard-refresh the site (Ctrl+F5).
echo   This window closes in 15 seconds.
echo ============================================
timeout /t 15
