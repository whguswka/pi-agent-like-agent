# pi-agent-like-agent-api

**Kubeflow 노트북(code-server·VS Code 웹)의 터미널에서 LLM API(vLLM 등 OpenAI 호환)를 두뇌로 쓰는 코딩 에이전트**입니다. 인터넷이 안 되는 사내망에서도 설치해 쓸 수 있습니다.
오픈소스 코딩 에이전트 **pi**([earendil-works/pi](https://github.com/earendil-works/pi), npm `@earendil-works/pi-coding-agent` 0.87.1, MIT)를 npm 없이 실행할 수 있게 묶고,
한국어 안내, 위험한 명령 확인, 작업 모드(계획·확인·자동), 되돌리기, 기본 명령·스킬, LLM 위키를 더했습니다. pi 원본 코드는 고치지 않았습니다.

pi 는 터미널에서 동작합니다. 할 일을 말로 지시하면 LLM 과 주고받으면서 파일을 읽고 고치고, 명령을 실행해 결과를 확인합니다.

> **처음이면 [한 장 요약 (빠른 시작)](docs/빠른시작.md)** 부터 보세요. 설치, LLM 연결, 매일 쓰는 법, 자주 쓰는 명령(`/plan`, `@파일`, `/undo`, `/remember` 등)이 한 장에 있습니다.
> LLM 서버 연결은 [API 연결](docs/API-연결.md), 사람이 직접 하는 일(반입, 설치, 업데이트, 되돌리기)은 [수동 작업 절차](docs/수동-작업-절차.md), 판마다 바뀐 점은 [CHANGELOG](CHANGELOG.md) 에 있습니다.

```
[브라우저] ── Kubeflow 노트북 (code-server / VS Code 웹)
                └─ 터미널: pi ── 명령 실행·파일 작업: 이 노트북 안 (홈 /home/jovyan 은 영구 저장소)
                                └── 두뇌(LLM): OpenAI 호환 API (vLLM 등). 주소와 모델 이름은 ~/.pi/agent/models.json
```
- JupyterLab 터미널 같은 다른 Linux 터미널에서도 같은 방법으로 씁니다.
- 이 저장소는 [pi-agent-like-agent](https://github.com/whguswka/pi-agent-like-agent) 에서 웹 채팅 연결 부분을 빼고, API 로 쓰는 부분만 Kubeflow 노트북용으로 남긴 판입니다.

## 목차
1. [준비물](#1-준비물)
2. [설치](#2-설치) (LLM 연결 포함)
3. [기본 사용법](#3-기본-사용법) (code-server 터미널의 키 포함)
4. [모델 설정](#4-모델-설정)
5. [지침, 스킬, 메모리](#5-지침-스킬-메모리) (AGENTS.md, SKILL.md, hook, LLM 위키)
6. [주의할 점](#6-주의할-점)
7. [새 버전으로 바꾸기](#7-새-버전으로-바꾸기)
8. [설정](#8-설정)
9. [문제 해결](#9-문제-해결)
10. [저장소 구성, 의존성, 라이선스](#10-저장소-구성-의존성-라이선스)

## 1. 준비물
| 항목 | 설명 |
|---|---|
| **Kubeflow 노트북** | code-server(VS Code 웹) 노트북. 홈(`/home/jovyan`)이 영구 저장소(PVC)여서 파드를 다시 시작해도 남는 것 |
| **Node.js 20.15 이상** | 따로 없어도 **code-server 에 들어 있는 Node**(`/usr/lib/code-server/lib/node`)를 자동으로 씁니다. code-server 4.93 의 Node 20.15 는 호환 모드로 돕니다. 없으면 PyPI 패키지 `nodejs-wheel-binaries` ([2-3](#2-3-nodejs-확인)) |
| **LLM API** | vLLM 등 OpenAI 호환 API 의 주소와 모델 이름. 서버에서 **도구 호출(tool calling)** 이 켜져 있어야 합니다 ([API 연결 4장](docs/API-연결.md#4-도구-호출tool-calling이-켜져-있어야-합니다)) |
| (선택) Python | zip 풀기(`python -m zipfile`)와 `pip` 에 씁니다 (보통 노트북에 있음) |

- 설치 프로그램이나 실행파일은 없습니다. 스크립트와 JavaScript 소스뿐입니다.
- 이 저장소 밖에서 받을 것은 없습니다. 노트북에 쓸 만한 Node 가 없을 때만 PyPI 패키지 `nodejs-wheel-binaries` 를 설치합니다.

## 2. 설치
노트북의 터미널에서 합니다. code-server 에서 터미널 열기: 왼쪽 위 메뉴(☰) > **Terminal > New Terminal** (또는 ``Ctrl+` ``).

### 2-1. zip 올리기
이미 `~/tools/pi` 가 있으면 설치하지 말고 [7장](#7-새-버전으로-바꾸기) 대로 바꾸세요.
1. 인터넷 PC 에서 GitHub 저장소 화면의 **Code > Download ZIP** 으로 `pi-agent-like-agent-api-main.zip` 을 받아, 사내 반입 절차로 옮깁니다 ([수동 작업 절차 1장](docs/수동-작업-절차.md#1-반입과-배포-배포-담당)).
2. 노트북에 올립니다: code-server 왼쪽의 탐색기(Explorer)에서 홈 폴더(`/home/jovyan`)에 zip 파일을 끌어다 놓습니다.
   끌어다 놓기가 안 되면 탐색기의 폴더를 오른쪽 클릭 > **Upload...**

### 2-2. 풀기
```bash
cd ~ && mkdir -p ~/tools && python -m zipfile -e ~/pi-agent-like-agent-api-main.zip ~/tools/ && mv ~/tools/pi-agent-like-agent-api-main ~/tools/pi
```
- 반드시 **홈 아래**에 둡니다. 그래야 파드를 다시 시작해도 남습니다.
- `unzip` 이 있으면 `unzip -q ~/pi-agent-like-agent-api-main.zip -d ~/tools/` 로 풀어도 됩니다.
- 받은 파일 이름이 `pi-agent-like-agent-api-main (1).zip` 처럼 바뀌었으면 명령의 이름도 바꿉니다 (공백이 있으면 따옴표로 감쌈).

### 2-3. Node.js 확인
```bash
bash ~/tools/pi/check-node.sh
```
- 마지막 줄이 `결과: 사용 가능` 또는 `결과: 호환 모드로 사용 가능` 이면 다음으로 넘어갑니다 (예: `-> /usr/lib/code-server/lib/node (v20.15.1)`).
- `사용 가능한 Node 없음` 이면 화면에 나온 방법 중 하나를 씁니다.
  - 노트북 안에서 찾은 node 가 보이면 그 경로를 `PI_NODE` 로 적습니다 (화면에 명령이 나옴).
  - 또는 `pip install --user nodejs-wheel-binaries==24.16.0` (`--user` 가 없으면 파드를 다시 시작할 때 사라짐).
- 자세한 내용(호환 모드, Node 를 찾는 순서): [docs/설치.md](docs/설치.md#1-nodejs-확인)

### 2-4. 설치
```bash
bash ~/tools/pi/install.sh
```
- 설정 템플릿을 `~/.pi/agent` 에 복사하고, PATH 를 `~/.bashrc` 와 `~/.profile` 에 넣습니다.
- **새 터미널**(터미널 패널의 `+`)을 열고 `pi --version` 이 나오면 설치된 것입니다.
- Node 를 찾지 못했다는 안내가 나왔으면 2-3 대로 준비한 뒤 이 명령을 한 번 더 실행합니다 (기본 명령·스킬 복사와 설정 갱신에 Node 를 씀).

### 2-5. LLM 연결
설치한 `~/.pi/agent/models.json` 에는 자리만 잡아 둔 틀이 들어 있습니다. LLM 서버의 주소와 모델 이름으로 바꿉니다 (자세히: [docs/API-연결.md](docs/API-연결.md)).
1. 서버가 보이는지와 모델 이름을 확인합니다. 결과의 `"id"` 가 모델 이름입니다.
   ```bash
   curl -s http://VLLM주소:8000/v1/models
   ```
   같은 클러스터 안의 서비스면 주소는 보통 `http://<서비스>.<네임스페이스>.svc.cluster.local:<포트>/v1` 입니다.
2. `~/.pi/agent/models.json` 에서 `baseUrl`(주소 + `/v1`), `apiKey`(키가 없는 서버면 `EMPTY` 그대로), `models` 의 `id`(1의 이름 그대로),
   `contextWindow`(서버의 최대 길이. vLLM 은 `--max-model-len`)를 바꿉니다. code-server 탐색기에서 `~/.pi/agent` 폴더를 열어 고치면 편합니다.
   ```json
   { "id": "Qwen/Qwen3-32B", "name": "Qwen3 32B (사내 vLLM)", "contextWindow": 32768, "maxTokens": 8192 }
   ```
3. `~/.pi/agent/settings.json` 의 `defaultModel` 도 같은 이름으로 바꿉니다.
4. 확인:
   ```bash
   cd ~ && pi -p "bash 로 echo hello 를 실행하고 결과를 알려줘"
   ```
   `hello` 를 실행했다는 답이 나오면 됩니다. 명령을 실행하지 않고 글로만 답하면 서버의 도구 호출이 꺼져 있는 것입니다 ([API 연결 4장](docs/API-연결.md#4-도구-호출tool-calling이-켜져-있어야-합니다)).
- `curl` 은 되는데 pi 만 연결하지 못하면 프록시를 봅니다: `env | grep -i proxy` 에 값이 있으면 LLM 주소가 `no_proxy` 에 들어 있어야 합니다 ([API 연결 1장](docs/API-연결.md#1-주소와-모델-이름-확인)).

### 2-6. 처음 실행
```bash
mkdir -p ~/work/hello && cd ~/work/hello
pi
```
- pi 화면에서 `hello.py 를 만들어서 hello 를 출력하고 실행해줘` 처럼 지시해 봅니다. 파일이 생기고 실행 결과가 나오면 준비 끝입니다.
- 시작 화면의 `Warning: fd not found ...`, `Warning: ripgrep not found ...` 두 줄은 늘 나오는 것이니 무시합니다 (쓰지 않는 검색 도구 안내).
- 줄을 바꾸려고 `Shift+Enter` 를 눌렀는데 바로 보내지면 [3-3](#3-3-code-server-터미널에서-다르게-쓰는-키) 의 설정을 한 번 합니다.
- 안 되면 pi 안에서 `/doctor` 를 치거나 [9장](#9-문제-해결)을 봅니다.

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
- 요청 하나가 30초 넘게 걸리면 끝날 때 터미널 벨과 알림으로 알려 줍니다 (시간은 [8장](#8-설정)의 `notify_after_seconds`).
- code-server·VS Code 터미널에서는 대화 기록을 pi 화면 안에서 스크롤하는 fullscreen 화면으로 켭니다 (마우스 휠·`PageUp`/`PageDown`). 예전 화면으로 쓰려면 `pi --tui-mode regular`.

### 3-2. 화면에서 쓰는 키와 명령
| 하고 싶은 것 | 방법 |
|---|---|
| 지시 보내기 / 줄 바꾸기 | `Enter` / `Shift+Enter` (안 되면 [3-3](#3-3-code-server-터미널에서-다르게-쓰는-키)) |
| 파일 다루기 | 경로나 파일 이름을 그대로 적거나, `@` 를 치고 골라 넣습니다 (예: `@src/main.py 의 오류 처리를 고쳐줘`) — 표 아래 '@파일' |
| 명령을 직접 실행하고 결과를 대화에 넣기 | `!git status` (`!!git status` 는 결과를 LLM 에 보내지 않음) |
| 일하는 중에 방향 바꾸기 | 입력하고 `Enter` (지금 단계가 끝나면 반영) |
| 멈추기 | `Esc` |
| 계획부터 세우고 승인받아 진행 | `/plan` 을 치고 요청 (또는 `/plan <요청>`). 다시 `/plan` 이면 끔 — 아래 3-5 |
| 바꿀 때마다 확인받기 / 다시 자동으로 | `/mode ask` / `/mode auto` (`/mode` 만 치면 고르기) |
| pi 가 고친 파일 되돌리기 | `/undo` (마지막 요청), `/undo 2` (마지막 두 요청) — 아래 3-6 |
| 앞으로도 지킬 것 기억시키기 | `/remember 커밋 메시지는 한국어로` (지침 파일 AGENTS.md 에 적음, [5장 메모리](#메모리)) |
| 도구 출력 펼치기·접기 | `Ctrl+O` |
| 모델 고르기 | `/model` 또는 `Ctrl+L` ([4장](#4-모델-설정)) |
| 지침·스킬을 고친 뒤 다시 읽기 | `/reload` |
| 자주 하는 일 | 기본 명령 `/init` `/handoff` `/review` `/test` `/commit` `/explain` ([5장](#5-지침-스킬-메모리)) |
| 명령 목록 | `/` 를 치면 나옴 |
| 빠른 도움말 | `/kit` (키, 세션, 명령·스킬 목록, 설정 파일 위치를 편집기 위에 보여 줌. 다시 입력하면 닫힘). 팀 공유 폴더 등록은 `/kit share <폴더>` |
| 상태 요약 | `/doctor` (판 번호, pi 폴더, Node. 문제가 생기면 이 화면을 찍어 보내 주세요) |

**@파일**: 입력창에서 `@` 를 치면 작업 폴더의 파일 목록이 뜹니다. 글자를 더 치면 좁혀지고(`@src/ma`), `Tab` 으로 고릅니다.
- `.git`, `node_modules`, `__pycache__`, `.venv` 등은 빼고 6단계 깊이까지 보여 줍니다.
- 보낼 때 `@` 로 적은 텍스트 파일은 **내용이 요청에 함께 붙습니다.** LLM 이 파일을 따로 읽는 왕복이 줄어듭니다.
  파일 하나 6000자, 모두 8000자, 5개까지이고, 넘으면 앞부분만 붙인 뒤 나머지는 LLM 이 읽게 합니다.
  폴더·노트북(`.ipynb`)·바이너리·없는 파일은 붙이지 않습니다 (글은 그대로 갑니다). `/` 로 시작하는 명령(`/explain @a.py` 등)에 적은 파일도 붙이지 않습니다.

### 3-3. code-server 터미널에서 다르게 쓰는 키
code-server(VS Code 웹)는 브라우저 안에서 돌기 때문에, 몇몇 키는 pi 에 오기 전에 VS Code 나 브라우저가 가져갑니다.

| 키 | code-server 에서 일어나는 일 | pi 에서는 이렇게 |
|---|---|---|
| `Ctrl+P`, `Ctrl+Shift+P` | VS Code 의 빠른 열기·명령 팔레트가 열림 | 모델 바꾸기는 `/model` (또는 `Ctrl+L`) |
| `Ctrl+J` | VS Code 의 아래 패널을 닫고 엶 | 줄 바꾸기는 `Shift+Enter` (아래 설정) |
| `Ctrl+W` | 브라우저 탭이 닫힘 | 단어 지우기는 `Alt+Backspace` |
| `Ctrl+T`, `Ctrl+N` | 브라우저의 새 탭·새 창 | 누르지 않기 |

**Shift+Enter 로 줄 바꾸기 (한 번 설정):** VS Code 1.109 보다 예전 판(예: code-server 4.93)의 터미널은 `Shift+Enter` 를 `Enter` 와 똑같이 보내서, pi 가 줄을 바꾸지 않고 바로 보냅니다.
1. `F1` (또는 `Ctrl+Shift+P`) 을 누르고 `Preferences: Open Keyboard Shortcuts (JSON)` 을 고릅니다.
2. 열린 파일의 `[` `]` 안에 아래를 넣고 저장합니다 (다른 항목이 있으면 그 사이에 쉼표).
   ```json
   {
     "key": "shift+enter",
     "command": "workbench.action.terminal.sendSequence",
     "args": { "text": "\u001b[13;2u" },
     "when": "terminalFocus"
   }
   ```
- 이 설정은 code-server 의 사용자 설정 폴더(홈 아래)에 남습니다. 그 뒤로 bash 같은 다른 프로그램에서 `Shift+Enter` 를 누르면 글자 몇 개가 들어갈 수 있습니다.
- 긴 지시는 파일에 적어 두고 `@파일` 로 보내도 됩니다.
- VS Code 가 가져가는 키를 터미널로 보내려면 설정의 `terminal.integrated.sendKeybindingsToShell` 을 켭니다 (그동안 터미널 안에서는 VS Code 단축키가 듣지 않음). 브라우저가 가져가는 키(`Ctrl+W` 등)는 그래도 안 됩니다.

### 3-4. 세션 (대화 기록)
pi 는 대화를 자동으로 저장합니다 (`~/.pi/agent/sessions/`, 작업 폴더별).

| 명령 | 뜻 |
|---|---|
| `pi -c` | 이 폴더의 마지막 세션을 이어서 시작 |
| `pi -r` 또는 `/resume` | 저장된 세션 목록에서 골라 열기 |
| `/new` | 새 세션 시작 |
| `/name 이름` | 세션에 이름 붙이기 (목록에서 찾기 쉬움) |
| `/session` | 지금 세션 정보 |
| `/compact` | 앞 대화를 요약해 줄이기 (대화가 길어 느려졌을 때. 맥락 한도에 가까워지면 pi 가 스스로 함) |

### 3-5. 작업 모드 (/plan, /mode)
pi 는 기본으로 묻지 않고 바로 고치고 실행합니다 (자동 모드). 큰 작업이나 처음 보는 코드라면 계획부터 보고 진행하는 편이 안전합니다.

| 모드 | 하는 일 | 바꾸기 |
|---|---|---|
| 계획 | 파일을 읽고 살펴보기만 하고(읽기 전용 명령만 실행) 번호 붙인 단계로 계획을 적습니다. 계획이 오면 "이 계획대로 진행할까요?" 를 묻습니다 | `/plan`, `/plan <요청>` |
| 확인 | 파일을 쓰거나 고치기 전, 읽기 전용이 아닌 명령을 실행하기 전에 바뀌는 줄(`-` 지움, `+` 넣음)이나 명령을 보여 주고 묻습니다. 거절하면 그 작업은 하지 않고 멈춥니다 | `/mode ask` |
| 자동 | 묻지 않고 실행합니다. 위험한 명령(폴더 지우기, `git push` 등)만 묻습니다 ([6장](#6-주의할-점)) | `/mode auto` (기본) |

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
- pi 를 시작할 때의 모드는 [8장](#8-설정)의 `default_mode` 로 정합니다 (예: 늘 확인 모드로 시작하려면 `"default_mode": "ask"`).
  `pi -p` 처럼 물을 수 없는 실행은 늘 자동 모드로 시작합니다.

### 3-6. 되돌리기 (/undo)
pi 가 파일을 고치기 직전과 직후 내용을 요청마다 기록해 두고, `/undo` 로 원래대로 돌립니다.
- 되돌리기 전에 파일 목록(복원 / 지움: 새로 만든 파일)을 보여 주고 확인을 받습니다.
- 그 뒤에 다른 곳에서 다시 바뀐 파일은 덮어쓰지 않고 알려 줍니다.
- 되돌린 다음 요청에는 LLM 에게 어떤 파일을 되돌렸는지 알려 줍니다.
- **셸 명령(bash)으로 바뀐 파일은 되돌리지 못합니다** (예: `sed -i`, `rm`, 스크립트 실행 결과). 5MB 넘는 파일도 기록하지 않습니다.
- 기록은 pi 를 끄면 사라집니다. 오래 남길 변경은 git 으로 관리하세요.

### 3-7. 쓰지 않을 명령
| 명령 | 이유 |
|---|---|
| `/share` | 대화를 외부 서비스에 올리는 기능입니다. 쓰지 마세요 |
| `/login` | 필요 없음. LLM 서버의 키는 `models.json` 의 `apiKey` 에 적습니다 ([4장](#4-모델-설정)) |

## 4. 모델 설정
pi 가 쓰는 모델은 `~/.pi/agent/models.json` 에 적습니다. 처음 설정은 [2-5](#2-5-llm-연결), 항목 설명과 예는 [docs/API-연결.md](docs/API-연결.md) 에 있습니다.
- 모델을 여러 개 적으면 `/model`(또는 `Ctrl+L`)에서 고릅니다. 시작할 때 고르기: `pi --model <모델 id>`
- 고른 모델은 그 세션에만 기록됩니다. 새 세션의 기본 모델로 삼으려면 `/model` 목록에서 `Ctrl+S` 를 누르거나 `~/.pi/agent/settings.json` 의 `defaultModel` 을 바꿉니다.
- 서버가 여러 대면 `providers` 에 이름을 달리해 더합니다. `/model` 을 열면 `models.json` 을 다시 읽습니다.
- `contextWindow` 는 서버가 받는 최대 길이 이하로 적습니다. 대화가 그 한도에 가까워지면 pi 가 앞 대화를 스스로 요약합니다 (`/compact` 와 같음).
- 키를 파일에 적지 않으려면 `"apiKey": "$VLLM_API_KEY"` 처럼 환경변수 이름을 적고 `~/.bashrc` 에 `export VLLM_API_KEY=...` 를 둡니다.
- pi 는 서버의 **도구 호출(tool calling)** 로 파일을 다루고 명령을 실행합니다. 도구 호출을 잘하는 모델일수록 일을 잘합니다.

## 5. 지침, 스킬, 메모리
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
- Kubeflow 노트북 요령: 홈(PVC) 밖은 파드를 다시 시작하면 사라짐, `pip install --user`, 오래 걸리는 작업은 `nohup` 과 로그
- 폐쇄망 규칙: 외부 접속·다운로드 금지, pip 는 사내 미러로 설치하고 설치 전에 알림 (사내망이 아니면 이 줄은 지우거나 고치세요)
- 빠르게 일하는 방법: 큰 파일은 grep 으로 위치를 찾아 일부만 읽기, 작은 수정은 edit 로, 긴 출력은 줄이기 (LLM 과 주고받는 글과 횟수가 줄어 빨라집니다)

예시 `~/work/myproject/AGENTS.md`:
```markdown
# 프로젝트 지침
- Python 3.11. 테스트는 `pytest -q` 로 돌리고, 고친 뒤에는 반드시 테스트를 돌릴 것
- 원본 데이터(data/raw/)는 고치지 말 것
- 보고는 한국어로, 바꾼 파일 목록을 마지막에 정리할 것
```
- pi 시작 화면 위쪽에 읽어 들인 지침 파일 목록이 나옵니다.
- 실행 중에 고쳤으면 `/reload` 로 다시 읽습니다.
- 한 줄짜리 규칙은 `/remember <내용>` 으로 바로 적을 수 있습니다 (아래 [메모리](#메모리)).
- pi 에게 "이 규칙을 AGENTS.md 에 추가해줘" 라고 시켜도 됩니다. 공통 지침(`~/.pi/agent/AGENTS.md`)은 작업 폴더 밖이라 확인 창이 뜨니 실행을 허용하세요 ([6장](#6-주의할-점)).
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
| `hook-creator` | "명령 실행 전에 ○○ 막아줘", "끝나면 ○○ 기록해줘" 하면 hook(확장 파일)을 만들어 줌 ([아래](#hook-확장-파일)). 설정으로 되는 일이면 설정을 알려 줌 |
| `llm-wiki` | 위키가 켜져 있을 때 원본 반영(ingest)·위키로 답하기(query)·점검(lint)의 순서와 페이지 형식 ([아래](#llm-위키-wiki)) |
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
**공유 폴더** (여러 노트북에 함께 붙인 볼륨 등): 폴더 안에 `skills/<이름>/SKILL.md`, `prompts/<이름>.md` 를 두고 pi 에서 등록합니다.
```
/kit share /mnt/team/pi
```
- 그 폴더의 `skills`·`prompts` 를 `~/.pi/agent/settings.json` 에 등록하고 바로 다시 읽습니다. 팀원은 각자 한 번만 등록하면 됩니다.
- 폴더가 비어 있으면 `skills`·`prompts` 를 만들지 묻습니다. 새 스킬은 `skill-creator` 에게 "/mnt/team/pi/skills 에 ○○ 스킬 만들어줘" 라고 하면 됩니다.
- `/kit share` 만 입력하면 등록된 폴더를 보여 주고, `/kit unshare /mnt/team/pi` 로 뺍니다.
- 내 스킬과 이름이 겹치면 공유 폴더 쪽이 쓰입니다. 이름을 다르게 지으세요.
- 같이 쓰는 볼륨이 없으면, 스킬 폴더를 git 저장소로 관리해 각자 `~/.pi/agent/skills/` 아래에 받아 써도 됩니다.

**프로젝트 저장소:** 프로젝트에만 쓰는 스킬·명령은 그 저장소의 `.pi/skills/`, `.pi/prompts/` 에 두고 `AGENTS.md` 와 함께 커밋합니다.
받은 사람이 처음 pi 를 켜면 이 폴더를 믿을지 묻습니다 (`/trust` 로 저장).

### 메모리
- **pi 에는 자동 메모리 기능이 없습니다.** 대화에서 무엇을 기억할지 스스로 골라 저장하지 않습니다.
- 오래 기억시킬 것은 **AGENTS.md 에 적습니다.** 공통이면 `~/.pi/agent/AGENTS.md`, 프로젝트별이면 프로젝트 폴더에 둡니다.
- **`/remember <내용>`** 이 가장 빠릅니다. 예: `/remember 테스트는 pytest -q 로 돌린다`
  - 어디에 적을지 고릅니다: **이 프로젝트만**(작업 폴더의 `AGENTS.md`) 또는 **모든 프로젝트**(`~/.pi/agent/AGENTS.md`).
  - 그 파일의 `## 기억할 것` 아래에 한 줄로 더합니다 (없으면 만듦). 같은 내용이 있으면 더하지 않습니다.
  - 지침 파일은 pi 를 시작할 때 읽지만, 지금 대화에도 다음 요청과 함께 바로 알려 줍니다 (`/reload` 하지 않아도 됨).
  - 지우거나 고칠 때는 그 파일을 직접 고칩니다. 너무 많이 쌓이면 요청마다 보내는 지침이 길어지니 가끔 정리하세요.
- 긴 규칙이나 여러 줄은 직접 적거나, pi 에게 "방금 정한 규칙을 AGENTS.md 에 추가해줘" 라고 시킵니다.
- 하던 작업의 맥락은 **세션**으로 이어 갑니다 (`pi -c`, `/resume`).
- 긴 작업은 진행 메모를 파일로 남기게 하면 좋습니다. AGENTS.md 에 "작업을 마치면 진행 상황과 다음 할 일을 NOTES.md 에 정리할 것" 처럼 적어 두면, 다음 세션에서 그 파일을 읽고 이어 갑니다.

### hook (확장 파일)
pi 에는 hook 설정 파일이 따로 없고, `~/.pi/agent/extensions/` 의 TypeScript 파일(확장)에서 `pi.on("tool_call", …)` 처럼 이벤트를 받아 만듭니다.
- `hook-creator` 스킬에게 "명령 실행 전에 ○○ 막아줘", "작업이 끝나면 ○○ 기록해줘" 처럼 부탁하면 `my-<이름>.ts` 로 만들어 줍니다.
  예 6개(명령 기록, 파일 보호, 결과에 안내 덧붙이기, 팀 규칙 파일, 입력 바꾸기, 끝날 때 기록)는 `~/.pi/agent/skills/hook-creator/examples.md` 에 있습니다.
- 적용은 `/reload` (또는 pi 를 다시 실행). 끄려면 파일 이름 끝에 `.off` 를 붙이고 `/reload`.
- `my-` 로 시작하는 내 확장은 업데이트해도 그대로 남습니다. 키트 확장(`guard.ts` 등)을 직접 고치면 업데이트 때 새 판으로 바뀝니다.
- 확장은 pi 와 같은 권한으로 돕니다. 직접 쓰거나 내용을 확인한 코드만 두세요.

### LLM 위키 (/wiki)
안드레 카파시의 'LLM Wiki' 방식입니다. 원본을 넣으면 pi 가 마크다운 위키 페이지를 쓰고 서로 이어 두어, 다음에 물을 때 처음부터 다시 찾지 않고 쌓인 위키를 근거로 답합니다.
위키는 노트북 홈 아래의 마크다운 파일입니다 (링크는 `[[페이지 제목]]`). code-server 에서 바로 열어 보거나, 폴더째 받아 Obsidian 같은 마크다운 편집기로 봅니다.

```text
<위키 폴더>/
  WIKI.md    이 위키의 규칙: 주제, 분류(type), 페이지 형식 (pi 와 사람이 같이 고침)
  index.md   목록 (pi 가 페이지 머리말로 만듦)        log.md   기록 (pi 가 덧붙임)
  raw/       원본 (읽기만)                             pages/   pi 가 쓰는 페이지 (분류별 폴더)
```

| 하고 싶은 것 | 방법 |
|---|---|
| 위키 만들기 | `/wiki init` (기본: 모델 운영 위키, 폴더 `~/pi-wiki/모델운영`). 이름·폴더 지정: `/wiki init 이름 ~/위키/이름` |
| 원본 반영 | 원본을 위키의 `raw/` 에 넣고(탐색기에 끌어다 놓기) `/wiki ingest 파일이름` (지금은 텍스트·마크다운. 문서는 텍스트로 바꿔서) |
| 위키로 묻기 | 그냥 물어보면 됨 (위키가 켜져 있으면 모델이 먼저 위키를 찾음). 위키만 근거로: `/wiki ask 질문` |
| 남기기 | 모델이 작업 중 새로 확인한 것을 알아서 남기고 답 끝에 `위키에 남김: [[…]]` 을 적음. 방금 답을 남기기: `/wiki save [제목]` |
| 점검 | `/wiki lint` (깨진 링크, 같은 이름, 고아 페이지, 반영 안 된 원본), 목록 다시 만들기 `/wiki reindex` |
| 상태 / 끄기·켜기 | `/wiki` / `/wiki off`, `/wiki use 이름` (끄면 위키 도구도 모델에게 보이지 않음) |

- 주제가 모델 운영이 아니면 `/wiki init 이름 폴더` 로 만든 뒤, 위키 폴더의 `WIKI.md` 에서 '주제' 와 '분류' 를 그 주제에 맞게 고칩니다.
- 위키 폴더도 홈 아래에 두세요 (파드를 다시 시작해도 남게).
- 모델이 알아서 쓰는 정도: `~/.pi/agent/wiki.json` 의 `"auto"` — `write`(기본: 찾고 남김), `ask`(남길지 물음), `search`(찾기만), `off`(부탁할 때만).
- 목록·기록 고치기와 점검은 pi 가 코드로 하고, 모델은 여러 페이지를 한 번에 읽고 씁니다 (도구 왕복을 줄이려고).
- 위키 내용은 모델이 찾거나 읽을 때만 LLM 으로 갑니다. 고치기 전 페이지는 위키 폴더의 `.history/` 에 남습니다 (git 은 쓰지 않음).
- 위키 도구로 쓰는 것은 `pages/` 아래뿐이라 쓸 때 확인 창이 뜨지 않습니다.

## 6. 주의할 점
- **보내는 내용:** pi 는 지침, 요청, 읽은 파일 내용, 명령 결과를 `models.json` 에 적은 LLM 서버로 보냅니다.
  개인정보·중요정보가 든 파일을 다룰 때는 그 서버가 그 정보를 받아도 되는 곳인지 먼저 확인하세요.
- **위험할 수 있는 작업은 실행 전에 묻습니다.** pi 는 보통 도구를 쓸 때 허락을 묻지 않지만, 되돌리기 어려운 작업은 확인 창을 띄웁니다.
  - 대상: 폴더 지우기(`rm -r` 등), `git push`·`git reset --hard`·`git clean`·`git branch -D`, 권한 일괄 변경, `kubectl delete`,
    패키지 제거, `sudo`, 받은 스크립트 바로 실행(`curl ... | sh`), 데이터베이스 삭제, 작업 폴더 밖 파일 쓰기
  - 거부하면 실행하지 않고 작업을 멈춥니다. 직접 치는 `!명령` 은 묻지 않습니다. `pi -p` 처럼 물을 수 없을 때는 실행하지 않고 LLM 에게 이유를 알립니다.
  - 명령 자리의 낱말만 봅니다. `echo "rm -rf ..."` 같은 따옴표 안의 글, 주석, `cat <<'EOF' > 파일` 로 쓰는 본문은 묻지 않습니다.
    대신 실제로 실행되는 글(`bash -c "..."`, `eval`, `ssh 호스트 '...'`, `$(...)`, `xargs rm`, `python -c` 코드 등)은 안까지 봅니다.
  - 묻지 않을 명령, 더 물어볼 명령은 [8장](#8-설정)의 `guard_allow`, `guard_patterns` 로 정합니다.
  - 계획 모드에서는 이런 작업을 묻지 않고 막고, 확인 모드에서는 바뀌는 내용과 함께 한 번에 묻습니다 ([3-5](#3-5-작업-모드-plan-mode)).
- 그래도 모든 위험을 막지는 못합니다. 중요한 폴더는 git 으로 관리하고 바뀐 내용을 확인하세요. 시킨 범위를 벗어나는 작업이 보이면 `Esc` 로 멈춥니다.
- **노트북의 권한:** pi 는 노트북 안에서 사용자 권한으로 명령을 실행합니다. 노트북에 붙은 데이터 볼륨, 쿠버네티스 권한(`kubectl`)도 그대로 쓸 수 있으니 같이 쓰는 자원은 조심하세요.
- **속도:** LLM 서버의 속도에 따라 다릅니다. pi 는 도구를 쓸 때마다 LLM 에 한 번 더 묻기 때문에, 파일 여러 개를 다루는 작업은 그만큼 오래 걸립니다.

## 7. 새 버전으로 바꾸기
1. 실행 중인 pi 를 모두 끕니다 (`/quit`).
2. 새 판 zip 을 2-1 처럼 노트북 홈에 올립니다.
3. 터미널에서 (받은 파일 이름이 다르면 그 이름으로):
   ```bash
   cd ~ && bash ~/tools/pi/update.sh ~/pi-agent-like-agent-api-main.zip
   ```
- 하는 일: 받은 파일 확인 → 지금 폴더를 `~/tools/pi.old` 로 이름 바꾸기 → 새 판을 `~/tools/pi` 에 → `install.sh` 로 설정 반영.
- 끝에 `지금 판 -> 새 판` 과 이 판에서 바뀐 점을 보여 줍니다. 그다음 `pi` 를 실행하면 새 판으로 시작합니다. `/doctor` 의 판 번호로 확인합니다.
- 받은 파일이 지금과 같은 판이면 멈춥니다 (이전 판 폴더를 덮지 않도록). 같은 판을 다시 깔려면 끝에 `--force`.
- zip 을 풀 프로그램(`unzip`, Python)이 둘 다 없는 노트북이면, GitHub 의 Tags 에서 그 판의 `tar.gz` 를 받아 같은 명령에 주면 됩니다 (`tar` 로 풂).
- 메시지별 할 일과 `update.sh` 가 안 될 때의 손 절차: [수동 작업 절차 3장](docs/수동-작업-절차.md#3-새-판으로-바꾸기)

그대로 남는 것:
- `~/.pi/agent` 의 설정(`settings.json`, `models.json`)에는 **새 판에 추가된 항목만** 넣습니다. LLM 주소·모델처럼 직접 고친 값과 직접 지운 항목은 그대로이고, 바뀐 파일은 `갱신:` 으로 알려 주며 이전 파일은 `.bak` 으로 남깁니다.
- 내 설정 파일(`~/.pi/agent/bridge.json`), 지침(AGENTS.md), 스킬, 세션 기록은 그대로입니다.
- 확장(`~/.pi/agent/extensions/`)은 새 것으로 바뀝니다. 새 판에서 빠진 키트 확장은 `~/.pi/agent/extensions.removed/` 로 옮깁니다 (직접 만든 확장은 그대로).
- 기본 명령·스킬(`~/.pi/agent/prompts`, `skills`)은 고치지 않은 것만 새 판으로 바뀝니다. 직접 고친 것과 지운 것은 그대로입니다.
- 잘 동작하면 `~/tools/pi.old` 는 지워도 됩니다 (지우면 그 뒤로는 zip 으로만 되돌릴 수 있음).

**이전 판으로 되돌리기:** `~/tools/pi.old` 에는 바로 앞 판 하나만 남습니다 (다음 업데이트 때 지워짐). 받은 zip 은 보관해 두세요.
- 이전 판 zip 이 있으면: `cd ~ && bash ~/tools/pi/update.sh <이전 판 zip>` (지금 판은 `pi.old` 로 남고, 그 판에 없는 확장은 치움)
- zip 이 없으면 `pi.old` 로 되돌리는 절차: [수동 작업 절차 5장](docs/수동-작업-절차.md#5-이전-판으로-되돌리기)

## 8. 설정
| 파일 | 내용 |
|---|---|
| `~/.pi/agent/models.json` | LLM 서버 주소와 모델 ([4장](#4-모델-설정), [API 연결](docs/API-연결.md)) |
| `~/.pi/agent/settings.json` | pi 설정: 기본 모델(`defaultProvider`, `defaultModel`) 등. 항목 전체는 pi 문서 `~/tools/pi/runtime/docs/settings.md` |
| `~/.pi/agent/bridge.json` | **내 설정 파일**: 이 키트의 확장 설정 (아래 표). 업데이트해도 그대로 남습니다 (파일 이름은 바탕이 된 저장소와 같게 두었습니다) |
| `~/.pi/agent/AGENTS.md` | 공통 지침 ([5장](#5-지침-스킬-메모리)) |
| `~/.pi/agent/wiki.json` | LLM 위키 목록과 켜진 위키 ([5장](#llm-위키-wiki)) |

**내 설정 파일 예시** (`~/.pi/agent/bridge.json`):
```json
{
  "guard_allow": ["^git push origin feature/"],
  "notify_after_seconds": 60,
  "default_mode": "ask"
}
```
- 항목은 맨 바깥 `{ }` 안에 적습니다 (`_예시` 안에 넣으면 적용되지 않음). 파일은 **UTF-8** 로 저장합니다.
- `_` 로 시작하는 항목(`_설명` 등)은 설명용이라 무시됩니다.
- 형식이 틀린 파일은 읽지 않고 기본값으로 동작합니다 (확인은 켜진 채). 고친 뒤 결과가 그대로면 쉼표·따옴표를 확인하세요.

| 항목 | 기본값 | 뜻 |
|---|---|---|
| `guard` | `true` | 위험할 수 있는 작업을 실행 전에 묻기 ([6장](#6-주의할-점)). `false` 면 끔 |
| `guard_allow` | `[]` | 묻지 않을 명령 (정규식 목록, 예: `["^git push origin feature/"]`) |
| `guard_patterns` | `[]` | 더 물어볼 명령 (정규식 목록, 예: `["make deploy"]`) |
| `guard_outside_writes` | `true` | 작업 폴더 밖 파일 쓰기도 묻기 |
| `notify_after_seconds` | `30` | 요청이 이 초보다 오래 걸리면 끝날 때 터미널 벨과 알림 (0 이면 끔) |
| `default_mode` | `auto` | pi 를 시작할 때의 작업 모드: `plan`(계획) · `ask`(확인) · `auto`(자동) ([3-5](#3-5-작업-모드-plan-mode)) |

- `guard` 로 시작하는 항목과 `notify_after_seconds` 는 고치면 바로 적용되고, `default_mode` 는 pi 를 시작할 때 읽습니다.

## 9. 문제 해결
먼저 pi 안에서 `/doctor` 를 쳐 보세요 (판 번호, pi 폴더, Node). 해결이 안 되면 그 화면과 오류 메시지를 찍어 보내 주세요.

| 증상 | 해결 |
|---|---|
| `pi: command not found` | 새 터미널을 여세요. 그래도 안 되면 `bash ~/tools/pi/install.sh` 를 다시 실행. 지금 창에서 바로 쓰려면 `export PATH="$HOME/tools/pi/bin:$PATH"` |
| Node 를 찾지 못했다는 메시지 | `bash ~/tools/pi/check-node.sh` 결과대로 준비 ([2-3](#2-3-nodejs-확인)) |
| `Connection error.`, `401`, `404`, 길이 초과 등 LLM 서버 오류 | [API 연결 7장](docs/API-연결.md#7-자주-나는-오류). `curl` 은 되는데 pi 만 안 되면 프록시(`no_proxy`) |
| 명령을 실행하지 않고 글로만 답함 | 서버의 도구 호출 설정 ([API 연결 4장](docs/API-연결.md#4-도구-호출tool-calling이-켜져-있어야-합니다)) |
| `/model` 목록에 모델이 없음 | `models.json` 의 JSON 형식과 `apiKey` ([API 연결 7장](docs/API-연결.md#7-자주-나는-오류)) |
| `Shift+Enter` 가 줄을 바꾸지 않고 보냄, `Ctrl+P` 로 VS Code 창이 뜸 | [3-3](#3-3-code-server-터미널에서-다르게-쓰는-키) |
| 일하는 동안 터미널 스크롤이 위로 감겼다 내려옴 | `pi --tui-mode regular` 로 켰을 때입니다. 그냥 `pi` 로 켜면 fullscreen 화면이라 생기지 않습니다 |
| 시작 화면에 `Warning: fd not found` / `ripgrep not found` | 무시해도 됩니다. 기본 도구(명령 실행, 파일 읽기·쓰기·고치기)는 이 둘 없이 동작하고, 입력창의 `@` 파일 목록도 fd 없이 나옵니다 |
| 오래 쓰다 보면 느려지거나 엉뚱하게 답함 | 대화가 너무 길어진 탓입니다. `/compact` 로 줄이거나 `/new` 로 새 세션을 시작하세요 (필요한 맥락은 AGENTS.md 나 `/handoff` 메모로) |
| 파드를 다시 시작했더니 pi 가 없음 | pi 와 Node 를 홈 아래에 두었는지(`~/tools/pi`, `pip install --user`), 새 터미널에서 `pi --version` |
| 업데이트가 `이미 같은 판` 으로 멈춤 | 받은 파일이 새 판인지 확인 ([7장](#7-새-버전으로-바꾸기)) |
| pi 설정 파일 오류 (`settings.json`, `models.json`) | JSON 형식 확인 (마지막 항목 뒤 쉼표 빼기, 따옴표). 설치·업데이트 때 남긴 `.bak` 으로 되돌릴 수 있습니다 |
| pi 가 끝난 뒤 터미널 화면이 이상함 | `reset` 입력 |

## 10. 저장소 구성, 의존성, 라이선스
| 경로 | 내용 |
|---|---|
| `runtime/` | pi 0.87.1 과 JS 라이브러리 3종 (npm 공식 배포본 그대로) |
| `bin/`, `compat/` | 실행기, Node 탐색, Node 20 호환 레이어 |
| `install.sh`, `update.sh`, `check-node.sh`, `VERSION` | 설치, 새 판으로 바꾸기, Node 진단 스크립트, 판 번호 |
| `profiles/` | 설정 템플릿과 기본 지침(`jupyter`: Kubeflow 노트북용), 확장(`common`: 위험 명령 확인, 작업 모드 `/plan`·`/mode`, 되돌리기 `/undo`, 기억하기 `/remember`, `@파일`, 작업 끝 알림, `/kit`·`/doctor`, LLM 위키 `/wiki`) |
| `prompts/`, `skills/` | 기본 명령 6개, 기본 스킬 8개 (설치할 때 `~/.pi/agent` 에 복사) |
| `tests/` | 단위 테스트 (`node tests/test_guard.mjs`, `node tests/test_modes.mjs`, `node tests/test_memory.mjs`, `node tests/test_files.mjs`, `node tests/test_merge_config.mjs`, `node tests/test_wiki.mjs`) |
| `CHANGELOG.md` | 판마다 바뀐 점과 바꾼 뒤 할 일 |
| `docs/` | [한 장 요약](docs/빠른시작.md), [API 연결](docs/API-연결.md), [수동 작업 절차](docs/수동-작업-절차.md), [설치 세부](docs/설치.md), [반입 검토 자료](docs/반입-검토-요청서.md), [runtime 파일 해시 목록](docs/runtime-SHA256SUMS.txt) |

**의존성**
- 저장소 밖에서 받아야 하는 것은 **PyPI 패키지뿐**입니다 ([requirements.txt](requirements.txt)).
  - `nodejs-wheel-binaries==24.16.0`: Node.js 실행환경. 노트북에 Node 20.15 이상(code-server 내장 Node 등)이 있으면 필요 없음
  - (선택) `ripgrep==14.1.0`: pi 의 grep 도구용
- pi 가 쓰는 JavaScript 라이브러리(chord, typebox, jiti)는 `runtime/node_modules/` 에 원본 그대로 들어 있습니다.

**네트워크**
- pi 가 접속하는 곳은 `~/.pi/agent/models.json` 에 적은 LLM 서버뿐입니다. 노트북에 프록시 환경변수(`http_proxy`, `https_proxy`, `no_proxy` 와 대문자)가 있으면 그대로 따릅니다.
- 실행기는 pi 의 자동 네트워크 활동(새 버전 확인 등)을 끄고(`PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`), 설정 템플릿은 설치 통계 전송을 끕니다.
- 이 키트가 더한 코드(실행기, 확장)는 외부 주소로 접속하지 않습니다.

**라이선스:** pi 와 포함한 JS 라이브러리는 MIT 라이선스입니다. [LICENSE-pi](LICENSE-pi), [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
