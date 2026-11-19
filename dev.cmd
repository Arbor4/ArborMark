@echo off
rem ---------------------------------------------------------------
rem Launch ArborMark in dev mode.
rem
rem WebView2 keeps its profile in %LOCALAPPDATA%\com.arbor.arbormark\EBWebView.
rem When that folder is locked or not writable, window creation fails with
rem 0x800700AA ("resource in use"). Point both the app data dir and the
rem WebView2 profile dir into the repo so the launch does not depend on it.
rem ---------------------------------------------------------------
setlocal
cd /d "%~dp0"

if not exist ".dev-data" mkdir ".dev-data"
if not exist ".dev-webview" mkdir ".dev-webview"

set "ARBORMARK_DATA_DIR=%CD%\.dev-data"
set "WEBVIEW2_USER_DATA_FOLDER=%CD%\.dev-webview"

call npm run dev
set "EXITCODE=%ERRORLEVEL%"
endlocal & exit /b %EXITCODE%
