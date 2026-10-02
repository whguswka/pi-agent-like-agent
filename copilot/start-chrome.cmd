@echo off
rem Starts the dedicated Chrome window for the pi Copilot bridge (remote debugging port 9222, separate profile).
rem Usage: start-chrome.cmd https://<kubeflow address>/notebook/<namespace>/<notebook>/lab
rem  - Uses its own profile (%LOCALAPPDATA%\pi-copilot-chrome), separate from your everyday Chrome.
rem    (Since Chrome 136, remote debugging is not allowed on the default profile, so a separate profile is required.)
rem  - The first time, log in to Copilot (and Kubeflow for jupyter mode) in this window. Logins are kept in the profile.
rem  - Background throttling is turned off so tabs behind other windows keep working.
rem  - start-edge.cmd uses the same port: run only one of the two.
rem  (Comments are in English on purpose: cmd reads .cmd files in the console code page, so Korean text can break lines.)
setlocal
set "JUPYTER_URL=%~1"
if "%JUPYTER_URL%"=="" set "JUPYTER_URL=about:blank"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo chrome.exe not found. Edit the CHROME path in this file, or use start-edge.cmd.
  exit /b 1
)
start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\pi-copilot-chrome" --no-first-run --no-default-browser-check --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows "https://m365.cloud.microsoft/chat" "%JUPYTER_URL%"
echo Chrome started with remote debugging port 9222. Log in to Copilot (and Kubeflow for jupyter mode), then run pi in Git Bash.
