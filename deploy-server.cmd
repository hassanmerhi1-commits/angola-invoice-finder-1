@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ================================================
echo   NEXOR ERP - SERVER DEPLOY
echo ================================================
echo.
echo Starting database + API...
echo (The first run builds the API image and can take a few minutes.)
echo.

docker compose up -d --build
if errorlevel 1 (
  echo.
  echo [ERROR] Could not start Docker.
  echo Make sure Docker Desktop is installed and RUNNING, then run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo Waiting for the database to accept connections...
set /a tries=0
:waitpg
docker compose exec -T postgres pg_isready -U postgres >nul 2>&1
if not errorlevel 1 goto pgready
set /a tries+=1
if !tries! geq 60 (
  echo [ERROR] Database did not become ready in time.
  echo Check logs with:  docker compose logs postgres
  pause
  exit /b 1
)
timeout /t 2 >nul
goto waitpg
:pgready

echo Database is ready. The API is now running on port 3000.
echo.
echo ================================================
echo   ADDRESS FOR CLIENT PCs
echo ================================================
where tailscale >nul 2>&1
if errorlevel 1 (
  echo Tailscale was not found on this PC.
  echo Install Tailscale, sign in, then run:  tailscale ip -4
  echo Clients then connect to:  http://[that-IP]:3000
) else (
  for /f "tokens=*" %%i in ('tailscale ip -4 2^>nul') do echo Clients connect to:  http://%%i:3000
)

echo.
echo ------------------------------------------------
echo FIRST TIME ONLY: to load your existing data,
echo  1) copy your backup file (e.g. belas-GOLD.db) into the "import" folder
echo  2) run  migrate-data.cmd   ONCE
echo ------------------------------------------------
echo.
pause
