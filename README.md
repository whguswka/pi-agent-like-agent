# pi-agent-like-agent

업무 PC 에서 **Copilot 웹 채팅을 두뇌(LLM)로 쓰는 코딩 에이전트**입니다.
오픈소스 코딩 에이전트 **pi**([earendil-works/pi](https://github.com/earendil-works/pi), npm `@earendil-works/pi-coding-agent` 0.87.1, MIT)를 npm 없이 실행할 수 있게 묶고,
Copilot 웹 채팅과 이어 주는 중계기를 더했습니다. pi 원본 코드는 고치지 않았습니다.

pi 는 터미널에서 동작합니다. 할 일을 말로 지시하면 LLM 과 주고받으면서 파일을 읽고 고치고, 명령을 실행해 결과를 확인합니다.

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
GitHub 저장소 화면의 **Code > Download ZIP** 으로 `pi-agent-like-agent-main.zip` 을 받고, zip 이 있는 폴더에서 (예: `cd ~/Downloads`):
```bash
mkdir -p ~/tools && unzip -q pi-agent-like-agent-main.zip -d ~/tools/ && mv ~/tools/pi-agent-like-agent-main ~/tools/pi
```
이미 `~/tools/pi` 가 있으면 [9장](#9-새-버전으로-바꾸기) 대로 하세요.

### 2-2. Node.js 확인
```bash
bash ~/tools/pi/check-node.sh
```
- `결과: 사용 가능` 또는 `결과: 호환 모드로 사용 가능` 이면 다음으로 넘어갑니다. VS Code 내장 Node 는 보통 호환 모드이며, 그대로 쓰면 됩니다.
- `사용 가능한 Node 없음` 이면 화면에 나온 방법 중 하나를 준비합니다. 보통은:
  ```bash
  pip install --user nodejs-wheel-binaries==24.19.0
  ```
- 자세한 내용(portable VS Code, 호환 모드, Node 를 찾는 순서): [docs/설치.md](docs/설치.md#1-nodejs-확인)

### 2-3. 설치
```bash
bash ~/tools/pi/install.sh pc
```
- 설정 템플릿을 `~/.pi/agent` 에 복사하고, `~/.bashrc` 에 PATH 를 넣습니다.
- **새 Git Bash 창**을 열고 `pi --version` 이 나오면 설치된 것입니다.

### 2-4. 처음 실행과 Copilot 로그인
```bash
mkdir -p ~/work/hello && cd ~/work/hello
pi
```
1. `pi` 를 실행하면 **Chrome 전용 창이 자동으로 뜹니다** (`[pi] Copilot 전용 창(chrome)을 띄웠습니다 ...`).
2. 그 창에서 **Copilot 에 로그인**합니다. 처음 한 번만 하면 됩니다 (로그인은 전용 프로필에 남음).
3. pi 화면에서 `hello.py 를 만들어서 hello 를 출력하고 실행해줘` 처럼 지시해 봅니다. 파일이 생기고 실행 결과가 나오면 준비 끝입니다.

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
| `--model` | + 모델 메뉴 항목 읽기, 기본 모델 고르기 (`--model "GPT 6.0 Sol"` 처럼 이름 지정 가능) |
| `--chats` | + 왼쪽 채팅 목록 찾기 |
| `--delete-test` | + 시험 대화를 하나 만들어 지워 보기 (다른 대화는 건드리지 않음) |
| `--jupyter` | + JupyterLab 터미널에서 시험 명령 실행 ([5장](#5-실행-위치-바꾸기-pc-와-jupyter-노트북)을 쓸 때) |
| `--report` | **한 화면 상태 요약**: 판 번호, Node, 중계 서버, 전용 창, 현재 모델, 설정, 최근 요청 통계(평균 시간, 새 대화, 조각 나눔), 최근 로그 (읽기만 함) |

- `--report` 는 요약만 보여 줍니다. 나머지 진단은 마지막 줄에 `결과: 정상` 이 나오면 됩니다.
- **문제가 생기면 `--report` 화면을 찍어 보내 주세요.** 상황 대부분이 한 장에 담깁니다.

## 3. 기본 사용법

### 3-1. 시작과 종료
```bash
cd ~/work/myproject                  # 작업할 폴더로 가서
pi                                   # 대화형으로 시작
pi -c                                # 이 폴더에서 하던 마지막 대화를 이어서
pi -p "이 폴더의 파이썬 파일 목록과 역할을 알려줘"     # 한 번만 묻고 끝 (답만 출력)
```
- pi 는 **시작한 폴더**를 작업 폴더로 씁니다. 파일 작업, 지침(AGENTS.md), 세션 기록이 모두 이 폴더 기준입니다.
- 종료: `/quit`, `Ctrl+C` 두 번, 또는 입력창이 비었을 때 `Ctrl+D`.
- 중계 서버는 `pi` 를 실행하면 자동으로 켜지고, 따로 끌 필요 없습니다. 로그: `~/.pi/agent/copilot-relay.log`
- 요청 하나가 30초 넘게 걸리면 끝날 때 터미널 벨과 알림으로 알려 줍니다. 다른 창을 보고 있어도 됩니다 (시간은 [10장](#10-설정)의 `notify_after_seconds`).

### 3-2. 화면에서 쓰는 키와 명령
| 하고 싶은 것 | 방법 |
|---|---|
| 지시 보내기 / 줄 바꾸기 | `Enter` / `Shift+Enter` |
| 파일 다루기 | 경로나 파일 이름을 그대로 적으면 됩니다 (예: `src/main.py 의 오류 처리를 고쳐줘`) |
| 명령을 직접 실행하고 결과를 대화에 넣기 | `!git status` (`!!git status` 는 결과를 LLM 에 보내지 않음) |
| 일하는 중에 방향 바꾸기 | 입력하고 `Enter` (지금 단계가 끝나면 반영) |
| 멈추기 | `Esc` |
| 도구 출력 펼치기·접기 | `Ctrl+O` |
| 모델 고르기 / 다음 모델로 | `/model` 또는 `Ctrl+L` / `Ctrl+P` |
| 지침·스킬을 고친 뒤 다시 읽기 | `/reload` |
| 명령 목록 | `/` 를 치면 나옴 |

### 3-3. 세션 (대화 기록)
pi 는 대화를 자동으로 저장합니다 (`~/.pi/agent/sessions/`, 작업 폴더별).

| 명령 | 뜻 |
|---|---|
| `pi -c` | 이 폴더의 마지막 세션을 이어서 시작 |
| `pi -r` 또는 `/resume` | 저장된 세션 목록에서 골라 열기 |
| `/new` | 새 세션 시작 (Copilot 도 새 대화로) |
| `/name 이름` | 세션에 이름 붙이기 (목록에서 찾기 쉬움) |
| `/session` | 지금 세션 정보 |

### 3-4. 이 구성에서 피할 명령
| 명령 | 이유 |
|---|---|
| `/compact`, `/fork`, `/clone`, `/tree`(다른 지점으로 이동) | 대화 기록이 바뀌어 Copilot 새 대화가 열리고, 지침과 기록을 다시 넣느라 1~2분 걸립니다. 꼭 필요할 때만 |
| `/thinking` | 해당 없음. 생각 깊이는 모델로 고릅니다 ([4장](#4-모델-고르기)의 '깊이 생각하기') |
| `/login` | 필요 없음. 계정은 전용 창의 Copilot 로그인을 씁니다 |
| `/share` | 대화를 외부 서비스에 올리는 기능입니다. 쓰지 마세요 |

## 4. 모델 고르기
pi 의 모델 목록에 Copilot 모델이 들어 있습니다. 모델을 고르면 중계 서버가 Copilot 화면의 모델 메뉴에서 같은 모델을 골라 줍니다.
(Copilot 은 새 대화마다 '자동' 으로 돌아가므로 중계 서버가 매번 다시 고릅니다.)

| pi 모델 id | Copilot 화면의 모델 |
|---|---|
| `gpt-6.0-sol` (기본) | GPT › GPT 6.0 Sol |
| `gpt-5.6-sol-think` | GPT › GPT 5.6 Sol 깊이 생각하기 |
| `gpt-5.6-sol-fast` | GPT › GPT 5.6 Sol 빠른 응답 |
| `claude-sonnet-4.5` | Claude › Sonnet 4.5 |
| `claude-opus` | Claude › Opus |
| `copilot` | `bridge.json` 의 `copilot_model` (비우면 화면에 선택된 모델 그대로) |

```bash
pi --model gpt-5.6-sol-think         # 시작할 때 지정
```
- pi 화면에서는 `/model`(또는 `Ctrl+L`)로 고르고, `Ctrl+P` 로 다음 모델로 바꿉니다. 바꾸면 다음 질문부터 같은 Copilot 대화에서 모델만 바뀝니다.
- 고른 모델은 그 세션에만 기록됩니다. 새 세션의 기본 모델로 삼으려면 `/model` 목록에서 `Ctrl+S` 를 누르거나 `~/.pi/agent/settings.json` 의 `defaultModel` 을 바꿉니다.
- **깊이 생각하기**는 답마다 생각하는 시간이 붙어 느립니다. pi 는 작업 하나에 Copilot 과 여러 번 주고받으므로 평소에는 GPT 6.0 Sol 을 권합니다.
- Copilot 메뉴에 새 모델이 생기면 `~/.pi/agent/models.json` 의 `models` 에 한 줄 추가합니다. `id` 는 **Copilot 화면의 모델 이름 그대로** 씁니다.
  ```json
  { "id": "새 모델 이름", "name": "새 모델 (Copilot)", "contextWindow": 1000000, "maxTokens": 16000 }
  ```
  짧은 id 를 쓰고 싶으면 `bridge.json` 의 `copilot_models` 에 `"짧은-id": "화면 이름"` 을 넣습니다.

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
| `/local` | 다시 이 PC 에서 (pi 를 시작한 폴더) |
| `/local ~/work/프로젝트` | 다시 이 PC 에서, 그 폴더를 작업 폴더로 |

- 대화 내용·지침·모델은 그대로 이어집니다. 화면 아래 상태 줄의 `Jupyter: …` 가 지금 노트북 위치입니다 (없으면 PC).
- 연결에 실패하거나 없는 폴더를 주면 위치를 바꾸지 않습니다.
- 노트북 쪽 명령은 JupyterLab 터미널 `pibridge` 에서 실행됩니다. JupyterLab 왼쪽 '실행 중인 터미널과 커널' 에서 열면 실시간으로 보입니다.
- 명령은 입력 없이 실행됩니다. 입력을 기다리는 명령(vi, less, 인자 없는 python 등)은 쓰지 마세요. `Esc` 로 멈추면 노트북 명령에도 Ctrl+C 가 전달됩니다.
- 노트북 홈에 생기는 `pi-bridge` 폴더는 실행 기록용입니다. pi 를 쓰지 않을 때 지워도 됩니다.

## 6. 지침, 스킬, 메모리
pi 에게 무엇을 어디에 적어 두는지 정리한 표입니다.

| 알려 주고 싶은 것 | 적는 곳 | 언제 쓰이나 |
|---|---|---|
| 항상 지킬 규칙, 내 작업 방식 | `~/.pi/agent/AGENTS.md` (공통 지침) | 모든 세션 |
| 이 프로젝트의 규칙, 구조, 빌드·테스트 방법 | 프로젝트 폴더의 `AGENTS.md` (프로젝트 지침) | 그 폴더(또는 하위 폴더)에서 시작한 세션 |
| 특정 작업의 절차, 양식, 참고 자료 | 스킬: `~/.pi/agent/skills/<이름>/SKILL.md` | 작업이 스킬 설명과 맞을 때 LLM 이 읽음. `/skill:이름` 으로 직접 부를 수도 있음 |
| 자주 쓰는 지시문 | 프롬프트 템플릿: `~/.pi/agent/prompts/<이름>.md` | `/이름` 을 입력할 때 |
| 지난 작업의 맥락 | 세션 기록 (자동 저장) | `pi -c`, `/resume` |

파일 이름은 정확히 **`AGENTS.md`**(S 포함, 대문자)와 **`SKILL.md`**(대문자) 입니다.

### 지침 (AGENTS.md)
pi 는 세션을 시작할 때 아래 파일을 찾아 **지침으로 함께 읽습니다** (있는 것 모두).
1. `~/.pi/agent/AGENTS.md`: 공통 지침. 어느 폴더에서 시작하든 적용됩니다.
2. 작업 폴더와 그 **상위 폴더들**의 `AGENTS.md`: 프로젝트 지침. 예를 들어 `~/work/AGENTS.md` 는 `~/work` 아래 모든 프로젝트에 적용됩니다.
   (`AGENTS.md` 대신 `CLAUDE.md` 라는 이름도 읽습니다.)

예시 `~/work/myproject/AGENTS.md`:
```markdown
# 프로젝트 지침
- Python 3.11. 테스트는 `pytest -q` 로 돌리고, 고친 뒤에는 반드시 테스트를 돌릴 것
- 원본 데이터(data/raw/)는 고치지 말 것
- 보고는 한국어로, 바꾼 파일 목록을 마지막에 정리할 것
```
- pi 시작 화면 위쪽에 읽어 들인 지침 파일 목록이 나옵니다.
- 실행 중에 고쳤으면 `/reload` 로 다시 읽습니다. 지침이 바뀌면 다음 질문은 Copilot 새 대화에서 새 지침으로 시작합니다.
- pi 에게 "이 규칙을 AGENTS.md 에 추가해줘" 라고 시켜도 됩니다.
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

스킬을 두는 곳:

| 위치 | 범위 |
|---|---|
| `~/.pi/agent/skills/` | 모든 프로젝트 (권장) |
| `~/.agents/skills/` | 모든 프로젝트 (여러 에이전트가 같이 쓰는 표준 위치) |
| 프로젝트 폴더의 `.pi/skills/`, `.agents/skills/` | 그 프로젝트만. 아래 '프로젝트 신뢰' 를 거칩니다 |

**프로젝트 신뢰:** 프로젝트 폴더에 `.pi/skills/`, `.pi/settings.json` 같은 설정이 있으면, pi 는 시작할 때 이 폴더를 믿을지 묻습니다.
믿는다고 답해야 그 스킬·설정이 들어옵니다. `/trust` 로 결정을 저장하면 다음부터 묻지 않습니다.
`pi -p` 는 물을 수 없어서 건너뜁니다 (불러오려면 `pi --approve -p "..."`). 지침(AGENTS.md)은 신뢰와 관계없이 항상 읽습니다.

### 메모리
- **pi 에는 자동 메모리 기능이 없습니다.** 대화에서 무엇을 기억할지 스스로 골라 저장하지 않습니다.
- 오래 기억시킬 것은 **AGENTS.md 에 적습니다.** 공통이면 `~/.pi/agent/AGENTS.md`, 프로젝트별이면 프로젝트 폴더에 둡니다. 직접 적거나, pi 에게 "방금 정한 규칙을 AGENTS.md 에 추가해줘" 라고 시킵니다.
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

- "PC 에 있는 이 문서 읽어줘" 같은 요청은 노트북에서 찾습니다. PC 파일이 필요하면 `/local` 로 바꾼 뒤 요청하세요.
- ML 작업이라면: 공통 규칙(코딩 스타일, 보고 방식)은 PC `~/.pi/agent/AGENTS.md`, 프로젝트 규칙(데이터 위치, 실험 방법)은 노트북 `~/work/<프로젝트>/AGENTS.md` 에 두고,
  `pi --jupyter work/<프로젝트>` 로 작업한 뒤 다음 날은 `-c` 를 붙여 이어 갑니다.

## 7. Copilot 대화 관리
- **같은 대화에 이어서:** 중계 서버는 pi 세션 하나를 Copilot 대화 하나로 이어 갑니다. 처음에는 지침·도구 설명·요청을 함께 보내고, 그 뒤로는 새로 추가된 부분만 보냅니다.
- **새 대화가 열리는 때:** 새 세션(`/new`, pi 다시 시작. `-c` 로 이어 시작해도 해당), 지침을 바꾸고 `/reload`, [3-4](#3-4-이-구성에서-피할-명령)의 기록을 바꾸는 명령,
  `Esc` 로 멈춘 다음 질문, 대화당 질문 수(`max_questions_per_chat`, 기본 100)에 닿았을 때.
  새 대화에는 지침과 최근 기록(오래된 것은 한 줄 요약)을 다시 넣으므로 1~2분 걸립니다.
- **끝난 대화 자동 삭제:** pi 세션이 끝나면(종료, `/new` 등) 그 세션이 쓰던 Copilot 대화를 왼쪽 목록에서 지웁니다. 맥락은 pi 세션에 남아 있으므로 Copilot 쪽 대화는 남길 필요가 없습니다.
  - 중계 서버가 만든 대화만 기록해 두고(`~/.pi/agent/copilot-chats.json`) 그것만 지웁니다. 직접 쓴 대화는 건드리지 않습니다.
  - 확인 창에 그 대화의 제목이 보일 때만 '삭제' 를 누릅니다. 다르면 취소합니다.
  - 창을 닫아 알림 없이 끝난 세션의 대화는 다음에 새 대화를 열 때 지웁니다.
  - 끄려면 `bridge.json` 의 `"delete_finished_chats": false`.

## 8. 주의할 점
- **pi 는 한 번에 하나만** 실행하세요. Copilot 탭 하나를 같이 쓰므로, 두 개를 같이 쓰면 질문이 번갈아 들어갈 때마다 새 대화가 열립니다.
- **전용 창의 Copilot 탭에서 직접 대화하지 마세요.** 대화 흐름이 섞입니다. 창은 최소화해도 되지만 닫으면 안 됩니다.
- **속도:** 질문 한 번 왕복에 보통 7~20초 걸립니다. pi 는 도구를 쓸 때마다 Copilot 에 한 번씩 묻기 때문에, 파일 여러 개를 다루는 작업은 몇 분 걸립니다.
  실제로 얼마나 걸리는지는 `diag.py --report` 의 '최근 요청' 줄(평균 시간, 새 대화 횟수와 시간, 긴 메시지를 나눠 보낸 횟수)에서 볼 수 있습니다.
- **사용량 제한:** 쉬지 않고 일하면 분당 질문 5개 정도가 나갑니다. 시험에서는 30분에 약 145개를 보냈을 때 약 1시간 동안 막혔습니다.
  이런 제한이 있는 계정이면 `bridge.json` 의 `max_questions_per_minute` 를 2 정도로 두세요. 제한이 없는 환경이면 기본값 0(끔) 그대로 둡니다.
- **위험할 수 있는 작업은 실행 전에 묻습니다.** pi 는 보통 도구를 쓸 때 허락을 묻지 않지만, 되돌리기 어려운 작업은 확인 창을 띄웁니다.
  - 대상: 폴더 지우기(`rm -r` 등), `git push`·`git reset --hard`·`git clean`·`git branch -D`, 권한 일괄 변경, `kubectl delete`,
    패키지 제거, `sudo`, 받은 스크립트 바로 실행(`curl ... | sh`), 데이터베이스 삭제, 작업 폴더 밖 파일 쓰기 (jupyter 모드는 노트북 작업 폴더 기준)
  - 거부하면 실행하지 않고 작업을 멈춥니다. 직접 치는 `!명령` 은 묻지 않습니다. `pi -p` 처럼 물을 수 없을 때는 실행하지 않고 LLM 에게 이유를 알립니다.
  - 묻지 않을 명령, 더 물어볼 명령은 [10장](#10-설정)의 `guard_allow`, `guard_patterns` 로 정합니다.
- 그래도 모든 위험을 막지는 못합니다. 중요한 폴더는 git 으로 관리하고 바뀐 내용을 확인하세요. 시킨 범위를 벗어나는 작업이 보이면 `Esc` 로 멈춥니다.

## 9. 새 버전으로 바꾸기
실행 중인 pi 를 모두 끈 뒤, 받은 zip 을 지정해 `update.sh` 를 실행합니다 (`~/tools/pi` 밖의 폴더에서).
```bash
cd ~
bash ~/tools/pi/update.sh ~/Downloads/pi-agent-like-agent-main.zip
```
- 하는 일: zip 확인 → 중계 서버 끄기 → 지금 폴더를 `~/tools/pi.old` 로 이름 바꾸기 → 새 판을 `~/tools/pi` 에 → `install.sh` 로 설정 반영.
- 끝에 `지금 판 -> 새 판` 과 확인할 점을 보여 줍니다. 그다음 `pi` 를 실행하면 새 판으로 시작합니다 (중계 서버도 새 판으로 켜짐).
- 폴더가 사용 중이라 이름을 바꾸지 못하면 **아무것도 바꾸지 않고 멈춥니다.** pi, Copilot 전용 창, 그 폴더를 연 탐색기·터미널을 닫고 다시 실행하세요.
- 지금 판은 `python ~/tools/pi/copilot/diag.py --report` 의 '버전' 줄에서 볼 수 있습니다.

그대로 남는 것:
- `~/.pi/agent` 의 설정(`settings.json`, `models.json`)에는 **새 판에 추가된 항목(새 모델 등)만** 넣습니다. 바뀐 파일은 `갱신:` 으로 알려 주고, 이전 파일은 `.bak` 으로 남깁니다.
- 직접 고친 값과 직접 지운 항목, 내 설정 파일(`~/.pi/agent/bridge.json`), 지침(AGENTS.md), 스킬, 세션 기록은 그대로입니다.
- 확장(`~/.pi/agent/extensions/`)은 새 것으로 바뀝니다.
- 예전 판에서 `copilot/bridge.json` 을 직접 고쳤다면 `update.sh` 가 그 항목을 알려 줍니다. 그 항목을 내 설정 파일([10장](#10-설정))로 옮기세요.
- 잘 동작하면 `~/tools/pi.old` 는 지워도 됩니다.

**`update.sh` 가 없는 예전 판에서 (처음 한 번만, 손으로):**
1. 실행 중인 pi 를 모두 끄고, Copilot 전용 창도 닫습니다.
2. zip 이 있는 폴더에서:
   ```bash
   rm -rf ~/tools/pi.old && mv ~/tools/pi ~/tools/pi.old
   unzip -q pi-agent-like-agent-main.zip -d ~/tools/ && mv ~/tools/pi-agent-like-agent-main ~/tools/pi
   bash ~/tools/pi/install.sh pc
   ```

## 10. 설정
| 파일 | 내용 |
|---|---|
| `~/.pi/agent/bridge.json` | **내 설정 파일.** 아래 항목 중 바꾸고 싶은 것만 적습니다. 업데이트해도 그대로 남습니다 |
| `~/tools/pi/copilot/bridge.json` | 중계 서버 설정의 기본값 (저장소에 들어 있는 파일이라 업데이트하면 새 판 값으로 바뀜. 직접 고치지 마세요) |
| `~/.pi/agent/settings.json` | pi 설정: 기본 모델(`defaultModel`), 응답 대기(`retry.provider.timeoutMs`), Git Bash 경로(`shellPath`) |
| `~/.pi/agent/models.json` | pi 가 쓸 모델 목록 |

**내 설정 파일 예시** (`~/.pi/agent/bridge.json`):
```json
{
  "jupyter_url": "https://<kubeflow 주소>/notebook/<네임스페이스>/<노트북>/lab",
  "max_questions_per_minute": 2,
  "copilot_models": { "gpt-7": "GPT 7" }
}
```
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
| `first_reply_timeout_seconds` / `reply_timeout_seconds` | `300` / `900` | 답이 시작될 때까지 / 끝날 때까지 기다리는 초. 늘릴 때는 `settings.json` 의 `retry.provider.timeoutMs`(밀리초) 도 함께 |
| `copilot_models` | 4장의 표 | pi 모델 id → Copilot 화면의 모델 이름 |
| `guard` | `true` | 위험할 수 있는 작업을 실행 전에 묻기 ([8장](#8-주의할-점)). `false` 면 끔 |
| `guard_allow` | `[]` | 묻지 않을 명령 (정규식 목록, 예: `["^git push origin feature/"]`) |
| `guard_patterns` | `[]` | 더 물어볼 명령 (정규식 목록, 예: `["make deploy"]`) |
| `guard_outside_writes` | `true` | 작업 폴더 밖 파일 쓰기도 묻기 |
| `notify_after_seconds` | `30` | 요청이 이 초보다 오래 걸리면 끝날 때 터미널 벨과 알림 (0 이면 끔) |

- **설정을 고친 뒤에는 중계 서버를 다시 켜야 적용됩니다.** 아래 명령으로 끄면 다음 `pi` 실행 때 새 설정으로 켜집니다.
  ```bash
  curl -s -X POST http://127.0.0.1:8765/shutdown
  ```
  (`browser`, `auto_start_browser`, `jupyter_url` 은 `pi` 를 실행할 때마다 읽고, `guard` 로 시작하는 항목과 `notify_after_seconds` 는 고치면 바로 적용됩니다.)
- JSON 파일에 Windows 경로를 쓸 때는 `/` 로 씁니다 (`"C:/Users/..."`). `\` 를 하나만 쓰면 JSON 오류가 납니다.
- 전체 항목: [copilot/README-copilot.md 3장](copilot/README-copilot.md#3-설정-copilotbridgejson-중계-서버-옵션)
- 중계 서버를 다른 에이전트에서 OpenAI 호환 API 로 쓰기: [copilot/README-copilot.md 5장](copilot/README-copilot.md#5-다른-에이전트에서-쓰기-중계-서버-api)

## 11. 문제 해결
먼저 `python ~/tools/pi/copilot/diag.py --report` 를 실행해 보세요. 해결이 안 되면 그 화면을 찍어 보내 주세요.

| 증상 | 해결 |
|---|---|
| `pi: command not found` | 새 Git Bash 창을 여세요. 지금 창에서 바로 쓰려면 `export PATH="$HOME/tools/pi/bin:$PATH"` |
| Node 를 찾지 못했다는 메시지 | `bash ~/tools/pi/check-node.sh` 결과대로 준비 ([2-2](#2-2-nodejs-확인)) |
| 시작 화면에 `Warning: fd not found` / `ripgrep not found` | 무시해도 됩니다. 기본 도구(명령 실행, 파일 읽기·쓰기·고치기)는 이 둘 없이 동작합니다 |
| `브라우저 원격 디버깅 포트(9222)에 연결할 수 없습니다` | 전용 창이 꺼져 있습니다. `pi` 를 다시 실행하면 다시 띄웁니다 (또는 `start-chrome.cmd`). 평소 쓰는 Chrome 창으로는 연결되지 않습니다 |
| `Copilot 탭을 찾지 못했습니다` | 전용 창에 Copilot 탭이 열려 있고 로그인돼 있는지 확인 |
| `중계 서버에 연결할 수 없습니다` | `~/.pi/agent/copilot-relay.log` 확인. Python 을 못 찾으면 `~/.bashrc` 에 `export PI_PYTHON=/c/.../python.exe` |
| `429 Copilot 사용량 제한에 걸렸습니다` | 계정 단위의 일시 제한입니다. 기다렸다가 같은 요청을 다시 하면 이어서 진행합니다. 자주 걸리면 `max_questions_per_minute` |
| 오래 쓰다 보면 Copilot 이 멈추거나 형식을 틀림 | 대화가 너무 길어진 탓입니다. `/new` 로 새 세션을 시작하세요 (필요한 맥락은 AGENTS.md 나 메모 파일로) |
| `같은 작업(...)이 계속 반복되어 여기서 멈췄습니다` | Copilot 이 같은 작업을 되풀이해서 중계 서버가 끊은 것입니다. 요청을 나누거나 바꿔서 다시 하세요 |
| 로그에 `Copilot 모델 선택 실패` | `diag.py --model` 로 메뉴 이름을 보고 `models.json`·`bridge.json` 의 이름을 화면과 똑같이 맞추세요 |
| 로그에 `지난 Copilot 대화 삭제 실패` | `diag.py --chats --delete-test` 결과를 확인하세요 |
| 설정을 고쳤는데 그대로임 | 중계 서버를 다시 켜야 합니다 ([10장](#10-설정)) |
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
| `profiles/` | 환경별 설정 템플릿 (`pc`, `jupyter`, 두 환경 공통 `common`: 위험 명령 확인, 작업 끝 알림) |
| `copilot/` | Copilot 웹 채팅 중계기, 진단 도구, 전용 창 실행 파일(`start-chrome.cmd`, `start-edge.cmd`) |
| `tests/` | 단위 테스트 (`python tests/test_relay.py`, `python tests/test_config.py`, `node tests/test_guard.mjs`) |
| `docs/` | [설치 세부](docs/설치.md), [vLLM 연결](docs/vLLM-연결.md), [반입 검토 자료](docs/반입-검토-요청서.md), [runtime 파일 해시 목록](docs/runtime-SHA256SUMS.txt) |

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
