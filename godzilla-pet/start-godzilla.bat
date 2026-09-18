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

REM ---------------------------------------------------------------
REM These three flags are REQUIRED. Do not remove them to "speed up
REM startup" -- that was tried on 2026-09-18 and it fails hard.
REM
REM Measured on this machine, same build, same isolated userData,
REM the only variable being these flags:
REM   with    : window appears, page loads, app runs
REM   without : process dies right after "TV window created",
REM             exit code 0x80000003, the page never loads
REM (the same flags are in package.json's "start" script for the
REM  same reason -- both entry points must stay in step)
REM
REM Why not: they are not sandbox leftovers. Without them Chromium
REM cannot bring up its GPU path here at all.
REM
REM They do NOT make startup slow. Measured with them on, unsandboxed:
REM window created -> page ready in 441 ms. The 5-10 s cold starts in
REM AppData logs come from something else (machine load / userData),
REM not from these flags.
REM
REM If startup ever hangs with no window at all, try removing
REM --in-process-gpu first and keeping the other two.
REM ---------------------------------------------------------------

start "Godzilla Pet" /D "%APP_DIR%" "%ELECTRON%" --in-process-gpu --disable-gpu --no-sandbox "%APP_DIR%."
exit /b 0
