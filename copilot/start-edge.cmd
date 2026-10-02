@echo off
rem Starts a dedicated Edge window for the pi Copilot bridge (remote debugging port, separate profile).
rem Use this instead of start-chrome.cmd if you prefer Edge (Edge may sign in to M365 with your Windows account).
rem Usage: start-edge.cmd [https://<kubeflow address>/notebook/<namespace>/<notebook>/lab]
rem  - pi starts this window by itself when bridge.json has "browser": "edge" and the window is not running.
rem    Then the JupyterLab address comes from PI_JUPYTER_URL and the port from PI_CDP_PORT (default 9222).
rem  - Uses its own profile (%LOCALAPPDATA%\pi-copilot-edge), separate from your everyday Edge.
rem  - The first time, log in to Copilot (and Kubeflow for jupyter mode) in this window. Logins are kept in the profile.
rem  - Background throttling is turned off so tabs behind other windows keep working.
rem  - start-chrome.cmd uses the same port: run only one of the two.
rem  (Comments are in English on purpose: cmd reads .cmd files in the console code page, so Korean text can break lines.)
setlocal
set "JUPYTER_URL=%~1"
if "%JUPYTER_URL%"=="" set "JUPYTER_URL=%PI_JUPYTER_URL%"
if "%JUPYTER_URL%"=="" set "JUPYTER_URL=about:blank"
set "PORT=%PI_CDP_PORT%"
if "%PORT%"=="" set "PORT=9222"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" (
  echo msedge.exe not found. Edit the EDGE path in this file.
  exit /b 1
)
start "" "%EDGE%" --remote-debugging-port=%PORT% --user-data-dir="%LOCALAPPDATA%\pi-copilot-edge" --no-first-run --no-default-browser-check --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows "https://m365.cloud.microsoft/chat" "%JUPYTER_URL%"
echo Edge started with remote debugging port %PORT%. Log in to Copilot (and Kubeflow for jupyter mode), then run pi in Git Bash.
