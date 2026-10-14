#!/usr/bin/env bash
# 이 노트북에서 pi 가 쓸 수 있는 Node.js 가 있는지 진단
D="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
. "$D/bin/find-node.sh"
echo "== Node.js 후보 (22.19 이상: 정식 / 20.15 이상: 호환 모드)"
pi_node_candidates | awk 'NF && !s[$0]++' | while IFS= read -r c; do
  [ -f "$c" ] || continue
  v="$("$c" -v 2>/dev/null)"
  if pi_node_ok "$c"; then r="OK"; elif pi_node_compat_ok "$c"; then r="OK (호환 모드)"; else r="버전 미달"; fi
  printf '  %-60s %-10s %s\n' "$c" "${v:-실행불가}" "$r"
done
if n="$(pi_find_node)"; then
  if pi_node_ok "$n"; then echo "== 결과: 사용 가능 -> $n"; else echo "== 결과: 호환 모드로 사용 가능 -> $n ($("$n" -v))"; fi
else
  echo "== 결과: 사용 가능한 Node 없음 (20.15 이상 필요)"
  # 편집기(VS Code 웹 등)에 따라 node 가 다른 곳에 있으므로 흔한 곳을 찾아 보여 줌
  found="$(find /usr/lib/code-server /usr/local/lib /opt /app "$HOME/.local/lib" "$HOME/.openvscode-server" "$HOME/.vscode-server" \
            -maxdepth 6 -type f -name node 2>/dev/null | head -10)"
  if [ -n "$found" ]; then
    echo "   이 노트북에서 찾은 node:"
    while IFS= read -r c; do printf '     %-60s %s\n' "$c" "$("$c" -v 2>/dev/null || echo 실행불가)"; done <<< "$found"
    echo "   20.15 이상인 것이 있으면 그 경로를 ~/.bashrc 에 한 번 적습니다 (새 터미널부터 적용):"
    echo "     echo >> ~/.bashrc; echo 'export PI_NODE=\"/위의/경로/node\"' >> ~/.bashrc"
  fi
  echo "   해결 (아래 중 하나만 있으면 됩니다):"
  echo "    - pip install --user nodejs-wheel-binaries==24.16.0   (Node.js 공식 바이너리 패키지)"
  echo "    - pip install --user playwright                       (1.46 이상. 내장 Node 사용, 브라우저 설치 불필요)"
  echo "    - node 실행 파일이 있으면 export PI_NODE=/경로/node 를 ~/.bashrc 에"
  exit 1
fi
