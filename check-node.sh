#!/usr/bin/env bash
# 이 환경에서 pi 가 쓸 수 있는 Node.js 가 있는지 진단
D="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
. "$D/bin/find-node.sh"
echo "== Node.js 후보 (22.19 이상: 정식 / 20.15 이상: 호환 모드)"
pi_node_candidates | awk 'NF && !s[$0]++' | while IFS= read -r c; do
  [ -f "$c" ] || continue
  v="$(pi_node_exec "$c" -v 2>/dev/null | tr -d '\r')"
  if pi_node_ok "$c"; then r="OK"; elif pi_node_compat_ok "$c"; then r="OK (호환 모드)"; else r="버전 미달"; fi
  pi_is_electron "$c" && r="$r  [편집기 내장 Node]"
  printf '  %-60s %-10s %s\n' "$c" "${v:-실행불가}" "$r"
done
if n="$(pi_find_node)"; then
  if pi_node_ok "$n"; then echo "== 결과: 사용 가능 -> $n"; else echo "== 결과: 호환 모드로 사용 가능 -> $n ($(pi_node_exec "$n" -v | tr -d '\r'))"; fi
else
  echo "== 결과: 사용 가능한 Node 없음 (20.15 이상 필요)"
  echo "   해결 (아래 중 하나만 있으면 됩니다):"
  echo "    - pip install --user nodejs-wheel-binaries==24.19.0   (Node.js 공식 바이너리 패키지)"
  echo "    - pip install --user playwright                       (1.46 이상. 내장 Node 사용, 브라우저 설치 불필요)"
  echo "    - (Windows) VS Code 데스크톱 1.93 이상                 (내장 Node 사용)"
  echo "      portable VS Code 라면 그 폴더의 Code.exe 경로를 ~/.bashrc 에 한 번 적기 (경로는 / 로, 새 Git Bash 창부터 적용):"
  echo "        echo >> ~/.bashrc; echo 'export PI_NODE=\"C:/경로/Code.exe\"' >> ~/.bashrc"
  echo "      지금 창에서만 쓰려면 export PI_NODE=\"C:/경로/Code.exe\" (이 창을 닫으면 사라짐)"
  exit 1
fi
