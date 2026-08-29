@echo off
setlocal
rem Builds the pulse_xeno native addon against the Electron headers.
rem Equivalent to: npm run build:xeno  (run from the project root)

pushd "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [pulse] Node.js was not found in PATH. Install Node 18+ and try again.
  popd
  exit /b 1
)

node build.js
set EXIT_CODE=%ERRORLEVEL%

popd
exit /b %EXIT_CODE%
