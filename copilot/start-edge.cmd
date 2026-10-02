@echo off
rem pi Copilot 브리지용 Edge 실행 (원격 디버깅 포트 9222, 전용 프로필)
rem 사용법: start-edge.cmd https://<kubeflow 주소>/notebook/<네임스페이스>/<노트북>/lab
rem  - 전용 프로필(%LOCALAPPDATA%\pi-copilot-edge)을 써서 평소 쓰는 Edge 와 따로 실행됩니다.
rem  - 처음 한 번은 이 창에서 Copilot 과 Kubeflow 에 로그인하세요. 로그인은 전용 프로필에 저장됩니다.
rem  - 뒤쪽 탭이 느려지거나 멈추지 않도록 백그라운드 절전 기능을 끕니다.
setlocal
set "JUPYTER_URL=%~1"
if "%JUPYTER_URL%"=="" set "JUPYTER_URL=about:blank"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" (
  echo msedge.exe not found. Edit the EDGE path in this file.
  exit /b 1
)
start "" "%EDGE%" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\pi-copilot-edge" --no-first-run --no-default-browser-check --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows "https://m365.cloud.microsoft/chat" "%JUPYTER_URL%"
echo Edge started with remote debugging port 9222. Log in to Copilot (and Kubeflow for jupyter mode), then run pi in Git Bash.
