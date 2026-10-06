# pi-agent-like-agent

업무 PC 에서 **Copilot 웹 채팅을 두뇌(LLM)로 쓰는 코딩 에이전트**입니다.
오픈소스 코딩 에이전트 **pi**([earendil-works/pi](https://github.com/earendil-works/pi), npm `@earendil-works/pi-coding-agent` 0.87.1, MIT)를 npm 없이 실행할 수 있게 묶고,
Copilot 웹 채팅과 이어 주는 중계기를 더했습니다. pi 원본 코드는 고치지 않았습니다.

pi 는 터미널에서 동작합니다. 할 일을 말로 지시하면 LLM 과 주고받으면서 파일을 읽고 고치고, 명령을 실행해 결과를 확인합니다.

> **처음이면 [한 장 요약 (빠른 시작)](docs/빠른시작.md)** 부터 보세요. 설치, 매일 쓰는 법, 자주 쓰는 명령(`/plan`, `@파일`, `/undo`, `/remember` 등)이 한 장에 있습니다.
> 사람이 직접 하는 일(반입, 설치, 업데이트, 되돌리기, 설정, 문제 보고)은 [수동 작업 절차](docs/수동-작업-절차.md) 에 순서대로 있습니다.
> 판마다 바뀐 점과 바꾼 뒤 할 일은 [바뀐 점 (CHANGELOG)](CHANGELOG.md) 에 있습니다.

```
[업무 PC]
  Git Bash ── pi
               ├─ 두뇌(LLM): 중계 서버 copilot/relay.py (127.0.0.1:8765, 이 PC 안에서만 열림)
               │              └─► Chrome 전용 창의 Copilot 탭 (같은 대화에 이어서 질문)
               └─ 실행 위치 (명령 실행·파일 작업), 둘 중 선택
                    ├─ 이 PC (Git Bash)                      : pi
                    └─ Kubeflow 노트북 (JupyterLab 터미널)     : pi --jupyter work/프로젝트
```

| 설정 | pi 가 도는 곳 | LLM | 상태 |
|---|---|---|---|
| `pc` | 업무 PC 의 Git Bash | Copilot 웹 채팅 (Chrome 전용 창) | **사용 중.** 이 문서의 1~11장 |
| `jupyter` | Kubeflow JupyterLab 터미널 | 사내 vLLM | 서비스 오픈 때까지 보류. [12장](#12-jupyter-용-pi-사내-vllm-보류) |

## 목차
1. [준비물](#1-준비물)
2. [설치](#2-설치)
3. [기본 사용법](#3-기본-사용법)
4. [모델 고르기](#4-모델-고르기)
5. [실행 위치 바꾸기: PC 와 Jupyter 노트북](#5-실행-위치-바꾸기-pc-와-jupyter-노트북)
6. [지침, 스킬, 메모리](#6-지침-스킬-메모리) (AGENTS.md, SKILL.md)
7. [Copilot 대화 관리](#7-copilot-대화-관리)
8. [주의할 점](#8-주의할-점)
9. [새 버전으로 바꾸기](#9-새-버전으로-바꾸기)
10. [설정](#10-설정)
11. [문제 해결](#11-문제-해결)
12. [Jupyter 용 pi (사내 vLLM, 보류)](#12-jupyter-용-pi-사내-vllm-보류)
13. [저장소 구성, 의존성, 라이선스](#13-저장소-구성-의존성-라이선스)

## 1. 준비물
| 항목 | 설명 |
|---|---|
| **Git Bash** | Git for Windows 에 들어 있습니다. pi 는 Git Bash 에서 실행합니다 (사용자 폴더에 설치된 Git 도 됩니다) |
| **Python 3.8 이상** | 중계 서버용 (표준 라이브러리만 씀). 설치된 Python 을 자동으로 찾습니다. `python3` 을 치면 Microsoft Store 가 뜨는 것은 Store 바로 가기일 뿐이니 신경 쓰지 않아도 됩니다 |
| **Node.js 20.15 이상** | pi 실행용. 따로 없어도 **VS Code 1.93 이상**이 설치돼 있으면 그 안의 Node 를 자동으로 씁니다 |
| **Chrome** (또는 Edge) | Copilot 을 띄울 전용 창. 평소 쓰는 창과 따로 뜹니다 |
| **Microsoft 365 Copilot** | 전용 창에서 처음 한 번 로그인 |
| (선택) Kubeflow 노트북 | 명령을 노트북 안에서 실행하고 싶을 때만 ([5장](#5-실행-위치-바꾸기-pc-와-jupyter-노트북)) |

- 설치 프로그램이나 실행파일(exe)은 없습니다. 스크립트와 JavaScript·Python 소스뿐입니다.
- 이 저장소 밖에서 받을 것은 없습니다. Node 도 VS Code 도 없을 때만 PyPI 패키지 `nodejs-wheel-binaries` 를 설치합니다 ([2-2](#2-2-nodejs-확인)).

## 2. 설치
아래 명령은 모두 **Git Bash** 에서 실행합니다. `~` 는 Windows 사용자 폴더(`C:\Users\<아이디>`)입니다.

### 2-1. 내려받아 풀기
이미 `~/tools/pi` 가 있으면 설치하지 말고 [9장](#9-새-버전으로-바꾸기) 대로 바꾸세요.

업무 PC 는 인터넷이 안 되므로, 인터넷 PC 에서 GitHub 저장소 화면의 **Code > Download ZIP** 으로 받은 `pi-agent-like-agent-main.zip` 을
사내 반입 절차로 업무 PC 에 옮깁니다 ([수동 작업 절차 1장](docs/수동-작업-절차.md#1-반입과-배포-배포-담당)). zip 이 있는 폴더에서 (예: `cd ~/Downloads`):
```bash
mkdir -p ~/tools && unzip -q pi-agent-like-agent-main.zip -d ~/tools/ && mv ~/tools/pi-agent-like-agent-main ~/tools/pi
```
- 받은 파일 이름이 `pi-agent-like-agent-main (1).zip` 처럼 바뀌었으면 명령의 이름도 바꿉니다 (공백이 있으면 따옴표로 감쌈).

### 2-2. Node.js 확인
```bash
bash ~/tools/pi/check-node.sh
```
- `결과: 사용 가능` 또는 `결과: 호환 모드로 사용 가능` 이면 다음으로 넘어갑니다. VS Code 내장 Node 는 보통 호환 모드이며, 그대로 쓰면 됩니다.
- `사용 가능한 Node 없음` 이면 화면에 나온 방법 중 하나를 준비합니다. 보통은:
  ```bash
  pip install --user nodejs-wheel-binaries==24.19.0
  ```
  (`pip` 를 찾지 못하면 `python -m pip install --user nodejs-wheel-binaries==24.19.0`)
- 자세한 내용(portable VS Code, 호환 모드, Node 를 찾는 순서): [docs/설치.md](docs/설치.md#1-nodejs-확인)

### 2-3. 설치
```bash
bash ~/tools/pi/install.sh pc
```
- 설정 템플릿을 `~/.pi/agent` 에 복사하고, `~/.bashrc` 에 PATH 를 넣습니다 (Git Bash 창이 `~/.bashrc` 를 읽지 않는 경우 `~/.bash_profile` 도 맞춤).
- **새 Git Bash 창**을 열고 `pi --version` 이 나오면 설치된 것입니다.
- Node 를 찾지 못했다는 안내가 나왔으면 2-2 대로 준비한 뒤 이 명령을 한 번 더 실행합니다 (기본 명령·스킬 복사와 설정 갱신에 Node 를 씀).

### 2-4. 처음 실행과 Copilot 로그인
```bash
mkdir -p ~/work/hello && cd ~/work/hello
pi
```
1. `pi` 를 실행하면 **Chrome 전용 창이 자동으로 뜹니다** (`[pi] Copilot 전용 창(chrome)을 띄웠습니다 ...`).
2. 그 창에서 **Copilot 에 로그인**합니다. 처음 한 번만 하면 됩니다 (로그인은 전용 프로필에 남음).
3. Copilot 채팅 화면이 나오면 pi 화면에서 `hello.py 를 만들어서 hello 를 출력하고 실행해줘` 처럼 지시해 봅니다.
   첫 요청은 새 대화를 여느라 1~2분 걸립니다 (상태 줄에 진행이 보임). 파일이 생기고 실행 결과가 나오면 준비 끝입니다.

전용 창에 대해:
- 평소 쓰는 Chrome 과 **따로 뜨는 창**입니다 (전용 프로필 `%LOCALAPPDATA%\pi-copilot-chrome`). 평소 Chrome 의 탭·로그인은 건드리지 않습니다.
  최신 Chrome 은 평소 프로필의 원격 조작을 막기 때문에 전용 프로필이 꼭 필요합니다.
- 최소화하거나 다른 창 뒤에 두어도 되지만 **닫으면 안 됩니다.** 닫았으면 `pi` 를 다시 실행할 때 다시 뜹니다.
- 이 창의 Copilot 탭은 **pi 전용**입니다. 여기서 직접 대화하지 마세요.
- 직접 띄우려면 `~/tools/pi/copilot/start-chrome.cmd` (탐색기에서 더블클릭해도 됨). Edge 를 쓰려면 [10장](#10-설정)의 `browser`.

### 2-5. 진단
```bash
python ~/tools/pi/copilot/diag.py --report
```
| 옵션 (`python ~/tools/pi/copilot/diag.py <옵션>`) | 확인하는 것 |
|---|---|
| (없음) | 전용 창, Copilot 탭, 입력창 |
| `--send` | + 시험 질문 하나를 새 대화로 보내고 답 읽기 |
| `--model` | + 모델 메뉴 항목 읽기, 기본 모델 고르기 (`--model "GPT-6 Sol"` 처럼 이름 지정 가능) |
| `--chats` | + 왼쪽 채팅 목록 찾기 |
| `--delete-test` | + 시험 대화를 하나 만들어 지워 보기 (다른 대화는 건드리지 않음) |
| `--jupyter` | + JupyterLab 터미널에서 시험 명령 실행 ([5장](#5-실행-위치-바꾸기-pc-와-jupyter-노트북)을 쓸 때) |
| `--input-limit` | + 입력창이 한 번에 받는 글자 수 확인 (붙여 넣어 보기만 하고 보내지 않음). 권장 `max_chars` 를 알려 줌 |
| `--report` | **한 화면 상태 요약**: 판 번호, Node, 중계 서버, 전용 창, 현재 모델, 설정, 최근 요청 통계(평균 시간, 새 대화, 조각 나눔), 최근 로그 (읽기만 함) |

- `--report` 는 요약만 보여 줍니다. 나머지 진단은 마지막 줄에 `결과: 정상` 이 나오면 됩니다.
- **문제가 생기면 `--report` 화면을 찍어 보내 주세요.** 상황 대부분이 한 장에 담깁니다. pi 를 쓰는 중이면 `/doctor` 로 같은 내용을 볼 수 있습니다.
- `--send`, `--model`, `--delete-test`, `--input-limit` 은 전용 창의 Copilot 탭을 직접 움직입니다. **pi 가 일하지 않을 때** 실행하고,
  `--send` 가 만든 시험 대화는 Copilot 목록에서 직접 지우세요.
- `python` 이 Microsoft Store 를 띄우거나 실행되지 않으면 pi 안에서 `/doctor` 를 쓰세요 (pi 는 Python 을 따로 찾아 씀).

## 3. 기본 사용법

### 3-1. 시작과 종료
```bash
cd ~/work/myproject                  # 작업할 폴더로 가서
pi                                   # 대화형으로 시작
pi -c                                # 이 폴더에서 하던 마지막 대화를 이어서
pi -p "이 폴더의 파이썬 파일 목록과 역할을 알려줘"     # 한 번만 묻고 끝 (답만 출력)
```
- pi 는 **시작한 폴더**를 작업 폴더로 씁니다. 파일 작업, 지침(AGENTS.md), 세션 기록이 모두 이 폴더 기준입니다.
- 종료: `/quit`(또는 `/exit`), `Ctrl+C` 두 번, 또는 입력창이 비었을 때 `Ctrl+D`.
- 중계 서버는 `pi` 를 실행하면 자동으로 켜지고, 따로 끌 필요 없습니다. 로그: `~/.pi/agent/copilot-relay.log`
- 요청을 처리하는 동안 화면 아래 상태 줄에 Copilot 쪽에서 지금 하는 일이 보입니다 (예: `Copilot: 새 대화 여는 중 12초`, `Copilot: 답 기다리는 중 (2/3) 5초`).
  앞 대화를 요약하는 동안(`/compact`, 자동 요약)에도 보입니다.
- 요청 하나가 30초 넘게 걸리면 끝날 때 터미널 벨과 알림으로 알려 줍니다. 다른 창을 보고 있어도 됩니다 (시간은 [10장](#10-설정)의 `notify_after_seconds`).

### 3-2. 화면에서 쓰는 키와 명령
| 하고 싶은 것 | 방법 |
|---|---|
| 지시 보내기 / 줄 바꾸기 | `Enter` / `Shift+Enter` |
| 파일 다루기 | 경로나 파일 이름을 그대로 적거나, `@` 를 치고 골라 넣습니다 (예: `@src/main.py 의 오류 처리를 고쳐줘`) — 표 아래 '@파일' |
| 명령을 직접 실행하고 결과를 대화에 넣기 | `!git status` (`!!git status` 는 결과를 LLM 에 보내지 않음) |
| 일하는 중에 방향 바꾸기 | 입력하고 `Enter` (지금 단계가 끝나면 반영) |
| 멈추기 | `Esc` |
| 계획부터 세우고 승인받아 진행 | `/plan` 을 치고 요청 (또는 `/plan <요청>`). 다시 `/plan` 이면 끔 — 아래 3-4 |
| 바꿀 때마다 확인받기 / 다시 자동으로 | `/mode ask` / `/mode auto` (`/mode` 만 치면 고르기) |
| pi 가 고친 파일 되돌리기 | `/undo` (마지막 요청), `/undo 2` (마지막 두 요청) — 아래 3-5 |
| 앞으로도 지킬 것 기억시키기 | `/remember 커밋 메시지는 한국어로` (지침 파일 AGENTS.md 에 적음, [6장 메모리](#메모리)) |
| 도구 출력 펼치기·접기 | `Ctrl+O` |
| 모델 고르기 / 다음 모델로 | `/model` 또는 `Ctrl+L` / `Ctrl+P` |
| 지침·스킬을 고친 뒤 다시 읽기 | `/reload` |
| 자주 하는 일 | 기본 명령 `/init` `/handoff` `/review` `/test` `/commit` `/explain` ([6장](#6-지침-스킬-메모리)) |
| 명령 목록 | `/` 를 치면 나옴 |
| 빠른 도움말 | `/kit` (키, 세션, 명령·스킬 목록, 설정 파일 위치를 편집기 위에 보여 줌. 다시 입력하면 닫힘). 팀 공유 폴더 등록은 `/kit share <폴더>` |
| 상태 요약 | `/doctor` (아래 `--report` 와 같은 내용을 pi 화면에. 문제가 생기면 이 화면을 찍어 보내 주세요) |

**@파일**: 입력창에서 `@` 를 치면 작업 폴더의 파일 목록이 뜹니다. 글자를 더 치면 좁혀지고(`@src/ma`), `Tab` 으로 고릅니다.
- jupyter 모드에서는 노트북 작업 폴더의 파일이 나옵니다. `.git`, `node_modules`, `__pycache__`, `.venv` 등은 빼고 6단계 깊이까지 보여 줍니다.
- 보낼 때 `@` 로 적은 텍스트 파일은 **내용이 요청에 함께 붙습니다.** LLM 이 파일을 따로 읽는 왕복(한 번에 7~20초)이 줄어듭니다.
  파일 하나 6000자, 모두 8000자, 5개까지이고, 넘으면 앞부분만 붙인 뒤 나머지는 LLM 이 읽게 합니다.
  폴더·노트북(`.ipynb`)·바이너리·없는 파일은 붙이지 않습니다 (글은 그대로 갑니다). `/` 로 시작하는 명령(`/explain @a.py` 등)에 적은 파일도 붙이지 않습니다.

### 3-3. 세션 (대화 기록)
pi 는 대화를 자동으로 저장합니다 (`~/.pi/agent/sessions/`, 작업 폴더별).

| 명령 | 뜻 |
|---|---|
| `pi -c` | 이 폴더의 마지막 세션을 이어서 시작 |
| `pi -r` 또는 `/resume` | 저장된 세션 목록에서 골라 열기 |
| `/new` | 새 세션 시작 (Copilot 도 새 대화로) |
| `/name 이름` | 세션에 이름 붙이기 (목록에서 찾기 쉬움) |
| `/session` | 지금 세션 정보 |

### 3-4. 작업 모드 (/plan, /mode)
pi 는 기본으로 묻지 않고 바로 고치고 실행합니다 (자동 모드). 큰 작업이나 처음 보는 코드라면 계획부터 보고 진행하는 편이 안전합니다.

| 모드 | 하는 일 | 바꾸기 |
|---|---|---|
| 계획 | 파일을 읽고 살펴보기만 하고(읽기 전용 명령만 실행) 번호 붙인 단계로 계획을 적습니다. 계획이 오면 "이 계획대로 진행할까요?" 를 묻습니다 | `/plan`, `/plan <요청>` |
| 확인 | 파일을 쓰거나 고치기 전, 읽기 전용이 아닌 명령을 실행하기 전에 바뀌는 줄(`-` 지움, `+` 넣음)이나 명령을 보여 주고 묻습니다. 거절하면 그 작업은 하지 않고 멈춥니다 | `/mode ask` |
| 자동 | 묻지 않고 실행합니다. 위험한 명령(폴더 지우기, `git push` 등)만 묻습니다 ([8장](#8-주의할-점)) | `/mode auto` (기본) |

지금 모드는 화면 아래 상태 줄에 보입니다 (`계획 모드 · 읽기만`, `확인 모드`. 자동이면 표시 없음).

**계획 모드로 일하기**
1. `/plan` 을 치고 할 일을 적습니다. 한 번에 하려면 `/plan 로그인할 때 로그를 남기도록 바꾸고 싶어`.
2. pi 가 필요한 파일을 읽고 계획을 적습니다. 이 동안 파일을 바꾸는 작업(write·edit, `>` 로 파일에 쓰기, `rm`, `git commit`, 스크립트 실행 등)은 막혀 있고,
   LLM 에게는 "계획의 단계로 적어 달라"고 돌려보냅니다.
3. 계획이 오면 고릅니다.
   - **진행 (자동)**: 묻지 않고 진행
   - **진행 (확인)**: 파일을 바꾸거나 명령을 실행할 때마다 확인하면서 진행
   - **계획 더 다듬기** (또는 `Esc`): 계획 모드 그대로. 고칠 점을 적어 보내면 계획을 다시 받습니다
4. 진행하면 입력창 위에 단계 목록(`[ ] 1. ...`)이 보이고, 단계를 마칠 때마다 체크됩니다. 모두 끝나면 다음 요청을 보낼 때 닫힙니다.

- 계획 모드에서 실행하는 명령: `ls`, `cat`, `head`, `grep`, `find`(`-delete`·`-exec rm` 등은 제외), `wc`, `sed -n`, `git status`·`diff`·`log`·`show`,
  `pip list`, `kubectl get`·`describe`·`logs`, `nvidia-smi` 처럼 읽기만 하는 것입니다. 파이썬 실행이나 테스트도 계획 모드에서는 하지 않습니다.
- 단계 체크는 LLM 이 답에 `[1단계 완료]` 처럼 적어 줄 때 됩니다. 적지 않으면 목록만 그대로 남고 작업에는 영향이 없습니다.
- pi 를 시작할 때의 모드는 [10장](#10-설정)의 `default_mode` 로 정합니다 (예: 늘 확인 모드로 시작하려면 `"default_mode": "ask"`).
  `pi -p` 처럼 물을 수 없는 실행은 늘 자동 모드로 시작합니다.

### 3-5. 되돌리기 (/undo)
pi 가 파일을 고치기 직전과 직후 내용을 요청마다 기록해 두고, `/undo` 로 원래대로 돌립니다.
- 되돌리기 전에 파일 목록(복원 / 지움: 새로 만든 파일)을 보여 주고 확인을 받습니다.
- 그 뒤에 다른 곳에서 다시 바뀐 파일은 덮어쓰지 않고 알려 줍니다.
- 되돌린 다음 요청에는 LLM 에게 어떤 파일을 되돌렸는지 알려 줍니다.
- jupyter 모드에서 노트북 파일을 고친 것도 되돌립니다.
- **셸 명령(bash)으로 바뀐 파일은 되돌리지 못합니다** (예: `sed -i`, `rm`, 스크립트 실행 결과). 5MB 넘는 파일도 기록하지 않습니다.
- 기록은 pi 를 끄면 사라집니다. 오래 남길 변경은 git 으로 관리하세요.

### 3-6. 이 구성에서 피할 명령
| 명령 | 이유 |
|---|---|
| `/compact`, `/fork`, `/clone`, `/tree`(다른 지점으로 이동) | 대화 기록이 바뀌어 Copilot 새 대화가 열리고, 지침과 기록을 다시 넣느라 1~2분 걸립니다. 꼭 필요할 때만 (`/compact` 가 회사 Copilot 에서 되는지는 [수동 작업 절차 4-2](docs/수동-작업-절차.md#4-2-요약-점검) 로 한 번 점검) |
| `/thinking` | 해당 없음. 생각 깊이는 모델로 고릅니다 ([4장](#4-모델-고르기)의 '깊이 생각하기') |
| `/login` | 필요 없음. 계정은 전용 창의 Copilot 로그인을 씁니다 |
| `/share` | 대화를 외부 서비스에 올리는 기능입니다. 쓰지 마세요 |

## 4. 모델 고르기
pi 의 모델 목록에 Copilot 모델이 들어 있습니다. 모델을 고르면 중계 서버가 Copilot 화면의 모델 메뉴에서 같은 모델을 골라 줍니다.
(Copilot 은 새 대화마다 '자동' 으로 돌아가므로 중계 서버가 매번 다시 고릅니다.)

| pi 모델 id | Copilot 화면의 모델 |
|---|---|
| `gpt-6.0-sol` (기본) | GPT › GPT-6 Sol |
| `gpt-5.6-sol-think` | GPT › GPT-5.6 Sol 깊이 생각하기 |
| `gpt-5.6-sol-fast` | GPT › GPT-5.6 Sol 빠른 응답 |
| `claude-sonnet-4.5` | Claude › Sonnet 4.5 |
| `claude-opus` | Claude › Opus |
| `copilot` | `bridge.json` 의 `copilot_model` (비우면 화면에 선택된 모델 그대로) |

```bash
pi --model gpt-5.6-sol-think         # 시작할 때 지정
```
- pi 화면에서는 `/model`(또는 `Ctrl+L`)로 고르고, `Ctrl+P` 로 다음 모델로 바꿉니다. 바꾸면 다음 질문부터 같은 Copilot 대화에서 모델만 바뀝니다.
- 고른 모델은 그 세션에만 기록됩니다. 새 세션의 기본 모델로 삼으려면 `/model` 목록에서 `Ctrl+S` 를 누르거나 `~/.pi/agent/settings.json` 의 `defaultModel` 을 바꿉니다.
- **깊이 생각하기**는 답마다 생각하는 시간이 붙어 느립니다. pi 는 작업 하나에 Copilot 과 여러 번 주고받으므로 평소에는 GPT-6 Sol 을 권합니다.
- Copilot 메뉴에 새 모델이 생기면 `~/.pi/agent/models.json` 의 `models` 에 한 줄 추가합니다. `id` 는 **Copilot 화면의 모델 이름 그대로** 씁니다.
  ```json
  { "id": "새 모델 이름", "name": "새 모델 (Copilot)", "contextWindow": 1000000, "maxTokens": 16000 }
  ```
  짧은 id 를 쓰고 싶으면 `bridge.json` 의 `copilot_models` 에 `"짧은-id": "화면 이름"` 을 넣습니다.
- Copilot 이 메뉴의 **모델 이름을 바꾸면** 그 모델을 고르지 못하고 '자동' 으로 답합니다. 띄어쓰기·`-`·버전 끝의 `.0` 만 다른 이름(`GPT 6.0 Sol` 과 `GPT-6 Sol`)은 같은 이름으로 보고,
  그 밖에는 내 설정 파일의 `copilot_models` 에 새 이름을 적습니다 ([수동 작업 절차 6장](docs/수동-작업-절차.md#6-필요할-때-한-번-하는-설정)의 '모델 이름이 바뀌었을 때').

### 4-1. 사내AI 모델 (2026-10-06.3 부터)
사내 웹 AI 채팅(이 문서에서는 '사내AI')도 pi 의 모델로 고를 수 있습니다. Copilot 사용량 제한에 걸렸을 때 등에 씁니다.
사내AI 의 주소는 저장소에 두지 않으므로, 처음 한 번 내 설정 파일 `~/.pi/agent/inhouse.json` 에 적습니다 (주소는 배포 담당이 알려 줌):
```json
{"copilot_url_contains": "<주소의 호스트 이름>", "copilot_new_chat_url": "<새 대화 주소>",
 "ui_noise_words": ["<답 아래 단추 글>"], "reply_busy_lines": ["<답을 만드는 동안에만 보이는 줄>"]}
```
- `ui_noise_words`: 답 아래에 있는 단추의 글(공유하기 등)이 답 끝에 섞여 나오면 그 글을 적습니다.
- `reply_busy_lines`: 사내AI 가 답을 쓰기 전에 처리 단계를 보여 주며 단계 사이에 오래 멈추면, 그동안에만 보이는 줄(처리 단계 제목 등)을 적습니다. 그 줄이 보이는 동안은 글이 멈춰도 답이 끝난 것으로 보지 않습니다 (없으면 글이 `stable_seconds`(사내AI 8초) 동안 그대로일 때 끝난 것으로 봄).
- 고친 뒤 pi 를 다시 실행하면 사내AI 중계 서버도 새 설정으로 다시 켜집니다 (2026-10-06.4 부터. 그 전 판은 `curl -s -X POST http://127.0.0.1:8766/shutdown` 뒤 pi 실행).

| pi 모델 id | 사내AI 화면 | |
|---|---|---|
| `inhouse-gemma4` | 안전모드 (Gemma 4) | 개인정보·중요정보가 들어가는 작업은 이쪽 (사내AI 안내) |
| `inhouse-sonnet` | 성능모드 (Claude Sonnet) | 개인정보·중요정보를 넣지 않는 작업만 |

- `/model` 에서 고릅니다. 처음 고르면 전용 창에 사내AI 탭을 열고, 고른 모드의 단추를 눌러 둔 뒤 질문합니다. 로그인이 필요하면 그 탭에서 로그인한 뒤 같은 요청을 다시 보내세요.
- pi 는 파일 내용과 명령 결과를 그대로 보냅니다. 모드를 고를 때 위 안내를 지켜 주세요.
- 사내AI 는 두 번째 중계 서버(포트 8766, 로그 `~/.pi/agent/inhouse-relay.log`)가 맡습니다. pi 를 실행하면 Copilot 중계 서버와 함께 켜집니다.
- Copilot 모델과 오가면 다음 질문은 그쪽의 새 대화로 이어 가므로 1~2분 걸립니다. 사내AI 대화는 자동으로 지우지 않으니 가끔 직접 정리하세요.
- 모드(안전·성능)는 작업 도중보다 시작할 때 고르세요. 사내AI 화면에서 대화 도중 모드를 바꿀 때의 동작(새 대화가 열리는지 등)은 아직 실제로 확인하지 못했습니다.
- 입력창의 id 처럼 화면을 열 때마다 바뀔 수 있는 값은 `input_selector` 에 적지 마세요 (비워 두면 중계 서버가 찾음).
- 사내AI 가 개인정보·민감 정보 확인으로 답하지 않으면, 중계 서버는 다시 부탁하지 않고 멈춰서 그 답을 그대로 보여 줍니다 (`사내AI: 개인정보·민감 정보 확인으로 답하지 않았습니다 …`). 나눠 보내던 긴 메시지였으면 남은 조각은 보내지 않고, 다음 요청 때 같은 대화에 처음부터 다시 보냅니다.
- 새 대화의 첫 메시지에는 '자기 도구(코드 실행, 파일 검색 등)로 직접 처리하지 말라' 는 규칙이 붙습니다 (`copilot/inhouse.json` 의 `extra_rules`). 자기 도구를 가진 채팅 서비스가 요청을 직접 처리하려다 '경로가 없다' 고 답하면, 중계 서버가 한 번 설명하고 작업 블록을 다시 부탁합니다.
- 확인: pi 가 일하지 않을 때 `python ~/tools/pi/copilot/diag.py --inhouse --send` (사내AI 에 새 대화로 시험 질문 하나를 보내 답과 명령 읽기를 확인).
- 사내AI 설정을 바꿀 때는 `~/.pi/agent/inhouse.json` 에 적습니다 (Copilot 의 내 설정 파일과 따로). 항목은 `copilot/inhouse.json` 과 같습니다.

## 5. 실행 위치 바꾸기: PC 와 Jupyter 노트북
pi 와 Copilot 은 PC 에서 돌고, **명령 실행과 파일 작업(도구 4개: bash, read, write, edit)만** Kubeflow 노트북에서 하게 할 수 있습니다. 노트북에는 아무것도 설치하지 않습니다.

**준비:** 전용 창에서 Kubeflow 에 로그인하고 **JupyterLab 을 탭으로 열어 둡니다** (평소 Chrome 에 열린 탭은 쓸 수 없음).
- 전용 창을 띄울 때 JupyterLab 도 함께 열리게 하려면 내 설정 파일(`~/.pi/agent/bridge.json`)의 `jupyter_url` 에 주소(`https://<kubeflow 주소>/notebook/<네임스페이스>/<노트북>/lab`)를 넣어 둡니다.
- 확인: `python ~/tools/pi/copilot/diag.py --jupyter`

```bash
pi --jupyter work/myproject          # 노트북의 ~/work/myproject 에서 실행 (없으면 만듦)
pi --jupyter work/myproject -c       # 그 프로젝트의 지난 대화를 이어서
```

**같은 세션 안에서 바꾸기:**

| 명령 | 뜻 |
|---|---|
| `/jupyter work/mlproj` (또는 `/web work/mlproj`) | 이후 명령·파일 작업을 노트북의 `~/work/mlproj` 에서 (없으면 만듦) |
| `/jupyter` | 마지막으로 쓴 노트북 폴더로 다시 |
| `/local` | 다시 이 PC 에서 (pi 를 실행한 폴더) |
| `/local ~/work/프로젝트` | 다시 이 PC 에서, 그 폴더를 작업 폴더로 |

- 대화 내용·지침·모델은 그대로 이어집니다. 화면 아래 상태 줄의 `Jupyter: …` 가 지금 노트북 위치입니다 (없으면 PC).
- 바꾼 위치는 `/new`, `/resume`, `/reload` 뒤에도 그대로입니다. 바꾼 뒤 첫 질문은 Copilot 새 대화라 1~2분 걸립니다 (작업 폴더가 바뀌어 지침을 다시 보냄).
- jupyter 모드의 경로: 상대 경로는 노트북 작업 폴더, `~` 는 노트북 홈 기준입니다. `C:/...`, `//서버/...` 처럼 PC 경로를 적으면 PC 파일을 읽고 씁니다
  (pi 설정 폴더 `~/.pi/agent` 도 PC 의 것: 스킬 만들기 등).
- 노트북 폴더 이름에는 한글도 됩니다. `pi --jupyter` 로 시작한 세션 기록은 PC 의 `~/.pi/jupyter-work/<폴더 이름>` 에 노트북 폴더별로 따로 쌓입니다.
- 연결에 실패하거나 없는 폴더를 주면 위치를 바꾸지 않습니다.
- 노트북 쪽 명령은 JupyterLab 터미널 `pibridge` 에서 실행됩니다. JupyterLab 왼쪽 '실행 중인 터미널과 커널' 에서 열면 실시간으로 보입니다.
  pi 여러 개 동시 실행(`max_tabs`)을 켜면 두 번째 pi 부터는 `pibridge2`, `pibridge3` … 에서 실행됩니다.
- 명령은 입력 없이 실행됩니다. 입력을 기다리는 명령(vi, less, 인자 없는 python 등)은 쓰지 마세요. `Esc` 로 멈추면 노트북 명령에도 Ctrl+C 가 전달됩니다.
- 노트북 홈에 생기는 `pi-bridge` 폴더는 실행 기록용입니다. pi 를 쓰지 않을 때 지워도 됩니다.

**PC ↔ 노트북 파일 옮기기:**

| 명령 | 뜻 |
|---|---|
| `/upload 보고서.docx` | PC 작업 폴더의 파일을 노트북 작업 폴더로 (jupyter 모드가 아니면 노트북 홈으로) |
| `/upload ~/Downloads/data.csv data/` | 노트북의 `data/` 폴더 안으로 |
| `/download result.csv` | 노트북 작업 폴더의 파일을 PC 작업 폴더로 |
| `/download ~/work/x/model.pkl out/` | 노트북 경로를 직접, PC 의 `out/` 폴더 안으로 |
| `/upload 실험코드` · `/download 결과` | 폴더째 옮기기 (자동으로 묶어 보내고 받은 쪽에서 풂) |

- 파일·폴더 하나씩, 1GB 까지 옮깁니다 (폴더는 묶은 크기). 4MB 넘으면 나눠 보내고, 화면 아래 상태 줄에 진행률이 나옵니다.
  속도는 시험에서 올리기 초당 약 2MB, 받기 초당 약 4MB 였습니다 (51MB: 올리기 25초, 받기 11초).
- 이미 있는 파일은 덮어쓸지, 이미 있는 폴더는 합칠지(같은 이름 파일은 덮어씀) 묻습니다.
- 폴더를 옮길 때는 노트북 쪽 경로가 '그 안에 넣을 폴더' 입니다 (`/upload 실험코드 work/` → 노트북 `work/실험코드`).
- 노트북 홈 밖이나 숨김 폴더(`.` 으로 시작)의 파일은 50MB 까지만 받을 수 있습니다.
- 경로에 공백이 있으면 따옴표로 감쌉니다: `/upload "회의 자료.pdf"`
- 노트북 쪽은 JupyterLab 탭이 열려 있으면 jupyter 모드가 아니어도 됩니다.
- PC 쪽 상대 경로는 PC 작업 폴더 기준입니다. `pi --jupyter` 로 시작했으면 pi 를 실행한 폴더입니다.

## 6. 지침, 스킬, 메모리
pi 에게 무엇을 어디에 적어 두는지 정리한 표입니다.

| 알려 주고 싶은 것 | 적는 곳 | 언제 쓰이나 |
|---|---|---|
| 항상 지킬 규칙, 내 작업 방식 | `~/.pi/agent/AGENTS.md` (공통 지침) | 모든 세션 |
| 이 프로젝트의 규칙, 구조, 빌드·테스트 방법 | 프로젝트 폴더의 `AGENTS.md` (프로젝트 지침) | 그 폴더(또는 하위 폴더)에서 시작한 세션 |
| 특정 작업의 절차, 양식, 참고 자료 | 스킬: `~/.pi/agent/skills/<이름>/SKILL.md` | 작업이 스킬 설명과 맞을 때 LLM 이 읽음. `/skill:이름` 으로 직접 부를 수도 있음 |
| 자주 쓰는 지시문 | 프롬프트 템플릿: `~/.pi/agent/prompts/<이름>.md` (기본 명령은 아래) | `/이름` 을 입력할 때 |
| 지난 작업의 맥락 | 세션 기록 (자동 저장) | `pi -c`, `/resume` |

파일 이름은 정확히 **`AGENTS.md`**(S 포함, 대문자)와 **`SKILL.md`**(대문자) 입니다.

### 지침 (AGENTS.md)
pi 는 세션을 시작할 때 아래 파일을 찾아 **지침으로 함께 읽습니다** (있는 것 모두).
1. `~/.pi/agent/AGENTS.md`: 공통 지침. 어느 폴더에서 시작하든 적용됩니다.
2. 작업 폴더와 그 **상위 폴더들**의 `AGENTS.md`: 프로젝트 지침. 예를 들어 `~/work/AGENTS.md` 는 `~/work` 아래 모든 프로젝트에 적용됩니다.
   (`AGENTS.md` 대신 `CLAUDE.md` 라는 이름도 읽습니다.)

**기본 지침:** 처음 설치할 때 `~/.pi/agent/AGENTS.md` 를 만들어 둡니다 (이미 있으면 만들지 않고, 업데이트해도 바꾸지 않음). 내용은 자유롭게 고쳐 쓰세요.
- 한국어로 답하고, 끝에 한 일·바꾼 파일·확인 방법을 정리
- 폐쇄망 규칙 (외부 접속·다운로드 금지, pip 는 사내 미러로 `--user`, 설치 전에 알림), Git Bash 요령
- 빠르게 일하는 방법: 큰 파일은 grep 으로 위치를 찾아 일부만 읽기, 작은 수정은 edit 로, 긴 출력은 줄이기
  (Copilot 과 주고받는 글이 짧아져 새 대화·긴 메시지 나눔이 줄어듭니다)

예시 `~/work/myproject/AGENTS.md`:
```markdown
# 프로젝트 지침
- Python 3.11. 테스트는 `pytest -q` 로 돌리고, 고친 뒤에는 반드시 테스트를 돌릴 것
- 원본 데이터(data/raw/)는 고치지 말 것
- 보고는 한국어로, 바꾼 파일 목록을 마지막에 정리할 것
```
- pi 시작 화면 위쪽에 읽어 들인 지침 파일 목록이 나옵니다.
- 실행 중에 고쳤으면 `/reload` 로 다시 읽습니다. 지침이 바뀌면 다음 질문은 Copilot 새 대화에서 새 지침으로 시작합니다.
- 한 줄짜리 규칙은 `/remember <내용>` 으로 바로 적을 수 있습니다 (아래 [메모리](#메모리)).
- pi 에게 "이 규칙을 AGENTS.md 에 추가해줘" 라고 시켜도 됩니다. 공통 지침(`~/.pi/agent/AGENTS.md`)은 작업 폴더 밖이라 확인 창이 뜨니 실행을 허용하세요 ([8장](#8-주의할-점)).
- 그 밖에 `~/.pi/agent/APPEND_SYSTEM.md` 는 pi 의 기본 지시문 뒤에 덧붙고, `SYSTEM.md` 는 기본 지시문을 통째로 바꿉니다. 보통은 AGENTS.md 로 충분합니다.

### 스킬 (SKILL.md)
스킬은 **특정 작업을 위한 지침과 자료를 담은 폴더**입니다.
pi 는 시작할 때 스킬의 이름과 설명만 LLM 에게 알려 주고, 작업이 그 설명과 맞으면 LLM 이 `SKILL.md` 를 읽고 따릅니다.
평소에는 본문이 지침에 들어가지 않으므로 여러 개 만들어 두어도 부담이 적습니다.

```
~/.pi/agent/skills/
└── weekly-report/
    ├── SKILL.md
    └── template.md          # 스킬이 참고할 자료 (선택)
```
`SKILL.md`:
```markdown
---
name: weekly-report
description: 주간 업무 보고서를 쓸 때 사용. 이번 주 git 기록을 모아 template.md 양식으로 보고서 초안을 만든다.
---
# 주간 보고서
1. `git log --since="1 week ago" --oneline` 으로 이번 주 변경을 모은다.
2. 이 스킬 폴더의 template.md 양식에 맞춰 report/주간보고_<날짜>.md 로 쓴다.
```
- 맨 위 `---` 사이의 `name`, `description` 은 꼭 있어야 합니다.
  - `name`: 영문 소문자·숫자·`-` (폴더 이름과 같게).
  - `description`: **무엇을 하는지와 언제 쓰는지**를 적습니다. LLM 은 이 설명을 보고 스킬을 고릅니다.
- 확실히 쓰게 하려면 `/skill:weekly-report` (뒤에 요청을 붙여도 됨: `/skill:weekly-report 이번 주는 배포 위주로`).
- 만들거나 고친 뒤에는 `/reload`.

**기본 스킬:** 설치할 때 `~/.pi/agent/skills/` 에 복사됩니다. 작업이 설명과 맞으면 LLM 이 알아서 읽고, `/skill:이름` 으로 직접 부를 수도 있습니다.

| 스킬 | 쓰는 때 |
|---|---|
| `skill-creator` | "○○ 스킬 만들어줘" 하면 형식에 맞게 만들어 줌. 팀 노하우를 스킬로 쌓기 쉬움 |
| `office-files` | 엑셀·워드 파일 읽기·만들기, PDF·한글(hwp, hwpx) 파일 읽기 (pandas, openpyxl, python-docx, pypdf 등. 없으면 사내 미러로 `--user` 설치) |
| `data-analysis` | CSV·엑셀 탐색, 요약 통계, 집계. 그래프는 파일로 저장 (한글 글꼴 요령 포함) |
| `kubeflow-notebook` | 노트북 요령: GPU·메모리·디스크 확인, `pip --user`, 긴 작업은 nohup + 로그, 홈(PVC) 보존 |
| `korean-report` | 주간보고·작업 결과 보고서·회의록 (개조식, 양식 파일 포함) |
| `debugging` | 재현 → 오류 읽기 → 원인 좁히기 → 고치기 → 확인 순서 |

**기본 명령·스킬과 업데이트:** 고치지 않은 것은 새 판으로 바꾸고, 직접 고친 것은 그대로 둡니다 (설치할 때 "직접 고친 것은 그대로 둠" 으로 알려 줌). 지운 것은 다시 넣지 않습니다.

스킬을 두는 곳:

| 위치 | 범위 |
|---|---|
| `~/.pi/agent/skills/` | 모든 프로젝트 (권장) |
| `~/.agents/skills/` | 모든 프로젝트 (여러 에이전트가 같이 쓰는 표준 위치) |
| 프로젝트 폴더의 `.pi/skills/`, `.agents/skills/` | 그 프로젝트만. 아래 '프로젝트 신뢰' 를 거칩니다 |

**프로젝트 신뢰:** 프로젝트 폴더에 `.pi/skills/`, `.pi/settings.json` 같은 설정이 있으면, pi 는 시작할 때 이 폴더를 믿을지 묻습니다.
믿는다고 답해야 그 스킬·설정이 들어옵니다. `/trust` 로 결정을 저장하면 다음부터 묻지 않습니다.
`pi -p` 는 물을 수 없어서 건너뜁니다 (불러오려면 `pi --approve -p "..."`). 지침(AGENTS.md)은 신뢰와 관계없이 항상 읽습니다.

### 기본 명령 (프롬프트 템플릿)
자주 하는 일을 짧은 명령으로 시킬 수 있게 기본으로 넣어 두었습니다. 명령 뒤에 덧붙인 말은 요청에 함께 들어갑니다.

| 명령 | 하는 일 |
|---|---|
| `/init` | 프로젝트를 살펴보고 그 폴더의 `AGENTS.md`(프로젝트 지침) 초안을 씀. 이미 있으면 빠진 내용만 제안 |
| `/handoff [메모]` | 지금까지 한 일·다음 할 일을 `NOTES.md` 에 정리. 다음 날 `pi -c` 나 새 세션에서 이어 가기 좋음 |
| `/review [파일·볼 점]` | 커밋하지 않은 변경(git diff)을 검토. 고치지 않고 문제를 심각한 순서로 정리 |
| `/test [대상]` | 테스트를 돌리고, 실패하면 원인을 찾아 고침 (테스트를 지우거나 건너뛰게 하지 않음) |
| `/commit [내용]` | 바뀐 내용으로 한국어 커밋 메시지를 써서 커밋 (push 는 하지 않음) |
| `/explain <파일·함수>` | 코드를 읽고 하는 일·구조·흐름·주의할 점을 설명 |

- 기본 명령은 설치할 때 `~/.pi/agent/prompts/` 에 복사됩니다 (예: `review.md`). 고쳐 써도 됩니다.
- 내 명령은 같은 곳에 `<이름>.md` 로 만듭니다 (형식은 기본 명령 파일을 참고).

### 팀과 스킬·명령 같이 쓰기
**공유 폴더** (공유 드라이브, 같이 받는 폴더 등): 폴더 안에 `skills/<이름>/SKILL.md`, `prompts/<이름>.md` 를 두고 pi 에서 등록합니다.
```
/kit share Z:/팀/pi
```
- 그 폴더의 `skills`·`prompts` 를 `~/.pi/agent/settings.json` 에 등록하고 바로 다시 읽습니다. 팀원은 각자 한 번만 등록하면 됩니다.
- 폴더가 비어 있으면 `skills`·`prompts` 를 만들지 묻습니다. 새 스킬은 `skill-creator` 에게 "Z:/팀/pi/skills 에 ○○ 스킬 만들어줘" 라고 하면 됩니다.
- `/kit share` 만 입력하면 등록된 폴더를 보여 주고, `/kit unshare Z:/팀/pi` 로 뺍니다.
- 내 스킬과 이름이 겹치면 공유 폴더 쪽이 쓰입니다. 이름을 다르게 지으세요.

**프로젝트 저장소:** 프로젝트에만 쓰는 스킬·명령은 그 저장소의 `.pi/skills/`, `.pi/prompts/` 에 두고 `AGENTS.md` 와 함께 커밋합니다.
받은 사람이 처음 pi 를 켜면 이 폴더를 믿을지 묻습니다 (`/trust` 로 저장).

### 메모리
- **pi 에는 자동 메모리 기능이 없습니다.** 대화에서 무엇을 기억할지 스스로 골라 저장하지 않습니다.
- 오래 기억시킬 것은 **AGENTS.md 에 적습니다.** 공통이면 `~/.pi/agent/AGENTS.md`, 프로젝트별이면 프로젝트 폴더에 둡니다.
- **`/remember <내용>`** 이 가장 빠릅니다. 예: `/remember 테스트는 pytest -q 로 돌린다`
  - 어디에 적을지 고릅니다: **이 프로젝트만**(작업 폴더의 `AGENTS.md`, jupyter 모드면 노트북 작업 폴더) 또는 **모든 프로젝트**(`~/.pi/agent/AGENTS.md`).
  - 그 파일의 `## 기억할 것` 아래에 한 줄로 더합니다 (없으면 만듦). 같은 내용이 있으면 더하지 않습니다.
  - 지침 파일은 pi 를 시작할 때 읽지만, 지금 대화에도 다음 요청과 함께 바로 알려 줍니다 (`/reload` 처럼 Copilot 새 대화를 열지 않음).
  - 지우거나 고칠 때는 그 파일을 직접 고칩니다. 너무 많이 쌓이면 새 대화를 열 때 보내는 글이 길어지니 가끔 정리하세요.
- 긴 규칙이나 여러 줄은 직접 적거나, pi 에게 "방금 정한 규칙을 AGENTS.md 에 추가해줘" 라고 시킵니다.
- 하던 작업의 맥락은 **세션**으로 이어 갑니다 (`pi -c`, `/resume`). 세션 기록은 PC 에 남으므로 Copilot 대화가 지워져도 사라지지 않습니다.
- 긴 작업은 진행 메모를 파일로 남기게 하면 좋습니다. AGENTS.md 에 "작업을 마치면 진행 상황과 다음 할 일을 NOTES.md 에 정리할 것" 처럼 적어 두면, 다음 세션에서 그 파일을 읽고 이어 갑니다.
- **Copilot 자체 메모리:** Copilot 은 계정 설정에 따라 대화 내용을 따로 기억할 수 있고, 이 기억은 대화를 지워도 남습니다.
  pi 의 동작에는 필요 없는 기능이니, 무엇이 남는지는 Copilot 설정에서 확인·관리하세요.

### jupyter 모드에서
pi 자체는 PC 에서 돌기 때문에 지침·스킬·세션은 PC 것을 씁니다. 노트북으로 넘어가는 것은 도구 4개뿐입니다.

| 항목 | 위치 | jupyter 모드에서 |
|---|---|---|
| 공통 지침 | PC `~/.pi/agent/AGENTS.md` | 적용 |
| 프로젝트 지침 (노트북에 둘 때) | 노트북 `~/work/<프로젝트>/AGENTS.md` | 적용. 코드와 함께 관리하기 좋음 |
| 프로젝트 지침·스킬 (PC 에 둘 때) | PC `~/.pi/jupyter-work/work_<프로젝트>/` 의 `AGENTS.md`, `.pi/skills/` | `pi --jupyter work/<프로젝트>` 로 시작했을 때 적용 (폴더 이름은 `/` 를 `_` 로 바꾼 것) |
| 스킬 | PC `~/.pi/agent/skills/` | SKILL.md 는 PC 에서 읽음. 단 스킬에 딸린 스크립트는 명령이 노트북에서 실행되므로 쓸 수 없음 |
| 세션 기록 | PC `~/.pi/agent/sessions/` | 노트북 프로젝트별로 따로 쌓임 (PC 작업 세션과 목록이 따로) |

- jupyter 모드에서 경로만 적으면 노트북에서 찾습니다. PC 파일은 `C:/Users/...` 처럼 드라이브부터 적으면 PC 에서 읽고 씁니다
  (또는 `/upload` 로 올리거나 `/local` 로 바꾼 뒤 요청). 스킬 만들기(`~/.pi/agent/skills`)는 jupyter 모드에서도 PC 에 만들어집니다.
- ML 작업이라면: 공통 규칙(코딩 스타일, 보고 방식)은 PC `~/.pi/agent/AGENTS.md`, 프로젝트 규칙(데이터 위치, 실험 방법)은 노트북 `~/work/<프로젝트>/AGENTS.md` 에 두고,
  `pi --jupyter work/<프로젝트>` 로 작업한 뒤 다음 날은 `-c` 를 붙여 이어 갑니다.

## 7. Copilot 대화 관리
- **같은 대화에 이어서:** 중계 서버는 pi 세션 하나를 Copilot 대화 하나로 이어 갑니다. 처음에는 지침·도구 설명·요청을 함께 보내고, 그 뒤로는 새로 추가된 부분만 보냅니다.
- **새 대화가 열리는 때:** 새 세션(`/new`, pi 다시 시작. `-c` 로 이어 시작해도 해당), 지침을 바꾸고 `/reload`, `/jupyter`·`/local` 로 실행 위치를 바꾼 다음 질문, `/kit share`·`/kit unshare`,
  [3-6](#3-6-이-구성에서-피할-명령)의 기록을 바꾸는 명령,
  `Esc` 로 멈춘 다음 질문, 대화당 질문 수(`max_questions_per_chat`, 기본 100)에 닿았을 때.
  새 대화에는 지침과 최근 기록(오래된 것은 한 줄 요약)을 다시 넣으므로 1~2분 걸립니다.
- **아주 긴 세션:** pi 는 맥락 한도(약 100만 토큰)에 가까워지면 앞 대화를 스스로 요약합니다 (`/compact` 와 같음). 요약 요청과 그다음 질문이 각각 새 대화라 몇 분 걸립니다 (상태 줄에 진행이 보임).
  요약할 대화가 아주 길면 중계 서버가 처음 요청과 최근 작업만 남기고 가운데를 줄여 보냅니다 (Copilot 에 보내는 조각 수를 10개 안쪽으로).
  며칠씩 `pi -c` 로 이어 쓴 세션은 `/handoff` 로 정리한 뒤 `/new` 로 새로 시작하는 편이 빠릅니다.
  회사 Copilot 에서 요약과 새 대화 넘어가기가 되는지는 [수동 작업 절차 4-2·4-3](docs/수동-작업-절차.md#4-2-요약-점검) 으로 한 번 점검합니다.
- **끝난 대화 자동 삭제:** pi 세션이 끝나면(종료, `/new` 등) 그 세션이 쓰던 Copilot 대화를 왼쪽 목록에서 지웁니다. 맥락은 pi 세션에 남아 있으므로 Copilot 쪽 대화는 남길 필요가 없습니다.
  - 중계 서버가 만든 대화만 기록해 두고(`~/.pi/agent/copilot-chats.json`) 그것만 지웁니다. 직접 쓴 대화는 건드리지 않습니다.
  - 확인 창에 그 대화의 제목이 보일 때만 '삭제' 를 누릅니다. 다르면 취소합니다.
  - 창을 닫아 알림 없이 끝난 세션의 대화는 다음에 새 대화를 열 때 지웁니다.
  - 끄려면 `bridge.json` 의 `"delete_finished_chats": false`.

## 8. 주의할 점
- **pi 는 기본적으로 한 번에 하나만** 실행하세요. Copilot 탭 하나를 같이 쓰므로, 두 개를 같이 쓰면 질문이 번갈아 들어갈 때마다 새 대화가 열립니다.
  여러 개를 동시에 쓰려면 내 설정 파일에 `"max_tabs": 2` (또는 3)를 넣으세요. pi 마다 Copilot 창을 따로 열어 동시에 처리합니다.
  창은 필요할 때 전용 브라우저에 새로 열리고(지금 보는 창을 가리지 않음), 세션이 끝나면 다음 pi 가 이어 씁니다.
  질문이 그만큼 많이 나가므로 사용량 제한이 있는 계정이면 주의하세요.
  jupyter 모드에서도 창마다 노트북 터미널을 따로 써서(창 1: `pibridge`, 창 2: `pibridge2` …) 노트북 명령이 동시에 실행됩니다.
- **전용 창의 Copilot 탭에서 직접 대화하지 마세요.** 대화 흐름이 섞입니다. 창은 최소화해도 되지만 닫으면 안 됩니다.
- **속도:** 질문 한 번 왕복에 보통 7~20초 걸립니다. pi 는 도구를 쓸 때마다 Copilot 에 한 번씩 묻기 때문에, 파일 여러 개를 다루는 작업은 몇 분 걸립니다.
  실제로 얼마나 걸리는지는 `diag.py --report` 의 '최근 요청' 줄(평균 시간, 새 대화 횟수와 시간, 긴 메시지를 나눠 보낸 횟수)에서 볼 수 있습니다.
  새 대화를 열 때 1~2분 걸리는 것은 대부분 긴 메시지를 1만 자씩 나눠 보내기 때문입니다. `diag.py --input-limit` 로 입력창 한도를 확인하고,
  더 받는다면 내 설정 파일의 `max_chars` 를 늘리면 빨라집니다.
  파일을 여러 개 읽는 작업이 많다면 `multi_read` 를 켜 보세요. Copilot 이 여러 파일 읽기를 한 번에 요청할 수 있어 왕복이 줄어듭니다 (시험 기능, 기본 꺼짐).
- **사용량 제한:** 쉬지 않고 일하면 분당 질문 5개 정도가 나갑니다. 시험에서는 30분에 약 145개를 보냈을 때 약 1시간 동안 막혔습니다.
  이런 제한이 있는 계정이면 `bridge.json` 의 `max_questions_per_minute` 를 2 정도로 두세요. 제한이 없는 환경이면 기본값 0(끔) 그대로 둡니다.
- **위험할 수 있는 작업은 실행 전에 묻습니다.** pi 는 보통 도구를 쓸 때 허락을 묻지 않지만, 되돌리기 어려운 작업은 확인 창을 띄웁니다.
  - 대상: 폴더 지우기(`rm -r` 등), `git push`·`git reset --hard`·`git clean`·`git branch -D`, 권한 일괄 변경, `kubectl delete`,
    패키지 제거, `sudo`, 받은 스크립트 바로 실행(`curl ... | sh`), 데이터베이스 삭제, 작업 폴더 밖 파일 쓰기 (jupyter 모드는 노트북 작업 폴더 기준)
  - 거부하면 실행하지 않고 작업을 멈춥니다. 직접 치는 `!명령` 은 묻지 않습니다. `pi -p` 처럼 물을 수 없을 때는 실행하지 않고 LLM 에게 이유를 알립니다.
  - 명령 자리의 낱말만 봅니다. `echo "rm -rf ..."` 같은 따옴표 안의 글, 주석, `cat <<'EOF' > 파일` 로 쓰는 본문은 묻지 않습니다.
    대신 실제로 실행되는 글(`bash -c "..."`, `eval`, `ssh 호스트 '...'`, `$(...)`, `xargs rm`, `python -c` 코드 등)은 안까지 봅니다.
  - 묻지 않을 명령, 더 물어볼 명령은 [10장](#10-설정)의 `guard_allow`, `guard_patterns` 로 정합니다.
  - 계획 모드에서는 이런 작업을 묻지 않고 막고, 확인 모드에서는 바뀌는 내용과 함께 한 번에 묻습니다 ([3-4](#3-4-작업-모드-plan-mode)).
- 그래도 모든 위험을 막지는 못합니다. 중요한 폴더는 git 으로 관리하고 바뀐 내용을 확인하세요. 시킨 범위를 벗어나는 작업이 보이면 `Esc` 로 멈춥니다.

## 9. 새 버전으로 바꾸기
실행 중인 pi 를 모두 끄고 Copilot 전용 창도 닫은 뒤, 받은 zip 의 위치를 `Z=` 뒤에 적어 실행합니다 (`~/tools/pi` 밖의 폴더에서).
```bash
cd ~
Z=~/Downloads/pi-agent-like-agent-main.zip
unzip -o -j -q "$Z" '*/update.sh' -d ~/tools && bash ~/tools/update.sh "$Z"
```
- 새 판의 `update.sh` 를 꺼내 실행합니다. 지금 판에 `update.sh` 가 없는 예전 판(2026-10-02 이전)도 이 방법으로 바꿉니다.
  이미 새 판을 쓰고 있으면 `bash ~/tools/pi/update.sh "$Z"` 도 같습니다.
- 하는 일: zip 확인 → 중계 서버 끄기 → 지금 폴더를 `~/tools/pi.old` 로 이름 바꾸기 → 새 판을 `~/tools/pi` 에 → `install.sh` 로 설정 반영.
- 끝에 `지금 판 -> 새 판` 과 확인할 점을 보여 줍니다. 그다음 `pi` 를 실행하면 새 판으로 시작합니다 (중계 서버도 새 판으로 켜짐). `/doctor` 의 '버전' 줄로 확인합니다.
- 폴더가 사용 중이라 이름을 바꾸지 못하면 **아무것도 바꾸지 않고 멈춥니다.** pi, Copilot 전용 창, 그 폴더를 연 탐색기·터미널을 닫고 다시 실행하세요.
- 받은 zip 이 지금과 같은 판이면 멈춥니다 (이전 판 폴더를 덮지 않도록). 브라우저가 `(1)` 을 붙여 저장한 새 파일인지 확인하고, 같은 판을 다시 깔려면 끝에 `--force`.
- 메시지별 할 일, `update.sh` 가 안 될 때의 손 절차, 바꾼 뒤 점검(5분 점검, 처음 한 번 요약 점검): [수동 작업 절차 3·4장](docs/수동-작업-절차.md#3-새-판으로-바꾸기)

그대로 남는 것:
- `~/.pi/agent` 의 설정(`settings.json`, `models.json`)에는 **새 판에 추가된 항목(새 모델 등)만** 넣습니다. 바뀐 파일은 `갱신:` 으로 알려 주고, 이전 파일은 `.bak` 으로 남깁니다.
- 직접 고친 값과 직접 지운 항목, 내 설정 파일(`~/.pi/agent/bridge.json`), 지침(AGENTS.md), 스킬, 세션 기록은 그대로입니다.
- 확장(`~/.pi/agent/extensions/`)은 새 것으로 바뀝니다. 새 판에서 빠진 키트 확장은 `~/.pi/agent/extensions.removed/` 로 옮깁니다 (직접 만든 확장은 그대로).
- 기본 명령·스킬(`~/.pi/agent/prompts`, `skills`)은 고치지 않은 것만 새 판으로 바뀝니다. 직접 고친 것과 지운 것은 그대로입니다.
- 예전 판에서 `copilot/bridge.json` 을 직접 고쳤다면 `update.sh` 가 그 항목을 알려 줍니다. 그 항목을 내 설정 파일([10장](#10-설정))로 옮기세요.
- 잘 동작하면 `~/tools/pi.old` 는 지워도 됩니다 (지우면 그 뒤로는 zip 으로만 되돌릴 수 있음).

**이전 판으로 되돌리기:** `~/tools/pi.old` 에는 바로 앞 판 하나만 남습니다 (다음 업데이트 때 지워짐). 받은 zip 은 보관해 두세요.
- 이전 판 zip 이 있으면: `cd ~ && bash ~/tools/pi/update.sh <이전 판 zip>` (지금 판은 `pi.old` 로 남고, 그 판에 없는 확장은 치움)
- zip 이 없으면 `pi.old` 로 되돌리는 절차: [수동 작업 절차 5장](docs/수동-작업-절차.md#5-이전-판으로-되돌리기)

## 10. 설정
| 파일 | 내용 |
|---|---|
| `~/.pi/agent/bridge.json` | **내 설정 파일.** 아래 항목 중 바꾸고 싶은 것만 적습니다. 업데이트해도 그대로 남습니다 |
| `~/tools/pi/copilot/bridge.json` | 중계 서버 설정의 기본값 (저장소에 들어 있는 파일이라 업데이트하면 새 판 값으로 바뀜. 직접 고치지 마세요) |
| `~/.pi/agent/settings.json` | pi 설정: 기본 모델(`defaultModel`), 응답 대기(`retry.provider.timeoutMs`), Git Bash 경로(`shellPath`), 자동 다시 시도 끔(`retry.enabled: false`: 오류·사용량 제한 때 같은 질문을 바로 여러 번 보내지 않게. 오류가 나면 같은 요청을 다시 보내면 이어서 진행) |
| `~/.pi/agent/models.json` | pi 가 쓸 모델 목록 |

**내 설정 파일 예시** (`~/.pi/agent/bridge.json`):
```json
{
  "jupyter_url": "https://<kubeflow 주소>/notebook/<네임스페이스>/<노트북>/lab",
  "max_questions_per_minute": 2,
  "copilot_models": { "gpt-7": "GPT 7" }
}
```
- 항목은 맨 바깥 `{ }` 안에 적습니다 (`_예시` 안에 넣으면 적용되지 않음). 파일은 **UTF-8** 로 저장합니다.
- 새 모델을 `/model` 목록에 보이게 하려면 `~/.pi/agent/models.json` 에도 그 id 를 넣습니다 ([4장](#4-모델-고르기)).
- 적은 항목만 기본값을 덮어씁니다. `copilot_models` 같은 표는 항목별로 합쳐집니다 (위 예시는 모델 하나를 더하는 것).
- `_` 로 시작하는 항목(`_설명` 등)은 설명용이라 무시됩니다.
- 형식이 틀리면 `pi` 를 실행할 때 `[pi] 설정 파일 오류: ... (줄 n, 칸 m)` 으로 알려 줍니다.
- 이 문서에서 "`bridge.json` 의 ○○" 라고 한 항목은 모두 내 설정 파일에 적으면 됩니다.

자주 바꾸는 항목:

| 항목 | 기본값 | 뜻 |
|---|---|---|
| `browser` | `chrome` | 전용 창 브라우저. `edge` 도 됩니다 (지정한 쪽이 없으면 다른 쪽으로 띄움) |
| `auto_start_browser` | `true` | `pi` 를 실행할 때 전용 창이 꺼져 있으면 띄움 |
| `jupyter_url` | (빈 값) | 전용 창을 띄울 때 함께 열 JupyterLab 주소 |
| `delete_finished_chats` | `true` | 끝난 세션의 Copilot 대화 삭제 |
| `max_questions_per_minute` | `0` | 분당 질문 수 제한 (0 이면 끔) |
| `max_questions_per_chat` | `100` | 이만큼 질문하면 새 대화로 넘어감 |
| `max_chars` | `10000` | Copilot 메시지 하나의 최대 글자 수. 넘으면 나눠 보내고 조각마다 왕복이 한 번 더 듭니다 (`diag.py --input-limit` 로 확인) |
| `max_tabs` | `1` | 2 이상이면 pi 를 여러 개 동시에 쓸 때 pi 마다 Copilot 창을 따로 씀 (최대 그 수만큼 창을 엶, [8장](#8-주의할-점)) |
| `multi_read` | `false` | `true` 면 Copilot 이 파일 읽기(read)를 여러 개 한 번에 요청할 수 있음 (왕복 줄이기, 시험 기능). 고치기·명령 실행은 그대로 하나씩 |
| `first_reply_timeout_seconds` / `reply_timeout_seconds` | `300` / `900` | 답이 시작될 때까지 / 끝날 때까지 기다리는 초. 늘릴 때는 `settings.json` 의 `retry.provider.timeoutMs`(밀리초) 도 함께 |
| `copilot_models` | 4장의 표 | pi 모델 id → Copilot 화면의 모델 이름 |
| `guard` | `true` | 위험할 수 있는 작업을 실행 전에 묻기 ([8장](#8-주의할-점)). `false` 면 끔 |
| `guard_allow` | `[]` | 묻지 않을 명령 (정규식 목록, 예: `["^git push origin feature/"]`) |
| `guard_patterns` | `[]` | 더 물어볼 명령 (정규식 목록, 예: `["make deploy"]`) |
| `guard_outside_writes` | `true` | 작업 폴더 밖 파일 쓰기도 묻기 |
| `notify_after_seconds` | `30` | 요청이 이 초보다 오래 걸리면 끝날 때 터미널 벨과 알림 (0 이면 끔) |
| `default_mode` | `auto` | pi 를 시작할 때의 작업 모드: `plan`(계획) · `ask`(확인) · `auto`(자동) ([3-4](#3-4-작업-모드-plan-mode)) |

- **설정을 고친 뒤 `pi` 를 다시 실행하면 중계 서버도 새 설정으로 다시 켜집니다** (2026-10-06.4 부터. `/doctor` 의 '내 설정' 줄로 확인). 다른 pi 창이 일하는 중이면 그 일이 끝난 뒤의 실행 때 반영합니다.
  그 전 판이거나 바로 다시 켜려면, 실행 중인 pi 를 모두 끈 뒤 중계 서버를 끄고 pi 를 실행합니다 (사내AI 설정 `~/.pi/agent/inhouse.json` 은 `8766`):
  ```bash
  curl -s -X POST http://127.0.0.1:8765/shutdown
  ```
  (`browser`, `auto_start_browser`, `jupyter_url`, `default_mode` 는 `pi` 를 실행할 때마다 읽고, `guard` 로 시작하는 항목과 `notify_after_seconds` 는 고치면 바로 적용됩니다.)
- JSON 파일에 Windows 경로를 쓸 때는 `/` 로 씁니다 (`"C:/Users/..."`). `\` 를 하나만 쓰면 JSON 오류가 납니다.
- 중계 서버 항목 전체: [copilot/README-copilot.md 3장](copilot/README-copilot.md#3-설정-copilotbridgejson-중계-서버-옵션) (`guard`·`notify_after_seconds`·`default_mode` 는 위 표)
- 중계 서버를 다른 에이전트에서 OpenAI 호환 API 로 쓰기: [copilot/README-copilot.md 5장](copilot/README-copilot.md#5-다른-에이전트에서-쓰기-중계-서버-api)

## 11. 문제 해결
먼저 `python ~/tools/pi/copilot/diag.py --report` 를 실행해 보세요 (pi 안에서는 `/doctor`). 해결이 안 되면 그 화면을 찍어 보내 주세요.

| 증상 | 해결 |
|---|---|
| `pi: command not found` | 새 Git Bash 창을 여세요. 그래도 안 되면 `bash ~/tools/pi/install.sh pc` 를 다시 실행 (Git Bash 창이 읽는 파일에 PATH 를 넣음). 지금 창에서 바로 쓰려면 `export PATH="$HOME/tools/pi/bin:$PATH"` |
| Node 를 찾지 못했다는 메시지 | `bash ~/tools/pi/check-node.sh` 결과대로 준비 ([2-2](#2-2-nodejs-확인)) |
| 시작 화면에 `Warning: fd not found` / `ripgrep not found` | 무시해도 됩니다. 기본 도구(명령 실행, 파일 읽기·쓰기·고치기)는 이 둘 없이 동작하고, 입력창의 `@` 파일 목록도 fd 없이 나옵니다 |
| `브라우저 원격 디버깅 포트(9222)에 연결할 수 없습니다` | 전용 창이 꺼져 있습니다. `pi` 를 다시 실행하면 다시 띄웁니다 (또는 `start-chrome.cmd`). 평소 쓰는 Chrome 창으로는 연결되지 않습니다 |
| `Copilot 탭을 찾지 못했습니다` | 전용 창에 Copilot 탭이 열려 있고 로그인돼 있는지 확인 |
| `Connection error.` 또는 `중계 서버에 연결할 수 없습니다` | pi 를 끄고 다시 실행하면 중계 서버도 다시 켜집니다. 그래도 안 되면 `~/.pi/agent/copilot-relay.log` 끝부분 확인. Python 을 못 찾으면 `~/.bashrc` 에 `export PI_PYTHON=/c/.../python.exe` |
| JupyterLab 로그인이 풀림 (jupyter 모드) | 전용 창의 JupyterLab 탭에서 다시 로그인한 뒤 `/jupyter` |
| 업데이트가 `이미 같은 판` 으로 멈춤 | 받은 zip 이 새 판인지 확인 ([9장](#9-새-버전으로-바꾸기)) |
| `429 Copilot 사용량 제한에 걸렸습니다` | 계정 단위의 일시 제한입니다. 기다렸다가 같은 요청을 다시 하면 이어서 진행합니다. 자주 걸리면 `max_questions_per_minute` |
| 요청마다 로그에 `앞 답을 마무리하는 동안 n초 기다림, Copilot 이 답하는 중` (`grep -c "앞 답을 마무리하는 동안" ~/.pi/agent/copilot-relay.log` 가 요청 수와 비슷함) | 화면의 다른 단추를 '응답 중지' 로 잘못 알아보는 것일 수 있습니다 (그때마다 5초 늦어짐). 전용 창 화면을 찍어 보내 주세요 |
| `입력창에 글자가 다 들어가지 않았습니다` / `Copilot 입력창이 글을 받지 않습니다` | 2026-10-06.2 부터는 Copilot 이 앞 답을 마무리할 때까지 기다렸다 보냅니다. 그래도 나면 `이어서 해줘` 로 다시 보내고, 반복되면 전용 창 화면과 `tail -30 ~/.pi/agent/copilot-relay.log` 를 보내 주세요. pi 가 일하는 동안에는 전용 창 안을 클릭하지 마세요 |
| 전용 창의 모델 버튼이 고른 모델이 아니라 `자동` (로그에 `Copilot 모델 선택 실패`) | Copilot 이 모델 이름을 바꾼 것입니다. [수동 작업 절차 6장](docs/수동-작업-절차.md#6-필요할-때-한-번-하는-설정)의 '모델 이름이 바뀌었을 때' |
| 오래 쓰다 보면 Copilot 이 멈추거나 형식을 틀림 | 대화가 너무 길어진 탓입니다. `/new` 로 새 세션을 시작하세요 (필요한 맥락은 AGENTS.md 나 메모 파일로) |
| `같은 작업(...)이 계속 반복되어 여기서 멈췄습니다` | Copilot 이 같은 작업을 되풀이해서 중계 서버가 끊은 것입니다. 요청을 나누거나 바꿔서 다시 하세요 |
| 로그에 `Copilot 모델 선택 실패` | `diag.py --model` 로 메뉴 이름을 보고 `models.json`·`bridge.json` 의 이름을 화면과 똑같이 맞추세요 |
| 로그에 `지난 Copilot 대화 삭제 실패` | `diag.py --chats --delete-test` 결과를 확인하세요 |
| 설정을 고쳤는데 그대로임 | pi 를 모두 끈 뒤 다시 실행하세요 (다른 pi 창이 일하는 중이면 그 뒤에). 그래도 그대로면 중계 서버를 끄고 실행 ([10장](#10-설정)) |
| `사내AI: 개인정보·민감 정보 확인으로 답하지 않았습니다` | 사내AI 가 보낸 내용(작업 규칙, 파일 내용, 명령 결과)을 개인정보·민감 정보로 보고 답하지 않은 것입니다. 중계 서버는 다시 부탁하지 않습니다. 보낸 내용을 사내AI 안내에 맞게 확인하세요 |
| 사내AI 의 답이 다 오기 전에 끝남 (처리 단계 중간 글만 옴) | 답을 만드는 동안에만 보이는 줄을 `~/.pi/agent/inhouse.json` 의 `reply_busy_lines` 에 적으세요 ([4-1](#4-1-사내ai-모델-2026-10-063-부터)) |
| `[pi] 설정 파일 오류: ... (줄 n, 칸 m)` | 알려 준 파일의 그 줄을 고치세요. 흔한 원인은 Windows 경로의 `\` (`/` 로 쓰기)와 마지막 항목 뒤의 쉼표 |
| pi 설정 파일 오류 (`settings.json` 등) | JSON 형식 확인 (경로의 `\` 는 `/` 로). 설치 때 남긴 `.bak` 으로 되돌릴 수 있습니다 |
| pi 가 끝난 뒤 터미널 화면이 이상함 | `reset` 입력 |

전체 표: [copilot/README-copilot.md 4장](copilot/README-copilot.md#4-문제-해결)

## 12. Jupyter 용 pi (사내 vLLM, 보류)
사내 vLLM 서비스가 열리면 쓸 구성입니다. Kubeflow JupyterLab 터미널에 pi 를 설치하고 vLLM 을 바로 씁니다 (Copilot·브라우저 불필요).
zip 을 JupyterLab 파일 브라우저로 홈에 올린 뒤 터미널에서:
```bash
mkdir -p ~/tools && python -m zipfile -e ~/pi-agent-like-agent-main.zip ~/tools/ && mv ~/tools/pi-agent-like-agent-main ~/tools/pi
bash ~/tools/pi/check-node.sh                         # Node 가 없으면: pip install --user nodejs-wheel-binaries==24.19.0
bash ~/tools/pi/install.sh jupyter
```
- 반드시 **홈(PVC) 아래**에 두고, pip 에는 **`--user`** 를 붙이세요. 그래야 파드를 재시작해도 남습니다.
- 그 다음 `~/.pi/agent/models.json` 의 주소와 모델 이름을 vLLM 에 맞춥니다: [docs/vLLM-연결.md](docs/vLLM-연결.md)
- 사용법(3장), 지침·스킬·메모리(6장)는 같습니다. Copilot 관련 내용(4장, 5장, 7장)만 해당하지 않습니다.

## 13. 저장소 구성, 의존성, 라이선스
| 경로 | 내용 |
|---|---|
| `runtime/` | pi 0.87.1 과 JS 라이브러리 3종 (npm 공식 배포본 그대로) |
| `bin/`, `compat/` | 실행기, Node 탐색, Node 20 호환 레이어 |
| `install.sh`, `update.sh`, `check-node.sh`, `VERSION` | 설치, 새 판으로 바꾸기, Node 진단 스크립트, 판 번호 |
| `profiles/` | 환경별 설정 템플릿 (`pc`, `jupyter`, 두 환경 공통 `common`: 위험 명령 확인, 작업 모드 `/plan`·`/mode`, 되돌리기 `/undo`, 기억하기 `/remember`, `@파일`, 작업 끝 알림, `/kit`·`/doctor`) |
| `prompts/`, `skills/` | 기본 명령 6개, 기본 스킬 6개 (설치할 때 `~/.pi/agent` 에 복사) |
| `copilot/` | Copilot 웹 채팅 중계기, 진단 도구, 전용 창 실행 파일(`start-chrome.cmd`, `start-edge.cmd`) |
| `tests/` | 단위 테스트 (`python tests/test_relay.py`, `python tests/test_config.py`, `node tests/test_guard.mjs`, `node tests/test_modes.mjs`, `node tests/test_memory.mjs`, `node tests/test_files.mjs`, `node tests/test_merge_config.mjs`, `python tests/test_noise.py`, `python tests/test_unmangle.py`) |
| `CHANGELOG.md` | 판마다 바뀐 점과 바꾼 뒤 할 일 |
| `docs/` | [한 장 요약](docs/빠른시작.md), [수동 작업 절차](docs/수동-작업-절차.md), [설치 세부](docs/설치.md), [vLLM 연결](docs/vLLM-연결.md), [반입 검토 자료](docs/반입-검토-요청서.md), [runtime 파일 해시 목록](docs/runtime-SHA256SUMS.txt) |

**의존성**
- 저장소 밖에서 받아야 하는 것은 **PyPI 패키지뿐**입니다 ([requirements.txt](requirements.txt)).
  - `nodejs-wheel-binaries==24.19.0`: Node.js 실행환경. Node 20.15 이상(또는 VS Code 1.93 이상)이 이미 있으면 필요 없음
  - (선택) `ripgrep==14.1.0`: pi 의 grep 도구용
- pi 가 쓰는 JavaScript 라이브러리(chord, typebox, jiti)는 `runtime/node_modules/` 에 원본 그대로 들어 있습니다.
- Copilot 중계기(`copilot/`)는 파이썬 표준 라이브러리만 씁니다.

**네트워크**
- 중계 서버(8765)와 브라우저 원격 디버깅 포트(9222)는 `127.0.0.1` 에서만 열립니다. 다른 PC 에서는 접속할 수 없습니다.
- 실행기는 pi 의 자동 네트워크 활동(새 버전 확인 등)을 끄고(`PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`), 설정 템플릿은 설치 통계 전송을 끕니다.

**라이선스:** pi 와 포함한 JS 라이브러리는 MIT 라이선스입니다. [LICENSE-pi](LICENSE-pi), [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
