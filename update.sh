#!/usr/bin/env bash
# 새 판으로 바꾸기: bash ~/tools/pi/update.sh <받은 zip 파일> [pc|jupyter]
#  1) zip 이 이 저장소인지 확인하고 옆의 임시 폴더에 풂
#  2) 중계 서버를 끔 (다음 pi 실행 때 새 판으로 켜짐)
#  3) 지금 폴더를 <폴더>.old 로 바꾸고 새 판을 그 자리에 둠
#  4) install.sh 로 설정 반영 (내 설정·지침·스킬·세션 기록은 그대로)
#  5) 지금 판 -> 새 판, 확인할 점을 보여 줌
# 설정 이름(pc|jupyter)을 생략하면 ~/.pi/agent/models.json 을 보고 고른다.

# 이 스크립트도 바꿀 폴더 안에 있으므로 임시 복사본으로 다시 실행한다
# (Windows 는 안의 파일이 열려 있는 폴더의 이름을 바꾸지 못함. bash 는 스크립트를 읽는 동안 파일을 열어 둔다)
if [ -z "$PI_UPDATE_SELF" ]; then
  _src="$(readlink -f "${BASH_SOURCE[0]}")"
  _tmp="$(mktemp "${TMPDIR:-/tmp}/pi-update.XXXXXX")" && cp "$_src" "$_tmp" || { echo "[update] 임시 파일을 만들지 못했습니다" >&2; exit 1; }
  PI_UPDATE_SELF="$_tmp" PI_UPDATE_HOME="$(dirname "$_src")" exec bash "$_tmp" "$@"
fi
PI_HOME="$PI_UPDATE_HOME"
WORK=
cleanup() { [ -n "$WORK" ] && rm -rf "$WORK"; rm -f "$PI_UPDATE_SELF"; }
trap cleanup EXIT
die() { echo "[update] $*" >&2; exit 1; }

ZIP="${1:-}"
PROFILE="${2:-}"
[ -n "$ZIP" ] || die "사용법: bash $PI_HOME/update.sh <받은 zip 파일> [pc|jupyter]"
[ -f "$ZIP" ] || die "zip 파일이 없습니다: $ZIP"
ZIP="$(cd "$(dirname "$ZIP")" && pwd)/$(basename "$ZIP")"
# 지금 폴더가 바꿀 폴더 안이면 이름을 바꿀 수 없다 (Windows 는 대소문자를 구분하지 않으므로 소문자로 비교)
case "${PWD,,}/" in "${PI_HOME,,}"/*) die "지금 폴더($PWD)가 바꿀 폴더 안에 있습니다. 다른 폴더에서 실행하세요 (예: cd ~)" ;; esac

. "$PI_HOME/bin/find-node.sh"
. "$PI_HOME/bin/kit-config.sh"  # pi_find_python, pi_native_path
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
if [ -z "$PROFILE" ]; then
  if grep -q "127.0.0.1:8765" "$AGENT_DIR/models.json" 2>/dev/null; then PROFILE=pc; else PROFILE=jupyter; fi
fi
case "$PROFILE" in pc|jupyter) ;; *) die "설정 이름은 pc 또는 jupyter 입니다: $PROFILE" ;; esac
PY="$(pi_find_python 2>/dev/null)" || PY=

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
[ "$n" = 1 ] && [ -f "$TOP/install.sh" ] && [ -f "$TOP/bin/pi" ] && [ -d "$TOP/runtime" ] \
  || die "pi-agent-like-agent 저장소의 zip 이 아닙니다: $ZIP"
OLD_VER="$(tr -d '\r\n' < "$PI_HOME/VERSION" 2>/dev/null)"
NEW_VER="$(tr -d '\r\n' < "$TOP/VERSION" 2>/dev/null)"
COMMIT=  # GitHub 에서 받은 zip 은 주석에 커밋 번호가 들어 있음
[ -n "$PY" ] && COMMIT="$("$PY" -c "import sys, zipfile; print(zipfile.ZipFile(sys.argv[1]).comment.decode('ascii', 'replace')[:7])" \
  "$(pi_native_path "$ZIP")" 2>/dev/null | tr -d '\r\n')"
echo "[update] 지금 판: ${OLD_VER:-(판 번호 없음)}  ->  새 판: ${NEW_VER:-(판 번호 없음)}${COMMIT:+ (커밋 $COMMIT)}"

# 2) 중계 서버 끄기 (우리 중계 서버일 때만)
if command -v curl >/dev/null 2>&1; then
  case "$(curl -s -m 3 http://127.0.0.1:8765/health 2>/dev/null)" in *'"server": "ok"'*)
    curl -s -m 3 -X POST http://127.0.0.1:8765/shutdown >/dev/null 2>&1 && echo "[update] 중계 서버를 껐습니다 (다음 pi 실행 때 새 판으로 켜짐)"
    sleep 1 ;;
  esac
fi

# 3) 폴더 바꾸기 (실패하면 아무것도 바꾸지 않은 상태로 멈춤)
OLD="$PI_HOME.old"
rm -rf "$OLD" 2>/dev/null
[ -e "$OLD" ] && die "지난번 이전 판 폴더($OLD)를 지우지 못했습니다. 그 폴더를 연 창을 닫고 다시 실행하세요. 지금 판은 그대로입니다"
mv "$PI_HOME" "$OLD" 2>/dev/null \
  || die "지금 폴더의 이름을 바꾸지 못했습니다 (사용 중). pi, Copilot 전용 창, 그 폴더를 연 탐색기·터미널을 닫고 다시 실행하세요. 지금 판은 그대로입니다"
if ! mv "$TOP" "$PI_HOME"; then
  mv "$OLD" "$PI_HOME" 2>/dev/null
  die "새 판을 옮기지 못해 원래대로 되돌렸습니다"
fi

# 4) 설정 반영
echo "[update] 설정 반영: bash $PI_HOME/install.sh $PROFILE"
echo
bash "$PI_HOME/install.sh" "$PROFILE" || echo "[update] install.sh 가 실패했습니다. 위 메시지를 확인하세요 (이전 판: $OLD)" >&2
echo

# 5) 확인할 점: 이전 판에서 copilot/bridge.json 을 직접 고쳤다면 내 설정 파일로 옮기도록 알림
if [ -n "$PY" ] && [ -f "$OLD/copilot/bridge.json" ]; then
  PYTHONIOENCODING=utf-8 "$PY" - "$(pi_native_path "$OLD/copilot/bridge.json")" "$(pi_native_path "$PI_HOME/copilot/bridge.json")" <<'EOF'
import json, sys
def load(p):
    try:
        with open(p, encoding="utf-8-sig") as f:
            return {k: v for k, v in json.load(f).items() if not k.startswith("_")}
    except (OSError, ValueError):
        return None
old, new = load(sys.argv[1]), load(sys.argv[2])
if old is not None and new is not None:
    diff = [k for k in old if old[k] != new.get(k)]
    if diff:
        print("[update] 확인: 이전 판의 copilot/bridge.json 에서 새 판과 값이 다른 항목: " + ", ".join(diff))
        print("         직접 고친 것이라면 그 항목을 내 설정 파일(~/.pi/agent/bridge.json)로 옮기세요.")
EOF
fi
echo "[update] 완료: ${OLD_VER:-예전 판} -> ${NEW_VER:-새 판}. 이전 판은 $OLD 에 있습니다 (잘 되면 지워도 됨)"
echo "         pi 를 실행하면 새 판으로 시작합니다. 상태 확인: python $PI_HOME/copilot/diag.py --report"
