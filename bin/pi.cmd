@echo off
rem pi launcher (Windows cmd / PowerShell)
rem Node 후보: PI_NODE > pip 패키지(nodejs-wheel-binaries, playwright 내장 Node) > PATH 의 node > Node 기본 설치 경로
rem           > VS Code 계열 편집기 내장 Node.   20.15 미만은 건너뛰고, 22.19 미만이면 호환 레이어 자동 사용
setlocal
set "PI_HOME=%~dp0.."
if not defined PI_NODE goto search
rem PI_NODE 는 node.exe 또는 편집기 실행파일만 허용 (VSCodePortable.exe 같은 런처를 지정해도 창이 뜨지 않게)
for %%f in ("%PI_NODE%") do set "PI_NODE_NAME=%%~nxf"
for %%n in (node.exe Code.exe "Code - Insiders.exe" Cursor.exe Windsurf.exe Antigravity.exe) do if /i "%PI_NODE_NAME%"=="%%~n" goto checkver
echo [pi] PI_NODE must point to node.exe or VS Code's Code.exe (ignored): %PI_NODE%
echo      portable VS Code: Code.exe inside its folder (PortableApps layout: App\VSCode\Code.exe)
set "PI_NODE="
goto search
:checkver
set "PI_WANT=%PI_NODE%"
set "PI_NODE="
call :try "%PI_WANT%"
if defined PI_NODE goto found
echo [pi] PI_NODE is not Node 20.15+ or cannot run (ignored): %PI_WANT%
:search
rem Python 설치(PATH 에 없어도 기본 경로)마다 pip 로 설치된 Node 확인
for /d %%d in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%d\python.exe" call :trypy "%%d\python.exe"
for %%i in (python.exe py.exe) do if not "%%~$PATH:i"=="" call :trypy "%%~$PATH:i"
for %%i in (node.exe) do if not "%%~$PATH:i"=="" call :try "%%~$PATH:i"
for %%p in ("%ProgramFiles%\nodejs\node.exe" "%LOCALAPPDATA%\Programs\nodejs\node.exe" "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" "%ProgramFiles%\Microsoft VS Code\Code.exe" "%LOCALAPPDATA%\Programs\Microsoft VS Code Insiders\Code - Insiders.exe" "%LOCALAPPDATA%\Programs\cursor\Cursor.exe" "%LOCALAPPDATA%\Programs\Windsurf\Windsurf.exe" "%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe") do call :try %%p
if not defined PI_NODE (
  echo [pi] Node.js 20.15+ not found. Set PI_NODE=C:\path\to\node.exe   ^(diagnose in Git Bash: bash check-node.sh^)
  exit /b 1
)
:found
if defined PI_DEBUG echo [pi] node: %PI_NODE%
set PI_OFFLINE=1
set PI_SKIP_VERSION_CHECK=1
set "PI_URL=file:///%PI_HOME:\=/%"
set "PI_PRE="
set "ELECTRON_RUN_AS_NODE="
for %%f in ("%PI_NODE%") do if /i not "%%~nxf"=="node.exe" set "ELECTRON_RUN_AS_NODE=1"
rem VS Code 계열 내장 Node: 하위 프로세스에 ELECTRON_RUN_AS_NODE 가 상속되지 않도록 preload 에서 제거
if defined ELECTRON_RUN_AS_NODE set PI_PRE=--import "%PI_URL%/compat/electron.mjs"
rem Code.exe 는 GUI 프로그램이라 콘솔을 직접 쓰지 못함 -> 대화형 화면(TUI)은 Git Bash 의 bin\pi (터미널 중계)로 실행
if not defined ELECTRON_RUN_AS_NODE goto version
rem 인자 검사는 Node 에 맡김 (따옴표·공백이 섞인 인자도 정확히 해석). -p 등 비대화형이면 그대로 실행
"%PI_NODE%" -e "const f=new Set(['-p','--print','--mode','--export','--list-models','-h','--help','-v','--version']);process.exit(process.argv.slice(1).some(a=>f.has(a)||a.startsWith('--mode='))?0:1)" -- %*
if not errorlevel 1 goto version
set "PI_BASH="
for %%p in ("%LOCALAPPDATA%\Programs\Git\bin\bash.exe" "%ProgramFiles%\Git\bin\bash.exe") do if not defined PI_BASH if exist %%p set "PI_BASH=%%~p"
if not defined PI_BASH (
  echo [pi] The interactive TUI on VS Code's built-in Node needs Git Bash ^(bash.exe^), which was not found.
  echo      One-shot questions work:  pi.cmd -p "question"
  exit /b 1
)
set "ELECTRON_RUN_AS_NODE="
"%PI_BASH%" "%PI_HOME%\bin\pi" %*
exit /b %errorlevel%
:version
"%PI_NODE%" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)" >nul 2>&1 && goto modern
rem cli.js 는 require(esm) 을 써서 Node 20.15~20.18 에서 실패 -> 실제 진입점 cli-runtime.js 를 직접 실행
"%PI_NODE%" %PI_PRE% --import "%PI_URL%/compat/node20.mjs" "%PI_HOME%\runtime\dist\bundle\cli-runtime.js" %*
exit /b %errorlevel%
:modern
"%PI_NODE%" %PI_PRE% "%PI_HOME%\runtime\dist\bundle\cli.js" %*
exit /b %errorlevel%

rem python 으로 nodejs-wheel-binaries / playwright 에 들어 있는 node.exe 경로를 얻어 검사 (bin\find-pynode.py)
:trypy
if defined PI_NODE exit /b 0
set "PI_PYOUT=%TEMP%\pi-pynode-%RANDOM%%RANDOM%.txt"
"%~1" "%PI_HOME%\bin\find-pynode.py" > "%PI_PYOUT%" 2>nul
for /f "usebackq delims=" %%i in ("%PI_PYOUT%") do call :try "%%i"
del "%PI_PYOUT%" >nul 2>&1
exit /b 0

rem 후보 검사: 존재하고 Node 20.15 이상이면 PI_NODE 로 채택 (VS Code 1.80 의 Node 16 같은 낮은 버전은 건너뜀)
:try
if defined PI_NODE exit /b 0
if not exist "%~1" exit /b 0
setlocal
if /i not "%~nx1"=="node.exe" set "ELECTRON_RUN_AS_NODE=1"
"%~1" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=15)?0:1)" >nul 2>&1
set "PI_TRY_RC=%errorlevel%"
endlocal & set "PI_TRY_RC=%PI_TRY_RC%"
if "%PI_TRY_RC%"=="0" set "PI_NODE=%~1"
exit /b 0
