# Node.js 탐색 (pi launcher / check-node.sh 에서 source)
# 후보: $PI_NODE > pip 패키지(nodejs-wheel-binaries, playwright 내장 Node) > PATH 의 node > Node 기본 설치 경로
#       > code-server 내장 node > (Windows) VS Code 계열 편집기 내장 Node
# 1순위로 22.19 이상을 찾고, 없으면 20.15 이상을 호환 모드(compat/node20.mjs)로 사용. 그보다 낮은 버전은 건너뜀

PI_FIND_NODE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Windows: setx 로 지정한 PI_NODE 는 C:\... 형식이므로 Git Bash 경로로 변환
if [ -n "$PI_NODE" ] && command -v cygpath >/dev/null 2>&1; then PI_NODE="$(cygpath -u "$PI_NODE")"; fi

# VS Code 계열(Electron) 실행파일인지 판별 — 이름이 확인된 것만 허용 (다른 Electron 앱은 실행하면 창이 뜰 수 있음)
pi_is_electron() {
  local name="${1##*/}"
  name="${name##*\\}"
  case "$name" in
    Code.exe | "Code - Insiders.exe" | Cursor.exe | Windsurf.exe | Antigravity.exe) return 0 ;;
    *) return 1 ;;
  esac
}
# 실행해도 되는 이름인지 (node / node.exe / 위 편집기) — PI_NODE 에 다른 프로그램(예: VSCodePortable.exe 런처)을 지정해도 창이 뜨지 않게
pi_node_name_ok() {
  local name="${1##*/}"
  name="${name##*\\}"
  case "$name" in node | node.exe) return 0 ;; esac
  pi_is_electron "$1"
}
pi_node_exec() { # <node 또는 Electron exe> [args...]  : Electron 이면 Node 모드로 실행
  if pi_is_electron "$1"; then ELECTRON_RUN_AS_NODE=1 "$@"; else "$@"; fi
}
pi_node_ver_ok() { # <node> <major> <minor>
  pi_node_exec "$1" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>$2||(a===$2&&b>=$3)?0:1)" >/dev/null 2>&1
}
pi_node_ok() { pi_node_ver_ok "$1" 22 19; }
pi_node_compat_ok() { pi_node_ver_ok "$1" 20 15; }
pi_pythons() { # 사용 가능한 python 실행파일 목록 (Windows 는 PATH 에 없어도 흔한 설치 경로 확인)
  local py up la
  for py in python3 python py; do
    py="$(command -v "$py" 2>/dev/null)" || continue
    # Windows 스토어 바로가기(python3 등)는 Python 이 없으면 안내문만 출력하고 실패 -> 실제로 실행되는 것만 사용
    case "$py" in *WindowsApps*) "$py" -c "" >/dev/null 2>&1 || continue ;; esac
    echo "$py"
  done
  if command -v cygpath >/dev/null 2>&1; then
    up="$(cygpath -u "${USERPROFILE:-$HOME}")"
    la="$(cygpath -u "${LOCALAPPDATA:-$HOME/AppData/Local}")"
    for py in "$la"/Programs/Python/Python3*/python.exe "/c/Program Files"/Python3*/python.exe \
              "$up"/anaconda3/python.exe "$up"/miniconda3/python.exe "$up"/Anaconda3/python.exe \
              /c/ProgramData/anaconda3/python.exe /c/ProgramData/Anaconda3/python.exe /c/ProgramData/miniconda3/python.exe; do
      [ -f "$py" ] && echo "$py"
    done
  fi
}
pi_node_candidates() {
  local py d base
  [ -n "$PI_NODE" ] && pi_node_name_ok "$PI_NODE" && echo "$PI_NODE"
  while IFS= read -r py; do
    [ -n "$py" ] || continue
    # 파이프로 받을 때 Python 은 cp949 로 내보내므로 한글이 든 사용자 폴더 경로가 깨짐 -> UTF-8 로
    PYTHONIOENCODING=utf-8 "$py" "$PI_FIND_NODE_DIR/find-pynode.py" 2>/dev/null | tr -d '\r' | while IFS= read -r d; do
      command -v cygpath >/dev/null 2>&1 && d="$(cygpath -u "$d")"
      echo "$d"
    done
  done < <(pi_pythons | awk '!s[$0]++')
  command -v node 2>/dev/null
  echo /usr/lib/code-server/lib/node
  if command -v cygpath >/dev/null 2>&1; then # Windows (Git Bash)
    for base in "$(cygpath -u "${LOCALAPPDATA:-$HOME/AppData/Local}")/Programs" "/c/Program Files"; do
      echo "$base/nodejs/node.exe"
      echo "$base/Microsoft VS Code/Code.exe"
      echo "$base/Microsoft VS Code Insiders/Code - Insiders.exe"
      echo "$base/cursor/Cursor.exe"
      echo "$base/Windsurf/Windsurf.exe"
      echo "$base/Antigravity/Antigravity.exe"
    done
  fi
}
pi_find_node() {
  local c list
  # 사용자가 PI_NODE 로 직접 지정했으면 그것을 우선 사용
  if [ -n "$PI_NODE" ]; then
    if ! pi_node_name_ok "$PI_NODE"; then
      echo "[pi] PI_NODE 는 node.exe 또는 VS Code 의 Code.exe 를 가리켜야 합니다 (무시함): $PI_NODE" >&2
      echo "     portable VS Code 라면 그 폴더 안의 Code.exe (PortableApps 형식은 App\\VSCode\\Code.exe)" >&2
    elif [ -f "$PI_NODE" ] && pi_node_compat_ok "$PI_NODE"; then
      echo "$PI_NODE"; return 0
    else
      echo "[pi] PI_NODE 의 Node 가 20.15 미만이거나 실행할 수 없습니다 (무시함): $PI_NODE" >&2
    fi
  fi
  list="$(pi_node_candidates | awk 'NF && !s[$0]++')"
  while IFS= read -r c; do
    [ -f "$c" ] && pi_node_ok "$c" && { echo "$c"; return 0; }
  done <<< "$list"
  while IFS= read -r c; do
    [ -f "$c" ] && pi_node_compat_ok "$c" && { echo "$c"; return 0; }
  done <<< "$list"
  return 1
}
