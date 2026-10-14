#!/usr/bin/env bash
# API 전용 판(pi-agent-like-agent-api) 만들기: 이 저장소의 한 커밋에서 웹 채팅 중계 부분을 빼고 API 판 글로 바꾼 폴더를 만든다
#   bash api-kit/make-api-kit.sh <내보낼 폴더> [커밋·태그 (기본 HEAD)]
#    1) <커밋> 을 git archive 로 풂 (api-kit/ 은 .gitattributes 의 export-ignore 라 빠짐)
#    2) remove.txt 의 경로를 지움
#    3) overlay/ 의 파일로 덮어씀. 원래 파일이 overlay.sha256 을 적은 뒤 바뀌었으면 멈춤 (바뀐 내용을 overlay 에 옮긴 뒤 --update-sha)
#    4) edits.json 의 글 바꾸기 (바꿀 글이 정한 횟수만큼 없으면 멈춤)
#    5) check.mjs 로 점검 (남은 중계 내용, 판 번호의 CHANGELOG 항목, 확장 목록)
#    6) <내보낼 폴더> 를 결과로 바꿈 (.git 은 그대로 둠: API 저장소의 작업 폴더에 바로 내보내도 됨)
#   bash api-kit/make-api-kit.sh --update-sha [커밋]   overlay.sha256 을 <커밋> 의 원래 파일로 다시 적음
# api-kit/ 의 파일(overlay, edits, 점검)은 작업 폴더의 것을 쓴다. 내보낸 뒤 올리기 전에 api-kit/ 도 커밋할 것
set -euo pipefail
KIT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
REPO="$(cd "$KIT/.." && pwd)"
die() { echo "[api-kit] $*" >&2; exit 1; }
[ -d "$REPO/.git" ] || die "api-kit/ 이 저장소 맨 위에 있지 않습니다: $REPO"
NODE="${NODE:-node}"
command -v "$NODE" >/dev/null 2>&1 || die "node 를 찾지 못했습니다 (NODE=/경로/node 로 지정)"

# overlay 의 파일 목록 (overlay/ 기준 경로)
overlay_files() { (cd "$KIT/overlay" && find . -type f | sed 's#^\./##' | LC_ALL=C sort); }
blob_sha() { git -C "$REPO" cat-file -e "$1:$2" 2>/dev/null && git -C "$REPO" show "$1:$2" | sha256sum | cut -d' ' -f1; }

if [ "${1:-}" = --update-sha ]; then
  REV="$(git -C "$REPO" rev-parse --verify "${2:-HEAD}^{commit}")" || die "커밋을 찾지 못했습니다: ${2:-HEAD}"
  {
    echo "# overlay/ 가 대신하는 원래 파일의 sha256 (커밋 $REV). 원래 키트에 없는 새 파일은 적지 않음"
    overlay_files | while IFS= read -r f; do
      s="$(blob_sha "$REV" "$f")" || continue
      [ -n "$s" ] && printf '%s  %s\n' "$s" "$f"
    done
  } > "$KIT/overlay.sha256"
  echo "[api-kit] overlay.sha256 을 다시 적었습니다 ($(grep -vc '^#' "$KIT/overlay.sha256") 개, 커밋 ${REV:0:7})"
  exit 0
fi

OUT="${1:-}"
[ -n "$OUT" ] || die "사용법: bash api-kit/make-api-kit.sh <내보낼 폴더> [커밋·태그]"
REV="$(git -C "$REPO" rev-parse --verify "${2:-HEAD}^{commit}")" || die "커밋을 찾지 못했습니다: ${2:-HEAD}"
case "$(readlink -f "$OUT" 2>/dev/null || echo "$OUT")/" in "$REPO"/*) die "내보낼 폴더가 이 저장소 안입니다: $OUT" ;; esac
# 비어 있지 않은 폴더는 전에 내보낸 폴더일 때만 덮는다 (.git 말고 다른 것이 있으면 VERSION·bin/pi 가 있어야 함)
if [ -d "$OUT" ] && [ -n "$(find "$OUT" -mindepth 1 -maxdepth 1 ! -name .git -print -quit)" ] \
   && ! { [ -f "$OUT/VERSION" ] && [ -f "$OUT/bin/pi" ]; }; then
  die "내보낼 폴더가 비어 있지 않고 전에 내보낸 폴더도 아닙니다: $OUT"
fi
[ -z "$(git -C "$REPO" status --porcelain -- api-kit)" ] || echo "[api-kit] 참고: api-kit/ 에 커밋하지 않은 변경이 있습니다 (작업 폴더의 것을 씀)"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/api-kit.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
T="$TMP/tree"
mkdir -p "$T"
# 1) 풀기
git -C "$REPO" archive --format=tar "$REV" | tar -x -C "$T"
# 2) 지우기
while IFS= read -r p || [ -n "$p" ]; do
  p="${p%$'\r'}"
  case "$p" in ""|"#"*) continue ;; esac
  if [ -e "$T/$p" ]; then rm -rf "$T/${p%/}"; else echo "[api-kit] 참고: 이 커밋에는 없는 경로 (remove.txt 에서 빼도 됨): $p"; fi
done < "$KIT/remove.txt"
# 3) 덮어쓰기 (그 전에 원래 파일이 바뀌었는지)
drift=0
if [ -f "$KIT/overlay.sha256" ]; then
  while IFS= read -r line; do
    case "$line" in ""|"#"*) continue ;; esac
    want="${line%%  *}" f="${line#*  }"
    if [ -f "$T/$f" ]; then got="$(sha256sum "$T/$f" | cut -d' ' -f1)"; else got="(지워짐)"; fi
    if [ "$got" != "$want" ]; then
      echo "[api-kit] 바뀜: $f (원래 키트의 이 파일이 overlay 를 만든 뒤 바뀌었습니다)" >&2
      drift=$((drift + 1))
    fi
  done < "$KIT/overlay.sha256"
fi
if [ "$drift" -gt 0 ]; then
  base="$(sed -n '1s/.*커밋 \([0-9a-f]*\)).*/\1/p' "$KIT/overlay.sha256")"
  echo "[api-kit] 바뀐 내용: git diff ${base:0:7} ${REV:0:7} -- <위 파일>  을 보고 overlay/ 에 옮긴 뒤 --update-sha ${REV:0:7}" >&2
  [ -n "${API_KIT_ALLOW_DRIFT:-}" ] || die "멈춤: overlay 가 대신하는 원래 파일 ${drift}개가 바뀌었습니다 (그래도 만들려면 API_KIT_ALLOW_DRIFT=1)"
fi
n=0
while IFS= read -r f; do
  mkdir -p "$(dirname "$T/$f")"
  cp "$KIT/overlay/$f" "$T/$f"
  n=$((n + 1))
done < <(overlay_files)
# 셸 스크립트는 실행 권한 (zip 으로 받으면 사라지지만 git 저장소에는 남음)
chmod +x "$T/bin/pi" "$T/install.sh" "$T/update.sh" "$T/check-node.sh" 2>/dev/null || true
# 4) 글 바꾸기
"$NODE" "$KIT/apply-edits.mjs" "$T" "$KIT/edits.json"
# 5) 점검
"$NODE" "$KIT/check.mjs" "$T"
# 6) 내보내기 (.git 은 그대로)
mkdir -p "$OUT"
find "$OUT" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a "$T/." "$OUT/"
echo "[api-kit] 완료: $OUT (판 $(tr -d '\r\n' < "$OUT/VERSION"), 원래 키트 커밋 ${REV:0:7}, 덮어쓴 파일 ${n}개, 파일 $(find "$OUT" -path "$OUT/.git" -prune -o -type f -print | wc -l)개)"
