# pip 로 설치된 패키지 안의 Node 실행파일 경로를 출력 (bin/pi, bin/pi.cmd 의 Node 탐색에서 사용)
#  - nodejs-wheel-binaries : Node.js 공식 바이너리 패키지
#  - playwright            : 브라우저 자동화 패키지. driver 폴더에 Node 실행파일이 들어 있음 (1.46 이상은 Node 20.16+)
import importlib.util
import os

for module, parts in (
    ("nodejs_wheel", ("node.exe",)),
    ("nodejs_wheel", ("bin", "node")),
    ("playwright", ("driver", "node.exe")),
    ("playwright", ("driver", "node")),
):
    try:
        spec = importlib.util.find_spec(module)
    except Exception:
        spec = None
    if spec and spec.origin:
        path = os.path.join(os.path.dirname(spec.origin), *parts)
        if os.path.isfile(path):
            print(path)
