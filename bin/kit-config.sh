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
