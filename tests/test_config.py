# 설정 합치기 단위 테스트: 저장소 copilot/bridge.json + 내 설정 파일(~/.pi/agent/bridge.json)  (python tests/test_config.py)
#  - bridge.load_config: 덮어쓰기, 표(dict) 합치기, '_' 설명 키 무시, 형식 오류 알림
#  - bridge.py --shell-config 와 bin/kit-config.sh(pi_cfg_load, pi_cfg): 실행기가 쓰는 값 (Git Bash 가 있으면)
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "copilot"))
import bridge  # noqa: E402

fails = 0


def check(name, cond, detail=""):
    global fails
    print(("OK   " if cond else "FAIL ") + name + ("" if cond else "  -> " + str(detail)))
    if not cond:
        fails += 1


def write(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        f.write(obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False, indent=1))


tmp = tempfile.mkdtemp()
repo, user = os.path.join(tmp, "bridge.json"), os.path.join(tmp, "user.json")
write(repo, {"_설명": "x", "browser": "chrome", "copilot_models": {"a": "A", "b": "B"}, "max_questions_per_chat": 100})

cfg = bridge.load_config(repo, user)
check("내 설정 파일이 없으면 저장소 값 그대로", cfg["browser"] == "chrome" and cfg["_user"]["keys"] == [], cfg)
check("'_' 로 시작하는 설명 키는 무시", "_설명" not in cfg)

write(user, {"_설명": "y", "browser": "edge", "copilot_models": {"c": "C", "a": "A2"}, "max_questions_per_minute": 2})
cfg = bridge.load_config(repo, user)
check("내 설정이 덮어씀", cfg["browser"] == "edge" and cfg["max_questions_per_minute"] == 2, cfg)
check("표(copilot_models)는 항목별로 합침", cfg["copilot_models"] == {"a": "A2", "b": "B", "c": "C"}, cfg["copilot_models"])
check("내 설정에 없는 값은 저장소 값", cfg["max_questions_per_chat"] == 100)
check("덮어쓴 항목 목록", cfg["_user"]["keys"] == ["browser", "copilot_models", "max_questions_per_minute"], cfg["_user"])
check("기본값 표는 바뀌지 않음", bridge.DEFAULT_CONFIG["copilot_models"] == {}, bridge.DEFAULT_CONFIG["copilot_models"])

write(user, '{\n  "jupyter_url": "C:\\Users\\me"\n}\n')
try:
    bridge.load_config(repo, user)
    check("형식 오류는 알림 (역슬래시)", False, "오류가 나지 않음")
except bridge.ConfigError as e:
    check("형식 오류는 알림: 파일·줄·역슬래시 안내", user in str(e) and "줄 2" in str(e) and "/ 로" in str(e), e)

write(user, '{"browser": "edge",}')
try:
    bridge.load_config(repo, user)
    check("형식 오류는 알림 (끝 쉼표)", False, "오류가 나지 않음")
except bridge.ConfigError as e:
    check("형식 오류는 알림 (끝 쉼표)", "줄 1" in str(e), e)

write(user, "[1, 2]")
try:
    bridge.load_config(repo, user)
    check("{ } 가 아니면 오류", False)
except bridge.ConfigError:
    check("{ } 가 아니면 오류", True)

write(user, "")
check("빈 파일은 괜찮음", bridge.load_config(repo, user)["_user"]["keys"] == [])

# 메모장 등에서 ANSI(cp949)로 저장한 설정 파일: 프로그램이 죽지 않고(예전: UnicodeDecodeError) UTF-8 로 저장하라고 알림
with open(user, "wb") as f:
    f.write('{"copilot_model": "자동"}'.encode("cp949"))
try:
    bridge.load_config(repo, user)
    check("UTF-8 이 아닌 설정 파일은 알림", False, "오류가 나지 않음")
except bridge.ConfigError as e:
    check("UTF-8 이 아닌 설정 파일(cp949)은 알림 + UTF-8 로 저장 안내", user in str(e) and "UTF-8 로" in str(e), e)
except Exception as e:  # noqa: BLE001  (예전: UnicodeDecodeError 로 멈춤)
    check("UTF-8 이 아닌 설정 파일(cp949)은 알림 + UTF-8 로 저장 안내", False, repr(e))

# diag.py --report: 내 설정 파일이 틀려도 저장소 bridge.json 값으로 요약하고 오류를 함께 알림 (예전: 기본값만 보여 줌)
#  (요약 함수는 브라우저·중계 서버에 연결하므로 바꿔 끼워서 받은 설정만 확인)
import diag  # noqa: E402

_got = {}
_real = (diag.report, sys.argv)
diag.report = lambda c: _got.update(cfg=c) or 0
sys.argv = ["diag.py", "--report", "--config", repo]
os.environ["PI_COPILOT_USER_CONFIG"] = user
try:
    rc = diag.main()
except Exception as e:  # noqa: BLE001
    rc = repr(e)
finally:
    diag.report, sys.argv = _real
    del os.environ["PI_COPILOT_USER_CONFIG"]
cfg = _got.get("cfg") or {}
check("diag --report: 내 설정 파일 오류여도 저장소 설정 값 + 오류 알림", rc == 0 and cfg.get("copilot_models") == {"a": "A", "b": "B"}
      and "UTF-8" in cfg.get("_error", ""), cfg)
write(user, "")

agent = os.path.join(tmp, "agent")
os.makedirs(agent)
write(os.path.join(agent, "bridge.json"), {"cdp_port": 9333})
os.environ["PI_CODING_AGENT_DIR"] = agent
check("기본 위치: <pi 설정 폴더>/bridge.json", bridge.load_config(repo)["cdp_port"] == 9333)
check("PI_COPILOT_USER_CONFIG 로 위치 지정", (os.environ.update(PI_COPILOT_USER_CONFIG=user) or
                                            bridge.load_config(repo)["_user"]["path"] == user))
del os.environ["PI_COPILOT_USER_CONFIG"]

# bridge.py --shell-config: 실행기(bin/pi)가 쓰는 값
write(os.path.join(agent, "bridge.json"), {"browser": "edge", "jupyter_url": "https://k/notebook/ns/nb/lab?a=1&b=2"})
out = subprocess.run([sys.executable, os.path.join(ROOT, "copilot", "bridge.py"), "--shell-config"], capture_output=True)
lines = out.stdout.decode("utf-8").splitlines()
check("--shell-config: 내 설정 반영", out.returncode == 0 and "browser=edge" in lines and "auto_start_browser=true" in lines
      and "cdp_port=9222" in lines and "jupyter_url=https://k/notebook/ns/nb/lab?a=1&b=2" in lines, (out.returncode, lines))
write(os.path.join(agent, "bridge.json"), '{"browser": "edge"')
out = subprocess.run([sys.executable, os.path.join(ROOT, "copilot", "bridge.py"), "--shell-config"], capture_output=True)
check("--shell-config: 형식 오류면 2 와 안내", out.returncode == 2 and "설정 파일 오류" in out.stderr.decode("utf-8"),
      (out.returncode, out.stderr.decode("utf-8", "replace")))
with open(os.path.join(agent, "bridge.json"), "wb") as f:
    f.write('{"browser": "edge", "copilot_model": "자동"}'.encode("cp949"))
out = subprocess.run([sys.executable, os.path.join(ROOT, "copilot", "bridge.py"), "--shell-config"], capture_output=True)
check("--shell-config: UTF-8 이 아닌 설정 파일이면 2 와 안내 (예전: 오류 추적이 나며 1)", out.returncode == 2
      and "UTF-8 로" in out.stderr.decode("utf-8"), (out.returncode, out.stderr.decode("utf-8", "replace")))

# bin/kit-config.sh: pi_cfg_load + pi_cfg (Git Bash / Linux bash)
bash = os.environ.get("PI_TEST_BASH") or shutil.which("bash")
if bash and "system32" in bash.lower():
    bash = None
if not bash:
    print("SKIP bin/kit-config.sh 시험 (bash 없음)")
else:
    def sh(script, agent_json, python=sys.executable):
        write(os.path.join(agent, "bridge.json"), agent_json)
        env = dict(os.environ, PI_HOME=ROOT.replace("\\", "/"), PI_PYTHON=python, PI_CODING_AGENT_DIR=agent.replace("\\", "/"))
        r = subprocess.run([bash, "-c", '. "$PI_HOME/bin/find-node.sh"; . "$PI_HOME/bin/kit-config.sh"; ' + script],
                           capture_output=True, env=env)
        return r.returncode, r.stdout.decode("utf-8", "replace").strip(), r.stderr.decode("utf-8", "replace").strip()

    rc, out, err = sh('pi_cfg_load; echo "rc=$?"; pi_cfg browser; pi_cfg auto_start_browser; pi_cfg cdp_port; pi_cfg jupyter_url',
                      {"browser": "edge", "auto_start_browser": False, "jupyter_url": "https://k/lab?x=1&y=2"})
    check("pi_cfg: Python 으로 읽은 값", out.split("\n") == ["rc=0", "edge", "false", "9222", "https://k/lab?x=1&y=2"], (out, err))
    rc, out, err = sh('pi_cfg_load; echo "rc=$?"', '{"browser": "edge",, }')
    check("pi_cfg_load: 형식 오류면 1 과 안내", out == "rc=1" and "설정 파일 오류" in err, (out, err))
    rc, out, err = sh('pi_cfg_load; echo "rc=$?"; pi_cfg browser; pi_cfg auto_start_browser',
                      '{\n  "browser": "edge",\n  "auto_start_browser": false\n}', python="/no/such/python")
    check("Python 이 실행되지 않으면 파일에서 직접 읽음", out.split("\n") == ["rc=0", "edge", "false"], (out, err))
    rc, out, err = sh('pi_cfg_load; pi_cfg browser; pi_cfg cdp_port', "{}", python="/no/such/python")
    check("내 설정에 없으면 저장소 값 (직접 읽기)", out.split("\n") == ["chrome", "9222"], (out, err))

shutil.rmtree(tmp, ignore_errors=True)

# 판 내기 확인: 저장소 copilot/bridge.json 을 바꾸면 update.sh 의 SHIPPED 에 그 sha256 을 넣어야 함
# (넣지 않으면 다음 업데이트 때 키트가 바꾼 값을 '직접 고친 항목' 으로 잘못 알림)
import hashlib  # noqa: E402
import re  # noqa: E402
with open(os.path.join(ROOT, "copilot", "bridge.json"), "rb") as f:
    _h = hashlib.sha256(f.read()).hexdigest()
with open(os.path.join(ROOT, "update.sh"), encoding="utf-8") as f:
    _shipped = set(re.findall(r'^\s*"([0-9a-f]{64})",', f.read(), flags=re.M))
check("판 내기: 지금 copilot/bridge.json 의 sha256 이 update.sh 의 SHIPPED 에 있음", _h in _shipped, (_h, len(_shipped)))
check("판 내기: CHANGELOG.md 에 지금 판(VERSION) 항목", "\n## " + open(os.path.join(ROOT, "VERSION"), encoding="utf-8").read().strip()
      in open(os.path.join(ROOT, "CHANGELOG.md"), encoding="utf-8").read())
print("RESULT:", "PASS" if fails == 0 else "FAIL ({})".format(fails))
sys.exit(1 if fails else 0)
