@echo off
setlocal
title NEXOR ERP — repair PostgreSQL schema
set "INSTALL_DIR=%~dp0"
if /I not "%INSTALL_DIR:~-1%"=="\" set "INSTALL_DIR=%INSTALL_DIR%\"
set "NEXOR_INSTALL_DIR=%INSTALL_DIR%"
set "BACKEND=%INSTALL_DIR%resources\backend"

if not exist "%BACKEND%\scripts\ensure-server-schema.js" (
  echo [ERROR] Backend not found at:
  echo   %BACKEND%
  echo Run this from the NEXOR ERP install folder ^(e.g. C:\NEXOR ERP\^).
  pause
  exit /b 1
)

if not exist "%INSTALL_DIR%database.env" (
  echo [ERROR] database.env missing in %INSTALL_DIR%
  echo This script is for the PostgreSQL SERVER PC only.
  pause
  exit /b 1
)

echo Repairing schema on PostgreSQL server...
cd /d "%BACKEND%"
node scripts\ensure-server-schema.js
set ERR=%ERRORLEVEL%
echo.
if %ERR% NEQ 0 (
  echo [FAILED] Exit code %ERR% — check backend log in %%LOCALAPPDATA%%\NEXOR ERP\logs
) else (
  echo [OK] Restart NEXOR ERP, then open:
  echo   http://localhost:3001/api/health?lite=1
  echo Expected: engine=postgres, schemaVersion=53
)
pause
exit /b %ERR%
