# API 판 README 조각

원래 키트 `README.md` 의 `api:바꾸기 이름`·`api:넣기 이름` 표시 자리에 API 판에서 들어갈 글입니다 (`api-kit/assemble.mjs` 가 씀).
'조각: 이름' 주석 줄로 나누고, 조각 끝의 빈 줄은 빼고 읽습니다. 첫 조각 위의 이 글은 읽지 않습니다.

<!-- 조각: 제목 -->
# pi-agent-like-agent-api

<!-- 조각: 안내 -->
> **처음이면 [한 장 요약 (빠른 시작)](docs/빠른시작.md)** 부터 보세요. 설치, LLM 연결, 매일 쓰는 법, 자주 쓰는 명령(`/plan`, `@파일`, `/undo`, `/remember` 등)이 한 장에 있습니다.
> LLM 서버 연결은 [API 연결](docs/API-연결.md), 사람이 직접 하는 일(반입, 설치, 업데이트, 되돌리기)은 [수동 작업 절차](docs/수동-작업-절차.md), 판마다 바뀐 점은 [CHANGELOG](CHANGELOG.md) 에 있습니다.

<!-- 조각: 소개 -->
```
[브라우저] ── Kubeflow 노트북 (code-server / VS Code 웹)
                └─ 터미널: pi ── 명령 실행·파일 작업: 이 노트북 안 (홈 /home/jovyan 은 영구 저장소)
                                └── 두뇌(LLM): OpenAI 호환 API (vLLM 등). 주소와 모델 이름은 ~/.pi/agent/models.json
```
- JupyterLab 터미널 같은 다른 Linux 터미널에서도 같은 방법으로 씁니다.
- 이 저장소는 [pi-agent-like-agent](https://github.com/whguswka/pi-agent-like-agent) 에서 웹 채팅 연결 부분을 빼고, API 로 쓰는 부분만 Kubeflow 노트북용으로 남긴 판입니다.

<!-- 조각: 준비물 -->
| 항목 | 설명 |
|---|---|
| **Kubeflow 노트북** | code-server(VS Code 웹) 노트북. 홈(`/home/jovyan`)이 영구 저장소(PVC)여서 파드를 다시 시작해도 남는 것 |
| **Node.js 20.15 이상** | 따로 없어도 **code-server 에 들어 있는 Node**(`/usr/lib/code-server/lib/node`)를 자동으로 씁니다. code-server 4.93 의 Node 20.15 는 호환 모드로 돕니다. 없으면 PyPI 패키지 `nodejs-wheel-binaries` ([2-3](#2-3-nodejs-확인)) |
| **LLM API** | vLLM 등 OpenAI 호환 API 의 주소와 모델 이름. 서버에서 **도구 호출(tool calling)** 이 켜져 있어야 합니다 ([API 연결 4장](docs/API-연결.md#4-도구-호출tool-calling이-켜져-있어야-합니다)) |
| (선택) Python | zip 풀기(`python -m zipfile`)와 `pip` 에 씁니다 (보통 노트북에 있음) |

- 설치 프로그램이나 실행파일은 없습니다. 스크립트와 JavaScript 소스뿐입니다.
- 이 저장소 밖에서 받을 것은 없습니다. 노트북에 쓸 만한 Node 가 없을 때만 PyPI 패키지 `nodejs-wheel-binaries` 를 설치합니다.

<!-- 조각: 설치 -->
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

<!-- 조각: 3-1-화면 -->
- code-server·VS Code 터미널에서는 대화 기록을 pi 화면 안에서 스크롤하는 fullscreen 화면으로 켭니다 (마우스 휠·`PageUp`/`PageDown`). 예전 화면으로 쓰려면 `pi --tui-mode regular`.

<!-- 조각: 3-3 -->
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
- 저장한 뒤에도 `Shift+Enter` 가 바로 보내면 브라우저 탭을 새로 고칩니다 (브라우저의 새로 고침 단추. 켜 둔 pi 는 그대로 이어집니다).
- 이 설정은 code-server 의 사용자 설정 폴더(홈 아래)에 남습니다. 그 뒤로 bash 같은 다른 프로그램에서 `Shift+Enter` 를 누르면 글자 몇 개가 들어갈 수 있습니다.
- VS Code 1.109 이후 판(예: code-server 4.121)은 이 설정 없이도 `Shift+Enter` 로 줄이 바뀝니다.
- 긴 지시는 파일에 적어 두고 `@파일` 로 보내도 됩니다.
- VS Code 가 가져가는 키를 터미널로 보내려면 설정의 `terminal.integrated.sendKeybindingsToShell` 을 켭니다 (그동안 터미널 안에서는 VS Code 단축키가 듣지 않음). 브라우저가 가져가는 키(`Ctrl+W` 등)는 그래도 안 됩니다.

<!-- 조각: 세션-compact -->
| `/compact` | 앞 대화를 요약해 줄이기 (대화가 길어 느려졌을 때. 맥락 한도에 가까워지면 pi 가 스스로 함) |

<!-- 조각: 3-7 -->
### 3-7. 쓰지 않을 명령
| 명령 | 이유 |
|---|---|
| `/share` | 대화를 외부 서비스에 올리는 기능입니다. 쓰지 마세요 |
| `/login` | 필요 없음. LLM 서버의 키는 `models.json` 의 `apiKey` 에 적습니다 ([4장](#4-모델-설정)) |

<!-- 조각: 4장 -->
## 4. 모델 설정
pi 가 쓰는 모델은 `~/.pi/agent/models.json` 에 적습니다. 처음 설정은 [2-5](#2-5-llm-연결), 항목 설명과 예는 [docs/API-연결.md](docs/API-연결.md) 에 있습니다.
- 모델을 여러 개 적으면 `/model`(또는 `Ctrl+L`)에서 고릅니다. 시작할 때 고르기: `pi --model <모델 id>`
- 고른 모델은 그 세션에만 기록됩니다. 새 세션의 기본 모델로 삼으려면 `/model` 목록에서 `Ctrl+S` 를 누르거나 `~/.pi/agent/settings.json` 의 `defaultModel` 을 바꿉니다.
- 서버가 여러 대면 `providers` 에 이름을 달리해 더합니다. `/model` 을 열면 `models.json` 을 다시 읽습니다.
- `contextWindow` 는 서버가 받는 최대 길이 이하로 적습니다. 대화가 그 한도에 가까워지면 pi 가 앞 대화를 스스로 요약합니다 (`/compact` 와 같음).
- 키를 파일에 적지 않으려면 `"apiKey": "$VLLM_API_KEY"` 처럼 환경변수 이름을 적고 `~/.bashrc` 에 `export VLLM_API_KEY=...` 를 둡니다.
- pi 는 서버의 **도구 호출(tool calling)** 로 파일을 다루고 명령을 실행합니다. 도구 호출을 잘하는 모델일수록 일을 잘합니다.

<!-- 조각: 공유-폴더 -->
**공유 폴더** (여러 노트북에 함께 붙인 볼륨 등): 폴더 안에 `skills/<이름>/SKILL.md`, `prompts/<이름>.md` 를 두고 pi 에서 등록합니다.
```
/kit share /mnt/team/pi
```
- 그 폴더의 `skills`·`prompts` 를 `~/.pi/agent/settings.json` 에 등록하고 바로 다시 읽습니다. 팀원은 각자 한 번만 등록하면 됩니다.
- 폴더가 비어 있으면 `skills`·`prompts` 를 만들지 묻습니다. 새 스킬은 `skill-creator` 에게 "/mnt/team/pi/skills 에 ○○ 스킬 만들어줘" 라고 하면 됩니다.
- `/kit share` 만 입력하면 등록된 폴더를 보여 주고, `/kit unshare /mnt/team/pi` 로 뺍니다.
- 내 스킬과 이름이 겹치면 공유 폴더 쪽이 쓰입니다. 이름을 다르게 지으세요.
- 같이 쓰는 볼륨이 없으면, 스킬 폴더를 git 저장소로 관리해 각자 `~/.pi/agent/skills/` 아래에 받아 써도 됩니다.

<!-- 조각: 위키-주제 -->
- 주제가 모델 운영이 아니면 `/wiki init 이름 폴더` 로 만든 뒤, 위키 폴더의 `WIKI.md` 에서 '주제' 와 '분류' 를 그 주제에 맞게 고칩니다.
- 위키 폴더도 홈 아래에 두세요 (파드를 다시 시작해도 남게).

<!-- 조각: 6장-앞 -->
- **보내는 내용:** pi 는 지침, 요청, 읽은 파일 내용, 명령 결과를 `models.json` 에 적은 LLM 서버로 보냅니다.
  개인정보·중요정보가 든 파일을 다룰 때는 그 서버가 그 정보를 받아도 되는 곳인지 먼저 확인하세요.

<!-- 조각: 6장-끝 -->
- **노트북의 권한:** pi 는 노트북 안에서 사용자 권한으로 명령을 실행합니다. 노트북에 붙은 데이터 볼륨, 쿠버네티스 권한(`kubectl`)도 그대로 쓸 수 있으니 같이 쓰는 자원은 조심하세요.
- **속도:** LLM 서버의 속도에 따라 다릅니다. pi 는 도구를 쓸 때마다 LLM 에 한 번 더 묻기 때문에, 파일 여러 개를 다루는 작업은 그만큼 오래 걸립니다.

<!-- 조각: 7장-방법 -->
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

<!-- 조각: 8장-파일 -->
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

<!-- 조각: 8장-끝 -->
- `guard` 로 시작하는 항목과 `notify_after_seconds` 는 고치면 바로 적용되고, `default_mode` 는 pi 를 시작할 때 읽습니다.

<!-- 조각: 9장-표 -->
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

<!-- 조각: 10장 -->
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
