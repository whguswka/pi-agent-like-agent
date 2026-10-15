# release: 판 내기 도구

판(태그)마다 GitHub Release 페이지를 만들고, 업데이트용 가벼운 zip 을 올립니다. `.gitattributes` 의 `export-ignore` 로 이 저장소의 zip 에는 들어가지 않습니다.

| 파일 | 내용 |
|---|---|
| `update-zip.sh` | 업데이트용 zip 만들기: `bash release/update-zip.sh <저장소 폴더> <태그·커밋> [내보낼 폴더]` → `<저장소 이름>-<판>-update.zip` |
| `github-release.mjs` | Release 만들기(있으면 고치기)와 파일 올리기: `node release/github-release.mjs <저장소 폴더> <태그> [올릴 파일...]` |

**업데이트용 zip:** 전체 zip 에서 pi 본체(`runtime/`, 2.8MB·835개 파일)를 뺀 것입니다 (약 0.4MB). 받는 쪽 `update.sh` 가 지금 깔린 pi 본체를
새 판의 해시 목록(`docs/runtime-SHA256SUMS.txt`)과 맞춰 본 뒤 그대로 쓰고, 다르면 아무것도 바꾸지 않고 전체 zip 이 필요하다고 멈춥니다.
키트 파일은 모두 들어 있으므로 몇 판을 건너뛰어도 됩니다. 크기는 판이 쌓여도 늘지 않습니다.
- `update-zip.sh` 는 만든 zip 을 확인합니다: 폴더 하나, `runtime/`·`api-kit/`·`release/` 없음, `update.sh`·`install.sh`·`bin/pi`·해시 목록 있음, 주석에 커밋 번호.
- pi 본체가 앞 태그와 다르면 알리고, Release 본문에도 "이 판으로 처음 바꿀 때는 전체 zip" 을 적습니다.

**Release 본문:** 받을 파일 안내 + 그 태그의 `CHANGELOG.md` 의 `## <판>` 항목. 제목은 `판 <판>`.
토큰은 `git credential fill`(GCM_INTERACTIVE=never)로 얻어 `Authorization` 머리글로만 씁니다 (화면·인자에 쓰지 않음).

**판을 낼 때 (태그를 push 한 뒤):**
```bash
bash release/update-zip.sh . v<판> /tmp
node release/github-release.mjs . v<판> /tmp/pi-agent-like-agent-<판>-update.zip
```
API 판: API 저장소의 태그를 push 한 뒤, 저장소 폴더만 바꿔 같은 두 줄 (`../pi-agent-like-agent-api`, 파일 이름은 `pi-agent-like-agent-api-<판>-update.zip`).
