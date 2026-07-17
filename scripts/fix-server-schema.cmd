@echo off
setlocal EnableExtensions
title NEXOR ERP — repair PostgreSQL schema

:: Always delegate to PowerShell (picks NEWEST backend, stops NEXOR, writes log).
:: Log: C:\NEXOR ERP\fix-server-schema.log

set "INSTALL_DIR=C:\NEXOR ERP"
set "PS1="
set "SCRIPT_DIR=%~dp0"
if /I not "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR%\"

:: Prefer newest script from installed app (C:\NEXOR ERP copy may be stale)
for %%F in (
  "%ProgramFiles%\NEXOR ERP\resources\fix-server-schema.ps1"
  "%ProgramFiles(x86)%\NEXOR ERP\resources\fix-server-schema.ps1"
  "%LOCALAPPDATA%\Programs\NEXOR ERP\resources\fix-server-schema.ps1"
  "%SCRIPT_DIR%fix-server-schema.ps1"
  "%INSTALL_DIR%\fix-server-schema.ps1"
) do (
  if not defined PS1 if exist %%~F set "PS1=%%~F"
)

if not defined PS1 (
  echo [ERROR] fix-server-schema.ps1 not found.
  echo Install NEXOR-ERP-1.1.32-x64.exe on this SERVER PC.
  echo.
  echo Or run this in PowerShell on the server:
  echo   Get-ChildItem -Path "C:\Program Files","%LOCALAPPDATA%\Programs" -Recurse -Filter ensure-server-schema.js -ErrorAction SilentlyContinue
  pause
  exit /b 1
)

echo Using: %PS1%
echo Log:   %INSTALL_DIR%\fix-server-schema.log
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set ERR=%ERRORLEVEL%

if %ERR% NEQ 0 (
  echo.
  echo [FAILED] See log: %INSTALL_DIR%\fix-server-schema.log
  type "%INSTALL_DIR%\fix-server-schema.log" 2>nul
)
pause
exit /b %ERR%
