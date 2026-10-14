# 바뀐 점 (CHANGELOG)

판 번호는 `VERSION` 에 있습니다. 새 판으로 바꾸면(`update.sh`) 끝에 그 판의 항목을 보여 줍니다.
이 판의 바탕인 [pi-agent-like-agent](https://github.com/whguswka/pi-agent-like-agent) 와 판 번호를 맞춥니다.

## 2026-10-14.2
첫 공개판입니다. pi-agent-like-agent 2026-10-14.2 에 공용 확장 수정 하나(커밋 fcc4324: API 로 쓸 때 위키 쓰기 도구와 `/doctor` 의 설명)를 더한 코드에서
웹 채팅 연결 부분을 빼고, OpenAI 호환 API(vLLM, Ollama 등)로 쓰는 부분만 남겼습니다.
- 설치: `bash install.sh pc` (업무 PC 의 Git Bash) 또는 `bash install.sh jupyter` (Linux 터미널: Kubeflow JupyterLab 등). LLM 은 두 설정 모두 `~/.pi/agent/models.json` 에 적은 API.
- 들어 있는 것: pi 0.87.1 (npm 없이 실행, Node 20.15 이상·VS Code 내장 Node 지원), 위험한 명령 확인, 작업 모드(`/plan`, `/mode`), 되돌리기(`/undo`), 기억하기(`/remember`),
  `@파일`, 작업 끝 알림, `/kit`·`/doctor`, LLM 위키(`/wiki`), 기본 명령 6개·기본 스킬 8개(hook 만들기 포함), VS Code 터미널의 fullscreen 화면.
- 할 일: 설치한 뒤 `~/.pi/agent/models.json` 에 LLM 서버의 주소와 모델 이름, `settings.json` 의 `defaultModel` ([README 2-4](README.md#2-4-llm-연결), [API 연결](docs/API-연결.md)).
