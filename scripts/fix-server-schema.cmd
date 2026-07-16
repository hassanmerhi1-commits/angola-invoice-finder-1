@echo off
setlocal EnableExtensions EnableDelayedExpansion
title NEXOR ERP — repair PostgreSQL schema

:: ---------------------------------------------------------------------------
:: Repairs PostgreSQL schema on the SERVER PC (database.env required).
:: Works from C:\NEXOR ERP\ or from the installed app resources folder.
:: Uses NEXOR ERP.exe as Node when "node" is not in PATH.
:: ---------------------------------------------------------------------------

set "SCRIPT_DIR=%~dp0"
if /I not "!SCRIPT_DIR:~-1!"=="\" set "SCRIPT_DIR=!SCRIPT_DIR!\"

set "INSTALL_DIR=C:\NEXOR ERP"
if exist "!SCRIPT_DIR!database.env" set "INSTALL_DIR=!SCRIPT_DIR!"
if exist "C:\NEXOR ERP\database.env" set "INSTALL_DIR=C:\NEXOR ERP"

if not exist "!INSTALL_DIR!database.env" (
  echo [ERROR] database.env not found.
  echo.
  echo This script must run on the PostgreSQL SERVER PC.
  echo Create: C:\NEXOR ERP\database.env
  echo   DATABASE_URL=postgres://user:pass@host:5432/dbname
  echo   DB_ENGINE=postgres
  echo.
  pause
  exit /b 1
)

set "NEXOR_INSTALL_DIR=!INSTALL_DIR!"
set "BACKEND="

:: 1) Explicit override
if defined NEXOR_BACKEND_ROOT (
  if exist "!NEXOR_BACKEND_ROOT!\scripts\ensure-server-schema.js" set "BACKEND=!NEXOR_BACKEND_ROOT!"
)

:: 2) Backend next to this script (resources\fix-server-schema.cmd + resources\backend)
if not defined BACKEND if exist "!SCRIPT_DIR!backend\scripts\ensure-server-schema.js" (
  set "BACKEND=!SCRIPT_DIR!backend"
)

:: 3) C:\NEXOR ERP\backend (sync-nexor-backend.ps1 overlay)
if not defined BACKEND if exist "!INSTALL_DIR!backend\scripts\ensure-server-schema.js" (
  set "BACKEND=!INSTALL_DIR!backend"
)

:: 4) Packaged app resources
if not defined BACKEND if exist "%ProgramFiles%\NEXOR ERP\resources\backend\scripts\ensure-server-schema.js" (
  set "BACKEND=%ProgramFiles%\NEXOR ERP\resources\backend"
)
if not defined BACKEND if exist "%ProgramFiles(x86)%\NEXOR ERP\resources\backend\scripts\ensure-server-schema.js" (
  set "BACKEND=%ProgramFiles(x86)%\NEXOR ERP\resources\backend"
)
if not defined BACKEND if exist "%LOCALAPPDATA%\Programs\NEXOR ERP\resources\backend\scripts\ensure-server-schema.js" (
  set "BACKEND=%LOCALAPPDATA%\Programs\NEXOR ERP\resources\backend"
)

:: 5) Repo dev layout
if not defined BACKEND if exist "!SCRIPT_DIR!..\backend\scripts\ensure-server-schema.js" (
  set "BACKEND=!SCRIPT_DIR!..\backend"
)

if not defined BACKEND (
  echo [ERROR] Could not find backend\scripts\ensure-server-schema.js
  echo.
  echo Install the latest NEXOR-ERP-x64.exe on this SERVER PC, then run this script again.
  echo Or from a dev PC run: scripts\sync-nexor-backend.ps1
  echo.
  echo Searched:
  echo   !SCRIPT_DIR!backend
  echo   !INSTALL_DIR!backend
  echo   %ProgramFiles%\NEXOR ERP\resources\backend
  echo   %LOCALAPPDATA%\Programs\NEXOR ERP\resources\backend
  echo.
  pause
  exit /b 1
)

set "NODE_RUNNER="
set "USE_ELECTRON_NODE=0"

where node >nul 2>&1
if !ERRORLEVEL! EQU 0 (
  set "NODE_RUNNER=node"
  goto :run_schema
)

if exist "%ProgramFiles%\NEXOR ERP\NEXOR ERP.exe" (
  set "NODE_RUNNER=%ProgramFiles%\NEXOR ERP\NEXOR ERP.exe"
  set "USE_ELECTRON_NODE=1"
  goto :run_schema
)
if exist "%LOCALAPPDATA%\Programs\NEXOR ERP\NEXOR ERP.exe" (
  set "NODE_RUNNER=%LOCALAPPDATA%\Programs\NEXOR ERP\NEXOR ERP.exe"
  set "USE_ELECTRON_NODE=1"
  goto :run_schema
)

echo [ERROR] Neither "node" nor NEXOR ERP.exe found.
echo Install NEXOR ERP on this server, or add Node.js to PATH.
pause
exit /b 1

:run_schema
echo Install dir:  !INSTALL_DIR!
echo Backend:      !BACKEND!
echo Node runner:  !NODE_RUNNER!
echo.
cd /d "!BACKEND!"

if "!USE_ELECTRON_NODE!"=="1" (
  set ELECTRON_RUN_AS_NODE=1
  "!NODE_RUNNER!" scripts\ensure-server-schema.js
) else (
  "!NODE_RUNNER!" scripts\ensure-server-schema.js
)
set ERR=!ERRORLEVEL!

echo.
if !ERR! NEQ 0 (
  echo [FAILED] Exit code !ERR!
  echo.
  echo Common fixes:
  echo   - Install latest NEXOR-ERP-x64.exe on this SERVER PC
  echo   - Confirm database.env DATABASE_URL is correct
  echo   - Ensure PostgreSQL is running
  echo   - Close NEXOR ERP before running this script
  echo.
  echo Log hint: %APPDATA%\NEXOR ERP\logs\backend-*.log
) else (
  echo [OK] Schema repair finished.
  echo Restart NEXOR ERP on this server, then check:
  echo   http://localhost:3000/api/health?lite=1
  echo Expected: engine=postgres, schemaVersion=56, schemaVersionExpected=56
)
pause
exit /b !ERR!
