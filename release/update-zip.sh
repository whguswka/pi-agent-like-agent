#!/usr/bin/env bash
# 업데이트용 가벼운 zip 만들기: pi 본체(runtime/)를 뺀 zip. 받는 쪽 update.sh 가 깔린 pi 본체를 해시 목록으로 확인한 뒤 그대로 쓴다
#   bash release/update-zip.sh <저장소 폴더> <태그·커밋> [내보낼 폴더 (기본: 지금 폴더)]
#   -> <저장소 이름>-<버전>-update.zip (안의 폴더 이름은 GitHub 의 태그 zip 과 같은 <저장소 이름>-<버전>/)
#  만든 뒤 확인: 폴더 하나, runtime/·api-kit/·release/ 없음, update.sh·install.sh·bin/pi·docs/runtime-SHA256SUMS.txt 있음, 주석에 커밋 번호
#  pi 본체가 앞 버전(앞 태그)과 다르면 알림 (그 버전은 처음에 전체 zip 이 필요)
set -euo pipefail
die() { echo "[update-zip] $*" >&2; exit 1; }
[ $# -ge 2 ] || die "사용법: bash release/update-zip.sh <저장소 폴더> <태그·커밋> [내보낼 폴더]"
REPO="$(cd "$1" && pwd)"
REV="$2"
OUT="$(cd "${3:-.}" && pwd)"
COMMIT="$(git -C "$REPO" rev-parse -q --verify "$REV^{commit}")" || die "태그·커밋을 찾지 못했습니다: $REV"
VER="$(git -C "$REPO" show "$COMMIT:VERSION" | tr -d '\r\n')"
[ -n "$VER" ] || die "VERSION 이 비었습니다 ($REV)"
URL="$(git -C "$REPO" remote get-url origin 2>/dev/null || echo "$REPO")"
NAME="$(basename "${URL%.git}")"
Z="$OUT/$NAME-$VER-update.zip"
P="$NAME-$VER/"
rm -f "$Z"
git -C "$REPO" archive --format=zip --prefix="$P" -o "$Z" "$COMMIT" -- . ':(exclude)runtime'

# 확인
names="$(unzip -Z1 "$Z")"
bad=0
fail() { echo "[update-zip] 확인 실패: $*" >&2; bad=1; }
[ -z "$(printf '%s\n' "$names" | grep -v "^$P" || true)" ] || fail "폴더가 하나가 아님 (모두 $P 아래여야 함)"
for p in runtime api-kit release; do
  printf '%s\n' "$names" | grep -q "^$P$p/" && fail "$p/ 이 들어 있음"
done
for f in update.sh install.sh bin/pi VERSION CHANGELOG.md docs/runtime-SHA256SUMS.txt; do
  printf '%s\n' "$names" | grep -qx "$P$f" || fail "$f 이 없음"
done
[ "$(unzip -z "$Z" | tail -1 | tr -d '\r\n')" = "$COMMIT" ] || fail "zip 주석이 커밋 번호($COMMIT)가 아님"
[ "$bad" = 0 ] || { rm -f "$Z"; die "멈춤: 위 확인을 고친 뒤 다시"; }

files="$(printf '%s\n' "$names" | grep -vc '/$')"
size="$(wc -c < "$Z" | tr -d ' ')"
echo "[update-zip] $Z ($((size / 1024))KB, 파일 ${files}개, 버전 $VER, 커밋 ${COMMIT:0:7})"
prev="$(git -C "$REPO" describe --tags --abbrev=0 "$COMMIT^" 2>/dev/null || true)"
if [ -n "$prev" ] && ! git -C "$REPO" diff --quiet "$prev" "$COMMIT" -- runtime; then
  echo "[update-zip] 참고: pi 본체(runtime/)가 앞 버전($prev)과 다릅니다. 이 버전으로 처음 바꿀 때는 전체 zip 이 필요합니다 (Release 본문에도 적힘)"
fi
