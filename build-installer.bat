@echo off
setlocal EnableDelayedExpansion
:: Always run from the folder where this script lives (project root)
cd /d "%~dp0"

title NEXOR ERP - Build Installer
color 0A

echo.
echo ========================================
echo    NEXOR ERP - BUILD INSTALLER
echo ========================================
echo.
echo [INFO] Running from: %cd%
echo.
set "FINAL_RELEASE_DIR=%cd%\release"
:: Build to TEMP so electron-builder never tries to delete release\win-unpacked\resources\app.asar
:: while NEXOR ERP is still running from that folder (Windows file lock).
set "BUILD_OUTPUT_DIR=%TEMP%\nexor-erp-release"
if not exist "%FINAL_RELEASE_DIR%" mkdir "%FINAL_RELEASE_DIR%"
if not exist "%BUILD_OUTPUT_DIR%" mkdir "%BUILD_OUTPUT_DIR%"

echo [INFO] Electron-builder staging dir: %BUILD_OUTPUT_DIR%
echo [INFO] Final artifacts + synced win-unpacked: %FINAL_RELEASE_DIR%
echo [INFO] Close NEXOR ERP before packaging, or the sync step may skip win-unpacked.
echo.
:: Prevent stale locked NSIS archive from blocking next build
if exist "release\nexor-erp-*.nsis.7z" (
    echo [INFO] Cleaning stale NSIS archive cache...
    del /f /q "release\nexor-erp-*.nsis.7z" >nul 2>nul
)
if exist "%BUILD_OUTPUT_DIR%\nexor-erp-*.nsis.7z" (
    del /f /q "%BUILD_OUTPUT_DIR%\nexor-erp-*.nsis.7z" >nul 2>nul
)
echo.

:: Check Node
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    pause
    exit /b 1
)
echo [OK] Node.js: 
node --version
echo.

if not exist "package.json" (
    echo [ERROR] package.json not found!
    pause
    exit /b 1
)

:: ---------- [1/4] Frontend deps (skip if node_modules exists) ----------
if exist "node_modules\.package-lock.json" (
    echo [1/4] Frontend dependencies already installed - SKIPPING
) else (
    echo [1/4] Installing frontend dependencies...
    call npm install
    if %errorlevel% neq 0 ( echo [ERROR] npm install failed & pause & exit /b 1 )
)
echo.

:: ---------- [2/4] Backend deps (always — avoids stale node_modules after package.json changes) ----------
echo [2/4] Installing backend dependencies...
call npm --prefix backend install --omit=dev
if %errorlevel% neq 0 ( echo [ERROR] backend install failed & pause & exit /b 1 )
if not exist "backend\node_modules\dotenv\package.json" (
    echo [ERROR] backend dotenv missing after install. Aborting.
    pause
    exit /b 1
)
echo.

:: ---------- [3/4] Build web app ----------
echo [3/4] Building web application (Vite)...
call npm run build
if %errorlevel% neq 0 ( echo [ERROR] Vite build failed & pause & exit /b 1 )
echo.

:: ---------- [4/4] Package Windows installer + portable ----------
echo [4/4] Packaging Windows installer (NSIS)...
echo [INFO] Ensuring build\icon.ico and build\icon.png for electron-builder...
call node scripts\ensure-build-icon.mjs
if %errorlevel% neq 0 ( echo [ERROR] ensure-build-icon failed & pause & exit /b 1 )
echo [INFO] Stopping NEXOR ERP if running (avoids file locks on app.asar)...
taskkill /F /IM "NEXOR ERP.exe" >nul 2>&1
powershell -NoProfile -Command "Start-Sleep -Seconds 2" >nul 2>&1
set CSC_IDENTITY_AUTO_DISCOVERY=false
set WIN_CSC_LINK=
set "NSIS_OK=0"
set /a NSIS_TRY=1
:NSIS_RETRY
echo [INFO] NSIS attempt !NSIS_TRY!/3 (30-minute max per attempt; first run may download Electron ~150MB)...
echo [INFO] After "icon" lines, NSIS can run 15-30+ min with little output - not frozen.
echo [INFO] If you see "lookup github.com: no such host", fix DNS/Wi-Fi/VPN then retry.
call node scripts\run-with-timeout.mjs 1800000 npx electron-builder --win nsis --publish never --config.win.signAndEditExecutable=false --config.directories.output="%BUILD_OUTPUT_DIR%"
if %errorlevel% equ 0 (
    set "NSIS_OK=1"
    goto AFTER_NSIS
)
if !NSIS_TRY! geq 3 (
    echo [WARN] NSIS installer build did not finish after 3 attempts.
    echo [WARN] Continuing with portable build so delivery is not blocked.
    goto AFTER_NSIS
)
echo [WARN] NSIS attempt failed or timed out. Cleaning cache and retrying in 6 seconds...
del /f /q "%BUILD_OUTPUT_DIR%\nexor-erp-*.nsis.7z" >nul 2>nul
powershell -NoProfile -Command "Start-Sleep -Seconds 6"
set /a NSIS_TRY+=1
goto NSIS_RETRY
:AFTER_NSIS
echo [4/4] Packaging Windows portable executable...
echo [INFO] Portable step may also sit quiet several minutes - still working.
call npx electron-builder --win portable --publish never --config.win.signAndEditExecutable=false --config.directories.output="%BUILD_OUTPUT_DIR%"
if %errorlevel% neq 0 ( echo [ERROR] Portable build failed & pause & exit /b 1 )

call node scripts\verify-packaged-backend.mjs "%BUILD_OUTPUT_DIR%\win-unpacked"
if %errorlevel% neq 0 ( echo [ERROR] Packaged backend verification failed & pause & exit /b 1 )

echo [INFO] Copying .exe files to release...
copy /Y "%BUILD_OUTPUT_DIR%\*.exe" "%FINAL_RELEASE_DIR%\" >nul
if %errorlevel% neq 0 ( echo [WARN] Copy exe to release had issues - check %BUILD_OUTPUT_DIR% )

echo [INFO] Syncing win-unpacked to release (stop NEXOR ERP if this fails)...
taskkill /F /IM "NEXOR ERP.exe" >nul 2>&1
powershell -NoProfile -Command "Start-Sleep -Seconds 2" >nul 2>&1
if exist "%FINAL_RELEASE_DIR%\win-unpacked" (
    rmdir /s /q "%FINAL_RELEASE_DIR%\win-unpacked" 2>nul
    if exist "%FINAL_RELEASE_DIR%\win-unpacked" (
        echo [WARN] Could not remove release\win-unpacked - still in use. Portable .exe in release is NEW.
        echo [WARN] Close the app, delete release\win-unpacked, then run: robocopy "%BUILD_OUTPUT_DIR%\win-unpacked" "%FINAL_RELEASE_DIR%\win-unpacked" /E
        goto AFTER_SYNC
    )
)
robocopy "%BUILD_OUTPUT_DIR%\win-unpacked" "%FINAL_RELEASE_DIR%\win-unpacked" /E /R:2 /W:2 /NFL /NDL /NJH /NJS /nc /ns /np >nul
set "RC=!errorlevel!"
if !RC! geq 8 (
    echo [WARN] robocopy win-unpacked failed code=!RC!. Fresh tree is under %BUILD_OUTPUT_DIR%\win-unpacked
) else (
    echo [OK] release\win-unpacked synced from build output.
)
:AFTER_SYNC

echo.
echo ========================================
echo    BUILD COMPLETE!
echo ========================================
echo.
echo Output in "release" folder:
dir /b release\*.exe 2>nul
echo.
if "%NSIS_OK%"=="1" (
    echo - Installer: run the x64 .exe to install on Windows
) else (
    echo - Installer: not generated in this run \(NSIS timed out/failed\)
)
echo - Portable: run the Portable .exe directly (no install)
echo.
pause
