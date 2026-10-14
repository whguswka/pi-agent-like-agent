# 바뀐 점 (CHANGELOG)

판 번호는 `VERSION` 에 있습니다. 새 판으로 바꾸면(`update.sh`) 끝에 그 판의 항목을 보여 줍니다.
판마다 바탕이 된 [pi-agent-like-agent](https://github.com/whguswka/pi-agent-like-agent) 의 판을 함께 적습니다.

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
첫 공개판입니다. pi-agent-like-agent 2026-10-14.2 에 공용 확장 수정 하나(커밋 fcc4324: API 로 쓸 때 위키 쓰기 도구와 `/doctor` 의 설명)를 더한 코드에서
웹 채팅 연결 부분을 빼고, OpenAI 호환 API(vLLM, Ollama 등)로 쓰는 부분만 남겼습니다 (업무 PC 와 Linux 터미널 두 설정).
- 들어 있는 것: pi 0.87.1 (npm 없이 실행), 위험한 명령 확인, 작업 모드(`/plan`, `/mode`), 되돌리기(`/undo`), 기억하기(`/remember`),
  `@파일`, 작업 끝 알림, `/kit`·`/doctor`, LLM 위키(`/wiki`), 기본 명령 6개·기본 스킬 8개(hook 만들기 포함), VS Code 터미널의 fullscreen 화면.
- 할 일: 설치한 뒤 `~/.pi/agent/models.json` 에 LLM 서버의 주소와 모델 이름, `settings.json` 의 `defaultModel` ([README 2-5](README.md#2-5-llm-연결), [API 연결](docs/API-연결.md)).
