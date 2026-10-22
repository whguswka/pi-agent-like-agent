# bin/ps1 (Git Bash 에서 Windows PowerShell 실행) 시험  (python tests/test_ps1.py. Windows + Git Bash 에서만, 아니면 건너뜀)
#  - heredoc 의 $변수·\ 가 그대로, 한글 출력·오류 문구가 UTF-8 로, 오류 줄 번호가 스크립트 기준, 맨 앞의 using
#  - 종료 코드: exit 값, 외부 프로그램의 종료 코드, throw·Write-Error·실패한 명령으로 끝나면 1, 성공 0
#  - .ps1 파일: 이름 붙은 인자·스위치 전달, $PSScriptRoot, BOM 없는 한글 파일에 BOM 붙이기, 없는 파일
#  - 명령 줄은 pi 의 bash 도구처럼 bash 에 그대로 넘김 (파이썬→bash 인자 전달에서 큰따옴표가 바뀌지 않게 파일로)
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
PS1 = os.path.join(ROOT, "bin", "ps1").replace("\\", "/")
fails = 0


def check(name, cond, detail=""):
    global fails
    print(("OK   " if cond else "FAIL ") + name + ("" if cond else "  -> " + str(detail)[:600]))
    if not cond:
        fails += 1


bash = os.environ.get("PI_TEST_BASH") or shutil.which("bash")
if bash and "system32" in bash.lower():  # Windows 의 bash.exe(WSL) 말고 Git Bash
    bash = None
if os.name != "nt" or not bash or not shutil.which("powershell.exe"):
    print("SKIP bin/ps1 시험 (Windows 의 Git Bash·powershell.exe 가 아님)")
    print("RESULT: PASS")
    sys.exit(0)


def sh(cmdline, cwd=None):
    fd, path = tempfile.mkstemp(suffix=".sh")
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
        f.write(cmdline + "\n")
    try:
        r = subprocess.run([bash, path], capture_output=True, cwd=cwd, timeout=120)
        return r.returncode, r.stdout.decode("utf-8", "replace"), r.stderr.decode("utf-8", "replace")
    finally:
        os.remove(path)


def ps1(args, body=None, cwd=None):
    """bash 명령 줄 `ps1 '인자' ...` (body 가 있으면 ps1 <<'EOF' 본문으로)"""
    q = "".join(" '" + a.replace("'", "'\\''") + "'" for a in args)
    line = 'bash "{}"{}'.format(PS1, q)
    if body is not None:
        line += " <<'PI_EOF'\n" + body.rstrip("\n") + "\nPI_EOF"
    return sh(line, cwd)


rc, out, err = ps1([], """$roots = @('C:\\Windows', 'C:\\없는폴더')
foreach ($r in $roots) { "{0} -> {1}" -f $r, (Test-Path $r) }
$c = "class Metrics { }"; $c.Substring($c.IndexOf('Metrics'))
"한글 출력"
""")
check("heredoc: $변수·\\ 가 그대로", rc == 0 and "C:\\Windows -> True" in out and "C:\\없는폴더 -> False" in out and "Metrics { }" in out, (rc, out, err))
check("한글 출력이 UTF-8 로", "한글 출력" in out, out)
rc, out, err = ps1([], 'using namespace System.Text\n"first"\nGet-Item C:\\no\\such\\file\n')
check("맨 앞의 using 도 됨", "first" in out, (rc, out, err))
check("마지막 명령이 실패하면 1", rc == 1, (rc, err))
check("오류 줄 번호는 스크립트 기준 (3번째 줄)", "script.ps1:3 " in err, err)
rc, out, err = ps1([], 'Write-Error "한글 오류 문구"')
check("Write-Error 로 끝나면 1, 한글 오류 문구가 읽힘", rc == 1 and "한글 오류 문구" in err, (rc, err))
for name, args, want in [("외부 프로그램의 종료 코드", ["-c", "cmd /c exit 3"], 3), ("throw 면 1", ["-c", 'throw "x"'], 1),
                         ("exit 값", ["-c", "exit 5"], 5), ("성공이면 0", ["-c", '"fine"'], 0), ("빈 스크립트면 0", ["-c", ""], 0),
                         ("앞 명령이 실패해도 마지막이 성공이면 0", ["-c", 'cmd /c exit 4; "after"'], 0)]:
    rc, out, err = ps1(args)
    check("종료 코드: " + name, rc == want, (rc, out, err))
rc, out, err = ps1(["-c", "cmd /c echo 한글네이티브"])
check("외부 프로그램의 한글 출력도 UTF-8 로", "한글네이티브" in out, (out, err))
rc, out, err = ps1(["-c", '"a=" + $args[0] + " b=" + $args[1]', "x y", "z"])
check("-c 뒤의 인자는 $args 로", rc == 0 and "a=x y b=z" in out, (rc, out, err))

d = tempfile.mkdtemp()
try:
    with open(os.path.join(d, "build.ps1"), "w", encoding="utf-8", newline="\n") as f:  # BOM 없는 UTF-8
        f.write('param($Config = "Debug", [switch]$Fast)\n"설정=$Config 빠름=$Fast 폴더=$PSScriptRoot"\ncmd /c exit 7\n')
    rc, out, err = ps1(["build.ps1", "-Config", "Release", "-Fast"], cwd=d)
    check(".ps1: 이름 붙은 인자·스위치, $PSScriptRoot", "설정=Release 빠름=True" in out and "폴더=" + os.path.realpath(d) in out, (rc, out, err))
    check(".ps1: 마지막 외부 프로그램의 종료 코드", rc == 7, rc)
    check(".ps1: BOM 없는 한글 파일에 BOM 을 붙이고 알림", open(os.path.join(d, "build.ps1"), "rb").read(3) == b"\xef\xbb\xbf" and "BOM" in err, err)
    rc, out, err = ps1(["./build.ps1"], cwd=d)
    check(".ps1: 두 번째는 알림 없이 (이미 BOM)", "BOM" not in err and "설정=Debug" in out, (rc, out, err))
    with open(os.path.join(d, "ascii.ps1"), "w", encoding="utf-8", newline="\n") as f:
        f.write('"plain"\n')
    rc, out, err = ps1(["ascii.ps1"], cwd=d)
    check(".ps1: ASCII 만 있는 파일은 그대로", open(os.path.join(d, "ascii.ps1"), "rb").read(3) == b'"pl' and rc == 0 and "plain" in out, (rc, err))
    rc, out, err = ps1(["nope.ps1"], cwd=d)
    check(".ps1: 없는 파일이면 2 와 안내", rc == 2 and "파일이 없습니다" in err, (rc, err))
    rc, out, err = ps1(["Get-Process"], cwd=d)
    check("알 수 없는 인자면 2 와 사용법", rc == 2 and "ps1 <<'EOF'" in err, (rc, err))
    left = [n for n in os.listdir(tempfile.gettempdir()) if n.startswith("pi-ps1-")]
    check("임시 폴더를 남기지 않음", not left, left)
finally:
    shutil.rmtree(d, ignore_errors=True)
print("RESULT:", "PASS" if not fails else "FAIL ({})".format(fails))
sys.exit(1 if fails else 0)
