@echo off
REM Double-click on the CITY SERVER PC. Asks for Administrator.
cd /d "%~dp0"
net session >nul 2>&1
if %errorLevel% neq 0 (
  echo A pedir permissao de Administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preparar-servidor-cidade.ps1"
echo.
pause
