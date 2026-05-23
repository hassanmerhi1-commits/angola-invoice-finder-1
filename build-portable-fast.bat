@echo off
cd /d "%~dp0"
title NEXOR ERP - Fast Portable Build
color 0A
echo [1/2] Building web app...
call npm run build
if %errorlevel% neq 0 exit /b 1
echo [2/2] Packaging portable app from minimal staged files...
call node scripts\build-portable-fast.mjs
if %errorlevel% neq 0 exit /b 1
echo.
set "RELEASE_DIR=%cd%\release"
set "PORTABLE_EXE="
for /f "delims=" %%F in ('dir /b /o-d /tw "%RELEASE_DIR%\NEXOR-ERP-Portable*.exe" 2^>nul') do (
  if not defined PORTABLE_EXE set "PORTABLE_EXE=%RELEASE_DIR%\%%F"
)
if defined PORTABLE_EXE (
  echo Done. Portable app:
  echo   %PORTABLE_EXE%
  explorer /select,"%PORTABLE_EXE%"
) else (
  echo Done. Check the release folder:
  echo   %RELEASE_DIR%
  start "" "%RELEASE_DIR%"
)
