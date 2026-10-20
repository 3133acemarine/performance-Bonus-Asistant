@echo off
rem Starts the local server and opens the app in the browser. Close this window to stop.
cd /d "%~dp0"
if not exist "dist\index.html" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
pause
