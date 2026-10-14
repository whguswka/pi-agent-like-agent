#!/usr/bin/env bash
# bin/pi, update.sh 가 불러 쓰는 함수: Python 찾기, 화면 인자
# (find-node.sh 를 먼저 불러야 함: pi_pythons)
pi_find_python() { # PI_PYTHON > PATH 의 python3·python
  local p
  [ -n "$PI_PYTHON" ] && { echo "$PI_PYTHON"; return 0; }
  p="$(pi_pythons | head -1)"
  [ -n "$p" ] && { echo "$p"; return 0; }
  return 1
}
pi_native_path() { printf '%s\n' "$1"; }
# pi 를 대화형으로 켤 때 더할 화면 인자: code-server·VS Code 터미널(TERM_PROGRAM=vscode)이면 --tui-mode fullscreen
#  기본(regular) 화면은 대화가 길면 다시 그릴 때마다 스크롤 기록 전체(수천 줄)를 다시 출력하는데, VS Code 터미널은
#  그 과정을 그대로 보여 줘서 일하는 동안 스크롤이 위로 감겼다 내려오는 것처럼 보인다. fullscreen 은 보이는 한 화면만 다시 그림.
#  직접 --tui-mode 를 줬거나, settings.json 에 tuiMode 가 있거나(pi 의 /settings 로 고른 값), 대화형이 아닌 실행이면 더하지 않음
pi_tui_args() {
  local a
  [ "$TERM_PROGRAM" = vscode ] || return 0
  grep -q '"tuiMode"' "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/settings.json" 2>/dev/null && return 0
  for a in "$@"; do
    case "$a" in --tui-mode|--tui-mode=*|-p|--print|--mode|--mode=*|--export|--list-models|-h|--help|-v|--version) return 0 ;; esac
  done
  echo "--tui-mode fullscreen"
}
