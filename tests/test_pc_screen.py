# pc 설정의 pc-screen 스킬 스크립트 시험  (python tests/test_pc_screen.py. Windows + Git Bash 에서만, 아니면 건너뜀)
#  - 스크립트는 UTF-8 BOM 으로 둠 (없으면 bin/ps1 이 설치된 사본에 BOM 을 붙이고, 업데이트가 그 파일을 '사용자가 고친 것' 으로 보고 건너뜀)
#  - shot.ps1: 영역 찍기·크기 줄이기·찍을 곳이 없을 때. 화면 내용이 남지 않게 구석의 작은 영역만 임시 폴더에 찍고 지움
#  - windows.ps1: 창 목록, 없는 프로세스 / start.ps1: 바로 돌아옴(숨긴 콘솔 프로그램), 사용법, 없는 파일
import glob
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SKILL = os.path.join(ROOT, "profiles", "pc", "skills", "pc-screen")
PS1 = os.path.join(ROOT, "bin", "ps1").replace("\\", "/")
fails = 0


def check(name, cond, detail=""):
    global fails
    print(("OK   " if cond else "FAIL ") + name + ("" if cond else "  -> " + str(detail)[:600]))
    if not cond:
        fails += 1


scripts = sorted(glob.glob(os.path.join(SKILL, "scripts", "*.ps1")))
check("스크립트 셋 (shot, start, windows)", [os.path.basename(p) for p in scripts] == ["shot.ps1", "start.ps1", "windows.ps1"], scripts)
check("스크립트는 모두 UTF-8 BOM 으로 시작", all(open(p, "rb").read(3) == b"\xef\xbb\xbf" for p in scripts))
with open(os.path.join(SKILL, "SKILL.md"), encoding="utf-8") as f:
    md = f.read()
check("SKILL.md: 이름·Windows 전용·확인할 창만 찍기", md.startswith("---\nname: pc-screen\n") and "Windows PC 에서만" in md and "확인할 창·영역만 찍는다" in md)

bash = os.environ.get("PI_TEST_BASH") or shutil.which("bash")
if bash and "system32" in bash.lower():  # Windows 의 bash.exe(WSL) 말고 Git Bash
    bash = None
if os.name != "nt" or not bash or not shutil.which("powershell.exe"):
    print("SKIP 스크립트 실행 시험 (Windows 의 Git Bash·powershell.exe 가 아님)")
    print("RESULT:", "PASS" if not fails else "FAIL ({})".format(fails))
    sys.exit(1 if fails else 0)


def ps1(script, args, cwd, timeout=120):
    line = 'bash "{}" "{}"'.format(PS1, os.path.join(SKILL, "scripts", script).replace("\\", "/"))
    line += "".join(" '" + a.replace("'", "'\\''") + "'" for a in args)
    fd, path = tempfile.mkstemp(suffix=".sh")
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
        f.write(line + " < /dev/null\n")
    try:
        t0 = time.time()
        r = subprocess.run([bash, path], capture_output=True, cwd=cwd, timeout=timeout)
        return r.returncode, r.stdout.decode("utf-8", "replace") + r.stderr.decode("utf-8", "replace"), time.time() - t0
    finally:
        os.remove(path)


def png_size(p):
    with open(p, "rb") as f:
        head = f.read(24)
    return struct.unpack(">II", head[16:24]) if head[:8] == b"\x89PNG\r\n\x1a\n" else None


d = tempfile.mkdtemp()
try:
    rc, out, _ = ps1("shot.ps1", ["-Region", "0,0,40,20", "-Out", "a.png"], d)
    check("shot: 영역을 그대로 찍음 (40x20)", rc == 0 and png_size(os.path.join(d, "a.png")) == (40, 20) and "찍음:" in out, (rc, out))
    rc, out, _ = ps1("shot.ps1", ["-Region", "0,0,200,100", "-Max", "50", "-Out", "b.png"], d)
    check("shot: 긴 쪽이 -Max 를 넘으면 줄임 (200x100 -> 50x25)", rc == 0 and png_size(os.path.join(d, "b.png")) == (50, 25) and "줄임" in out, (rc, out))
    rc, out, _ = ps1("shot.ps1", [], d)
    check("shot: 찍을 곳을 정하지 않으면 2 와 안내", rc == 2 and "-Window" in out, (rc, out))
    rc, out, _ = ps1("shot.ps1", ["-Window", "no-such-process-x"], d)
    check("shot: 없는 프로세스면 1", rc == 1 and "실행 중이 아닙니다" in out, (rc, out))
    rc, out, _ = ps1("shot.ps1", ["-Region", "1,2,3"], d)
    check("shot: 영역 값이 네 수가 아니면 2", rc == 2, (rc, out))
    rc, out, _ = ps1("windows.ps1", [], d)
    check("windows: 보이는 창 목록 (위에 있는 것부터)", rc == 0 and "보이는 창" in out and len(out.strip().splitlines()) >= 2, (rc, out))
    rc, out, _ = ps1("windows.ps1", ["-Name", "no-such-process-x"], d)
    check("windows: 없는 프로세스면 1", rc == 1 and "실행 중이 아닙니다" in out, (rc, out))
    rc, out, took = ps1("start.ps1", ["-Hidden", sys.executable, "-c", "import time; time.sleep(30)"], d, timeout=60)
    pid = next((w for w in out.split() if w.isdigit()), "")
    alive = bool(pid) and pid in subprocess.run(["tasklist", "/FI", "PID eq " + pid], capture_output=True, text=True).stdout
    check("start: 띄우고 바로 돌아옴 (프로그램은 계속 실행)", rc == 0 and "실행:" in out and took < 20 and alive, (rc, out, round(took, 1), alive))
    if pid:
        subprocess.run(["taskkill", "/F", "/T", "/PID", pid], capture_output=True)  # 가상 환경의 python.exe 는 실제 Python 을 자식으로 띄움
    rc, out, _ = ps1("start.ps1", [], d)
    check("start: 실행 파일이 없으면 2 와 사용법", rc == 2 and "사용법" in out, (rc, out))
    rc, out, _ = ps1("start.ps1", ["-Wait", "1", "no-such-program-x.exe"], d)
    check("start: 띄우지 못하면 1", rc == 1 and "띄우지 못함" in out, (rc, out))
finally:
    shutil.rmtree(d, ignore_errors=True)
print("RESULT:", "PASS" if not fails else "FAIL ({})".format(fails))
sys.exit(1 if fails else 0)
