#!/usr/bin/env bash
# 업데이트를 마친 뒤 보여 줄 바뀐 점 (update.sh 가 부름): 새 버전의 CHANGELOG 항목 전체와, 건너뛴 버전들의 '할 일'
#   bash bin/changelog-notes.sh <CHANGELOG.md> <이전 버전> <새 버전>
#  - 이전 버전이 CHANGELOG 에서 새 버전보다 아래(예전)에 있을 때만 건너뛴 버전을 본다 (되돌리기나 모르는 버전이면 새 버전 항목만)
#  - 건너뛴 버전은 '- 할 일' 줄과 그 아래 들여 쓴 줄만 (바뀐 점 전체는 길어서 CHANGELOG 에서 보게)
#  - 출력이 없으면 아무것도 쓰지 않는다
f="$1"; old="$2"; new="$3"
[ -f "$f" ] && [ -n "$new" ] || exit 0
nl="$(awk -v v="$new" '$1 == "##" && $2 == v {print NR; exit}' "$f")"
[ -n "$nl" ] || exit 0
ne="$(awk -v a="$nl" 'NR > a && /^## / {print NR; exit}' "$f")"
ol=""
[ -n "$old" ] && [ "$old" != "$new" ] && ol="$(awk -v v="$old" '$1 == "##" && $2 == v {print NR; exit}' "$f")"
notes="$(awk -v a="$nl" -v b="${ne:-0}" 'NR > a && (b == 0 || NR < b) && NF' "$f")"
if [ -n "$notes" ]; then
  echo "[update] 이 버전($new)에서 바뀐 점 (전체: $f)"
  printf '%s\n' "$notes" | sed 's/^/  /'
  echo
fi
if [ -n "$ol" ] && [ -n "$ne" ] && [ "$ol" -gt "$ne" ]; then
  skipped="$(awk -v a="$ne" -v b="$ol" '
    NR < a || NR >= b { next }
    $1 == "##" { ver = $2; todo = 0; next }
    /^- 할 일/ { print "(" ver ") " $0; todo = 1; next }
    todo && /^  / { print $0; next }
    { todo = 0 }' "$f")"
  vers="$(awk -v a="$ne" -v b="$ol" 'NR >= a && NR < b && $1 == "##" {printf "%s%s", (n++ ? ", " : ""), $2}' "$f")"
  if [ -n "$vers" ]; then
    echo "[update] 건너뛴 버전: $vers (바뀐 점은 $f 에서)"
    [ -n "$skipped" ] && { echo "[update] 건너뛴 버전의 할 일:"; printf '%s\n' "$skipped" | sed 's/^/  /'; }
    echo
  fi
fi
exit 0
