@echo off
title Sitely Deploy
REM Run from wherever this file lives — no hard-coded machine path.
cd /d "%~dp0"
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
