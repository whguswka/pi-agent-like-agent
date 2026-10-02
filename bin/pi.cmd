@echo off
rem pi launcher (Windows cmd / PowerShell)
rem (Comments are in English on purpose: cmd reads .cmd files in the console code page, so Korean text can break lines.)
rem Node search: PI_NODE > pip packages (nodejs-wheel-binaries, playwright's bundled Node) > node on PATH > default install paths
rem             > Node built into VS Code-like editors. Below 20.15 is skipped; below 22.19 uses the compat layer.
setlocal
set "PI_HOME=%~dp0.."
if not defined PI_NODE goto search
rem PI_NODE may only be node.exe or an editor executable (so a launcher like VSCodePortable.exe never opens a window)
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
rem For each Python install (default paths too, even if not on PATH), look for Node installed with pip
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
rem Editor built-in Node: the preload removes ELECTRON_RUN_AS_NODE so child processes do not inherit it
if defined ELECTRON_RUN_AS_NODE set PI_PRE=--import "%PI_URL%/compat/electron.mjs"
rem Code.exe is a GUI program and cannot use the console -> the interactive TUI runs via Git Bash binpi (terminal relay)
if not defined ELECTRON_RUN_AS_NODE goto version
rem Let Node inspect the arguments (handles quotes and spaces). Non-interactive modes such as -p run directly.
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
rem cli.js uses require(esm), which fails on Node 20.15-20.18 -> run the real entry cli-runtime.js directly
"%PI_NODE%" %PI_PRE% --import "%PI_URL%/compat/node20.mjs" "%PI_HOME%\runtime\dist\bundle\cli-runtime.js" %*
exit /b %errorlevel%
:modern
"%PI_NODE%" %PI_PRE% "%PI_HOME%\runtime\dist\bundle\cli.js" %*
exit /b %errorlevel%

rem Ask python for node.exe inside nodejs-wheel-binaries / playwright (binind-pynode.py) and test it
:trypy
if defined PI_NODE exit /b 0
set "PI_PYOUT=%TEMP%\pi-pynode-%RANDOM%%RANDOM%.txt"
"%~1" "%PI_HOME%\bin\find-pynode.py" > "%PI_PYOUT%" 2>nul
for /f "usebackq delims=" %%i in ("%PI_PYOUT%") do call :try "%%i"
del "%PI_PYOUT%" >nul 2>&1
exit /b 0

rem Test a candidate: use it as PI_NODE if it exists and is Node 20.15+ (skips old ones such as VS Code 1.80 with Node 16)
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
