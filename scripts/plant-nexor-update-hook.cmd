@echo off
setlocal EnableExtensions
REM Run by the NEXOR installer (Administrator). Writes C:\NEXOR.cmd so Update
REM NEXOR can start, and copies this installer's backend onto the live folders.
REM Stop the service first, copy src atomically, then start. If the overlay is
REM still incomplete, point NexorBackend at the packaged Program Files tree.

set "INST=%~1"
if "%INST%"=="" set "INST=%~dp0.."

set "SRC=%INST%\resources\backend"
if not exist "%SRC%\src\server.js" set "SRC=%INST%\backend"

copy /Y "%~dp0nexor-apply-shim.cmd" "C:\NEXOR.cmd" >nul 2>&1
if errorlevel 1 (
  > "C:\NEXOR.cmd" echo @echo off
  >> "C:\NEXOR.cmd" echo REM NEXOR-APPLY-SHIM
  >> "C:\NEXOR.cmd" echo if exist "C:\ProgramData\NEXOR\run-apply.cmd" call "C:\ProgramData\NEXOR\run-apply.cmd" ^& goto :eof
  >> "C:\NEXOR.cmd" echo if exist "C:\NEXOR ERP\updates\run-apply.cmd" call "C:\NEXOR ERP\updates\run-apply.cmd"
)

if not exist "%SRC%\src\server.js" goto RESTART

net stop NexorBackend >nul 2>&1
timeout /t 2 /nobreak >nul

call :COPY_ONE "%SRC%" "C:\NEXOR ERP\backend"
if exist "C:\Users\user\Documents\GitHub\angola-invoice-finder\backend\src\server.js" (
  call :COPY_ONE "%SRC%" "C:\Users\user\Documents\GitHub\angola-invoice-finder\backend"
)

call :ENSURE_SERVICE_BACKEND

:RESTART
net start NexorBackend >nul 2>&1
exit /b 0

:COPY_ONE
set "FROM=%~1"
set "TO=%~2"
if not exist "%FROM%\src\server.js" goto :eof
mkdir "%TO%" 2>nul
mkdir "%TO%\webapp" 2>nul
mkdir "%TO%\scripts\lib" 2>nul

REM Stage src, then swap the folder so a mid-copy crash cannot leave a new
REM server.js requiring routes that were never copied.
set "SRCNEW=%TO%\src.nexor-new"
if exist "%SRCNEW%" rmdir /s /q "%SRCNEW%" 2>nul
xcopy /E /I /Y /Q "%FROM%\src" "%SRCNEW%" >nul
if not exist "%SRCNEW%\server.js" goto INPLACE
if not exist "%SRCNEW%\routes\consistency.js" goto INPLACE
if exist "%TO%\src.nexor-old" rmdir /s /q "%TO%\src.nexor-old" 2>nul
if exist "%TO%\src\server.js" (
  move /Y "%TO%\src" "%TO%\src.nexor-old" >nul 2>&1
)
move /Y "%SRCNEW%" "%TO%\src" >nul 2>&1
if exist "%TO%\src\server.js" if exist "%TO%\src\routes\consistency.js" goto COPY_REST

:INPLACE
if exist "%SRCNEW%\routes" xcopy /E /I /Y /Q "%SRCNEW%" "%TO%\src" >nul
if not exist "%TO%\src\routes\consistency.js" if exist "%FROM%\src\routes\consistency.js" (
  mkdir "%TO%\src\routes" 2>nul
  xcopy /E /I /Y /Q "%FROM%\src\routes" "%TO%\src\routes" >nul
)
if not exist "%TO%\src\server.js" xcopy /E /I /Y /Q "%FROM%\src" "%TO%\src" >nul

:COPY_REST
if exist "%FROM%\webapp\index.html" xcopy /E /I /Y /Q "%FROM%\webapp" "%TO%\webapp" >nul
if exist "%FROM%\package.json" copy /Y "%FROM%\package.json" "%TO%\package.json" >nul
if exist "%FROM%\BUILD_STAMP.json" copy /Y "%FROM%\BUILD_STAMP.json" "%TO%\BUILD_STAMP.json" >nul
if exist "%FROM%\scripts\lib" xcopy /E /I /Y /Q "%FROM%\scripts\lib" "%TO%\scripts\lib" >nul
if exist "%FROM%\scripts\ensure-server-schema.js" copy /Y "%FROM%\scripts\ensure-server-schema.js" "%TO%\scripts\ensure-server-schema.js" >nul
if exist "%SRCNEW%" rmdir /s /q "%SRCNEW%" 2>nul
goto :eof

:ENSURE_SERVICE_BACKEND
set "LIVE=C:\NEXOR ERP\backend"
set "PACK=%SRC%"
if not exist "%PACK%\src\server.js" set "PACK=C:\Program Files\NEXOR ERP\resources\backend"
set "NSSM="
if exist "C:\NEXOR ERP\tools\nssm.exe" set "NSSM=C:\NEXOR ERP\tools\nssm.exe"
if exist "C:\Program Files\nssm\nssm.exe" set "NSSM=C:\Program Files\nssm\nssm.exe"

REM Overlay is usable only when server.js, consistency.js, and node_modules exist.
if exist "%LIVE%\src\server.js" if exist "%LIVE%\src\routes\consistency.js" if exist "%LIVE%\node_modules\dotenv" goto :eof

if not exist "%PACK%\src\server.js" goto :eof
if not exist "%PACK%\src\routes\consistency.js" goto :eof
if "%NSSM%"=="" goto :eof
"%NSSM%" set NexorBackend AppDirectory "%PACK%" >nul 2>&1
"%NSSM%" set NexorBackend AppParameters "src\server.js" >nul 2>&1
goto :eof
