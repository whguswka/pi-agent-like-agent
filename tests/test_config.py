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
print("RESULT:", "PASS" if fails == 0 else "FAIL ({})".format(fails))
sys.exit(1 if fails else 0)
