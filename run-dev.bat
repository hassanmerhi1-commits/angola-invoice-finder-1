@echo off
title NEXOR ERP - Development Mode
color 0B

echo.
echo ========================================
echo    KWANZA ERP - DEV MODE
echo ========================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please download and install Node.js from https://nodejs.org
    pause
    exit /b 1
)

:: Check if node_modules exists
if not exist "node_modules" (
    echo [INFO] Installing dependencies first...
    call npm install
)

echo [INFO] Starting NEXOR ERP in development mode...
echo [INFO] The app will open automatically when ready.
echo [INFO] Press Ctrl+C to stop.
echo.

:: Run electron in dev mode
call npx concurrently "npm run dev" "npx wait-on http://localhost:8080 && npx cross-env ELECTRON_DEV=true npx electron ."
