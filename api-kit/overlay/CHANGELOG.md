# 바뀐 점 (CHANGELOG)

버전 번호는 `VERSION` 에 있습니다. 새 버전으로 바꾸면(`update.sh`) 끝에 그 버전의 항목을 보여 줍니다.
버전마다 바탕이 된 [pi-agent-like-agent](https://github.com/whguswka/pi-agent-like-agent) 의 버전을 함께 적습니다.

## 2026-10-16.1
가벼운 업데이트 zip 을 더했습니다. 바탕: pi-agent-like-agent 2026-10-16.1.
- **가벼운 업데이트 zip**: 버전마다 GitHub 저장소의 **Releases** 에 `pi-agent-like-agent-api-<버전>-update.zip` 을 올립니다. pi 본체(`runtime/`, 2.8MB·835개 파일)를 뺀 약 0.2MB 라 반입이 가볍습니다 (전체 zip 은 3.0MB) ([README 7장](README.md#7-새-버전으로-바꾸기)).
  - `update.sh` 가 지금 깔린 pi 본체가 새 버전의 것과 같은지 해시 목록(`docs/runtime-SHA256SUMS.txt`)으로 확인한 뒤 그대로 씁니다. 다르면 아무것도 바꾸지 않고 전체 zip 이 필요하다고 멈춥니다.
  - 키트 파일은 모두 들어 있어 몇 버전을 건너뛰어도 됩니다. pi 본체가 바뀌는 버전은 CHANGELOG 와 Releases 에 '전체 zip 필요' 를 적습니다.
- `update.sh`: 처음 zip 을 풀어 설치한 버전에서 바꿀 때 나오던 `.commit: No such file or directory` 줄을 없앴습니다 (동작은 같음).
- 확인한 환경: 개발 PC 에서 설치·업데이트(전체 zip, 가벼운 zip, tar.gz)를 돌렸습니다. 이번 버전은 Kubeflow 노트북에서는 돌려 보지 않았습니다.
- 할 일: **이 버전으로는 전체 zip 으로 바꾸세요** (2026-10-15.x 의 `update.sh` 는 가벼운 zip 을 모름). 다음 버전부터는 Releases 의 가벼운 zip 으로 바꿀 수 있습니다.

## 2026-10-15.2
LLM 위키에 폴더째 반영을 더했습니다. 바탕: pi-agent-like-agent 2026-10-15.1.
- **LLM 위키: 폴더째 반영** (`/wiki ingest 폴더`): 그 폴더 아래 모든 단계의 원본을 경로 순(숫자는 크기 순: 1월, 2월, 10월)으로 하나씩 차례로 반영합니다 ([README 5장](README.md#llm-위키-wiki)).
  - 처음에 개수를 보여 주고 묻습니다. 한 번에 10개까지 하고, 이미 반영한 것과 글이 아닌 파일(pdf·docx·hwp 등), 200KB 넘는 파일은 뺍니다. raw/ 전체는 `/wiki ingest raw`.
  - 원본 하나를 요청 하나로 보내고 앞 요청이 끝나면 다음을 보냅니다 (상태 줄에 `반영 2/7`). `Esc` 로 멈추고, 같은 명령으로 남은 것부터 이어 갑니다. 원본 2개가 연달아 반영되지 않으면 스스로 멈춥니다.
- **LLM 위키: 여러 단계 폴더와 같은 이름의 원본**
  - 다른 폴더에 같은 이름의 원본이 있으면(`2025/1월.md`, `2026/1월.md`) 하나만 반영해도 둘 다 반영한 것으로 세던 것을 고쳤습니다 (경로로 셈).
  - 같은 이름 원본의 요약 페이지 이름이 겹쳐 뒤의 것이 앞의 것을 덮어쓰던 것을 고쳤습니다. pi 가 겹치지 않는 이름(`2025 1월`)을 정해 모델에게 줍니다.
  - `/wiki ingest 1월.md` 처럼 이름만 적으면 하위 폴더 안의 원본을 찾지 못하던 것을 고쳤습니다. 맞는 원본이 여러 개면 경로를 적어 달라고 합니다.
- 확인한 환경: 개발 PC 에서 가짜 LLM 서버로 설치·업데이트와 위키(폴더째 반영의 차례, Esc 뒤 이어 가기 등)를 돌렸습니다. 이번 버전은 Kubeflow 노트북(Node 20 인 code-server 4.93)과 실제 vLLM 으로는 돌려 보지 않았습니다.
- 할 일: `bash ~/tools/pi/update.sh <새 zip>` 뒤 새 터미널. 설정(`models.json` 등)은 그대로입니다.
  위키에 같은 이름의 원본을 반영한 적이 있으면 `/wiki lint` 의 '아직 반영 안 된 원본' 을 한 번 보고, 나온 원본은 `/wiki ingest <경로>` (덮어써진 요약 페이지는 위키 폴더의 `.history/` 에 있음).

## 2026-10-15.1
Kubeflow 노트북(code-server·VS Code 웹) 전용으로 바꿨습니다. 바탕: pi-agent-like-agent 2026-10-14.2 와 그 뒤의 공용 확장 수정(fcc4324, 8299a37).
- 설치는 노트북 터미널에서 `bash ~/tools/pi/install.sh` 하나 (PC 의 설정, cmd·PowerShell 실행기, VS Code 데스크톱의 내장 Node 로 돌리는 부분을 뺌).
- Node 를 따로 설치하지 않아도 code-server 에 든 것(`/usr/lib/code-server/lib/node`)을 찾아 씁니다. `check-node.sh` 가 Node 를 못 찾으면 노트북 안의 흔한 곳에서 찾은 node 를 보여 줍니다.
- code-server 터미널에서 다르게 쓰는 키(`Ctrl+P`·`Ctrl+J`·`Ctrl+W`, `Shift+Enter` 줄바꿈 설정)를 README 3-3 에 적었습니다.
- `update.sh`: zip 을 풀 프로그램이 없으면 GitHub 의 `tar.gz` 도 받습니다.
- LLM 위키: `/wiki init 이름 ~/폴더` 의 `~` 를 홈으로 (전에는 지금 폴더 안에 `~` 폴더를 만들었음).
- 문서: 프록시가 있는 노트북에서 LLM 주소를 `no_proxy` 에 넣는 법, 클러스터 안 서비스 주소.
- 확인한 환경: Kubeflow code-server 노트북 4.93.1 (VS Code 1.93, Node 20.15.1 호환 모드)과 4.121 (VS Code 1.121, Node 22.22.1).
  설치·업데이트(zip, tar.gz), 새 터미널의 PATH, `/kit`·`/doctor`·위키·hook 을 가짜 LLM 서버로, code-server 터미널의 키(3-3)를 화면에서 확인했습니다. 실제 vLLM 으로는 돌려 보지 않았습니다.
- 할 일: 2026-10-14.2 를 깔았다면 `bash ~/tools/pi/update.sh <새 zip>` 뒤 새 터미널. 설정(`models.json` 등)은 그대로입니다.

## 2026-10-14.2
첫 공개 버전입니다. pi-agent-like-agent 2026-10-14.2 에 공용 확장 수정 하나(커밋 fcc4324: API 로 쓸 때 위키 쓰기 도구와 `/doctor` 의 설명)를 더한 코드에서
웹 채팅 연결 부분을 빼고, OpenAI 호환 API(vLLM, Ollama 등)로 쓰는 부분만 남겼습니다 (업무 PC 와 Linux 터미널 두 설정).
- 들어 있는 것: pi 0.87.1 (npm 없이 실행), 위험한 명령 확인, 작업 모드(`/plan`, `/mode`), 되돌리기(`/undo`), 기억하기(`/remember`),
  `@파일`, 작업 끝 알림, `/kit`·`/doctor`, LLM 위키(`/wiki`), 기본 명령 6개·기본 스킬 8개(hook 만들기 포함), VS Code 터미널의 fullscreen 화면.
- 할 일: 설치한 뒤 `~/.pi/agent/models.json` 에 LLM 서버의 주소와 모델 이름, `settings.json` 의 `defaultModel` ([README 2-5](README.md#2-5-llm-연결), [API 연결](docs/API-연결.md)).
