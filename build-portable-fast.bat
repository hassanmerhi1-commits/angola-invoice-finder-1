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
echo Done. Check the release folder.
start "" "release"
