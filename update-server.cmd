@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo   NEXOR ERP - SERVER UPDATE
echo ================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo Git is not installed on this PC.
  echo Download the latest project files manually, replace this folder,
  echo then run deploy-server.cmd again.
  pause
  exit /b 1
)

echo Pulling the latest version...
git pull origin main
if errorlevel 1 (
  echo [ERROR] git pull failed. Check the internet connection and try again.
  pause
  exit /b 1
)

echo.
echo Rebuilding and restarting the API...
docker compose build backend
if errorlevel 1 ( echo [ERROR] Build failed. & pause & exit /b 1 )

docker compose up -d
if errorlevel 1 ( echo [ERROR] Restart failed. & pause & exit /b 1 )

echo.
echo ================================================
echo   Server updated and running on port 3000.
echo   (Your data is preserved - this does NOT touch the database.)
echo ================================================
echo.
pause
