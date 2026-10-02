#!/usr/bin/env bash
# 설치·업데이트: bash install.sh <jupyter|pc>   (새 판으로 바꾼 뒤에도 다시 실행)
#  실행권한 부여 + ~/.pi/agent 설정 템플릿 배치 (기존 설정은 유지하고 새 판에 추가된 항목만 넣음) + PATH 등록
#   jupyter : Kubeflow JupyterLab 터미널에서 실행, 사내 vLLM 연결
#   pc      : 업무 PC 의 Git Bash 에서 실행, Copilot 웹 채팅 연결 (copilot/ 중계기)
set -e
PI_HOME="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PROFILE="${1:-}"
case "$PROFILE" in
  jupyter|pc) ;;
  *) echo "사용법: bash install.sh <jupyter|pc>"
     echo "  jupyter : Kubeflow JupyterLab 터미널 + 사내 vLLM"
     echo "  pc      : 업무 PC Git Bash + Copilot 웹 채팅"
     exit 1 ;;
esac
TEMPLATE="$PI_HOME/profiles/$PROFILE/agent-template"
chmod +x "$PI_HOME/bin/pi" "$PI_HOME/install.sh" "$PI_HOME/check-node.sh" 2>/dev/null || true
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
mkdir -p "$AGENT_DIR"
# 설정 파일은 이미 있으면 유지, 확장(extensions/)은 프로그램이므로 항상 새 것으로
( cd "$TEMPLATE" && find . -type f | sed 's#^\./##' ) | while IFS= read -r f; do
  case "$f" in
    extensions/*) mkdir -p "$(dirname "$AGENT_DIR/$f")"; cp "$TEMPLATE/$f" "$AGENT_DIR/$f"; echo "설치: $AGENT_DIR/$f" ;;
    *) if [ -e "$AGENT_DIR/$f" ]; then echo "유지: $AGENT_DIR/$f (이미 존재)"
       else mkdir -p "$(dirname "$AGENT_DIR/$f")"; cp "$TEMPLATE/$f" "$AGENT_DIR/$f"; echo "생성: $AGENT_DIR/$f"; fi ;;
  esac
done
# 이미 있던 설정 파일에는 새 판에 추가된 항목(새 모델 등)만 넣는다. 직접 고친 값과 직접 지운 항목은 그대로 (pi 가 쓰는 Node 로 실행)
. "$PI_HOME/bin/find-node.sh"
if PI_MERGE_NODE="$(pi_find_node 2>/dev/null)"; then
  pi_node_exec "$PI_MERGE_NODE" "$PI_HOME/bin/merge-config.mjs" "$TEMPLATE" "$AGENT_DIR" || echo "참고: 위 설정 파일을 확인해 주세요"
else
  echo "참고: Node 를 찾지 못해 기존 설정 파일에 새 항목을 넣지 못했습니다 (Node 를 준비한 뒤 install.sh 를 다시 실행하세요)"
fi
# Windows: Git 이 기본 경로가 아니면 settings.json 에 shellPath 지정
#  - cmd/PowerShell 에서 실행할 때 쓰임 (Git Bash 안에서 실행하면 pi 가 PATH 의 bash.exe 를 찾으므로 없어도 됨)
#  - Python 없이 처리하고, 실패해도 설치는 계속한다 (python 이 Windows 스토어 바로가기뿐인 PC 대비)
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*)
  if [ ! -e "/c/Program Files/Git/bin/bash.exe" ] && ! grep -q '"shellPath"' "$AGENT_DIR/settings.json" 2>/dev/null; then
    GIT_BASH="$(cygpath -m /)"; GIT_BASH="${GIT_BASH%/}/bin/bash.exe"  # Git 설치 폴더의 bin/bash.exe (슬래시 경로라 JSON 이스케이프 불필요)
    [ -e "$GIT_BASH" ] || GIT_BASH="$(cygpath -m /usr/bin/bash.exe)"
    if sed -i "0,/{/s#{#{\n  \"shellPath\": \"${GIT_BASH//&/\\&}\",#" "$AGENT_DIR/settings.json" 2>/dev/null; then
      echo "shellPath=$GIT_BASH"
    else
      echo "참고: settings.json 에 shellPath 를 넣지 못했습니다 (Git Bash 에서 pi 를 실행하면 영향 없음)"
    fi
  fi;;
esac
PATH_LINE="export PATH=\"$PI_HOME/bin:\$PATH\""
grep -qF "$PI_HOME/bin" "$HOME/.bashrc" 2>/dev/null || { echo "$PATH_LINE" >> "$HOME/.bashrc"; echo "PATH 추가: ~/.bashrc"; }
# Linux: JupyterLab 터미널 등은 로그인 셸(bash -l)이라 ~/.bashrc 를 읽지 않는다
#  -> 로그인 셸이 읽는 파일(~/.bash_profile, ~/.bash_login, ~/.profile 중 있는 것, 없으면 ~/.profile)에도 PATH 한 줄
#  (Windows Git Bash 는 ~/.bash_profile 이 ~/.bashrc 를 읽으므로 건드리지 않음)
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) ;; *)
  LOGIN_RC="$HOME/.profile"
  for f in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do [ -e "$f" ] && { LOGIN_RC="$f"; break; }; done
  grep -qF "$PI_HOME/bin" "$LOGIN_RC" 2>/dev/null || { echo "$PATH_LINE" >> "$LOGIN_RC"; echo "PATH 추가: $LOGIN_RC (로그인 셸용)"; } ;;
esac
echo
"$PI_HOME/check-node.sh" || true
echo
echo "설치 완료. 새 터미널을 열고 'pi --version' 으로 확인하세요. (지금 터미널에서 바로 쓰려면: export PATH=\"$PI_HOME/bin:\$PATH\")"
if [ "$PROFILE" = pc ]; then
  echo "브리지 pi 사용법: $PI_HOME/copilot/README-copilot.md"
  echo "  1) $PI_HOME/copilot/start-chrome.cmd 로 Chrome 전용 창을 열고 Copilot 에 로그인 (jupyter 모드는 Kubeflow 도. Edge 는 start-edge.cmd)"
  echo "  2) pi   또는   pi --jupyter work/프로젝트이름"
else
  echo "그 다음 $AGENT_DIR/models.json 의 baseUrl / 모델 id 를 사내 vLLM 에 맞게 수정하세요 (docs/vLLM-연결.md)."
fi
