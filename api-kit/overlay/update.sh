#!/usr/bin/env bash
# 새 판으로 바꾸기: bash ~/tools/pi/update.sh <받은 zip 파일> [pc|jupyter] [--force]
#  1) zip 이 이 저장소인지 확인하고 옆의 임시 폴더에 풂
#  2) 지금 폴더를 <폴더>.old 로 바꾸고 새 판을 그 자리에 둠
#  3) install.sh 로 설정 반영 (내 설정·지침·스킬·세션 기록은 그대로)
#  4) 지금 판 -> 새 판, 이 판에서 바뀐 점을 보여 줌
# 설정 이름(pc|jupyter)을 생략하면 Windows(Git Bash)는 pc, 그 밖(Linux)은 jupyter.
# 같은 판이면 멈춘다 (이전 판 폴더를 덮지 않게). 그래도 다시 설치하려면 --force. 예전 판 zip 을 주면 그 판으로 되돌린다.
#
# 새 zip 에서 이 파일만 꺼내 pi 폴더 옆(~/tools/update.sh)에 두고 실행해도 된다
#   unzip -o -j -q "$Z" '*/update.sh' -d ~/tools && bash ~/tools/update.sh "$Z"
#   -> 옆의 pi 폴더(~/tools/pi)를 바꾸고, 끝나면 꺼낸 update.sh 는 지운다

# 이 스크립트도 바꿀 폴더 안에 있으므로 임시 복사본으로 다시 실행한다
# (Windows 는 안의 파일이 열려 있는 폴더의 이름을 바꾸지 못함. bash 는 스크립트를 읽는 동안 파일을 열어 둔다)
if [ -z "$PI_UPDATE_SELF" ]; then
  _src="$(readlink -f "${BASH_SOURCE[0]}")"
  _home="$(dirname "$_src")" _boot=
  [ -f "$_home/install.sh" ] || { _boot="$_src"; _home="$_home/pi"; }  # pi 폴더 옆에 꺼내 둔 update.sh
  _tmp="$(mktemp "${TMPDIR:-/tmp}/pi-update.XXXXXX")" && cp "$_src" "$_tmp" || { echo "[update] 임시 파일을 만들지 못했습니다" >&2; exit 1; }
  PI_UPDATE_SELF="$_tmp" PI_UPDATE_HOME="$_home" PI_UPDATE_BOOT="$_boot" exec bash "$_tmp" "$@"
fi
PI_HOME="$PI_UPDATE_HOME"
WORK=
cleanup() { [ -n "$WORK" ] && rm -rf "$WORK"; rm -f "$PI_UPDATE_SELF"; }
trap cleanup EXIT
die() { echo "[update] $*" >&2; exit 1; }

ZIP= PROFILE= FORCE=
for _a in "$@"; do
  case "$_a" in
    --force) FORCE=1 ;;
    pc|jupyter) PROFILE="$_a" ;;
    *) [ -z "$ZIP" ] || die "알 수 없는 인자: $_a"; ZIP="$_a" ;;
  esac
done
[ -n "$ZIP" ] || die "사용법: bash $PI_HOME/update.sh <받은 zip 파일> [pc|jupyter] [--force]"
[ -f "$ZIP" ] || die "zip 파일이 없습니다: $ZIP (받은 파일 이름이 다르면 그 이름으로. 예: \"pi-agent-like-agent-api-main (1).zip\")"
ZIP="$(cd "$(dirname "$ZIP")" && pwd)/$(basename "$ZIP")"
[ -f "$PI_HOME/install.sh" ] && [ -f "$PI_HOME/bin/pi" ] \
  || die "바꿀 pi 폴더가 없습니다: $PI_HOME (update.sh 를 pi 폴더 안이나 그 옆에 두고 실행하세요)"
# 지금 폴더가 바꿀 폴더 안이면 이름을 바꿀 수 없다 (Windows 는 대소문자를 구분하지 않으므로 소문자로 비교)
case "${PWD,,}/" in "${PI_HOME,,}"/*) die "지금 폴더($PWD)가 바꿀 폴더 안에 있습니다. 다른 폴더에서 실행하세요 (예: cd ~)" ;; esac

# 도우미 함수(Python 찾기, Windows 경로): 지금 판에 있으면 그것, 없으면 zip 을 푼 뒤 새 판의 것
if [ -f "$PI_HOME/bin/kit-config.sh" ]; then
  . "$PI_HOME/bin/find-node.sh"
  . "$PI_HOME/bin/kit-config.sh"
fi
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
if [ -z "$PROFILE" ]; then
  case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) PROFILE=pc ;; *) PROFILE=jupyter ;; esac
fi
PY=
command -v pi_find_python >/dev/null 2>&1 && { PY="$(pi_find_python 2>/dev/null)" || PY=; }

# 1) 풀기 + 확인
WORK="$(dirname "$PI_HOME")/.$(basename "$PI_HOME")-update-$$"
rm -rf "$WORK"
mkdir -p "$WORK" || die "임시 폴더를 만들지 못했습니다: $WORK"
if command -v unzip >/dev/null 2>&1; then
  unzip -q "$ZIP" -d "$WORK" || die "zip 을 풀지 못했습니다: $ZIP"
elif [ -n "$PY" ]; then
  "$PY" -m zipfile -e "$(pi_native_path "$ZIP")" "$(pi_native_path "$WORK")" || die "zip 을 풀지 못했습니다: $ZIP"
else
  die "zip 을 풀 프로그램(unzip 또는 Python)이 없습니다"
fi
TOP=
n=0
for d in "$WORK"/*/; do [ -d "$d" ] && { TOP="${d%/}"; n=$((n + 1)); }; done
[ "$n" = 1 ] && [ -f "$TOP/install.sh" ] && [ -f "$TOP/bin/pi" ] && [ -d "$TOP/runtime" ] && [ -f "$TOP/docs/API-연결.md" ] \
  || die "pi-agent-like-agent-api 저장소의 zip 이 아닙니다: $ZIP"
if ! command -v pi_find_python >/dev/null 2>&1 && [ -f "$TOP/bin/kit-config.sh" ]; then
  . "$TOP/bin/find-node.sh"
  . "$TOP/bin/kit-config.sh"
  PY="$(pi_find_python 2>/dev/null)" || PY=
fi
OLD_VER="$(tr -d '\r\n' < "$PI_HOME/VERSION" 2>/dev/null)"
NEW_VER="$(tr -d '\r\n' < "$TOP/VERSION" 2>/dev/null)"
COMMIT=  # GitHub 에서 받은 zip 은 주석에 커밋 번호가 들어 있음
[ -n "$PY" ] && COMMIT="$("$PY" -c "import sys, zipfile; print(zipfile.ZipFile(sys.argv[1]).comment.decode('ascii', 'replace')[:7])" \
  "$(pi_native_path "$ZIP")" 2>/dev/null | tr -d '\r\n')"
OLD_COMMIT="$(tr -d '\r\n' < "$PI_HOME/.commit" 2>/dev/null)"
echo "[update] 지금 판: ${OLD_VER:-(판 번호 없음)}  ->  새 판: ${NEW_VER:-(판 번호 없음)}${COMMIT:+ (커밋 $COMMIT)}"
# 같은 판을 다시 깔면 하나뿐인 이전 판 폴더(.old)가 지금 판의 복사본으로 바뀌므로 멈춘다
if [ -z "$FORCE" ] && [ -n "$OLD_VER" ] && [ "$OLD_VER" = "$NEW_VER" ] \
   && { [ -z "$COMMIT" ] || [ -z "$OLD_COMMIT" ] || [ "$COMMIT" = "$OLD_COMMIT" ]; }; then
  die "이미 같은 판($NEW_VER)입니다. 받은 zip 이 새 판인지 확인하세요 (그래도 다시 설치하려면 끝에 --force)"
fi
if [ -n "$OLD_VER" ] && [ -n "$NEW_VER" ] && [ "$OLD_VER" != "$NEW_VER" ] \
   && [ "$(printf '%s\n%s\n' "$OLD_VER" "$NEW_VER" | sort -V | tail -1)" = "$OLD_VER" ]; then
  echo "[update] 참고: 지금 판보다 예전 판입니다 (이전 판으로 되돌리기)"
fi

# 2) 폴더 바꾸기 (실패하면 아무것도 바꾸지 않은 상태로 멈춤)
OLD="$PI_HOME.old"
rm -rf "$OLD" 2>/dev/null
[ -e "$OLD" ] && die "지난번 이전 판 폴더($OLD)를 지우지 못했습니다. 그 폴더를 연 창을 닫고 다시 실행하세요. 지금 판은 그대로입니다"
mv "$PI_HOME" "$OLD" 2>/dev/null \
  || die "지금 폴더의 이름을 바꾸지 못했습니다 (사용 중). pi, 그 폴더를 연 탐색기·터미널·편집기를 닫고 다시 실행하세요. 지금 판은 그대로입니다"
if ! mv "$TOP" "$PI_HOME"; then
  mv "$OLD" "$PI_HOME" 2>/dev/null
  die "새 판을 옮기지 못해 원래대로 되돌렸습니다"
fi
[ -n "$COMMIT" ] && echo "$COMMIT" > "$PI_HOME/.commit"

# 3) 설정 반영
echo "[update] 설정 반영: bash $PI_HOME/install.sh $PROFILE"
echo
bash "$PI_HOME/install.sh" "$PROFILE" || echo "[update] install.sh 가 실패했습니다. 위 메시지를 확인하세요 (이전 판: $OLD)" >&2
# 예전 판으로 되돌린 경우 그 판의 install.sh 는 새 판에만 있던 확장을 치우지 못하므로 여기서도 (키트가 낸 적 있는 이름만, 옮겨 둠)
KIT_EXT="guard.ts notify.ts kit.ts undo.ts modes.ts memory.ts files.ts wiki.ts lib/shell.ts lib/relay.ts lib/paths.ts"
for f in $KIT_EXT; do
  [ -e "$AGENT_DIR/extensions/$f" ] || continue
  { [ -e "$PI_HOME/profiles/common/agent-template/extensions/$f" ] || [ -e "$PI_HOME/profiles/$PROFILE/agent-template/extensions/$f" ]; } && continue
  mkdir -p "$(dirname "$AGENT_DIR/extensions.removed/$f")" && mv -f "$AGENT_DIR/extensions/$f" "$AGENT_DIR/extensions.removed/$f" \
    && echo "[update] 치움: $AGENT_DIR/extensions/$f (이 판에는 없는 확장 -> extensions.removed/)"
done
rmdir "$AGENT_DIR/extensions/lib" 2>/dev/null
echo
[ -n "$PI_UPDATE_BOOT" ] && rm -f "$PI_UPDATE_BOOT"  # 꺼내 둔 update.sh
# 4) 이 판에서 바뀐 점과 할 일 (CHANGELOG.md 의 '## <새 판>' 항목. 사내망에서는 GitHub 을 볼 수 없으므로 여기서 보여 줌)
if [ -n "$NEW_VER" ] && [ -f "$PI_HOME/CHANGELOG.md" ]; then
  notes="$(awk -v v="$NEW_VER" '$1 == "##" && $2 == v {on = 1; next} on && /^## / {exit} on && NF' "$PI_HOME/CHANGELOG.md")"
  if [ -n "$notes" ]; then
    echo "[update] 이 판에서 바뀐 점 (전체: $PI_HOME/CHANGELOG.md)"
    printf '%s\n' "$notes" | sed 's/^/  /'
    echo
  fi
fi
echo "[update] 완료: ${OLD_VER:-예전 판} -> ${NEW_VER:-새 판}. 이전 판은 $OLD 에 있습니다 (잘 되면 지워도 됨)"
echo "         pi 를 실행하면 새 판으로 시작합니다. 상태 확인: pi 안에서 /doctor"
