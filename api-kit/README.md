# api-kit: API 전용 판 만들기

이 저장소에서 웹 채팅 연결 부분(`copilot/`, PC 설정, 실행기의 자동 시작)을 빼고 OpenAI 호환 API(vLLM 등)로 쓰는 부분만 Kubeflow 노트북(code-server) 전용으로 남긴 판,
[pi-agent-like-agent-api](https://github.com/whguswka/pi-agent-like-agent-api) 를 만드는 도구입니다. `.gitattributes` 의 `export-ignore` 로 이 저장소의 zip 에는 들어가지 않습니다.
기능과 문서는 이 저장소에서만 고치고, API 판은 여기서 만들어 냅니다 (API 저장소를 직접 고치지 않음).

| 파일 | 내용 |
|---|---|
| `make-api-kit.sh` | 만들기: `bash api-kit/make-api-kit.sh <내보낼 폴더> [커밋·태그]` |
| `remove.txt` | 빼는 경로 |
| `assemble.mjs`, `fragments/` | 문서 한 벌 쓰기: 이 저장소 문서의 표시(아래)를 처리해 API 판 글로 바꿈. `fragments/<문서 경로>` 에 API 판에만 들어갈 글(조각) |
| `marks.sha256` | 표시로 짝을 이룬 글(`api:바꾸기` 블록 안, `api=` 줄)의 이 저장소 쪽 sha256. 바뀌면 만들기가 멈춤 |
| `overlay/` | 통째로 바꿔 넣는 파일 (CHANGELOG, VERSION, `docs/API-연결.md`·`빠른시작.md`·`설치.md`, `install.sh`, `update.sh`, `check-node.sh`, `bin/pi`, `bin/kit-config.sh`). API 판의 판 번호는 `overlay/VERSION` (원래 키트와 따로) |
| `overlay.sha256` | overlay 가 대신하는 원래 파일의 sha256. 원래 파일이 바뀌면 만들기가 멈춤 |
| `edits.json` | 몇 줄만 바꾸는 파일 (스킬 등). 바꿀 글이 정한 횟수만큼 없으면 멈춤 |
| `apply-edits.mjs`, `check.mjs` | 글 바꾸기, 점검 (남은 연결 내용, 남은 표시, 확장 목록, CHANGELOG 항목, 문서 링크) |
| `changelog-draft.mjs` | API 판 CHANGELOG 초안: 원래 키트 CHANGELOG 의 `[공통]` 항목을 모음 |
| `test-assemble.mjs`, `test-changelog.mjs` | 위 두 도구의 시험 (`node api-kit/test-assemble.mjs`) |

공용 확장(`profiles/common`)은 두 판이 같은 파일을 씁니다. API 판에서 달라야 하는 글은 확장 안에서 `isBridge()` 로 가릅니다 (`kit.ts`, `wiki.ts`).

## 문서 한 벌 쓰기 (README.md, docs/수동-작업-절차.md, docs/반입-검토-요청서.md)
이 세 문서는 두 판의 글을 이 저장소의 파일 하나에 씁니다. 두 판이 같은 글은 그대로 쓰면 API 판에도 들어가고, 다른 곳에만 HTML 주석 표시를 답니다 (GitHub 화면에는 안 보임).

| 쓰고 싶은 것 | 적는 법 |
|---|---|
| 이 판(Copilot·PC)에만 있는 글 | 여러 줄: `<!-- api:빼기 -->` 줄과 `<!-- /api -->` 줄 사이. 한 줄: 줄 끝에 `<!-- api= -->` |
| 두 판이 다른 한 줄 | 줄 끝에 `<!-- api= API 판 글 -->` |
| 두 판이 다른 여러 줄, 제목 | `<!-- api:바꾸기 이름 -->` 와 `<!-- /api -->` 사이에 이 판의 글, `fragments/<문서>` 의 `<!-- 조각: 이름 -->` 아래에 API 판 글 |
| API 판에만 있는 글 | 그 자리에 `<!-- api:넣기 이름 -->` 한 줄, 글은 조각으로 |

- `api=` 뒤의 글에서 표의 칸 나눔은 `\|`, 여러 줄은 `\n` 으로 적습니다. 앞뒤 빈칸은 하나씩만 뗍니다 (들여 쓴 줄이면 빈칸을 하나 더).
- 표시 줄은 코드 블록 밖에, 표의 가운데가 아닌 곳에 둡니다 (표 끝 바로 아래의 `api:넣기` 는 API 판에서 표에 줄을 더함). 제목 줄에는 `api=` 를 쓰지 않습니다.
- 목록 가운데의 표시 줄은 앞에 빈칸을 둡니다 (`-` 목록 2칸, `1.` 목록 3칸). 그래야 이 판의 화면에서 목록이 끊기지 않습니다.
- 표시를 지키지 않으면 `assemble.mjs` 가 멈추고 까닭을 알려 줍니다. 자세한 규칙은 `assemble.mjs` 맨 위.
- README 의 장 번호(1~10)는 두 판이 같습니다. 이 판에만 있는 내용은 절(2-5~2-7, 3-3, 4-1, 4-2, 9-1)로 두었으니, 장을 더할 때도 두 판의 번호가 같게 둡니다.
- `docs/빠른시작.md`·`docs/설치.md` 는 바뀌는 일이 적고(35판 중 4~5번) 빠른시작은 두 판의 장 번호가 하나씩 어긋나 있어서, 지금처럼 `overlay/` 에 API 판 전체를 둡니다.
- 이 저장소의 링크 점검(주석 안의 API 판 글은 보지 않음): `node api-kit/check.mjs --links .`

## 새 판을 낼 때
1. 이 저장소의 판을 낼 때 CHANGELOG 의 항목 앞에 `[공통]`(API 판에도 들어감) 또는 `[Copilot]`(이 판만)을 붙입니다. 판을 낸 뒤(VERSION, CHANGELOG, 태그) 만들어 봅니다:
   ```bash
   bash api-kit/make-api-kit.sh /tmp/api-try
   ```
2. 멈추면 알려 주는 대로 고칩니다. 둘 다 고친 뒤에는 `bash api-kit/make-api-kit.sh --update-sha` (지금 커밋 기준으로 `overlay.sha256`·`marks.sha256` 을 다시 적음).
   - `바뀜: <파일> (원래 키트의 이 파일이 ...)`: 원래 파일의 바뀐 내용(`git diff <커밋> HEAD -- <파일>`)을 `overlay/` 의 그 파일에 옮깁니다.
   - `바뀜: <문서>:<줄> api= 줄` 또는 `'바꾸기 <이름>' 블록`: 이 판 쪽 글이 바뀐 곳입니다. API 판 글(줄 끝 `api=` 뒤, 또는 `fragments/` 의 그 조각)도 고쳐야 하는지 보고 고칩니다.
     두 판이 같은 글(표시 없는 글)은 고치지 않아도 API 판에 들어갑니다.
   - `문서 표시 오류`: 알려 준 줄의 표시를 고칩니다.
   - `글 바꾸기 실패`: `edits.json` 의 그 항목을 새 글에 맞춥니다.
   - `점검 실패`: 새로 생긴 연결 내용(두 판이 같은 글에 Copilot 등이 들어간 것도)을 표시나 `edits.json`·`overlay/` 로 고치고, 새 확장이면 내용을 본 뒤 `check.mjs` 의 `SHARED_EXT` 와 overlay 의 `install.sh`·`update.sh` 의 `KIT_EXT` 에 더합니다.
3. API 판 `CHANGELOG.md`(overlay)에 그 판의 항목을 씁니다 (`update.sh` 가 끝에 보여 줌). 초안: `node api-kit/changelog-draft.mjs` (API 판 맨 위 항목의 '바탕' 판 뒤로 나온 `[공통]` 항목). `overlay/VERSION` 도 올립니다.
4. `api-kit/` 을 커밋하고, API 저장소의 작업 폴더로 내보내 커밋·태그·push 합니다:
   ```bash
   bash api-kit/make-api-kit.sh ../pi-agent-like-agent-api
   cd ../pi-agent-like-agent-api && git add -A && git commit -m "<판>: ..." && git tag -a v<판> -m <판> && git push origin main && git push origin v<판>
   ```
- API 판의 `update.sh` 는 zip 안에 `docs/API-연결.md` 가 있어야 그 판의 zip 으로 봅니다 (원래 키트의 zip 을 거절). 이 파일 이름은 바꾸지 마세요.
- 시험: 내보낸 폴더에서 `node tests/<이름>.mjs`, 임시 HOME 에 `install.sh`, `update.sh --force` (zip 은 `git archive` 로 만들어야 GitHub 의 zip 과 같음: 한글 파일 이름).
- 커밋하지 않은 변경으로 만들어 보려면 `bash api-kit/make-api-kit.sh /tmp/api-try "$(git stash create)"` (api-kit/ 은 늘 작업 폴더의 것을 씀).
