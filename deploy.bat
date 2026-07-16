@echo off
title Sitely Deploy
cd /d "C:\Users\zac\OneDrive - Ridgeline Construction\Claude\Projects\Sitely"
echo ============================================
echo   Deploying Sitely to Cloudflare...
echo ============================================
call npx wrangler pages deploy
echo.
echo ============================================
echo   Done! Hard-refresh the site (Ctrl+F5).
echo   This window closes in 15 seconds.
echo ============================================
timeout /t 15
