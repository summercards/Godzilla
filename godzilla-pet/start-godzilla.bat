@echo off
setlocal
set "APP_DIR=%~dp0"
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
set "ELECTRON=%APP_DIR%node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON%" (
  echo Electron runtime not found.
  echo Please run npm install in this folder first.
  pause
  exit /b 1
)

start "Godzilla Pet" /D "%APP_DIR%" "%ELECTRON%" --in-process-gpu --disable-gpu --no-sandbox "%APP_DIR%."
exit /b 0
