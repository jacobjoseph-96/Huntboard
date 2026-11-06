@echo off
setlocal
cd /d "%~dp0"
title Huntboard
set "PATH=%LOCALAPPDATA%\agy\bin;%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
where node >nul 2>nul
if errorlevel 1 goto not_installed
if not exist "node_modules" goto not_installed

rem Refresh the AI instruction files (fast, only writes what changed).
node tools\sync-agents.js --quiet

echo Starting Huntboard... (keep this window open; close it to stop Huntboard)
node app\server.js --open
pause
exit /b 0

:not_installed
echo Huntboard is not installed yet. Double-click install.bat first.
pause
exit /b 1
