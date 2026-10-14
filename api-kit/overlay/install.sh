#!/usr/bin/env bash
# 설치·업데이트: bash install.sh   (Kubeflow 노트북의 터미널에서. 새 판으로 바꾼 뒤에도 다시 실행)
#  실행권한 부여 + ~/.pi/agent 설정 템플릿 배치 (기존 설정은 유지하고 새 판에 추가된 항목만 넣음) + PATH 등록
#  LLM 은 OpenAI 호환 API (vLLM 등). 주소와 모델은 설치한 뒤 ~/.pi/agent/models.json 에 적는다
set -e
PI_HOME="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
case "${1:-}" in
  ""|jupyter|kubeflow) ;;
  *) echo "사용법: bash install.sh   (Kubeflow 노트북의 터미널에서)"
     exit 1 ;;
esac
TEMPLATE="$PI_HOME/profiles/jupyter/agent-template"
chmod +x "$PI_HOME/bin/pi" "$PI_HOME/install.sh" "$PI_HOME/update.sh" "$PI_HOME/check-node.sh" 2>/dev/null || true
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
mkdir -p "$AGENT_DIR"
# 설정 파일은 이미 있으면 유지, 확장(extensions/)은 프로그램이므로 항상 새 것으로
#  profiles/common: 공통 확장 (위험 명령 확인 등), profiles/jupyter: 설정 템플릿·기본 지침
for T in "$PI_HOME/profiles/common/agent-template" "$TEMPLATE"; do
  [ -d "$T" ] || continue
  ( cd "$T" && find . -type f | sed 's#^\./##' ) | while IFS= read -r f; do
    case "$f" in
      extensions/*) mkdir -p "$(dirname "$AGENT_DIR/$f")"; cp "$T/$f" "$AGENT_DIR/$f"; echo "설치: $AGENT_DIR/$f" ;;
      *) if [ -e "$AGENT_DIR/$f" ]; then echo "유지: $AGENT_DIR/$f (이미 존재)"
         else mkdir -p "$(dirname "$AGENT_DIR/$f")"; cp "$T/$f" "$AGENT_DIR/$f"; echo "생성: $AGENT_DIR/$f"; fi ;;
    esac
  done
done
# 이 판에 없는 키트 확장은 치운다 (pi 는 extensions 의 .ts 를 모두 불러오므로 이름이 바뀌거나 빠진 확장이 남으면 함께 돎).
#  키트가 낸 적이 있는 이름만 (직접 만든 확장은 그대로). 지우지 않고 extensions.removed/ 로 옮김. 확장을 새로 내면 이 목록에 더할 것
KIT_EXT="guard.ts notify.ts kit.ts undo.ts modes.ts memory.ts files.ts wiki.ts lib/shell.ts lib/relay.ts lib/paths.ts"
for f in $KIT_EXT; do
  [ -e "$AGENT_DIR/extensions/$f" ] || continue
  { [ -e "$PI_HOME/profiles/common/agent-template/extensions/$f" ] || [ -e "$TEMPLATE/extensions/$f" ]; } && continue
  mkdir -p "$(dirname "$AGENT_DIR/extensions.removed/$f")" && mv -f "$AGENT_DIR/extensions/$f" "$AGENT_DIR/extensions.removed/$f" \
    && echo "치움: $AGENT_DIR/extensions/$f (이 판에는 없는 확장 -> extensions.removed/)"
done
rmdir "$AGENT_DIR/extensions/lib" 2>/dev/null || true  # 비었으면 (set -e 라서 || true)
# 이미 있던 설정 파일에는 새 판에 추가된 항목(새 모델 등)만 넣는다. 직접 고친 값과 직접 지운 항목은 그대로 (pi 가 쓰는 Node 로 실행)
. "$PI_HOME/bin/find-node.sh"
if PI_MERGE_NODE="$(pi_find_node 2>/dev/null)"; then
  "$PI_MERGE_NODE" "$PI_HOME/bin/merge-config.mjs" "$TEMPLATE" "$AGENT_DIR" "$PI_HOME" || echo "참고: 위 설정 파일을 확인해 주세요"
else
  echo "참고: Node 를 찾지 못해 기존 설정 파일에 새 항목을 넣지 못했습니다 (Node 를 준비한 뒤 install.sh 를 다시 실행하세요)"
fi
# PATH: code-server·VS Code 터미널은 ~/.bashrc 를 읽고, JupyterLab 터미널 같은 로그인 셸(bash -l)은
#  ~/.bash_profile, ~/.bash_login, ~/.profile 중 처음 있는 것만 읽으므로 둘 다에 넣는다 (로그인 셸 파일이 없으면 ~/.profile)
PATH_LINE="export PATH=\"$PI_HOME/bin:\$PATH\""
# 파일 끝에 PATH 한 줄 더하기 (마지막 줄에 줄바꿈이 없으면 먼저 넣음: 앞 줄에 붙어 둘 다 망가지지 않게)
add_path_line() { [ -s "$1" ] && [ -n "$(tail -c1 "$1")" ] && echo >> "$1"; echo "$PATH_LINE" >> "$1"; }
grep -qF "$PI_HOME/bin" "$HOME/.bashrc" 2>/dev/null || { add_path_line "$HOME/.bashrc"; echo "PATH 추가: ~/.bashrc"; }
LOGIN_RC=
for f in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do [ -e "$f" ] && { LOGIN_RC="$f"; break; }; done
LOGIN_RC="${LOGIN_RC:-$HOME/.profile}"
grep -qF "$PI_HOME/bin" "$LOGIN_RC" 2>/dev/null || { add_path_line "$LOGIN_RC"; echo "PATH 추가: $LOGIN_RC (로그인 셸용)"; }
echo
"$PI_HOME/check-node.sh" || true
echo
echo "설치 완료 (판 $(tr -d '\r\n' < "$PI_HOME/VERSION" 2>/dev/null || echo '?')). 새 터미널을 열고 'pi --version' 으로 확인하세요. (지금 터미널에서 바로 쓰려면: export PATH=\"$PI_HOME/bin:\$PATH\")"
echo "사용법: $PI_HOME/README.md (GitHub 첫 페이지와 같은 내용)"
if grep -q 'VLLM-서버-주소' "$AGENT_DIR/models.json" 2>/dev/null; then
  echo "그 다음 LLM API 의 주소와 모델 이름을 $AGENT_DIR/models.json 에 적으세요 (baseUrl, apiKey, models 의 id)."
  echo "  settings.json 의 defaultModel 도 같은 모델 id 로. 안내: $PI_HOME/docs/API-연결.md"
fi
