# pi-agent-like-agent

오픈소스 코딩 에이전트 **pi**([earendil-works/pi](https://github.com/earendil-works/pi), npm `@earendil-works/pi-coding-agent` 0.87.1, MIT)를
npm 없이 사내 환경에서 실행하기 위한 소스 모음입니다. pi 원본 코드는 수정하지 않았고, 실행 스크립트와 사내 LLM 연결 설정을 더했습니다.

## 무엇을 하나
pi 는 터미널에서 동작하는 코딩 보조 에이전트입니다. 사용자가 작업을 지시하면 LLM 과 대화하면서 파일을 읽고 고치고, 명령을 실행해 결과를 확인합니다.

| 설정 | 실행 위치 | LLM |
|---|---|---|
| `jupyter` | Kubeflow JupyterLab 터미널 | 사내 vLLM (OpenAI 호환 API) |
| `pc` | 업무 PC 의 Git Bash | Copilot 웹 채팅 (Chrome 전용 창, PC 내부 중계기 경유) |

## 빠른 시작
1. 압축을 풀어 `~/tools/pi` 에 둡니다.
2. Node.js 확인: `bash ~/tools/pi/check-node.sh` — 없으면 `pip install --user nodejs-wheel-binaries==24.19.0`
3. 설치: `bash ~/tools/pi/install.sh jupyter` 또는 `bash ~/tools/pi/install.sh pc`
4. 새 터미널에서 `pi`

자세한 내용: [docs/설치.md](docs/설치.md) · [docs/vLLM-연결.md](docs/vLLM-연결.md) · [copilot/README-copilot.md](copilot/README-copilot.md)

## 의존성
- 저장소 밖에서 받아야 하는 것은 **PyPI 패키지뿐**입니다 ([requirements.txt](requirements.txt)).
  - `nodejs-wheel-binaries==24.19.0` — Node.js 실행환경. Node 20.15 이상이 이미 있으면 필요 없음
  - (선택) `ripgrep==14.1.0` — pi 의 grep 도구용
- pi 가 쓰는 JavaScript 라이브러리(chord, typebox, jiti)는 `runtime/node_modules/` 에 원본 그대로 들어 있습니다.
- Copilot 중계기(`copilot/`)는 파이썬 표준 라이브러리만 씁니다.

## 구성
| 경로 | 내용 |
|---|---|
| `runtime/` | pi 0.87.1 과 JS 라이브러리 3종 (npm 공식 배포본 그대로) |
| `bin/`, `compat/` | 실행기, Node 탐색, Node 20 호환 레이어 |
| `install.sh`, `check-node.sh` | 설치·진단 스크립트 |
| `profiles/` | 환경별 설정 템플릿 (`jupyter`, `pc`) |
| `copilot/` | Copilot 웹 채팅 연동 중계기 (`pc` 전용) |
| `tests/` | 중계기 단위 테스트 (`python tests/test_relay.py`) |
| `docs/` | 설치 안내, 반입 검토 자료, runtime 파일 해시 목록 |

## 라이선스
pi 와 포함한 JS 라이브러리는 MIT 라이선스입니다 — [LICENSE-pi](LICENSE-pi), [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
