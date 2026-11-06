@echo off
setlocal
cd /d "%~dp0"
title Huntboard - Install
echo ==================================================
echo   Huntboard - one-time setup
echo ==================================================
echo.

rem ---- 1. Node.js - runs Huntboard ----
where node >nul 2>nul
if not errorlevel 1 goto node_ok
echo [1/4] Node.js is missing. Installing it...
where winget >nul 2>nul
if errorlevel 1 goto no_winget
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
where node >nul 2>nul
if errorlevel 1 goto restart_needed
:node_ok
node -e "process.exit(parseInt(process.versions.node) >= 22 ? 0 : 1)"
if errorlevel 1 goto node_too_old
echo [1/4] Node.js is ready.

rem ---- 2. A Chromium browser - the app window, PDFs and job boards ----
set "HAVE_BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "HAVE_BROWSER=1"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "HAVE_BROWSER=1"
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "HAVE_BROWSER=1"
if defined HAVE_BROWSER goto browser_ok
echo [2/4] Google Chrome is missing. Installing it...
where winget >nul 2>nul
if errorlevel 1 goto no_winget
winget install -e --id Google.Chrome --accept-source-agreements --accept-package-agreements
:browser_ok
echo [2/4] Google Chrome is ready.

rem ---- 3. Huntboard itself ----
echo [3/4] Installing Huntboard...
call npm install --no-audit --no-fund
if errorlevel 1 goto failed

rem ---- 4. An AI tool ----
echo [4/4] Checking for an AI tool...
set "HAVE_AI="
for %%T in (claude gemini codex opencode cursor-agent) do (
  where %%T >nul 2>nul && set "HAVE_AI=1"
)
if exist "%LOCALAPPDATA%\agy\bin\agy.exe" set "HAVE_AI=1"
if defined HAVE_AI goto ai_ok
echo.
echo No AI tool found. Huntboard needs one; it uses your own account.
echo   1 = Gemini CLI  (free with a Google account)
echo   2 = Claude Code (Claude subscription or API key)
echo   3 = Codex CLI   (ChatGPT subscription or API key)
echo   4 = OpenCode    (any provider, also local models)
echo   5 = skip, I will install one myself
set /p "AI=Type a number and press Enter: "
if "%AI%"=="1" call npm install -g @google/gemini-cli
if "%AI%"=="2" powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"
if "%AI%"=="3" call npm install -g @openai/codex
if "%AI%"=="4" call npm install -g opencode-ai
:ai_ok
echo [4/4] Done.

echo.
echo ==================================================
echo   All done!  Double-click start.bat to open Huntboard.
echo   The first time, sign in to your AI tool once:
echo   open a terminal in this folder and type its name
echo   (for example: gemini, claude, agy, codex, opencode).
echo ==================================================
pause
exit /b 0

:no_winget
echo.
echo This PC has no "winget", so please install the missing program yourself:
echo   Node.js LTS:    https://nodejs.org
echo   Google Chrome:  https://www.google.com/chrome
echo Then run install.bat again.
pause
exit /b 1

:restart_needed
echo.
echo Node.js was installed. Please restart the computer, then run install.bat again.
pause
exit /b 1

:node_too_old
echo.
echo Your Node.js is too old - version 22 or newer is needed.
echo Install the newest LTS version from https://nodejs.org, then run install.bat again.
start "" https://nodejs.org
pause
exit /b 1

:failed
echo.
echo Something went wrong - see the messages above.
echo Check your internet connection and run install.bat again.
pause
exit /b 1
