@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NEXOR ERP - Run Portable

set "RELEASE_DIR=%cd%\release"
set "PORTABLE_EXE="

if exist "%RELEASE_DIR%" (
  for /f "delims=" %%F in ('dir /b /o-d /tw "%RELEASE_DIR%\NEXOR-ERP-Portable*.exe" 2^>nul') do (
    if not defined PORTABLE_EXE set "PORTABLE_EXE=%RELEASE_DIR%\%%F"
  )
)

if not defined PORTABLE_EXE (
  echo No portable build found in:
  echo   %RELEASE_DIR%
  echo.
  echo Building now ^(this takes a few minutes^)...
  call "%~dp0build-portable-fast.bat"
  if %errorlevel% neq 0 exit /b %errorlevel%
  for /f "delims=" %%F in ('dir /b /o-d /tw "%RELEASE_DIR%\NEXOR-ERP-Portable*.exe" 2^>nul') do (
    if not defined PORTABLE_EXE set "PORTABLE_EXE=%RELEASE_DIR%\%%F"
  )
)

if not defined PORTABLE_EXE (
  echo.
  echo [ERROR] Build finished but no NEXOR-ERP-Portable*.exe was found.
  echo Check: %RELEASE_DIR%
  echo Also check: %cd%\.tmp-electron-package\release-out
  pause
  exit /b 1
)

echo.
echo ========================================
echo   NEXOR ERP portable app
echo ========================================
echo.
echo   %PORTABLE_EXE%
echo.
echo Double-click that file to start the app.
echo ^(No installer — it does not appear on the Start menu.^)
echo.

explorer /select,"%PORTABLE_EXE%"
start "" "%PORTABLE_EXE%"
