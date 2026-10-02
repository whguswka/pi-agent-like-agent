# Windows Git Bash: 터미널 <-> 파이프 중계 (bin/pi 에서 source)
# VS Code 계열 편집기(Electron)의 Code.exe 는 GUI 프로그램이라 터미널(mintty/콘솔)을 직접 쓰지 못한다.
#  - 터미널을 raw 모드로 바꾸고 (Node 의 setRawMode 와 같은 설정)
#  - 입력: 터미널 -> cat -> 파이프 -> Code.exe,  출력: Code.exe -> 파이프 -> cat -> 터미널
#  - 창 크기: 0.4초마다 stty size 를 파일에 기록 -> compat/tty-relay.mjs 가 읽어 resize 이벤트 발생
# 사용법: pi_tty_relay <실행파일> [인자...]   (반환값: 실행파일의 종료 코드)
pi_tty_relay() {
  local saved size_file watcher incat infd rc
  saved="$(stty -g)" || return 1
  size_file="$(mktemp "${TMPDIR:-/tmp}/pi-tty-XXXXXX")" || return 1
  stty size > "$size_file" 2>/dev/null || echo "24 80" > "$size_file"
  # 백그라운드 작업은 stdin 이 /dev/null 로 바뀌므로 터미널을 명시적으로 연결 (<&0)
  (
    last="$(cat "$size_file")"
    while sleep 0.4; do
      s="$(stty size 2>/dev/null)" || continue
      if [ -n "$s" ] && [ "$s" != "$last" ]; then echo "$s" > "$size_file"; last="$s"; fi
    done
  ) <&0 &
  watcher=$!
  trap 'kill "$watcher" "$incat" 2>/dev/null; stty "$saved" 2>/dev/null; rm -f "$size_file"' EXIT
  # Node 의 raw 모드와 동일: 입력은 가공 없이 전달(Ctrl+C 도 문자로), 출력의 줄바꿈 처리는 유지
  stty raw -echo opost onlcr
  exec {infd}< <(exec cat)
  incat=$!
  PI_TTY_RELAY="$(cygpath -w "$size_file")" "$@" <&"$infd" 2>&1 | cat
  rc=${PIPESTATUS[0]}
  exec {infd}<&-
  kill "$watcher" "$incat" 2>/dev/null
  stty "$saved" 2>/dev/null
  rm -f "$size_file"
  trap - EXIT
  return "$rc"
}
