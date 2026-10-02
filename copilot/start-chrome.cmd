@echo off
rem pi Copilot 브리지용 Chrome 실행 (원격 디버깅 포트 9222, 전용 프로필) - start-edge.cmd 대신 쓸 때
rem 사용법: start-chrome.cmd https://<kubeflow 주소>/notebook/<네임스페이스>/<노트북>/lab
rem  - 전용 프로필(%LOCALAPPDATA%\pi-copilot-chrome)을 써서 평소 쓰는 Chrome 과 따로 실행됩니다.
rem    (Chrome 136 부터 평소 프로필에는 원격 디버깅이 허용되지 않으므로 전용 프로필이 꼭 필요합니다)
rem  - 처음 한 번은 이 창에서 Copilot 과 Kubeflow 에 로그인하세요. 로그인은 전용 프로필에 저장됩니다.
rem  - Edge(start-edge.cmd)와 같은 포트를 쓰므로 둘 중 하나만 실행하세요.
setlocal
set "JUPYTER_URL=%~1"
if "%JUPYTER_URL%"=="" set "JUPYTER_URL=about:blank"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo chrome.exe not found. Edit the CHROME path in this file.
  exit /b 1
)
start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\pi-copilot-chrome" --no-first-run --no-default-browser-check --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows "https://m365.cloud.microsoft/chat" "%JUPYTER_URL%"
echo Chrome started with remote debugging port 9222. Log in to Copilot (and Kubeflow for jupyter mode), then run pi in Git Bash.
