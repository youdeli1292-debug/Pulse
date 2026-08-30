@echo off
rem ==========================================================================
rem  Pulse — download the C++ core and build it
rem
rem    fetch-core.cmd
rem
rem  Clones the upstream C++ project into PulseCore\core (that folder is NOT
rem  committed: it stays a build input, like node_modules), builds it with
rem  MSBuild and copies the resulting DLL into PulseCore\bin, which is where
rem  Pulse looks for it when you press Attach.
rem
rem  Requirements: git and Visual Studio 2022 ("Desktop development with C++").
rem  Without MSBuild the script still downloads the sources and prints where to
rem  put the compiled DLL.
rem ==========================================================================

setlocal
cd /d "%~dp0"

set CORE_DIR=PulseCore\core
set BIN_DIR=PulseCore\bin

where git >nul 2>nul
if errorlevel 1 (
  echo [Pulse] git is required: https://git-scm.com
  exit /b 1
)

if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"

if exist "%CORE_DIR%\.git" (
  echo [Pulse] updating the C++ core...
  pushd "%CORE_DIR%"
  git pull --ff-only
  popd
) else (
  echo [Pulse] downloading the C++ core...
  git clone --depth 1 https://github.com/tyronetheqt/Xeno.git "%CORE_DIR%"
  if errorlevel 1 (
    echo [Pulse] clone failed.
    exit /b 1
  )
)

if exist "%CORE_DIR%\vcpkg.json" (
  echo [Pulse] note: the core declares vcpkg dependencies. If MSBuild reports
  echo [Pulse] missing headers, run "vcpkg install" inside %CORE_DIR% first.
)

where msbuild >nul 2>nul
if errorlevel 1 (
  echo.
  echo [Pulse] MSBuild was not found in PATH. Open "%CORE_DIR%\Xeno.sln" in
  echo [Pulse] Visual Studio 2022, build Release x64 and copy the produced
  echo [Pulse] Xeno.dll into %BIN_DIR%.
  exit /b 0
)

echo [Pulse] building the core (Release x64)...
msbuild "%CORE_DIR%\Xeno.sln" /p:Configuration=Release /p:Platform=x64 /m
if errorlevel 1 (
  echo [Pulse] the core build failed.
  exit /b 1
)

for /r "%CORE_DIR%" %%f in (Xeno.dll) do copy /y "%%f" "%BIN_DIR%\Xeno.dll" >nul

if exist "%BIN_DIR%\Xeno.dll" (
  echo.
  echo [Pulse] core ready: %BIN_DIR%\Xeno.dll
) else (
  echo.
  echo [Pulse] build finished but Xeno.dll was not found - copy it manually
  echo [Pulse] into %BIN_DIR%.
)

echo [Pulse] next step: build.cmd
endlocal
