# release: 릴리스 도구

버전(태그)마다 GitHub Release 페이지를 만들고, 업데이트용 가벼운 zip 을 올립니다. `.gitattributes` 의 `export-ignore` 로 이 저장소의 zip 에는 들어가지 않습니다.

| 파일 | 내용 |
|---|---|
| `update-zip.sh` | 업데이트용 zip 만들기: `bash release/update-zip.sh <저장소 폴더> <태그·커밋> [내보낼 폴더]` → `<저장소 이름>-<버전>-update.zip` |
| `github-release.mjs` | Release 만들기(있으면 고치기)와 파일 올리기: `node release/github-release.mjs [--notes <커밋>] <저장소 폴더> <태그> [올릴 파일...]` |

**업데이트용 zip:** 전체 zip 에서 pi 본체(`runtime/`, 2.8MB·835개 파일)를 뺀 것입니다 (약 0.4MB). 받는 쪽 `update.sh` 가 지금 깔린 pi 본체를
새 버전의 해시 목록(`docs/runtime-SHA256SUMS.txt`)과 맞춰 본 뒤 그대로 쓰고, 다르면 아무것도 바꾸지 않고 전체 zip 이 필요하다고 멈춥니다.
키트 파일은 모두 들어 있으므로 몇 버전을 건너뛰어도 됩니다. 크기는 버전이 쌓여도 늘지 않습니다.
- `update-zip.sh` 는 만든 zip 을 확인합니다: 폴더 하나, `runtime/`·`api-kit/`·`release/` 없음, `update.sh`·`install.sh`·`bin/pi`·해시 목록 있음, 주석에 커밋 번호.
- pi 본체가 앞 태그와 다르면 알리고, Release 본문에도 "이 버전으로 처음 바꿀 때는 전체 zip" 을 적습니다.

**Release 본문:** 받을 파일 안내 + 그 태그의 `CHANGELOG.md` 의 `## <버전>` 항목. 제목은 `버전 <버전>`.
태그를 낸 뒤 CHANGELOG 의 글을 고쳤으면 `--notes HEAD` 를 앞에 붙여 지난 Release 의 본문만 다시 씁니다 (올릴 파일 없이. 링크는 그 태그의 파일로 가므로 그 뒤에 바뀐 제목으로 가는 링크가 없는지 봄).
`Latest` 표시는 가장 새 태그의 Release 에만 둡니다 (지난 Release 를 고쳐도 옮겨 가지 않음).
토큰은 `git credential fill`(GCM_INTERACTIVE=never)로 얻어 `Authorization` 머리글로만 씁니다 (화면·인자에 쓰지 않음).

**버전을 낼 때 (태그를 push 한 뒤):**
```bash
bash release/update-zip.sh . v<버전> /tmp
node release/github-release.mjs . v<버전> /tmp/pi-agent-like-agent-<버전>-update.zip
```
API 키트: API 저장소의 태그를 push 한 뒤, 저장소 폴더만 바꿔 같은 두 줄 (`../pi-agent-like-agent-api`, 파일 이름은 `pi-agent-like-agent-api-<버전>-update.zip`).
