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
rem The loop is one block, read once: an update may replace this file while Huntboard runs.
rem Exit code 75 = "restart after an update" (the window is already open then).
set "HUNTBOARD_SUPERVISED=1"
set "HB_OPEN=--open"
setlocal EnableDelayedExpansion
for /l %%i in (0,0,1) do (
  node app\server.js !HB_OPEN!
  set "HB_CODE=!errorlevel!"
  if "!HB_CODE!"=="75" (
    set "HB_OPEN="
    echo Huntboard was updated. Starting it again...
  ) else (
    pause
    exit /b 0
  )
)

:not_installed
echo Huntboard is not installed yet. Double-click install.bat first.
pause
exit /b 1
