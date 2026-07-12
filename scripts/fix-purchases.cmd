@echo off
setlocal EnableExtensions
title NEXOR ERP - reparar faturas de compra (Soyo 05)
set "INSTALL_DIR=%~dp0"
if /I not "%INSTALL_DIR:~-1%"=="\" set "INSTALL_DIR=%INSTALL_DIR%\"

:: When run from repo during development
if exist "%~dp0..\backend\scripts\diagnose-repair-purchases.js" (
  set "BACKEND=%~dp0..\backend"
  goto :run
)

:: Shipped next to this script in C:\NEXOR ERP\
if exist "%INSTALL_DIR%backend\scripts\diagnose-repair-purchases.js" (
  set "BACKEND=%INSTALL_DIR%backend"
  goto :run
)

:: Packaged Electron app - backend lives under resources\ next to NEXOR ERP.exe
set "BACKEND="
for %%P in (
  "%LOCALAPPDATA%\Programs\NEXOR ERP\resources\backend"
  "%ProgramFiles%\NEXOR ERP\resources\backend"
  "%ProgramFiles(x86)%\NEXOR ERP\resources\backend"
  "%INSTALL_DIR%..\resources\backend"
) do (
  if exist "%%~P\scripts\diagnose-repair-purchases.js" (
    set "BACKEND=%%~P"
    goto :run
  )
)

echo [ERRO] Nao encontrei backend\scripts\diagnose-repair-purchases.js
echo Atualize o NEXOR ERP neste PC primeiro (a versao instalada e antiga).
pause
exit /b 1

:run
set "NEXOR_INSTALL_DIR=C:\NEXOR ERP"
if exist "%INSTALL_DIR%database.env" set "NEXOR_INSTALL_DIR=%INSTALL_DIR%"
if not exist "%NEXOR_INSTALL_DIR%\database.env" (
  echo [AVISO] database.env nao encontrado - o servidor usa SQLite local.
  echo O diagnostico vai localizar o ficheiro da base de dados automaticamente.
  echo.
)

:: SQLite native module is built for Electron - run the script with the app's
:: own binary (ELECTRON_RUN_AS_NODE) when available, else plain node.
set "RUNNER=node"
if exist "%BACKEND%\..\..\NEXOR ERP.exe" (
  set "RUNNER=%BACKEND%\..\..\NEXOR ERP.exe"
  set "ELECTRON_RUN_AS_NODE=1"
)

echo Backend: %BACKEND%
echo Runner : %RUNNER%
echo.
echo ================= PASSO 1: DIAGNOSTICO =================
cd /d "%BACKEND%"
"%RUNNER%" scripts\diagnose-repair-purchases.js
echo.
echo ================= PASSO 2: REPARACAO ===================
set /p CONFIRM="Reparar as faturas com problemas? (S/N): "
if /I not "%CONFIRM%"=="S" (
  echo Cancelado.
  pause
  exit /b 0
)
"%RUNNER%" scripts\diagnose-repair-purchases.js --repair
set ERR=%ERRORLEVEL%
echo.
if %ERR% NEQ 0 (
  echo [ATENCAO] Algumas faturas nao foram reparadas - veja os erros acima.
) else (
  echo [OK] Reparacao concluida. Atualize as paginas no NEXOR.
)
pause
exit /b %ERR%
