@echo off
rem Updates Huntboard to the newest version. Your data (workspace folder) is kept; a backup is made first.
rem Everything is in one block, read once: the update may replace this file while it runs.
(
  setlocal
  cd /d "%~dp0"
  title Huntboard update
  set "PATH=%LOCALAPPDATA%\agy\bin;%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
  node tools\hunt.js update
  echo.
  pause
  exit /b
)
