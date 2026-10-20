@echo off
REM NEXOR-APPLY-SHIM
if exist "C:\ProgramData\NEXOR\run-apply.cmd" call "C:\ProgramData\NEXOR\run-apply.cmd" & goto :eof
if exist "C:\NEXOR ERP\updates\run-apply.cmd" call "C:\NEXOR ERP\updates\run-apply.cmd"
