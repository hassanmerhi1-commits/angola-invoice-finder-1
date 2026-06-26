@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ================================================
echo   NEXOR ERP - ONE-TIME DATA MIGRATION
echo   (SQLite backup  -^>  Postgres)
echo ================================================
echo.

REM Find a .db file inside the import folder.
set "DBFILE="
for %%F in (import\*.db) do set "DBFILE=%%~nxF"

if "%DBFILE%"=="" (
  echo No .db backup found in the import folder.
  echo.
  echo Copy your backup file into:
  echo     %cd%\import\
  echo Then run this file again.
  echo.
  pause
  exit /b 1
)

echo Found backup:  import\%DBFILE%
echo.
echo *** WARNING ***
echo This REPLACES everything currently in the Postgres database with the
echo contents of %DBFILE%. Run this ONCE, BEFORE anyone starts using the server.
echo Running it again later will erase data entered after the migration.
echo.
set /p CONFIRM="Type  YES  to proceed (anything else cancels): "
if /i not "!CONFIRM!"=="YES" (
  echo.
  echo Cancelled. Nothing was changed.
  pause
  exit /b 0
)

echo.
echo Running migration...
echo.
docker compose run --rm -e SQLITE_PATH=/import/%DBFILE% --entrypoint node backend scripts/migrate-sqlite-to-postgres.js
if errorlevel 1 (
  echo.
  echo [ERROR] Migration did not complete. Review the messages above.
  pause
  exit /b 1
)

echo.
echo ================================================
echo   Migration finished. Review the counts above.
echo ================================================
echo.
pause
