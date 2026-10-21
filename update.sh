#!/usr/bin/env bash
# 새 버전으로 바꾸기: bash ~/tools/pi/update.sh <받은 zip 파일> [pc|jupyter] [--force]
#  1) zip 이 이 저장소인지 확인하고 옆의 임시 폴더에 풂
#  2) 중계 서버를 끔 (다음 pi 실행 때 새 버전으로 켜짐)
#  3) 지금 폴더를 <폴더>.old 로 바꾸고 새 버전을 그 자리에 둠
#  4) install.sh 로 설정 반영 (내 설정·지침·스킬·세션 기록은 그대로)
#  5) 지금 버전 -> 새 버전, 확인할 점을 보여 줌
# 설정 이름(pc|jupyter)을 생략하면 ~/.pi/agent/models.json 을 보고 고른다.
# 같은 버전이면 멈춘다 (이전 버전 폴더를 덮지 않게). 그래도 다시 설치하려면 --force. 예전 버전 zip 을 주면 그 버전으로 되돌린다.
# 업데이트용 zip(Releases 의 <저장소>-<버전>-update.zip)은 pi 본체(runtime/)를 뺀 가벼운 zip 이다: 지금 깔린 pi 본체가
#  새 버전의 해시 목록(docs/runtime-SHA256SUMS.txt)과 같은지 먼저 확인하고, 같으면 그것을 새 버전 폴더로 복사해 쓴다 (다르면 아무것도 바꾸지 않고 멈춤)
#
# update.sh 가 없는 예전 버전에서는: 새 zip 에서 이 파일만 꺼내 pi 폴더 옆(~/tools/update.sh)에 두고 실행한다
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
[ -f "$ZIP" ] || die "zip 파일이 없습니다: $ZIP (받은 파일 이름이 다르면 그 이름으로. 예: \"pi-agent-like-agent-main (1).zip\")"
ZIP="$(cd "$(dirname "$ZIP")" && pwd)/$(basename "$ZIP")"
[ -f "$PI_HOME/install.sh" ] && [ -f "$PI_HOME/bin/pi" ] \
  || die "바꿀 pi 폴더가 없습니다: $PI_HOME (update.sh 를 pi 폴더 안이나 그 옆에 두고 실행하세요)"
# 지금 폴더가 바꿀 폴더 안이면 이름을 바꿀 수 없다 (Windows 는 대소문자를 구분하지 않으므로 소문자로 비교)
case "${PWD,,}/" in "${PI_HOME,,}"/*) die "지금 폴더($PWD)가 바꿀 폴더 안에 있습니다. 다른 폴더에서 실행하세요 (예: cd ~)" ;; esac

# 도우미 함수(Python 찾기, Windows 경로): 지금 버전에 있으면 그것, 없으면(예전 버전) zip 을 푼 뒤 새 버전의 것
if [ -f "$PI_HOME/bin/kit-config.sh" ]; then
  . "$PI_HOME/bin/find-node.sh"
  . "$PI_HOME/bin/kit-config.sh"
fi
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
if [ -z "$PROFILE" ]; then
  if grep -q "127.0.0.1:8765" "$AGENT_DIR/models.json" 2>/dev/null; then PROFILE=pc; else PROFILE=jupyter; fi
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
# 업데이트용 zip: pi 본체(runtime/)는 없고 그 해시 목록만 있음
LIGHT=
[ "$n" = 1 ] && [ ! -d "$TOP/runtime" ] && [ -f "$TOP/docs/runtime-SHA256SUMS.txt" ] && LIGHT=1
[ "$n" = 1 ] && [ -f "$TOP/install.sh" ] && [ -f "$TOP/bin/pi" ] && { [ -d "$TOP/runtime" ] || [ -n "$LIGHT" ]; } \
  || die "pi-agent-like-agent 저장소의 zip 이 아닙니다: $ZIP"
if ! command -v pi_find_python >/dev/null 2>&1 && [ -f "$TOP/bin/kit-config.sh" ]; then
  . "$TOP/bin/find-node.sh"
  . "$TOP/bin/kit-config.sh"
  PY="$(pi_find_python 2>/dev/null)" || PY=
fi
OLD_VER="$(tr -d '\r\n' 2>/dev/null < "$PI_HOME/VERSION")"  # 2>/dev/null 을 먼저: 파일이 없을 때 셸의 오류 줄도 감춤
NEW_VER="$(tr -d '\r\n' 2>/dev/null < "$TOP/VERSION")"
COMMIT=  # GitHub 에서 받은 zip 은 주석에 커밋 번호가 들어 있음
[ -n "$PY" ] && COMMIT="$("$PY" -c "import sys, zipfile; print(zipfile.ZipFile(sys.argv[1]).comment.decode('ascii', 'replace')[:7])" \
  "$(pi_native_path "$ZIP")" 2>/dev/null | tr -d '\r\n')"
OLD_COMMIT="$(tr -d '\r\n' 2>/dev/null < "$PI_HOME/.commit")"
echo "[update] 지금 버전: ${OLD_VER:-(버전 번호 없음)}  ->  새 버전: ${NEW_VER:-(버전 번호 없음)}${COMMIT:+ (커밋 $COMMIT)}"
# 같은 버전을 다시 깔면 하나뿐인 이전 버전 폴더(.old)가 지금 버전의 복사본으로 바뀌므로 멈춘다
if [ -z "$FORCE" ] && [ -n "$OLD_VER" ] && [ "$OLD_VER" = "$NEW_VER" ] \
   && { [ -z "$COMMIT" ] || [ -z "$OLD_COMMIT" ] || [ "$COMMIT" = "$OLD_COMMIT" ]; }; then
  die "이미 같은 버전($NEW_VER)입니다. 받은 zip 이 새 버전인지 확인하세요 (그래도 다시 설치하려면 끝에 --force)"
fi
if [ -n "$OLD_VER" ] && [ -n "$NEW_VER" ] && [ "$OLD_VER" != "$NEW_VER" ] \
   && [ "$(printf '%s\n%s\n' "$OLD_VER" "$NEW_VER" | sort -V | tail -1)" = "$OLD_VER" ]; then
  echo "[update] 참고: 지금 버전보다 예전 버전입니다 (이전 버전으로 되돌리기)"
fi

# pi 본체(runtime/)가 해시 목록과 같은지: 같으면 0. 다르면 1, 다르거나 없는 파일을 3개까지 RUNTIME_BAD 에
runtime_check() {  # $1: pi 폴더, $2: 해시 목록 (줄마다 '<sha256>  runtime/<경로>')
  RUNTIME_BAD=
  [ -d "$1/runtime" ] || { RUNTIME_BAD="runtime/ 이 없음"; return 1; }
  if [ -z "$PI_UPDATE_HASH_PY" ] && command -v sha256sum >/dev/null 2>&1; then  # PI_UPDATE_HASH_PY=1: 시험용, Python 으로 확인
    local out
    out="$(cd "$1" && sha256sum -c --quiet "$2" 2>/dev/null)" && return 0
    RUNTIME_BAD="$(printf '%s\n' "$out" | sed -n 's/: FAILED.*//p' | head -3 | tr '\n' ' ')"
    RUNTIME_BAD="${RUNTIME_BAD% }"
    return 1
  elif [ -n "$PY" ]; then
    RUNTIME_BAD="$("$PY" - "$(pi_native_path "$1")" "$(pi_native_path "$2")" <<'PYEOF'
import hashlib, os, sys
root, sums = sys.argv[1], sys.argv[2]
bad = []
for line in open(sums, encoding="utf-8"):
    h, _, p = line.rstrip("\r\n").partition("  ")
    if not p:
        continue
    try:
        with open(os.path.join(root, p), "rb") as f:
            ok = hashlib.sha256(f.read()).hexdigest() == h
    except OSError:
        ok = False
    if not ok:
        bad.append(p)
print(" ".join(bad[:3]), end="")
PYEOF
)" || RUNTIME_BAD="확인하지 못함"
    [ -z "$RUNTIME_BAD" ]
  else
    RUNTIME_BAD="확인할 프로그램(sha256sum 또는 Python)이 없음"
    return 1
  fi
}
# 업데이트용 zip 이면 지금 깔린 pi 본체가 새 버전의 것과 같은지 먼저 본다 (다르면 아무것도 바꾸지 않고 멈춤)
if [ -n "$LIGHT" ]; then
  runtime_check "$PI_HOME" "$TOP/docs/runtime-SHA256SUMS.txt" \
    || die "이 zip 은 pi 본체(runtime/)를 뺀 업데이트용인데, 지금 깔린 pi 본체가 새 버전의 것과 다릅니다 ($RUNTIME_BAD). 전체 zip(GitHub 의 Code > Download ZIP, 또는 Releases 의 Source code (zip))으로 바꾸세요. 지금 버전은 그대로입니다"
  echo "[update] 업데이트용 zip (pi 본체 없음): 지금 깔린 pi 본체가 새 버전의 것과 같아 그대로 씁니다"
fi

# 2) 중계 서버 끄기 (8766 은 사내AI 중계 서버). 켜 둔 채 폴더 이름을 바꾸면 '사용 중' 으로 멈추므로 포트가 닫혔는지 보고,
#    안 닫히면(예전 중계 서버는 /shutdown 이 없음) 그 포트에서 기다리는 프로세스가 relay.py 일 때만 끈다 (Windows)
_port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
for _port in 8765 8766; do
  _port_open "$_port" || continue
  _name="중계 서버$([ "$_port" = 8765 ] || echo "($_port)")"
  command -v curl >/dev/null 2>&1 && curl -s -m 5 -X POST "http://127.0.0.1:$_port/shutdown" >/dev/null 2>&1
  for _i in 1 2 3 4 5 6 7 8 9 10; do _port_open "$_port" || break; sleep 0.3; done
  if _port_open "$_port"; then
    case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*)
      _pid="$(netstat -ano 2>/dev/null | awk -v a="127.0.0.1:$_port" '$2 == a && $3 ~ /:0$/ {print $5; exit}')"
      if [ -n "$_pid" ] && powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=$_pid').CommandLine" 2>/dev/null | grep -q 'relay\.py'; then
        taskkill //F //PID "$_pid" >/dev/null 2>&1
        for _i in 1 2 3 4 5 6 7 8 9 10; do _port_open "$_port" || break; sleep 0.3; done
      fi ;;
    esac
  fi
  if _port_open "$_port"; then
    echo "[update] 참고: ${_name}(127.0.0.1:$_port)를 끄지 못했습니다. 아래에서 '사용 중' 으로 멈추면 netstat -ano | grep 127.0.0.1:$_port 의 마지막 숫자로 taskkill //F //PID <번호>"
  else
    echo "[update] ${_name}를 껐습니다 (다음 pi 실행 때 새 버전으로 켜짐)"
  fi
done

# 3) 폴더 바꾸기 (실패하면 아무것도 바꾸지 않은 상태로 멈춤)
OLD="$PI_HOME.old"
rm -rf "$OLD" 2>/dev/null
[ -e "$OLD" ] && die "지난번 이전 버전 폴더($OLD)를 지우지 못했습니다. 그 폴더를 연 창을 닫고 다시 실행하세요. 지금 버전은 그대로입니다"
mv "$PI_HOME" "$OLD" 2>/dev/null \
  || die "지금 폴더의 이름을 바꾸지 못했습니다 (사용 중). pi 와 그 폴더를 연 탐색기·터미널을 닫고 다시 실행하세요 (2026-10-03.1 전 버전이면 Copilot 전용 창도). 보이는 창이 없으면 중계 서버일 수 있습니다: netstat -ano | grep -E '127.0.0.1:876[56]' 의 마지막 숫자로 taskkill //F //PID <번호>. 지금 버전은 그대로입니다"
if ! mv "$TOP" "$PI_HOME"; then
  mv "$OLD" "$PI_HOME" 2>/dev/null
  die "새 버전을 옮기지 못해 원래대로 되돌렸습니다"
fi
# 업데이트용 zip: 이전 버전의 pi 본체를 새 버전 폴더로 복사 (옮기지 않음: 이전 버전 폴더는 되돌리기용으로 그대로 둠)
if [ -n "$LIGHT" ]; then
  if ! cp -a "$OLD/runtime" "$PI_HOME/runtime" 2>/dev/null || ! runtime_check "$PI_HOME" "$PI_HOME/docs/runtime-SHA256SUMS.txt"; then
    mv "$PI_HOME" "$WORK/failed" 2>/dev/null
    mv "$OLD" "$PI_HOME" 2>/dev/null
    die "pi 본체(runtime/)를 새 버전 폴더로 복사하지 못해 원래대로 되돌렸습니다 (${RUNTIME_BAD:-복사 실패}). 디스크 공간을 확인하세요"
  fi
fi
[ -n "$COMMIT" ] && echo "$COMMIT" > "$PI_HOME/.commit"

# 4) 설정 반영
echo "[update] 설정 반영: bash $PI_HOME/install.sh $PROFILE"
echo
INSTALL_OK=1
bash "$PI_HOME/install.sh" "$PROFILE" || { INSTALL_OK=; echo "[update] install.sh 가 실패했습니다. 위 메시지를 확인하세요 (이전 버전: $OLD)" >&2; }
# 예전 버전으로 되돌린 경우 그 버전의 install.sh 는 새 버전에만 있던 확장을 치우지 못하므로 여기서도 (키트가 낸 적 있는 이름만, 옮겨 둠)
KIT_EXT="copilot-session.ts jupyter.ts guard.ts notify.ts kit.ts undo.ts modes.ts memory.ts files.ts wiki.ts lib/shell.ts lib/relay.ts lib/paths.ts"
for f in $KIT_EXT; do
  [ -e "$AGENT_DIR/extensions/$f" ] || continue
  { [ -e "$PI_HOME/profiles/common/agent-template/extensions/$f" ] || [ -e "$PI_HOME/profiles/$PROFILE/agent-template/extensions/$f" ]; } && continue
  mkdir -p "$(dirname "$AGENT_DIR/extensions.removed/$f")" && mv -f "$AGENT_DIR/extensions/$f" "$AGENT_DIR/extensions.removed/$f" \
    && echo "[update] 치움: $AGENT_DIR/extensions/$f (이 버전에는 없는 확장 -> extensions.removed/)"
done
rmdir "$AGENT_DIR/extensions/lib" 2>/dev/null
echo

# 5) 확인할 점: 이전 버전에서 copilot/bridge.json 을 직접 고쳤다면 내 설정 파일로 옮기도록 알림
#    버전 사이에 키트가 바꾼 값(예: 모델 이름)은 고친 것으로 보지 않는다 (새 버전의 bridge.py --edited-keys: 예전 버전들이 내놓은 값을 앎)
if [ -n "$PY" ] && [ -f "$OLD/copilot/bridge.json" ]; then
  _edited="$(PYTHONIOENCODING=utf-8 "$PY" "$(pi_native_path "$PI_HOME/copilot/bridge.py")" --edited-keys \
    "$(pi_native_path "$OLD/copilot/bridge.json")" "$(pi_native_path "$PI_HOME/copilot/bridge.json")" 2>/dev/null | tr -d '\r')"
  case "$_edited" in ""|"고친 항목 없음"|"확인하지 못함"*) ;; *)
    echo "[update] 확인: 이전 버전의 copilot/bridge.json 에서 새 버전과 값이 다른 항목: $_edited"
    echo "         직접 고친 것이라면 그 항목을 내 설정 파일(~/.pi/agent/bridge.json)로 옮기세요." ;;
  esac
fi
[ -n "$PI_UPDATE_BOOT" ] && rm -f "$PI_UPDATE_BOOT"  # 예전 버전용으로 꺼내 둔 update.sh
# 6) 이 버전에서 바뀐 점과 할 일 (CHANGELOG.md. 사내망에서는 GitHub 을 볼 수 없으므로 여기서 보여 줌).
#    여러 버전을 건너뛰었으면 건너뛴 버전들의 '할 일' 도 (bin/changelog-notes.sh)
if [ -f "$PI_HOME/bin/changelog-notes.sh" ]; then
  bash "$PI_HOME/bin/changelog-notes.sh" "$PI_HOME/CHANGELOG.md" "$OLD_VER" "$NEW_VER"
fi
if [ -z "$INSTALL_OK" ]; then
  # 폴더는 새 버전으로 바뀌었지만 설정 반영(install.sh)이 중간에 멈춤: '완료' 라고 하지 않고 되돌리는 방법을 알림 (이전 버전 폴더는 지우지 말 것)
  echo "[update] 마치지 못했습니다: 설정 반영(install.sh)이 실패했습니다. 위 메시지를 확인한 뒤 다시 하거나, 이전 버전으로 되돌리세요 (이전 버전 폴더 $OLD 는 지우지 마세요):" >&2
  echo "         mv \"$PI_HOME\" \"$PI_HOME.failed\" && mv \"$OLD\" \"$PI_HOME\" && bash \"$PI_HOME/install.sh\" $PROFILE" >&2
  exit 1
fi
echo "[update] 완료: ${OLD_VER:-예전 버전} -> ${NEW_VER:-새 버전}. 이전 버전은 $OLD 에 있습니다 (잘 되면 지워도 됨)"
echo "         pi 를 실행하면 새 버전으로 시작합니다. 상태 확인: pi 안에서 /doctor (또는 python $PI_HOME/copilot/diag.py --report)"
