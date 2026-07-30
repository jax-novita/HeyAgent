@echo off
REM One-click Windows bootstrap for HeyAgent (happy path)
cd /d "%~dp0.."
where node >nul 2>nul || (
  echo Node.js 22+ required. Install from https://nodejs.org
  pause
  exit /b 1
)
call npm.cmd install
if errorlevel 1 exit /b 1
call npm.cmd run build
if errorlevel 1 exit /b 1
echo.
echo Build OK. Next:
echo   npx hey onboard
echo   npx hey models auth groq
echo   npx hey gateway start
echo.
pause
