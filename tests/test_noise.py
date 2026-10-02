# bridge.strip_ui_noise 확인 (python tests/test_noise.py [bridge.py 경로, 기본: ../copilot/bridge.py])
import importlib.util
import os
import sys

default = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "copilot", "bridge.py")
spec = importlib.util.spec_from_file_location("bridge", sys.argv[1] if len(sys.argv) > 1 else default)
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
w = b.DEFAULT_CONFIG["ui_noise_words"]
cases = [
    ("Copilot\n\n모든 단계를 마쳤습니다.\n\nTOOL_OUTPUT<<BASH_TOOL_OK Linux bye world second line>>\n\nCopy 👍",
     "모든 단계를 마쳤습니다.\n\nTOOL_OUTPUT<<BASH_TOOL_OK Linux bye world second line>>"),
    ("편집 방법은 다음과 같습니다.\n1. 파일을 엽니다\nShare\n결과: OK", "편집 방법은 다음과 같습니다.\n1. 파일을 엽니다\n결과: OK"),
    ("Edit\nCopilot 은 도구입니다", "Copilot 은 도구입니다"),
]
fails = 0
for src, want in cases:
    got = b.strip_ui_noise(src, w)
    ok = got == want
    fails += not ok
    print("OK  " if ok else "FAIL", repr(got))
print("RESULT:", "PASS" if not fails else "FAIL")
