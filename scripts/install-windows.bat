@echo off
setlocal
cd /d "%~dp0.."
call npm.cmd install
call npm.cmd run build
echo.
echo HeyAgent installed. Run: npx hey onboard
endlocal
