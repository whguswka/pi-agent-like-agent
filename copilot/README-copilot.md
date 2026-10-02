# 브리지 pi — Copilot 웹 채팅을 두뇌로, Git Bash 또는 Jupyter 터미널을 실행 환경으로

LLM 이 Copilot 웹 채팅(m365.cloud.microsoft/chat)뿐일 때 쓰는 구성입니다. pi 는 **이 PC(Git Bash)** 에 설치합니다.

```
[Windows PC]
  Git Bash ── pi (PC 에 설치)
               ├─ 두뇌(LLM): 중계 서버 copilot/relay.py (127.0.0.1:8765, pi 에게는 OpenAI 호환 API 로 보임)
               │              └─ 원격 디버깅 ──► Chrome 전용 창의 [Copilot 탭]  (같은 대화에 이어서 질문)
               └─ 실행 환경(명령·파일 작업), 둘 중 선택
                    ├─ local  : 이 PC 의 Git Bash                    →  pi
                    └─ jupyter: Kubeflow 노트북 안 (JupyterLab 터미널) →  pi --jupyter work/프로젝트
                                  └─ 중계 서버 ──► 같은 창의 [JupyterLab 탭] ──► Jupyter 터미널 'pibridge'
```

- 중계 서버와 브라우저 조작은 **Python 표준 라이브러리만** 씁니다. 노트북(Jupyter)에는 아무것도 설치하지 않습니다.
- **중계 서버(relay.py)**
  - pi 의 요청을 Copilot 에 보낼 글로 바꿉니다.
  - **같은 Copilot 대화창에 이어서** 보냅니다. pi 기록이 이전의 연장이면 새로 추가된 부분만 보냅니다.
  - Copilot 의 답에서 도구 블록을 찾아 pi 의 도구 호출로 바꿉니다.
  - Copilot 대화 한도(대화당 질문 수)에 닿으면, 새 대화를 열고 지침과 이전 대화 내용을 다시 넣은 뒤 이어서 작업합니다.
  - 대화가 길어지면 Copilot 이 처음 받은 진행 규칙을 놓치므로, 질문 15개 이후 10개마다 짧은 규칙 요약을 붙입니다.
  - Copilot 이 형식을 틀리거나, 실행을 거절하거나, 코드만 보여 주거나, 일을 마치지 않고 멈추면 한 번 다시 부탁합니다.
  - 같은 작업(도구·인자가 같음)을 연달아 반복하면 끊고 다음으로 넘어가게 합니다.
  - **모델 선택:** Copilot 은 새 채팅마다 모델이 '자동' 으로 돌아갑니다. 중계 서버가 pi 에서 고른 모델을 Copilot 화면의 모델 메뉴(하위 메뉴 GPT ›, Claude › 포함)에서 골라 줍니다.
  - **끝난 대화 삭제:** pi 세션이 끝나면(종료, `/new` 등) 그 세션이 만든 Copilot 대화를 왼쪽 목록에서 '… > 삭제 > 확인' 으로 지웁니다. 맥락은 pi 가 따로 저장하므로 Copilot 쪽 대화는 남길 필요가 없습니다.
    - 중계 서버가 만든 대화만 기록해 두고(`~/.pi/agent/copilot-chats.json`) 그것만 지웁니다. 직접 쓰신 대화는 건드리지 않습니다.
    - 확인 창에 그 대화의 제목이 보일 때만 '삭제' 를 누릅니다. 다르면 취소합니다.
    - 창을 닫아 알림 없이 끝난 세션의 대화는 다음에 새 대화를 열 때 지웁니다. 끄려면 `bridge.json` 의 `delete_finished_chats` 를 `false` 로.
- **jupyter 모드:** pi 확장(`~/.pi/agent/extensions/jupyter.ts`)이 bash·read·write·edit 도구를 노트북 안에서 실행합니다. 실행 중에 `/jupyter`·`/local` 로 바꿀 수 있습니다 (아래 2장).
  - 명령은 JupyterLab 터미널 세션 `pibridge` 에서 실행됩니다. 화면에 띄워 둘 필요는 없습니다.
  - 보고 싶으면 JupyterLab 왼쪽 '실행 중인 터미널과 커널' 목록에서 `pibridge` 를 열면, 실행되는 명령과 출력이 실시간으로 보입니다.
  - 출력과 종료 코드는 화면이 아니라 파일(노트북 `~/pi-bridge/run/`)로 정확히 받습니다. 다 읽은 파일은 다음 명령 때 지워집니다.
  - 파일 읽기·쓰기는 Jupyter 파일 기능을 씁니다. 숨김 파일(`.bashrc` 등)이나 홈 밖 경로는 터미널 명령으로 처리합니다.

## 1. 처음 한 번
1. `docs/설치.md` 대로 Git Bash 에 설치합니다 (`bash install.sh pc`).
2. **Chrome 전용 창**을 띄웁니다 (Git Bash, 또는 탐색기에서 더블클릭):
   ```
   ~/tools/pi/copilot/start-chrome.cmd https://<kubeflow 주소>/notebook/<네임스페이스>/<노트북>/lab
   ```
   - 평소 쓰는 Chrome 과 따로 뜨는 창입니다 (전용 프로필 `%LOCALAPPDATA%\pi-copilot-chrome`). 평소 Chrome 의 탭·로그인은 건드리지 않습니다.
     최신 Chrome(136 이후)은 평소 프로필에는 원격 조작을 허용하지 않아서 전용 프로필이 꼭 필요합니다.
   - 열린 창에서 **Copilot 에 로그인**합니다 (처음 한 번. 로그인은 전용 프로필에 남음). jupyter 모드를 쓰려면 **Kubeflow 에도 로그인**해 JupyterLab 을 이 창에 열어 둡니다.
   - 이 창의 Copilot 탭은 **pi 전용**으로 두세요. 직접 대화하면 대화 흐름이 섞입니다.
   - 창은 최소화하거나 다른 창 뒤에 두어도 됩니다. 닫으면 안 됩니다.
   - Edge 를 쓰려면 `~/tools/pi/copilot/start-edge.cmd` (전용 프로필 `%LOCALAPPDATA%\pi-copilot-edge`). 같은 포트를 쓰므로 둘 중 하나만 실행하세요.
3. 진단:
   ```
   python copilot/diag.py              (브라우저 탭 + Copilot 입력창 확인)
   python copilot/diag.py --jupyter    (+ JupyterLab 터미널에서 시험 명령 실행)
   python copilot/diag.py --send       (+ Copilot 에 시험 질문 1개를 새 대화로 보내 답 읽기까지 확인)
   python copilot/diag.py --model      (+ 모델 메뉴 항목을 보여 주고 copilot_model 을 골라 봄. --model "GPT 6.0 Sol" 처럼 이름 지정 가능)
   python copilot/diag.py --chats      (+ 왼쪽 채팅 목록을 찾는지)
   python copilot/diag.py --delete-test  (+ 시험 대화를 하나 만들어 '… > 삭제 > 확인' 으로 지워 봄. 다른 대화는 건드리지 않음)
   ```
   `결과: 정상` 이 나오면 됩니다.

## 2. 사용 (Git Bash)
```bash
pi                                   # local 모드: 이 PC 에서 실행
pi --jupyter work/myproject          # jupyter 모드: 노트북의 ~/work/myproject 에서 실행 (없으면 만듦)
pi --jupyter work/myproject -c       # 그 프로젝트의 지난 대화 이어서
```
- 중계 서버는 `pi` 를 실행하면 자동으로 켜집니다. 로그: `~/.pi/agent/copilot-relay.log`
  - 직접 켜려면: `python ~/tools/pi/copilot/relay.py` (창을 열어 두면 Copilot 과 주고받는 내용이 보입니다)
  - 상태: `curl -s http://127.0.0.1:8765/health`
- jupyter 모드에서 폴더는 노트북 홈 기준입니다. `'~/work/myproject'` 처럼 따옴표로 감싸도 됩니다.
- jupyter 모드에서 pi 의 `!명령` 도 노트북에서 실행됩니다.
- 명령은 입력 없이 실행됩니다. 입력을 기다리는 명령(vi, less, 인자 없는 python 등)은 쓰지 마세요.
- pi 에서 `Esc` 로 멈추면 노트북 쪽 명령에도 Ctrl+C 가 전달됩니다.

**실행 위치 바꾸기 (같은 세션 안에서):**

| 명령 | 뜻 |
|---|---|
| `/jupyter work/mlproj` (또는 `/web work/mlproj`) | 이후 명령·파일 작업을 노트북의 `~/work/mlproj` 에서 (없으면 만듦) |
| `/jupyter` | 마지막으로 쓴 노트북 폴더로 다시 |
| `/local` | 다시 이 PC 에서 (pi 를 시작한 폴더) |
| `/local ~/work/프로젝트` | 다시 이 PC 에서, 그 폴더를 작업 폴더로 |

- 바뀌는 것은 도구 4개(명령 실행, 파일 읽기·쓰기·고치기)의 실행 위치뿐입니다. 대화 내용·지침·모델은 그대로 이어집니다.
- 세션 기록은 pi 를 시작한 곳 기준으로 쌓입니다 (`pi --jupyter 폴더` 로 시작하면 그 노트북 폴더별, `pi` 로 시작하면 시작한 PC 폴더별).
- 연결에 실패하거나 없는 폴더를 주면 위치를 바꾸지 않습니다. pi 화면 아래 상태 줄의 `Jupyter: …` 가 지금 노트북 위치입니다 (없으면 PC).
- `!명령` 도 지금 위치에서 실행됩니다. 단 `/local` 로 다른 PC 폴더를 골라도 `!명령` 은 pi 를 시작한 폴더에서 실행됩니다.

**jupyter 모드에서 지침·세션·스킬:** pi 자체는 PC 에서 돌아가므로 지침과 세션 기록은 PC 것을 그대로 씁니다. 노트북으로 넘어가는 것은 도구 4개뿐입니다.

| 항목 | 위치 | jupyter 모드에서 |
|---|---|---|
| 세션 기록 | PC `~/.pi/agent/sessions/` | PC 에 저장. 노트북 프로젝트별로 따로 쌓임 (로컬 세션과 목록이 따로) |
| 공통 지침 | PC `~/.pi/agent/AGENTS.md` | 적용 |
| 프로젝트 지침 (노트북에 둘 때) | 노트북 `~/work/<프로젝트>/AGENTS.md` | 적용 |
| 프로젝트 지침 (PC 에 둘 때) | PC `~/.pi/jupyter-work/work_<프로젝트>/AGENTS.md` | `pi --jupyter` 로 시작했을 때 적용 (폴더 이름은 `/` 를 `_` 로 바꾼 것) |
| 프롬프트 템플릿, `APPEND_SYSTEM.md`, 설정 | PC `~/.pi/agent/` | 적용 |
| 스킬 | PC `~/.pi/agent/skills/` | 스킬 파일(SKILL.md 등)은 PC 에서 읽음. 단 스킬에 딸린 스크립트는 명령이 노트북에서 실행되므로 쓸 수 없음 |

- 그 밖에 "PC 에 있는 이 문서 읽어줘" 같은 요청은 노트북에서 찾습니다. PC 파일이 필요하면 `/local` 로 바꾼 뒤 요청하세요.
- ML 작업 위주라면: 공통 규칙(코딩 스타일, 보고 방식 등)은 PC `~/.pi/agent/AGENTS.md`, 프로젝트 규칙(데이터 위치, 실험 방법 등)은 노트북 `~/work/<프로젝트>/AGENTS.md` 에 두면 코드와 함께 관리됩니다.
  작업은 `pi --jupyter work/<프로젝트>` 로 하고, 다음 날은 `-c` 를 붙여 이어 갑니다.

**모델 고르기:** pi 의 모델 목록에 Copilot 모델이 들어 있습니다 (`~/.pi/agent/models.json`). 기본은 GPT 6.0 Sol 입니다.
```bash
pi --model gpt-5.6-sol-think         # 시작할 때 지정
```
- pi 화면에서 `/model` (또는 `Ctrl+L`)로 고르거나 `Ctrl+P` 로 다음 모델로 바꿉니다. 바꾸면 다음 질문부터 같은 Copilot 대화에서 모델만 바뀝니다.

| pi 모델 id | Copilot 화면의 모델 |
|---|---|
| `gpt-6.0-sol` (기본) | GPT › GPT 6.0 Sol |
| `gpt-5.6-sol-think` | GPT › GPT 5.6 Sol 깊이 생각하기 |
| `gpt-5.6-sol-fast` | GPT › GPT 5.6 Sol 빠른 응답 |
| `claude-sonnet-4.5` | Claude › Sonnet 4.5 |
| `claude-opus` | Claude › Opus |
| `copilot` | `bridge.json` 의 `copilot_model` (비우면 화면에 선택된 모델 그대로) |

- 깊이 생각하기는 답마다 생각하는 시간이 붙어 느립니다. pi 는 작업 하나에 Copilot 과 여러 번 주고받으므로 평소에는 GPT 6.0 Sol 을 권합니다.
- 다른 모델(예: Claude ›)을 쓰려면 `models.json` 에 `{"id": "<Copilot 화면의 모델 이름 그대로>", ...}` 를 추가하면 됩니다 (표에 없는 id 는 id 자체를 화면 이름으로 씀).
  짧은 id 를 쓰고 싶으면 `bridge.json` 의 `copilot_models` 에 `"짧은-id": "화면 이름"` 을 추가합니다.

**참고:**
- 질문 한 번 왕복에 보통 7~20초 걸립니다. 도구를 여러 번 쓰는 작업은 그만큼 오래 걸립니다.
- **pi 는 한 번에 하나만 실행하세요.** Copilot 탭 하나를 같이 쓰므로, 두 개를 동시에 쓰면 질문이 번갈아 들어갈 때마다 Copilot 새 채팅이 열리고 지침·대화 내용을 다시 넣습니다.
- pi 에서 새 세션을 시작하면 Copilot 에도 새 채팅이 열리고, 지침과 대화 내용을 다시 넣습니다. 끝난 세션의 Copilot 대화는 자동으로 지워집니다.
- `pi -p "..."` (한 번 묻기)는 키보드 입력을 기다리지 않습니다 (`< /dev/null` 불필요). 실행 중 `Ctrl+C` 로 멈출 수 있습니다.
- pi 를 `Esc` 로 중단하면 다음 질문은 새 채팅으로 시작합니다 (Copilot 쪽 흐름과 어긋나지 않도록).
- Copilot 은 대화 하나에 질문 수 한도(시험 당시 600개)가 있습니다. 한도에 닿으면 중계 서버가 새 채팅을 열고, 지침과 최근 대화(오래된 것은 한 줄 요약)를 다시 넣은 뒤 이어서 작업합니다.
- **계정 사용량 제한에 주의하세요.** pi 는 도구를 한 번 쓸 때마다 Copilot 에 질문을 하나 보내므로, 쉬지 않고 일하면 분당 5개 정도가 나갑니다.
  시험에서는 30분 동안 약 145개를 보냈을 때 "현재 요청이 너무 많아 일시적으로 응답할 수 없습니다" 가 나왔고, **약 1시간 동안 막혔습니다** (새 채팅을 열어도 같음).
  이 제한에 걸리는 환경이면 `bridge.json` 의 `max_questions_per_minute` 를 2 정도로 두세요. 조금 느려지는 대신 막히지 않습니다.
  (기업용 Copilot 처럼 제한이 없는 환경이면 기본값 0(끔) 그대로 두면 됩니다.)
- **응답이 느린 환경:** 중계 서버는 답이 시작될 때까지 5분, 끝날 때까지 15분을 기다립니다. 더 걸리면 `bridge.json` 의
  `first_reply_timeout_seconds`·`reply_timeout_seconds` 와 `~/.pi/agent/settings.json` 의 `retry.provider.timeoutMs`(밀리초, 기본 900000)를 함께 늘리세요.
- `models.json` 의 `contextWindow` 를 1000000 으로 크게 잡은 이유: pi 가 스스로 기록을 요약(압축)하면 기록이 바뀌어 Copilot 새 채팅이 열립니다. 대화 기억은 Copilot 채팅이 갖고 있으므로 pi 의 압축이 일어나지 않게 했습니다.

## 3. 설정 (copilot/bridge.json, 중계 서버 옵션)
| 항목 | 의미 |
|---|---|
| `cdp_port` | 전용 브라우저 창의 원격 디버깅 포트 (start-chrome.cmd·start-edge.cmd 와 같아야 함, 기본 9222) |
| `copilot_url_contains` / `copilot_new_chat_url` | Copilot 탭을 찾을 주소 / 새 채팅 주소 |
| `jupyter_url_contains` | JupyterLab 탭이 여러 개일 때 고를 주소 일부 (예: `/notebook/내네임스페이스/내노트북/`) |
| `input_selector`, `send_button_selector`, `new_chat_selector`, `reply_selector` | 자동 인식이 안 될 때 CSS 선택자를 직접 지정. diag.py 가 후보를 보여줌 |
| `use_stream` | Copilot WebSocket 원문으로 답 읽기 (기본 true) |
| `first_reply_timeout_seconds` / `reply_timeout_seconds` | Copilot 답이 시작될 때까지 / 끝날 때까지 기다리는 최대 초 (기본 300 / 900). 응답이 느린 환경이면 늘리세요 |
| `copilot_model` | pi 모델 id 가 `copilot` 일 때 고를 Copilot 모델 (화면 이름, 기본 `GPT 6.0 Sol`). 비우면 화면에 선택된 모델 그대로 |
| `copilot_models` | pi 모델 id → Copilot 화면의 모델 이름 표. 표에 없는 id 는 id 자체를 화면 이름으로 씀 |
| `model_button_selector` | 모델 메뉴 버튼을 자동으로 못 찾을 때 CSS 선택자 (`diag.py --model` 이 버튼 HTML 을 보여 줌) |
| `model_button_names` | 모델 메뉴 버튼을 알아보는 이름 (버튼 글자가 이 중 하나로 시작). 기본: 자동, 빠른 응답, 깊이 생각하기, GPT, Claude 등 |
| `delete_finished_chats` | 끝난 세션의 Copilot 대화 삭제 (기본 true). 중계 서버가 만든 대화만 지움 |
| `chat_item_selector` | 왼쪽 채팅 목록 항목을 자동으로 못 찾을 때 CSS 선택자 (`diag.py --chats` 참고) |
| `chat_more_pattern` / `delete_menu_pattern` / `delete_confirm_pattern` | 대화의 '…' 버튼 이름 / 메뉴의 '삭제' / 확인 창의 '삭제' 를 알아보는 정규식 (화면 문구가 바뀌면 조정) |
| `stable_seconds` | 화면에서 읽을 때 답이 이 시간 동안 안 바뀌면 끝난 것으로 봄 |
| `max_questions_per_chat` | 기본 100. 이 수만큼 질문하면 새 대화로 넘어감 (0 이면 Copilot 한도(600)까지 한 대화). 시험에서 규칙 요약 없이 80개를 넘기자 Copilot 이 진행 규칙을 놓쳤고, 규칙 요약을 넣은 뒤 60개까지는 문제가 없었음. 새 대화에는 최근 기록과 그 앞 요약만 들어가므로 아주 오래된 내용은 Copilot 이 기억하지 못함 (필요하면 파일을 다시 읽게 하세요) |
| `max_questions_per_minute` | 0 이면 끔. 숫자를 넣으면 분당 그 수를 넘지 않게 기다렸다 보냄 (Copilot 사용량 제한 예방, 아래 참고) |

중계 서버 옵션 (`python relay.py --help`):
- `--max-chars` : Copilot 메시지 하나의 최대 글자 수 (기본 10000). 이보다 길면 나눠 보내고, 앞 조각에는 "OK 만 답하라" 고 적습니다.
- `--tool-result-chars` : 도구 결과 하나를 보낼 최대 글자 수 (기본 6000, 가운데 생략).

## 4. 문제 해결
| 증상 | 확인 |
|---|---|
| pi 에 `Copilot 탭을 찾지 못했습니다` | start-chrome.cmd(또는 start-edge.cmd)로 연 전용 창에 Copilot 탭이 열려 있고 로그인돼 있는지 |
| pi 에 `브라우저 원격 디버깅 포트(9222)에 연결할 수 없습니다` | 전용 창이 꺼져 있음. start-chrome.cmd 로 다시 띄우세요. 평소 쓰는 Chrome 창으로는 연결되지 않습니다 |
| pi 에 `중계 서버에 연결할 수 없습니다` | `~/.pi/agent/copilot-relay.log` 확인. Python 을 못 찾으면 `export PI_PYTHON=/c/.../python.exe` |
| `JupyterLab 탭을 찾지 못했습니다` (jupyter 모드) | 같은 전용 창에 JupyterLab 이 열려 있는지 (평소 Chrome 에 열린 탭은 쓸 수 없음). 여러 개면 `jupyter_url_contains` 지정 |
| `JupyterLab 로그인이 만료되었습니다` | 전용 창의 JupyterLab 탭을 새로고침해 다시 로그인 (중계 서버는 자동으로 다시 붙음) |
| `Copilot 입력창을 찾지 못했습니다` | `diag.py` 결과의 선택자를 `input_selector` 에 지정 |
| pi 에 `429 Copilot 사용량 제한에 걸렸습니다` | Copilot 이 "현재 요청이 너무 많아 일시적으로 응답할 수 없습니다" 라고 답한 상태입니다 (계정 단위 제한, Throttled). 새 대화를 열어도 같으므로 중계 서버는 새 대화를 열지 않습니다. 기다렸다가 같은 요청을 다시 하면 같은 대화에 이어서 보냅니다. 시험에서는 30분 동안 질문 약 145개를 보냈을 때 걸렸습니다 |
| Copilot 이 "실행할 수 없다" 며 거절 | 중계 서버가 한 번 설명하고 다시 부탁합니다. 계속되면 요청을 더 구체적으로 적어 보세요 |
| pi 에 `같은 작업(...)이 계속 반복되어 여기서 멈췄습니다` | Copilot 이 같은 작업을 되풀이해서 중계 서버가 끊은 것입니다. 요청을 나누거나 바꿔서 다시 하세요 |
| 오래 쓰다 보면 Copilot 이 중간에 멈추거나 형식을 틀림 | 대화가 아주 길어진 탓입니다. pi 에서 새 세션(`/new`)을 시작하면 Copilot 도 새 채팅으로 시작합니다 |
| 답이 잘리거나 이상함 | `python copilot/diag.py --send` 로 확인. `use_stream` 이 true 인지 |
| 노트북에 `pi-bridge` 폴더가 생김 | jupyter 모드의 실행 기록 폴더입니다. pi 를 쓰지 않을 때 지워도 됩니다 |
| 로그에 `Copilot 모델 선택 실패` | 모델을 못 고르면 지금 모델로 계속합니다. `python copilot/diag.py --model` 로 메뉴 항목 이름을 보고 `models.json`/`bridge.json` 의 이름을 화면과 똑같이 맞추세요 |
| 로그에 `지난 Copilot 대화 삭제 실패` | 3번까지 다시 시도합니다. `python copilot/diag.py --chats --delete-test` 결과를 보고 `chat_item_selector` 등을 조정하세요. 기록은 `~/.pi/agent/copilot-chats.json` |

## 5. 다른 에이전트에서 쓰기 (중계 서버 API)
중계 서버는 pi 가 아닌 다른 에이전트도 그대로 쓸 수 있습니다. 주소는 `http://127.0.0.1:8765` (기본).

**LLM (OpenAI 호환)**
- `GET /v1/models` → 모델 `copilot` + `bridge.json` 의 `copilot_models` id 들, `max_model_len` 1000000 (대화 기억은 Copilot 채팅이 가지므로 크게 알려 줌)
- `POST /v1/chat/completions` → `messages`, `tools`, `stream`, `model` 을 받습니다. `apiKey` 는 검사하지 않습니다.
  - `model` 은 Copilot 화면의 모델로 바꿔 고릅니다 (`copilot` 이면 `copilot_model`, 표에 없는 id 는 그 이름 그대로). 응답의 `model` 은 요청한 id 입니다.
  - 도구 호출은 OpenAI `tool_calls` 로 돌려줍니다 (응답 하나에 1개, `finish_reason` 은 `tool_calls` 또는 `stop`).
  - `stream: true` 면 답을 다 받은 뒤 SSE 로 한 번에 보냅니다: 역할·본문 조각 → `tool_calls` 조각(index·id·type·function.name·function.arguments 전체) → `finish_reason` 조각 → `usage` 조각(`choices` 빈 배열) → `data: [DONE]`
  - `usage` 는 글자 수 ÷ 4 로 어림한 값입니다 (실제 토큰 수 아님).
  - 시스템 메시지 맨 앞의 역할 지정 줄("You are ...", "너는 ...", "당신은 ...")은 빼고 나머지를 참고 규칙으로 넣습니다.
  - 대화 기록은 앞부분이 그대로면 새로 추가된 부분만 같은 Copilot 채팅에 보냅니다. 오래된 도구 결과를 비우거나 줄여도(같은 `tool_call_id`) 그대로 이어 갑니다.
    사용자·어시스턴트 메시지를 지우거나 바꾸면 새 채팅을 열고 지침과 최근 기록을 다시 넣습니다 (질문 7개 안팎, 1~2분).
- `GET /health`, `POST /reset` (다음 요청을 새 채팅으로)
- `POST /v1/session/end` `{"reason": "quit"}` → 작업(세션)이 끝났음을 알림. 바로 `{"ok": true}` 로 답하고, 쓰던 Copilot 대화를 뒤에서 지웁니다
  (`reason` 이 `reload` 면 무시). 알리지 않아도 다음에 새 채팅을 열 때 지웁니다. 참고 구현: `~/.pi/agent/extensions/copilot-session.ts`

**Kubeflow 노트북 실행 (`/jupyter/*`)** - 응답은 JSON, 실패하면 `{"ok": false, "code": ..., "error": ...}`
- `GET /jupyter/info` → `root`, `home` (노트북 안 절대 경로), `terminal` (실행에 쓰는 터미널 이름)
- `POST /jupyter/exec` `{"cwd": "/home/jovyan/work/x", "command": "bash 명령", "timeout": 초(0=없음)}` → `{"id": ...}`
- `GET /jupyter/exec/<id>?offset=N&wait=2` → `done`, `exitCode`, `aborted`, `timedOut`, `data`(offset 이후 출력, base64), `size`
  (wait 초 동안 끝나기를 기다렸다 답함. 출력은 stdout+stderr 합친 것. 명령은 입력 없이(stdin 없음) 한 번에 하나씩 실행)
- `POST /jupyter/exec/<id>/abort` → 터미널에 Ctrl+C
- `POST /jupyter/fs` `{"op": "read"|"write"|"mkdir"|"stat", "path": "노트북 안 절대 경로", "data": "base64 (write)"}`
  → read: `data`(base64), stat: `kind`(file/directory)·`writable`·`size`. 오류 `code`: ENOENT, EISDIR, EACCES, EINVAL, EIO, AUTH(로그인 만료), BRIDGE(탭 없음)
- 참고 구현: `~/.pi/agent/extensions/jupyter.ts` (pi 확장, 이 API 의 클라이언트)
