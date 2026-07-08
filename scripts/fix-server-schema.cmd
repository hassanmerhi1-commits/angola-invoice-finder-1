@echo off
setlocal EnableExtensions
title NEXOR ERP — repair PostgreSQL schema
set "INSTALL_DIR=%~dp0"
if /I not "%INSTALL_DIR:~-1%"=="\" set "INSTALL_DIR=%INSTALL_DIR%\"

:: When run from repo during development
if exist "%~dp0..\backend\scripts\ensure-server-schema.js" (
  set "BACKEND=%~dp0..\backend"
  goto :run
)

:: Shipped next to this script in C:\NEXOR ERP\ (v1.0.108+)
if exist "%INSTALL_DIR%backend\scripts\ensure-server-schema.js" (
  set "BACKEND=%INSTALL_DIR%backend"
  goto :run
)

:: Packaged Electron app — backend lives under resources\ next to NEXOR ERP.exe
set "BACKEND="
for %%P in (
  "%LOCALAPPDATA%\Programs\NEXOR ERP\resources\backend"
  "%ProgramFiles%\NEXOR ERP\resources\backend"
  "%ProgramFiles(x86)%\NEXOR ERP\resources\backend"
  "%INSTALL_DIR%..\resources\backend"
) do (
  if exist "%%~P\scripts\ensure-server-schema.js" (
    set "BACKEND=%%~P"
    goto :run
  )
)

echo [ERROR] Could not find backend\scripts\ensure-server-schema.js
echo.
echo Looked in:
echo   %INSTALL_DIR%backend
echo   %LOCALAPPDATA%\Programs\NEXOR ERP\resources\backend
echo   %ProgramFiles%\NEXOR ERP\resources\backend
echo.
echo Find it manually:
echo   dir /s /b "%LOCALAPPDATA%\Programs" ensure-server-schema.js 2^>nul
echo   dir /s /b "%ProgramFiles%" ensure-server-schema.js 2^>nul
echo.
pause
exit /b 1

:run
if not exist "%INSTALL_DIR%database.env" (
  if not exist "C:\NEXOR ERP\database.env" (
    echo [ERROR] database.env not found.
    echo This repair is for the PostgreSQL SERVER PC.
    echo Create C:\NEXOR ERP\database.env with DATABASE_URL=postgres://...
    pause
    exit /b 1
  )
  set "NEXOR_INSTALL_DIR=C:\NEXOR ERP"
) else (
  set "NEXOR_INSTALL_DIR=%INSTALL_DIR%"
)

echo Using backend: %BACKEND%
echo Install dir:   %NEXOR_INSTALL_DIR%
echo.
cd /d "%BACKEND%"
node scripts\ensure-server-schema.js
set ERR=%ERRORLEVEL%
echo.
if %ERR% NEQ 0 (
  echo [FAILED] Exit code %ERR%
) else (
  echo [OK] Restart NEXOR ERP, then open:
  echo   http://localhost:3001/api/health?lite=1
  echo Expected: engine=postgres, schemaVersion=53
)
pause
exit /b %ERR%
