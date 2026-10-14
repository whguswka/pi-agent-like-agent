# api-kit: API 전용 판 만들기

이 저장소에서 웹 채팅 연결 부분(`copilot/`, PC 설정의 연결용 확장, 실행기의 자동 시작)을 빼고 OpenAI 호환 API(vLLM 등)로 쓰는 부분만 남긴 판,
[pi-agent-like-agent-api](https://github.com/whguswka/pi-agent-like-agent-api) 를 만드는 도구입니다. `.gitattributes` 의 `export-ignore` 로 이 저장소의 zip 에는 들어가지 않습니다.

| 파일 | 내용 |
|---|---|
| `make-api-kit.sh` | 만들기: `bash api-kit/make-api-kit.sh <내보낼 폴더> [커밋·태그]` |
| `remove.txt` | 빼는 경로 |
| `overlay/` | 통째로 바꿔 넣는 파일 (README, CHANGELOG, docs, `install.sh`, `update.sh`, `bin/pi`, `bin/kit-config.sh`, PC 설정 템플릿) |
| `overlay.sha256` | overlay 가 대신하는 원래 파일의 sha256. 원래 파일이 바뀌면 만들기가 멈춤 |
| `edits.json` | 몇 줄만 바꾸는 파일 (스킬 등). 바꿀 글이 정한 횟수만큼 없으면 멈춤 |
| `apply-edits.mjs`, `check.mjs` | 글 바꾸기, 점검 (남은 연결 내용, 확장 목록, CHANGELOG 항목, 문서 링크) |

공용 확장(`profiles/common`)은 두 판이 같은 파일을 씁니다. API 판에서 달라야 하는 글은 확장 안에서 `isBridge()` 로 가릅니다 (`kit.ts`, `wiki.ts`).

## 새 판을 낼 때
1. 이 저장소의 판을 낸 뒤(VERSION, CHANGELOG, 태그) 만들어 봅니다:
   ```bash
   bash api-kit/make-api-kit.sh /tmp/api-try
   ```
2. 멈추면 알려 주는 대로 고칩니다.
   - `바뀜: <파일>`: 원래 파일의 바뀐 내용(`git diff <커밋> HEAD -- <파일>`)을 `overlay/` 의 그 파일에 옮기고, `bash api-kit/make-api-kit.sh --update-sha`.
   - `글 바꾸기 실패`: `edits.json` 의 그 항목을 새 글에 맞춥니다.
   - `점검 실패`: 새로 생긴 연결 내용을 `edits.json` 이나 `overlay/` 로 고치고, 새 확장이면 내용을 본 뒤 `check.mjs` 의 `SHARED_EXT` 와 overlay 의 `install.sh`·`update.sh` 의 `KIT_EXT` 에 더합니다.
   - API 판 `CHANGELOG.md`(overlay)에 그 판의 항목을 씁니다 (`update.sh` 가 끝에 보여 줌).
3. `api-kit/` 을 커밋하고, API 저장소의 작업 폴더로 내보내 커밋·태그·push 합니다:
   ```bash
   bash api-kit/make-api-kit.sh ../pi-agent-like-agent-api
   cd ../pi-agent-like-agent-api && git add -A && git commit -m "<판>: ..." && git tag -a v<판> -m <판> && git push origin main && git push origin v<판>
   ```
- API 판의 `update.sh` 는 zip 안에 `docs/API-연결.md` 가 있어야 그 판의 zip 으로 봅니다 (원래 키트의 zip 을 거절). 이 파일 이름은 바꾸지 마세요.
- 시험: 내보낸 폴더에서 `node tests/<이름>.mjs`, 임시 HOME 에 `install.sh pc`·`jupyter`, `update.sh --force` (zip 은 `git archive` 로 만들어야 GitHub 의 zip 과 같음: 한글 파일 이름).
