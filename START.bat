@echo off
title StockMind AI Pro
color 0A

echo.
echo  ============================================
echo   StockMind AI Pro v2 - Launching...
echo  ============================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo  [ERROR] Node.js is not installed.
    echo  Get it from: https://nodejs.org
    pause & exit /b 1
)

if not exist "backend\.env" (
    copy "backend\.env.example" "backend\.env" >nul
    echo  [SETUP] Created backend\.env
    echo  You can leave it as-is — no Finnhub key needed here anymore!
    echo  Users bring their own keys via Google login.
    echo.
)

if not exist "backend\node_modules" (
    echo  Installing backend dependencies (one time only)...
    cd backend && call npm install && cd ..
    echo.
)

echo  Starting backend on port 3001...
start "StockMind Backend" cmd /k "cd /d "%~dp0backend" && node server.js"

timeout /t 2 /nobreak >nul

echo  Opening app in browser...
start "" "%~dp0frontend\index.html"

echo.
echo  ============================================
echo   StockMind AI Pro is running!
echo  ============================================
echo.
echo  Users sign in with Google - no setup needed for them.
echo  Close the "StockMind Backend" window to stop.
echo.
pause
