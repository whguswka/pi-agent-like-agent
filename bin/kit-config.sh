#!/usr/bin/env bash
# bin/pi, update.sh 가 불러 쓰는 함수: Python 찾기, Windows 경로, 실행기가 쓰는 설정 값 읽기
# (find-node.sh 를 먼저 불러야 함: pi_pythons)
pi_find_python() { # PI_PYTHON > PATH 의 python(스토어 바로가기 제외) > 흔한 설치 경로 (find-node.sh 의 pi_pythons)
  local p
  [ -n "$PI_PYTHON" ] && { command -v cygpath >/dev/null 2>&1 && cygpath -u "$PI_PYTHON" || echo "$PI_PYTHON"; return 0; }
  p="$(pi_pythons | head -1)"
  [ -n "$p" ] && { echo "$p"; return 0; }
  return 1
}
pi_native_path() { case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) cygpath -w "$1" ;; *) printf '%s\n' "$1" ;; esac; }
# 실행기가 쓰는 설정 값 (browser, auto_start_browser, jupyter_url, cdp_port):
#  저장소의 copilot/bridge.json 위에 내 설정(~/.pi/agent/bridge.json)을 덮어쓴 값.
#  Python 이 있으면 bridge.py 로 읽고(형식 검사 포함, 틀리면 1), 없으면 아래 pi_cfg 가 두 파일에서 한 줄짜리 값만 읽는다
pi_cfg_load() {
  local py out rc k v
  py="$(pi_find_python)" || return 0
  out="$(PYTHONIOENCODING=utf-8 "$py" "$(pi_native_path "$PI_HOME/copilot/bridge.py")" --shell-config)"; rc=$?
  [ "$rc" = 2 ] && return 1  # 설정 파일 형식 오류 (bridge.py 가 어느 파일 몇째 줄인지 알림)
  [ "$rc" = 0 ] || return 0  # Python 을 실행하지 못함 -> pi_cfg 가 파일에서 직접 읽음
  while IFS='=' read -r k v; do
    v="${v%$'\r'}"
    case "$k" in browser|auto_start_browser|jupyter_url|cdp_port) printf -v "PI_CFG_$k" '%s' "$v" ;; esac
  done <<< "$out"
  return 0
}
pi_cfg() {
  local var="PI_CFG_$1" f v
  [ -n "${!var+x}" ] && { printf '%s\n' "${!var}"; return 0; }
  for f in "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/bridge.json" "$PI_HOME/copilot/bridge.json"; do
    v="$(sed -n "s/^ *\"$1\": *\"\{0,1\}\([^\",]*\)\"\{0,1\} *,\{0,1\} *$/\1/p" "$f" 2>/dev/null | head -1)"
    [ -n "$v" ] && { printf '%s\n' "$v"; return 0; }
  done
}
# pi 를 대화형으로 켤 때 더할 화면 인자: VS Code 터미널(TERM_PROGRAM=vscode)이면 --tui-mode fullscreen
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
