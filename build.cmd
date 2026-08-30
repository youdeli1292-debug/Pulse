@echo off
rem ==========================================================================
rem  Pulse — one-command build
rem
rem    build.cmd
rem
rem  Installs the dependencies, builds the native bridge to the C++ core
rem  (optional — skipped with a warning when Visual Studio is missing) and
rem  packs the portable Windows executable:
rem
rem    dist\Pulse-1.0.0-x64-portable.exe
rem
rem  Want the C++ core itself? Run fetch-core.cmd first.
rem ==========================================================================

setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [Pulse] Node.js 18+ is required. Get it here: https://nodejs.org
  exit /b 1
)

if not exist node_modules (
  echo [Pulse] installing dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [Pulse] npm install failed.
    exit /b 1
  )
)

if not exist "PulseCore\bridge\build\Release\pulse_core.node" (
  echo [Pulse] building the native core bridge...
  call npm run build:core
  if errorlevel 1 (
    echo [Pulse] the native bridge was not built - Pulse will drive the core
    echo [Pulse] through PulseCore.exe instead. Everything else still works.
  )
)

echo [Pulse] packing the portable executable...
call npm run dist
if errorlevel 1 (
  echo [Pulse] electron-builder failed.
  exit /b 1
)

for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set PULSE_VERSION=%%v

echo.
echo [Pulse] ready: dist\Pulse-%PULSE_VERSION%-x64-portable.exe
echo.
endlocal
