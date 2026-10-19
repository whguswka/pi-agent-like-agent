#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""브리지 pi 의 PC 쪽 중계 서버 (Windows PC, Python 3.8+ 표준 라이브러리만 사용)

1) 두뇌: pi 에게 OpenAI 호환 API(/v1/chat/completions)로 보이고, 실제 답은 브라우저(Chrome 또는 Edge 전용 창)의 Copilot 웹 채팅
   탭에 질문해서 받는다 (bridge.py 가 원격 디버깅으로 탭을 조작).
   - 같은 Copilot 대화창을 이어서 쓴다: pi 가 보낸 대화 기록이 이전에 보낸 내용의 연장이면 새로 추가된 부분만 보낸다.
     기록이 달라지면(새 세션, 압축 등) 또는 대화 한도에 닿으면 새 대화를 열고 지침 + 도구 + 대화 내용을 다시 넣는다.
   - Copilot 은 도구 호출 기능이 없으므로, 정해진 코드 블록 형식으로 답하게 하고 그것을 tool_calls 로 바꾼다.
2) 실행 환경(jupyter 모드): pi 확장(extensions/jupyter.ts)이 /jupyter/* 로 부르면, 브라우저의 JupyterLab 탭을
   통로로 Kubeflow 노트북 안에서 명령을 실행하고 파일을 읽고 쓴다 (jupyter.py).
3) 모델 선택: 요청의 model(pi 모델 id)을 Copilot 화면의 모델 이름으로 바꿔(bridge.json 의 copilot_models) 모델 메뉴에서 고른다.
4) 끝난 대화 삭제: 중계 서버가 만든 Copilot 대화를 copilot-chats.json 에 기록해 두고, 새 대화를 열 때와 pi 세션이 끝날 때
   (pi 확장 extensions/copilot-session.ts 가 /v1/session/end 로 알림) 지난 대화를 지운다 (delete_finished_chats).

사용법: python relay.py [--config bridge.json] [--port 8765] [--max-chars 10000]  (메시지 크기는 bridge.json 의 max_chars 로도)
먼저 브라우저를 원격 디버깅 포트와 함께 실행해야 한다 (start-chrome.cmd 또는 start-edge.cmd).
"""
import argparse
import base64
import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.parse
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bridge  # noqa: E402
import events  # noqa: E402
from jupyter import FsError, Jupyter  # noqa: E402

# 끊김·제한 기록 (events.py): 요청마다 어떻게 끝났는지를 내용 없이 한 줄씩. main() 이 파일을 정함 (시험에서는 꺼져 있음)
EVENTS = events.EventLog()
# 오류 기록에 안내 문구를 함께 남기는 종류 (서비스·중계 서버가 만든 정해진 문구라 요청·답의 글이 섞이지 않음)
MSG_KINDS = {"throttle", "privacy", "privacy_held", "login", "config", "browser", "tab", "no_reply_start", "reply_not_done", "input", "send",
             "marker_missing"}

MODEL_ID = "copilot"
PROTOCOL_TAG = "PI-COPILOT-PROTOCOL v2"
# 코드를 바꾸면 올린다. bin/pi 가 실행 중인 중계 서버의 버전(/health)과 다르면 끄고(/shutdown) 새로 켠다
RELAY_VERSION = "2026-10-19.1"

# 지금 하는 일: GET /status 가 잠금·브라우저 조작 없이 바로 돌려준다 (pi 확장이 상태 줄에 1초마다 표시)
STATUS = {"busy": False, "phase": "", "since": 0.0, "started": 0.0}
# 메모리: GET /memory 가 20초에 한 번만 잼 (pi 확장이 30초마다 물음. 탭 연결은 쓰지 않으므로 요청 처리 중이어도 됨)
MEMORY = {"at": 0.0, "browser": None, "relay": None}
STARTED = 0  # 중계 서버를 켠 시각 (설정 파일을 읽기 직전, 초). /health 로 알려 bin/pi 가 그 뒤에 바뀐 설정을 알아봄
_tls = threading.local()  # 지금 스레드가 일하는 창의 상태 (max_tabs 가 2 이상이면 창마다 따로)


def set_phase(phase):
    st = getattr(_tls, "status", None) or STATUS
    if phase != st["phase"]:
        st["phase"], st["since"] = phase, time.time()


def status(st=None):
    st = st or STATUS
    now = time.time()
    return {"busy": st["busy"], "phase": st["phase"] if st["busy"] else "",
            "seconds": round(now - st["since"], 1) if st["busy"] else 0,
            "total_seconds": round(now - st["started"], 1) if st["busy"] else 0, "version": RELAY_VERSION}


# ---------------------------------------------------------------------------
# 대화 내용 -> 비교용 지문
# ---------------------------------------------------------------------------


def content_text(content):
    """OpenAI message content(문자열 또는 parts 배열) -> 텍스트"""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    texts = []
    for part in content:
        if isinstance(part, dict):
            if part.get("type") == "text":
                texts.append(part.get("text", ""))
            elif part.get("type") in ("image_url", "input_image"):
                texts.append("[그림]")
    return "\n".join(texts)


# 그림: pi 는 그림을 볼 수 있는 모델(models.json 의 input 에 image)이면 사용자 메시지와 도구 결과의 그림을 image_url(data: 주소)로 보낸다.
#  도구 결과(read 로 연 그림 파일 등)의 그림은 결과 뒤에 이 글로 시작하는 사용자 메시지로 따로 온다
TOOL_IMAGE_TEXT = "Attached image(s) from tool result"
MAX_IMAGES = 4  # 한 번에 붙이는 그림 수
# 그림 하나의 최대 크기. pi 는 그림을 줄이지 않고 보낸다 (키트의 pi 에는 줄이는 도구가 없어 settings.json 의 images.autoResize 를 끔)
MAX_IMAGE_BYTES = 5 * 1048576


def message_images(m):
    """메시지 안의 그림 -> [{"mime", "data"(base64)}] (data: 주소만)"""
    out = []
    c = m.get("content")
    for part in c if isinstance(c, list) else []:
        if not isinstance(part, dict) or part.get("type") not in ("image_url", "input_image"):
            continue
        url = part.get("image_url")
        url = url.get("url") if isinstance(url, dict) else (url or part.get("url") or "")
        mm = re.match(r"^data:(image/[\w.+-]+);base64,(.+)$", str(url or ""), re.S)
        if mm:
            out.append({"mime": mm.group(1), "data": mm.group(2).strip()})
    return out


def tool_image_message(m):
    """pi 가 도구 결과의 그림을 담아 보내는 사용자 메시지인지 (사람이 쓴 요청이 아님)"""
    c = m.get("content")
    return (m.get("role") == "user" and isinstance(c, list) and bool(c) and isinstance(c[0], dict)
            and str(c[0].get("text") or "").startswith(TOOL_IMAGE_TEXT))


def norm(text):
    return re.sub(r"\s+", " ", text or "").strip()


def norm_args(args):
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            return norm(args)
    return json.dumps(args, ensure_ascii=False, sort_keys=True)


def fingerprint(msg):
    role = msg.get("role")
    if role in ("system", "developer"):
        key = ["system", hashlib.sha256(content_text(msg.get("content")).encode()).hexdigest()]
    elif role == "assistant" and msg.get("tool_calls"):
        key = ["assistant", [[tc.get("function", {}).get("name"), norm_args(tc.get("function", {}).get("arguments", "{}"))]
                              for tc in msg["tool_calls"]]]
    elif role == "tool":
        # 도구 결과는 번호(tool_call_id)로만 비교: 에이전트가 맥락을 줄이려고 오래된 도구 결과를 비우거나 요약으로 바꿔도
        # 같은 대화로 이어 간다 (Copilot 쪽 대화창에는 원래 결과가 이미 들어 있음)
        key = ["tool", msg.get("tool_call_id")]
    else:
        key = [role, norm(content_text(msg.get("content")))]
    return json.dumps(key, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Copilot 에 보낼 텍스트 만들기
# ---------------------------------------------------------------------------

# Copilot 은 역할을 바꾸라는 지시("You are ...")를 거부하므로, 사용자가 직접 부탁하는 말투로 쓴다
PREAMBLE = """[{tag}]
안녕하세요. 저는 제 컴퓨터의 터미널에서 'pi' 라는 작업 실행 도구를 쓰고 있습니다.
아래 요청을 단계별로 진행하려고 하니, 다음에 할 작업을 정해진 형식으로 알려 주세요. 실행은 제가 pi 로 직접 합니다.
(작업하는 환경과 폴더는 맨 아래 '작업 규칙'에 적혀 있습니다.)

진행 방식
1. 다음에 할 작업 하나를 아래 형식의 코드 블록 하나로만 적어 주세요. 당신이 직접 실행할 필요는 없습니다.
```json
{{"tool": "<도구 이름>", "arguments": {{ ... }}}}
```
2. 제가 실행한 결과를 다음 메시지에 "TOOL_RESULT" 로 붙여 드립니다. 결과를 추측하거나 지어내지 말고, 블록을 쓴 뒤에는 멈춰 주세요.
3. 긴 파일을 새로 쓰거나 통째로 바꿀 때는 JSON 대신 이 형식을 써도 됩니다 (이스케이프 불필요):
```text
@tool write path=<파일 경로>
<파일 전체 내용>
```
   파일 내용에 ``` 가 들어 있으면 바깥 블록은 ````text 로 열고 ```` 로 닫아 주세요 (backtick 4개).
   여러 줄 글을 받는 다른 도구도 같은 방식으로 `@tool <도구> 이름=값` 줄 다음에 글을 이어 쓰면 됩니다.
4. 요청이 끝났으면 코드 블록 없이 결과를 정리해서 답해 주세요.
- JSON 은 올바른 형식이어야 합니다 (문자열 안 줄바꿈은 \\n, 따옴표는 \\").
- 한 번에 블록 하나만 써 주세요.{multi_read}
- 메시지 끝의 [pi-xxxxxx] 표시는 무시하세요.{extra}

사용할 수 있는 도구
{tools}

작업 규칙 (참고)
{system}
"""

# Copilot 이 "직접 실행할 수 없다"며 거절하면 한 번 설명하고 다시 부탁한다
REFUSAL_RE = re.compile(r"(실행|접근|확인)(할|하실)? ?수 ?[는가]? ?없|(can ?not|can't|unable to) (run|execute|access)|주장할 ?수 ?는? ?없"
                         # 자기 도구로 직접 찾아보고 "작업 환경에 존재하지 않습니다" 처럼 답함 (도구를 직접 쓰는 채팅 서비스)
                         r"|(작업 ?환경|파일 ?시스템|이 환경)[^\n]{0,30}(존재하지 않|없습니다|확인되지 않|찾을 수 없)", re.I)
REFUSAL_NUDGE = ("괜찮습니다. 직접 실행하실 필요는 없습니다. 실행은 제가 pi 로 하고 결과를 그대로 붙여 드릴게요. "
                 "요청을 진행하기 위한 다음 작업 하나를 정해진 형식의 코드 블록(json)으로만 적어 주세요.")

# 대화가 길어지면 Copilot 이 맨 처음 받은 진행 규칙을 놓친다 (시험: 질문 80개를 넘자 도구 대신 중간에 멈추는 답이 더 많아짐)
#  -> 질문 15개 이후 10개마다 짧은 규칙 요약을 붙인다
#     (매번 "블록으로 주세요" 를 강하게 붙였더니 할 일이 없는데도 같은 블록을 반복하는 일이 생겨, 최종 답 안내를 앞에 둠)
REMIND_AFTER = 15
REMIND_EVERY = 10
PROTOCOL_REMINDER = ("(참고 - 진행 방식: 요청이 끝났으면 코드 블록 없이 최종 답을 주세요. 더 할 작업이 있으면 다음 작업 하나만 "
                     "```json {{\"tool\": \"<도구>\", \"arguments\": {{...}}}}``` 블록으로 주세요 (파일 전체 쓰기는 "
                     "```text @tool write path=<경로> ...```).{multi_read} 이미 한 작업을 똑같이 반복하지 마세요. 도구: {tools}.)")
# multi_read (bridge.json, 기본 켜짐. 사내AI 는 꺼짐): 살펴보기만 하는 작업(read, 읽기만 하는 bash 명령 등)은 블록 여러 개를
#  한 번에 받는다 (왕복 횟수 줄이기). pi 는 한 답의 도구들을 동시에 실행하므로, 순서가 중요한 쓰기·명령 실행은 지금처럼 하나씩
MULTI_READ_RULE = (" 단, 살펴보기만 하는 작업(read, 그리고 ls·cat·grep·git status·kubectl get·pip list 처럼 읽기만 하는 bash 명령)은 "
                   "블록 여러 개({n}개까지)를 한 번에 써도 됩니다 (결과를 한꺼번에 드립니다). 파일을 바꾸거나 앞 결과를 보고 정할 작업은 하나씩 써 주세요.")
MULTI_READ_HINT = " 살펴보기만 하는 작업(read, 읽기만 하는 명령)은 블록 여러 개를 한 번에 써도 됩니다."

# 같은 도구 호출(도구·인자 같음)이 연달아 반복되면 끊는다 (시험: 같은 write 를 8초마다 60번 넘게 반복한 일이 있었음)
LOOP_LIMIT = 2  # 직전에 이미 연속 2번 같은 호출이 있었으면 3번째는 반복으로 본다
LOOP_NUDGE = ("방금 주신 작업({name})은 바로 앞에서 이미 {count}번 똑같이 실행했고 결과도 같았습니다. "
              "같은 작업을 다시 하지 마시고, 다음 단계로 넘어가거나 요청이 끝났다면 블록 없이 최종 답을 주세요.")
LOOP_STOP = "같은 작업({name})이 계속 반복되어 여기서 멈췄습니다. 요청을 조금 바꾸거나 나눠서 다시 시도해 주세요."


def repeated_calls(messages, call):
    """새 도구 호출과 똑같은 호출이 바로 앞에 연달아 몇 번 있었는지 (도구 결과는 건너뛰고, 다른 메시지가 나오면 멈춤)
    결과까지 같아야 반복으로 센다: 가장 최근의 같은 호출과 결과가 다른 호출이 나오면 거기서 멈춤
    (예: 학습 로그를 'tail -n 3 train.log' 로 지켜보는 것은 결과가 계속 바뀌므로 반복이 아님)"""
    fp = fingerprint({"role": "assistant", "tool_calls": [{"function": {
        "name": call["name"], "arguments": json.dumps(call["arguments"], ensure_ascii=False)}}]})
    results = {m.get("tool_call_id"): content_text(m.get("content")) for m in messages if m.get("role") == "tool"}
    count, last = 0, None
    for m in reversed(messages):
        if m.get("role") == "tool":
            continue
        if m.get("role") == "assistant" and m.get("tool_calls") and fingerprint(m) == fp:
            res = [results.get(tc.get("id")) for tc in m["tool_calls"]]
            if count and res != last:
                break
            count, last = count + 1, res
            continue
        break
    return count

# 일을 마치지 않고 "다음 블록을 드리겠습니다", "결과를 본 다음" 처럼 멈추면 한 번 이어서 하도록 부탁한다
CONTINUE_NUDGE = ("아직 끝나지 않았다면 기다리지 마시고 다음 작업을 블록 하나로 바로 주세요. 명령을 글로 보여 주시면 제가 실행할 수 없어요. "
                  "모두 끝났다면 결과를 최종 답으로 정리해 주세요.")
UNFINISHED_RE = re.compile(r"다음 (블록|단계|작업)을? ?(을 )?(드리|진행|하겠|주시)|다음 (단계|작업)는 |결과를 (보|확인)[^\n]{0,12}(다음|뒤|후)|실행해 ?(주시면|보시고|주세요)|"
                           r"완료되지 않|아직 (끝나지|완료되지)|❌|(next|following) (step|block)|once you (run|share)", re.I)
# 사용자가 도구 없이 답하라고 했거나 계획 모드(pi 의 /plan, 요청 앞에 "[계획 모드]")면 도구를 쓰라고 다시 부탁하지 않는다
#  (계획을 적은 답에는 "다음 단계는", 코드 예시, "실행할 수 없" 같은 말이 자연스럽게 들어감)
NO_TOOLS_RE = re.compile(r"도구는? (쓰지|사용하지) ?말|도구 없이|\[계획 모드\]")

# 서비스가 개인정보·민감 정보 확인으로 답하지 않음 (사내AI 등): 다시 부탁하지 않고 멈춰서 그 답을 그대로 pi 에 알린다.
#  짧고 코드 블록이 없으며, 개인정보 낱말과 거절 표현이 함께 있을 때만
#  (분석 결과의 "이 테이블에는 개인정보 컬럼이 포함되어 있습니다" 같은 답은 거절이 아님)
PRIVACY_TERM_RE = re.compile(r"개인 ?정보|민감한? ?정보|중요 ?정보|기밀 ?정보|personal (data|information)|sensitive (data|information)", re.I)
PRIVACY_REFUSAL_RE = re.compile(
    r"(공유|입력|전송|제공|업로드)(하지|하시지) ?(않|마)"
    r"|(답변|응답|처리|진행|도움|분석)[을를이가]? ?(드리|해 ?드리|하)?(기|는 ?것이?)? ?(어렵|힘들|곤란)"
    r"|(답변|응답|처리|진행|분석|도와)[을를]? ?(드릴|해 ?드릴|할|하실|해) ?수 ?(가 |는 )?없"
    r"|(can ?not|can't|unable to|not able to) (help|assist|process|answer|continue)", re.I)
REFUSED_STATUS = 422  # pi 에 돌려주는 오류 번호 (인증 오류처럼 보이지 않게 401/403 은 쓰지 않음)


def privacy_refusal(reply, mid=False):
    """mid: 나눠 보낸 메시지의 중간 조각에 온 답. 'OK' 만 답해야 하므로, 막는 문구 뒤에 다른 글이 섞여 길어져도
    (예: 막힌 뒤 전용 창에 직접 입력한 말과 그 답) 앞부분으로 알아본다. 놓치면 막힌 조각을 빼고 나머지 조각만 보내게 됨"""
    text = (reply.get("text") or "").strip()
    if mid and PRIVACY_TERM_RE.search(text[:300]) and PRIVACY_REFUSAL_RE.search(text[:300]):
        return True
    if not text or len(text) > 500 or reply.get("code_blocks") or sum(1 for ln in text.split("\n") if ln.strip()) > 8:
        return False
    return bool(PRIVACY_TERM_RE.search(text) and PRIVACY_REFUSAL_RE.search(text))


# 막힌 조각에서 개인정보 모양 글 찾기: 보내는 글은 바꾸지 않고, 어디에 있는지만 pi 에 알려 사람이 빼도록 한다
PERSONAL_RES = [
    ("이메일 주소", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")),
    ("전화번호", re.compile(r"(?<!\d)01[016789][- .]?\d{3,4}[- .]?\d{4}(?!\d)")),
    ("주민등록번호 모양 번호", re.compile(r"(?<!\d)\d{6}-[1-4]\d{6}(?!\d)")),
]


def personal_values(text):
    """개인정보 모양 글 자체. 막힌 글을 다음 요청에 다시 보내지 않으려고 중계 서버 메모리에만 둔다 (로그·파일에는 남기지 않음)"""
    return {m.group(0) for _, rx in PERSONAL_RES for m in rx.finditer(text or "")}


def spot_advice(spots):
    """찾은 곳에 따라 빼는 방법: 지침·스킬 파일은 고친 뒤 /reload, 앞 대화(명령 결과·요청 글 등)에 남은 것은 /new"""
    files = any("번째 줄의" in s or s.startswith("스킬") for s in spots)
    talk = any(s.startswith(("도구 결과", "앞 답변", "요청 글", "보낸 글")) for s in spots)
    todo = (["지침·스킬 파일이면 고친 뒤 /reload"] if files else []) + (["앞 대화(명령 결과·요청 글)에 있으면 /new 로 새로 시작"] if talk else [])
    return ", ".join(todo) or "/new 로 새로 시작"


def personal_spots(text, limit=3, only=None):
    """보낸 글에서 개인정보 모양 글이 있는 곳 (예: '~/.pi/agent/AGENTS.md 19번째 줄의 이메일 주소 (se…@example.com)').
    pi 지침 파일(<project_instructions path=…>)이면 파일과 줄, 스킬 설명·도구 결과·요청 글이면 그 이름. only: 이 글들만"""
    home = os.path.expanduser("~").replace("\\", "/").rstrip("/")

    def short(p):
        q = p.replace("\\", "/")
        return "~" + q[len(home):] if home and q.lower().startswith(home.lower() + "/") else q

    def hint(kind, v):
        if kind == "이메일 주소":
            user, _, domain = v.partition("@")
            return " ({}…@{})".format(user[:2], domain)
        return " ({}…{})".format(v[:3], v[-2:]) if kind == "전화번호" else ""

    def where(s):
        tag = text.rfind("<project_instructions path=", 0, s)
        if tag >= 0 and text.find("</project_instructions>", tag, s) < 0:
            m = re.match(r'<project_instructions path="([^"]*)">\r?\n?', text[tag:])
            if m:
                return "{} {}번째 줄".format(short(m.group(1)), text.count("\n", tag + m.end(), s) + 1)
        sk = text.rfind("<skill>", 0, s)
        if sk >= 0 and text.find("</skill>", sk, s) < 0:
            loc = re.search(r"<location>([^<]*)</location>", text[sk:sk + 3000])
            return "스킬 {}".format(short(loc.group(1))) if loc else "스킬 설명"
        heads = {"TOOL_RESULT (": None, "[요청]": "요청 글", "[이전 답변]": "앞 답변", "[답변]": "앞 답변"}
        pos, label = max(((text.rfind(h, 0, s), h) for h in heads), key=lambda x: x[0])
        if pos < 0:
            return "보낸 글"
        if label == "TOOL_RESULT (":
            name = re.match(r"TOOL_RESULT \(([^)]*)\)", text[pos:])
            return "도구 결과 ({})".format(name.group(1) if name else "?")
        return heads[label]

    found = []
    for kind, rx in PERSONAL_RES:
        for m in rx.finditer(text):
            if only is not None and m.group(0) not in only:
                continue
            spot = "{}의 {}{}".format(where(m.start()), kind, hint(kind, m.group(0)))
            if spot not in found:
                found.append(spot)
    return found[:limit] + (["외 {}곳".format(len(found) - limit)] if len(found) > limit else [])


class PrivacyRefused(Exception):
    """서비스가 개인정보·민감 정보 확인으로 답하지 않음. part/total: 나눠 보낸 메시지에서 거절한 조각 (마지막 조각이면 None).
    sent: 막힌 조각의 글 (개인정보 모양 글이 어디 있는지 찾는 데만 씀. 모르면 None)"""

    def __init__(self, text, part=None, total=None, sent=None):
        super().__init__(text)
        self.text, self.part, self.total, self.sent = text, part, total, sent


# pi 가 맥락 한도에 닿아 앞 대화를 요약할 때(compaction, /compact) 보내는 요청: 대화 전체가 메시지 하나(<conversation>)에 들어 있다.
# 아주 긴 세션이면 수십만~수백만 자 -> 조각(max_chars)마다 Copilot 왕복이 한 번씩이라 오래 걸리고, 대화 한도에 걸려 요약이 실패한다.
# 너무 길면 대화의 앞(처음 요청)과 뒤(최근 작업)만 남기고 가운데를 줄인다. 이전 요약과 요약 형식 안내는 그대로
SUMMARY_SYSTEM_MARK = "context summarization assistant"  # pi 의 요약 요청 시스템 지시문에 있는 말
SUMMARY_CONV_CHARS = 60000  # 대화 부분 최대 글자 (조각 6~7개)
SUMMARY_HEAD_CHARS = 15000  # 그중 앞부분


def shorten_summary_request(messages):
    """pi 의 요약 요청이고 대화 부분이 너무 길면 가운데를 줄인 messages, 아니면 받은 messages 그대로"""
    if not any(m.get("role") in ("system", "developer") and SUMMARY_SYSTEM_MARK in content_text(m.get("content"))
               for m in messages):
        return messages
    out, changed = [], False
    for m in messages:
        text = content_text(m.get("content")) if m.get("role") == "user" else ""
        mm = re.match(r"<conversation>\n(.*)\n</conversation>\n", text, re.S)
        if not mm or len(mm.group(1)) <= SUMMARY_CONV_CHARS:
            out.append(m)
            continue
        conv = mm.group(1)
        head = conv[:SUMMARY_HEAD_CHARS]
        tail = conv[-(SUMMARY_CONV_CHARS - SUMMARY_HEAD_CHARS):]
        head = head[:head.rfind("\n")] if "\n" in head else head  # 줄 가운데에서 끊기지 않게
        tail = tail[tail.find("\n") + 1:] if "\n" in tail else tail
        note = ("\n\n[... 대화가 길어 가운데 {}자를 줄였습니다 (중계 서버: Copilot 메시지 크기 때문). "
                "앞은 처음 요청, 뒤는 최근 작업입니다 ...]\n\n").format(len(conv) - len(head) - len(tail))
        out.append(dict(m, content=text[:mm.start(1)] + head + note + tail + text[mm.end(1):]))
        changed = True
    return out if changed else messages


def last_user_text(messages):
    for m in reversed(messages):
        if m.get("role") == "user" and not tool_image_message(m):
            return content_text(m.get("content"))
    return ""


def tools_used_since_user(messages):
    """마지막 사용자 요청 뒤로 도구를 쓴 적이 있으면 True (도구 호출 또는 도구 결과)"""
    last_user = max((i for i, m in enumerate(messages) if m.get("role") == "user" and not tool_image_message(m)), default=-1)
    return any(m.get("tool_calls") or m.get("role") == "tool" for m in messages[last_user + 1:])


# 파일을 만들거나 고치라는 요청인데, 도구 블록 없이 코드만 보여 주고 끝내면 한 번 다시 부탁한다
#  (설명·예시만 원한 요청이었을 수도 있으므로, 그랬다면 방금 답을 다시 최종 답으로 달라고 덧붙임)
CODE_NUDGE = ("코드를 보여 주시기만 하면 제가 파일로 만들 수가 없어요. 파일은 아래 형식의 write 블록 하나로 만들어 주시고, "
              "실행이나 확인이 필요하면 그다음에 bash 블록으로 요청해 주세요. "
              "설명이나 예시만 필요한 요청이었다면 방금 답을 그대로 최종 답으로 다시 주세요.\n"
              "```text\n@tool write path=<파일 경로>\n<파일 전체 내용>\n```")
CHANGE_REQUEST_RE = re.compile(r"만들|작성|추가|수정|고쳐|고치|바꿔|저장|생성|확장|구현|리팩터|\b(create|write|add|fix|modify|update|implement)\b", re.I)
# 방법·예시를 묻는 질문 ("파일 만드는 방법 알려줘", "...은 어떻게 고쳐?")은 코드 예시가 곧 답이므로 write 를 부탁하지 않는다
HOWTO_RE = re.compile(r"예시(만|로)|예제(만|로)|알려 ?줘|설명해|궁금|[?？]\s*$")  # "README 에 설명을 추가해줘" 같은 고치기 요청은 해당 없음
PROGRAM_FENCE_RE = re.compile(r"```[ \t]*(python|py|bash|sh|shell|javascript|js|typescript|ts|java|go|rust|sql|r|c|cpp|c\+\+|"
                              r"html|css|yaml|yml|toml|ini|dockerfile|makefile|powershell|ps1)[ \t]*\n", re.I)


def wants_files_but_none_written(messages):
    """마지막 사용자 요청이 파일 생성·수정인데, 그 뒤로 도구를 한 번도 쓰지 않고 바로 답했으면 True
    (도구를 쓴 뒤의 답에 있는 코드는 결과 보고·설명일 수 있으므로 다시 부탁하지 않는다)"""
    text = last_user_text(messages)
    if not CHANGE_REQUEST_RE.search(text) or HOWTO_RE.search(text):
        return False
    return not tools_used_since_user(messages)


ROLE_LINE_RE = re.compile(r"\s*(you are\b|너는\s|당신은\s)", re.I)


def system_for_copilot(system):
    """시스템 프롬프트 맨 앞의 역할 지정 줄("You are ...", "너는 ...", "당신은 ...")은 빼고 나머지 규칙만 참고로 전달
    (Copilot 은 역할을 바꾸라는 지시를 거부하므로). 첫 문단에서 그 줄만 빼고 나머지 줄은 남긴다"""
    paras = [p for p in system.strip().split("\n\n") if p.strip()]
    if paras and ROLE_LINE_RE.match(paras[0]):
        rest = paras[0].strip().split("\n", 1)[1:]
        paras = ([rest[0]] if rest and rest[0].strip() else []) + paras[1:]
    return "\n\n".join(paras) or "(없음)"


def names_of(tools):
    return {(t.get("function") or t).get("name") for t in tools or []}


def render_tools(tools):
    lines = []
    for t in tools or []:
        f = t.get("function", t)
        params = f.get("parameters") or {}
        lines.append("- {}: {}\n  parameters: {}".format(
            f.get("name"), norm(f.get("description", "")), json.dumps(params, ensure_ascii=False, separators=(",", ":"))))
    return "\n".join(lines) if lines else "(no tools)"


# 도구 결과를 줄인 자리에 적는 안내: 모델이 잘린 내용이 필요하면 좁혀서 다시 보게 한다
OMIT_HINT = "필요한 부분은 grep·sed -n·tail 로 좁혀 다시 실행하거나, 파일이면 read 의 offset·limit 으로 나눠 읽으세요"


def truncate_middle(text, limit):
    """limit 자를 넘으면 앞(60%)과 끝만 남기고 가운데를 줄인다 (pi 가 결과 끝에 붙이는 'Full output: 파일' 안내는 남음)"""
    if len(text) <= limit:
        return text
    head = int(limit * 0.6)
    tail = max(0, limit - head - len(OMIT_HINT) - 30)
    omitted = len(text) - head - tail
    return text[:head] + "\n...[{}자 생략: {}]...\n".format(omitted, OMIT_HINT) + (text[-tail:] if tail else "")


class Renderer:
    def __init__(self, tool_result_chars):
        self.tool_result_chars = tool_result_chars

    def tool_names_by_id(self, messages):
        names = {}
        for m in messages:
            for tc in m.get("tool_calls") or []:
                names[tc.get("id")] = tc.get("function", {}).get("name", "?")
        return names

    def message(self, m, names, limit=None):
        role = m.get("role")
        text = content_text(m.get("content")).strip()
        if tool_image_message(m):
            return "(앞 도구 결과의 그림 {}개)".format(len(message_images(m)) or text.count("[그림]"))
        if role == "user":
            return "[요청]\n" + text
        if role == "tool":
            body = truncate_middle(text, limit or self.tool_result_chars)
            # 결과 안의 ``` 는 바꾸지 않고(''' 로 바꾸면 Copilot 이 그 내용을 그대로 옮겨 쓸 때 파일이 달라짐),
            # 안에 있는 가장 긴 ` 줄보다 긴 울타리로 감싼다 (최소 3개)
            fence = "`" * max(3, max((len(r) for r in re.findall(r"`+", body)), default=0) + 1)
            return "TOOL_RESULT ({}):\n{f}text\n{}\n{f}".format(names.get(m.get("tool_call_id"), "?"), body, f=fence)
        if role == "assistant":
            parts = [text] if text else []
            for tc in m.get("tool_calls") or []:
                f = tc.get("function", {})
                parts.append("(실행 요청: {} {})".format(f.get("name"), norm_args(f.get("arguments", "{}"))))
            return "[이전 답변]\n" + "\n".join(parts)
        return "{}:\n{}".format(str(role).upper(), text)

    def brief(self, m, names):
        """새 대화에 다시 넣을 때 오래된 기록용 요약 한 줄"""
        role = m.get("role")
        text = norm(content_text(m.get("content")))
        if role == "user":
            return "[요청] " + text[:300]
        if role == "tool":
            return "TOOL_RESULT ({}): {}".format(names.get(m.get("tool_call_id"), "?"), text[:150])
        if role == "assistant":
            calls = ["(실행 요청: {} {})".format(tc.get("function", {}).get("name"),
                                              norm_args(tc.get("function", {}).get("arguments", "{}"))[:150])
                     for tc in m.get("tool_calls") or []]
            return " ".join(([("[답변] " + text[:300])] if text else []) + calls) or "[답변]"
        return "{}: {}".format(str(role).upper(), text[:200])


def split_text(text, limit):
    """limit 이하 조각으로 나누기 (문단 경계 우선, 긴 문단은 줄 경계, 아주 긴 줄만 글자 단위)"""
    pieces = []
    for para in text.split("\n\n"):
        if len(para) + 2 <= limit:
            pieces.append(para + "\n\n")
            continue
        for line in para.split("\n"):
            line += "\n"
            while len(line) > limit:
                pieces.append(line[:limit])
                line = line[limit:]
            pieces.append(line)
        pieces.append("\n")
    parts, cur = [], ""
    for piece in pieces:
        if cur and len(cur) + len(piece) > limit:
            parts.append(cur)
            cur = ""
        cur += piece
    if cur.strip():
        parts.append(cur)
    # 앞뒤 줄바꿈만 뺀다 (조각이 들여쓴 코드 줄로 시작할 수 있으므로 앞의 공백은 그대로)
    return [p.strip("\n") for p in parts if p.strip()]


def build_parts(body, max_chars, marker):
    """Copilot 메시지 크기 제한에 맞춰 나누고, 앞부분 조각에는 'OK 만 답하라' 를 붙인다"""
    suffix = "\n\n" + marker
    room = max_chars - len(suffix)
    if len(body) <= room:
        return [body + suffix]
    note_room = room - 160
    chunks = split_text(body, note_room)
    n = len(chunks)
    out = []
    for i, c in enumerate(chunks, 1):
        if i < n:
            out.append("(긴 메시지의 {}/{} 부분입니다. 아직 답하지 말고 OK 라고만 답해 주세요.)\n\n{}{}".format(i, n, c, suffix))
        else:
            out.append("(긴 메시지의 {}/{} 부분, 마지막입니다. 이제 전체 내용에 대해 답해 주세요.)\n\n{}{}".format(i, n, c, suffix))
    return out


# ---------------------------------------------------------------------------
# Copilot 답 -> 도구 호출 해석
# ---------------------------------------------------------------------------

# 코드 블록 울타리 줄: 앞 공백 3개까지 + ` 3개 이상 + 언어 이름 등 (` 없음)
FENCE_LINE_RE = re.compile(r" {0,3}(`{3,})([^`]*)$")
NEAREST_FENCE_RE = re.compile(r"```[ \t]*([^\n`]*)\n(.*?)```", re.S)  # 예전 방식: 가장 가까운 ``` 에서 끝 (끝나지 않은 블록 뒤에만 씀)


def fenced_blocks(text):
    """답 원문(markdown)의 코드 블록 -> [{"lang", "text", "span": (시작, 끝)}] (span 은 울타리 줄까지 포함한 글자 위치)
    파일 내용 안에 코드 블록이 들어 있어도(README 의 ```bash ... ```) 바깥 블록이 거기서 끝나지 않도록 줄 단위로 센다:
     - 블록 안에서 언어 이름이 붙은 울타리(```bash)는 안쪽 블록의 시작, 이름 없는 울타리(```)는 안쪽 블록이 있으면 그 끝
     - 안쪽 블록이 없을 때 이름 없는 울타리는 여는 울타리보다 ` 가 적지 않아야 바깥 블록의 끝 (````text 안의 ``` 는 내용)
     - 끝나지 않은 블록은 블록으로 보지 않는다"""
    blocks, cur, pos = [], None, 0
    for line in text.split("\n"):
        start, pos = pos, pos + len(line) + 1
        m = FENCE_LINE_RE.match(line)
        if cur is None:
            if m:
                cur = {"lang": m.group(2).strip(), "n": len(m.group(1)), "depth": 0, "lines": [], "start": start}
            continue
        if m and m.group(2).strip():  # 안쪽 블록 시작
            cur["depth"] += 1
        elif m and cur["depth"]:  # 안쪽 블록 끝
            cur["depth"] -= 1
        elif m and len(m.group(1)) >= cur["n"]:  # 바깥 블록 끝
            blocks.append({"lang": cur["lang"], "text": "".join(ln + "\n" for ln in cur["lines"]),
                           "span": (cur["start"], start + len(line))})
            cur = None
            continue
        cur["lines"].append(line)
    if cur is not None:
        # 끝나지 않은 블록: Copilot 이 블록 하나를 닫지 않고 다음 블록을 연 경우 등. 그 뒤는 예전 방식(가장 가까운 ``` 에서 끝)으로 본다
        for m in NEAREST_FENCE_RE.finditer(text, cur["start"]):
            blocks.append({"lang": m.group(1).strip(), "text": m.group(2), "span": (m.start(), m.end())})
    return blocks


def cut_spans(text, blocks):
    """text 에서 코드 블록(울타리 포함) 부분을 뺀 나머지 글"""
    out, pos = [], 0
    for b in blocks:
        out.append(text[pos:b["span"][0]])
        pos = b["span"][1]
    return "".join(out) + text[pos:]


def repair_json(s):
    """흔한 오류 보정: 문자열 안의 실제 줄바꿈/탭, 끝의 쉼표
    (잘못된 역슬래시는 고치지 않는다: \\d 처럼 살려야 하는지 \\] 처럼 빼야 하는지 알 수 없어서, 다시 부탁한다)"""
    out, in_str, esc = [], False, False
    for ch in s:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            elif ch == "\n":
                out.append("\\n")
                continue
            elif ch == "\r":
                continue
            elif ch == "\t":
                out.append("\\t")
                continue
        elif ch == '"':
            in_str = True
        elif ch in "}]":  # 끝의 쉼표는 문자열 밖에서만 뺀다 (문자열 안의 r'[,]' 같은 글자는 그대로)
            j = len(out) - 1
            while j >= 0 and out[j] in (" ", "\t", "\r", "\n"):
                j -= 1
            if j >= 0 and out[j] == ",":
                del out[j]
        out.append(ch)
    return "".join(out)


# '@tool <도구> 이름=값' 형식에서 둘째 줄부터의 여러 줄 글을 받는 인자 (도구 정의의 인자 이름으로 정함: bash 의 command,
# write 의 content, 확장 도구의 text 등). 그중 파일 내용처럼 기호가 바뀌면 안 되는 인자는 코드 블록 밖이면 다시 부탁한다
REST_PARAMS = ("command", "content", "text")
CONTENT_PARAMS = ("content", "text")


def tool_table(tools):
    """요청의 도구 목록 -> {도구 이름: 둘째 줄부터의 글을 넣을 인자 이름 (없으면 None)}"""
    table = {}
    for t in tools or []:
        f = t.get("function") or t
        props = (f.get("parameters") or {}).get("properties") or {}
        table[f.get("name")] = next((p for p in REST_PARAMS if (props.get(p) or {}).get("type") == "string"), None)
    return table


def rest_param(tool_names, name):
    """둘째 줄부터의 글을 넣을 인자. 도구 목록이 이름만 있는 set 이면 bash 의 command, write 의 content"""
    if isinstance(tool_names, dict):
        return tool_names.get(name)
    return {"bash": "command", "write": "content"}.get(name)


def parse_block(text, lang, tool_names):
    """코드 블록 하나 -> (call dict | None, 오류 문자열 | None). tool_names: tool_table() 의 표 (또는 이름 set)"""
    s = (text or "").strip("\n")
    # 렌더링된 화면에서 읽으면 첫 줄에 언어 이름(json, text 등)만 있는 경우가 있음
    first = s.split("\n", 1)[0].strip().lower()
    if first in ("json", "text", "tool_call", "javascript", "plaintext") and "\n" in s:
        s = s.split("\n", 1)[1]
    st = s.strip()
    m = re.match(r"@tool[ \t]+write[ \t]+path=([^\n]+)\n?", st)
    if m:
        path = m.group(1).strip().strip('"\'')
        if "<" in path or ">" in path:  # 형식 예시(<파일 경로>)를 그대로 옮겨 적은 것
            return None, "형식 예시의 경로({})를 그대로 쓰셨습니다. 실제 파일 경로를 넣어 주세요".format(path)
        content = st[m.end():]
        return {"name": "write", "arguments": {"path": path, "content": content.rstrip("\n") + "\n"}}, None
    # '@tool <도구> 이름=값' 형식: Copilot 이 write 형식을 흉내 내 다른 도구도 '@tool read path=a.py' 처럼 쓰는 경우(긴 대화에서
    #  실제로 나옴)와, 여러 줄 글을 받는 도구(bash 의 명령, 확장 도구의 내용)를 이스케이프 없이 쓰는 경우.
    #  첫 줄의 이름=값을 인자로, 둘째 줄부터는 그 도구의 여러 줄 글 인자(rest_param)로
    m = re.match(r"@tool[ \t]+(\w+)([^\n]*)\n?", st)
    if m and m.group(1) in tool_names:
        name = m.group(1)
        args = {k: v.strip("\"'") for k, v in re.findall(r"(\w+)=(\"[^\"]*\"|'[^']*'|\S+)", m.group(2))}
        args = {k: int(v) if v.isdigit() and k in ("offset", "limit", "timeout") else v for k, v in args.items()}
        # 형식 예시(<경로> 등)를 그대로 옮겨 적은 것은 첫 줄의 값만 본다 (명령·내용에는 '<<' 같은 기호가 있을 수 있음)
        if any("<" in str(v) for v in args.values()):
            return None, "형식 예시의 값({})을 그대로 쓰셨습니다. 실제 값을 넣어 주세요".format(args)
        rp = rest_param(tool_names, name)
        rest = st[m.end():]
        rest = rest.strip() if rp == "command" else rest.strip("\n").rstrip() + "\n"
        if rp and rp not in args and rest.strip():
            args[rp] = rest
        if args:
            return {"name": name, "arguments": args}, None
        return None, "'@tool {}' 형식에서 인자를 찾지 못했습니다. json 블록으로 주세요".format(name)
    # 도구 호출은 "tool" 이 있거나, "name" 과 함께 "arguments"/"args"/"input" 이 있는 JSON 만
    #  (최종 답에 든 예시 JSON {"name": "my-app", "version": "1.0.0"} 은 도구 블록이 아니므로 다시 부탁하지 않는다)
    if not (st.startswith("{") and ('"tool"' in st or ('"name"' in st and re.search(r'"(arguments|args|input)"', st)))):
        return None, None
    obj, err = None, None
    for candidate in (st, repair_json(st)):
        try:
            obj = json.loads(candidate)
            break
        except Exception as e:  # noqa: BLE001
            err = str(e)
    if not isinstance(obj, dict):
        hint = ""
        if "escape" in (err or "").lower():
            hint = (" - JSON 문자열 안의 역슬래시는 \\\\ 처럼 두 번 써야 합니다. 파일 내용을 쓰는 거라면 이스케이프가 필요 없는 "
                    "```text @tool write path=<경로>``` 형식을 쓰세요")
        return None, "JSON 해석 실패: {}{}".format(err, hint)
    if "tool" not in obj and not ("name" in obj and any(k in obj for k in ("arguments", "args", "input"))):
        return None, None
    name = obj.get("tool") or obj.get("name")
    if not isinstance(name, str):
        return None, "도구 이름(tool)은 문자열이어야 합니다 (예: \"tool\": \"read\")"
    args = obj.get("arguments", obj.get("args", obj.get("input", {})))
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            try:
                args = json.loads(repair_json(args))
            except Exception:
                return None, "arguments 가 JSON 객체가 아닙니다"
    if name not in tool_names:
        return None, "알 수 없는 도구 '{}' (사용 가능: {})".format(name, ", ".join(sorted(tool_names)))
    if not isinstance(args, dict):
        return None, "arguments 가 객체가 아닙니다"
    return {"name": name, "arguments": args}, None


def parse_reply(reply, tool_names):
    """bridge 가 돌려준 답 -> (본문 텍스트, call | None, 오류 | None)"""
    text = reply.get("text") or ""
    fenced = fenced_blocks(text)
    blocks = reply.get("code_blocks") or fenced  # 화면에서 읽은 코드 블록이 없으면 원문(markdown)에서
    first_err = None
    for b in blocks:
        call, err = parse_block(b.get("text", ""), b.get("lang", ""), tool_names)
        if call:
            body = reply.get("text_without_code")
            if body is None:
                body = cut_spans(text, fenced)
            return body.strip(), call, None
        if err and not first_err:
            first_err = err
    # 울타리(```) 없이 온 블록 (Copilot 이 가끔 울타리를 빼고 씀)
    #  - 답 첫머리(300자 안)의 '@tool <도구>' 줄: read·bash 같은 짧은 도구는 그대로 받는다
    #    (긴 설명 중간에 나오는 것은 형식 설명일 수 있으므로 도구로 보지 않음)
    #    블록은 '@tool' 줄부터 첫 빈 줄까지만: 뒤에 이어지는 설명(예: "결과를 본 뒤 `git commit` 하겠습니다")이
    #    명령에 섞여 실행되지 않게 하고, 그 설명은 본문으로 남긴다
    #  - 파일 내용(write)은 코드 블록 밖에 있으면 마크다운 때문에 기호가 바뀔 수 있어(실제: ] 가 \] 로) 다시 부탁한다
    #  - 답 전체가 JSON 도구 블록이면 그대로
    st = text.strip()
    m = re.search(r"(?m)^@tool[ \t]+\w+", st)
    if m and m.start() <= 300:
        blank = re.compile(r"\n[ \t\r]*\n").search(st, m.start())
        end = blank.start() if blank else len(st)
        call, err = parse_block(st[m.start():end], "", tool_names)
        if call and (call["name"] == "write" or rest_param(tool_names, call["name"]) in CONTENT_PARAMS):
            call, err = None, ("파일 내용이 코드 블록(```) 밖에 있어 일부 기호가 바뀔 수 있습니다. "
                               "같은 내용을 ```text 코드 블록 안에 넣어 다시 주세요")
        if call:
            return "\n\n".join(p for p in (st[:m.start()].strip(), st[end:].strip()) if p), call, None
        first_err = first_err or err
    elif st.startswith("{") and st.endswith("}"):
        call, err = parse_block(st, "", tool_names)
        if call:
            return "", call, None
        first_err = first_err or err
    # 코드 블록이 하나도 없고 글 속에 JSON 도구 블록이 있을 때 (사내AI 등 화면에서 읽은 답: 인라인 코드나
    # 'json' 표시가 붙은 채로 읽힘. 예: 'json{"tool": "bash", ...}'). 파일 내용(write·edit)은 기호가 바뀌었을 수 있어 다시 부탁
    if not blocks and not first_err:
        span = find_tool_json(st)
        if span:
            call, err = parse_block(st[span[0]:span[1]], "json", tool_names)
            if call and (call["name"] in ("write", "edit") or rest_param(tool_names, call["name"]) in CONTENT_PARAMS):
                call, err = None, ("파일 내용이 코드 블록(```) 밖에 있어 일부 기호가 바뀔 수 있습니다. "
                                   "같은 내용을 ```json 코드 블록 안에 넣어 다시 주세요")
            if call:
                head = re.sub(r"(?i)\bjson\s*$", "", st[:span[0]]).strip()
                return "\n\n".join(p for p in (head, st[span[1]:].strip()) if p), call, None
            first_err = err
    return st, None, first_err


TOOL_JSON_RE = re.compile(r'\{\s*"tool"\s*:')


def find_tool_json(text):
    """글 속 JSON 도구 블록 {"tool": ...} 의 (시작, 끝). 괄호 짝을 세되 문자열 안의 괄호는 세지 않는다. 없으면 None"""
    for m in TOOL_JSON_RE.finditer(text):
        depth, in_str, esc = 0, False, False
        for i in range(m.start(), len(text)):
            c = text[i]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
            elif c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return m.start(), i + 1
    return None


def reply_calls(reply, tool_names):
    """답의 코드 블록 중 도구 호출 목록 (도구 블록이 아닌 코드는 건너뜀, 형식이 틀린 블록에서 멈춤)"""
    blocks = reply.get("code_blocks") or fenced_blocks(reply.get("text") or "")
    calls = []
    for b in blocks:
        call, err = parse_block(b.get("text", ""), b.get("lang", ""), tool_names)
        if call is None and err is None:  # 도구 블록이 아닌 코드 (예시 등)
            continue
        if not call:
            break
        calls.append(call)
    return calls


# ── 읽기만 하는 명령 (multi_read 로 한 번에 돌려도 되는 것) ─────────────────────────
# pi 쪽 modes.ts 의 판단(계획 모드)보다 좁게: 모르는 명령·문법이면 '아님' (그러면 지금처럼 하나씩).
# 잘못 '읽기만' 으로 봐도 pi 의 위험 명령 확인·작업 모드는 명령마다 그대로 걸리고, 순서만 어긋날 수 있다
BATCH_MAX = 5
LOOK_TOOLS = {"read", "grep", "find", "ls", "wiki_search", "wiki_read"}
READ_CMDS = set((
    "ls pwd cd cat head tail grep egrep fgrep rg wc du df stat file which whereis type realpath readlink basename dirname "
    "diff cmp comm cut tr nl column jq echo printf true false test [ seq date id whoami groups uname ps pgrep free uptime "
    "nproc lscpu lsblk md5sum sha1sum sha256sum sha512sum cksum od hexdump strings printenv locale sort uniq tree find sed "
    "awk gawk hostname").split())
VERSION_ONLY = set("python python3 node java javac go gcc g++ make cmake rustc cargo perl ruby uv nvcc npm conda pip pip3 "
                   "kubectl helm docker git jupyter".split())
# 이름은 읽기용이지만 쓰거나 다른 프로그램을 실행하거나 끝나지 않는 옵션 (짧은 옵션은 붙여 쓸 수 있으므로 글자 묶음 안에서도 찾음)
WRITE_FLAG = {
    "sort": re.compile(r"^-[bcCdfghiMmnRrsuVz]*o|^--(o|co)"),
    "date": re.compile(r"^-[uR]*s|^--s"),
    "tree": re.compile(r"^-[a-zA-Z]*o"),
    "rg": re.compile(r"^--pre"),
    "file": re.compile(r"^-[a-zA-Z]*C|^--compile"),
    "tail": re.compile(r"^-[a-zA-Z0-9]*[fF]|^--(f|retry)"),  # -f 따라가기: 끝나지 않음
}
SHELL_OPS = ("&&", "||", "|&", ">>", "&>", ">&", "<&", ">|", ";;", "|", ";", "&", ">", "<", "(", ")")


def shell_words(cmd):
    """셸 명령 -> 단순 명령마다 낱말 목록 (| && || ; 로 나눔). 읽기만 하는지 볼 수 없는 문법이면 None:
    여러 줄, 명령 치환 $( ) ``, <( ) >( ), here-doc, 뒤에서 돌리기 &, ( ) 묶음, /dev/null 이 아닌 곳으로 출력"""
    if not cmd.strip() or any(x in cmd for x in ("\n", "\r", "`", "$(", "<(", ">(", "<<")):
        return None
    toks, word, has, i, n = [], [], False, 0, len(cmd)
    while i < n:
        c = cmd[i]
        if c in " \t":
            if has:
                toks.append(("w", "".join(word)))
            word, has, i = [], False, i + 1
        elif c == "'":
            j = cmd.find("'", i + 1)
            if j < 0:
                return None
            word.append(cmd[i + 1:j])
            has, i = True, j + 1
        elif c == '"':
            j, buf = i + 1, []
            while j < n and cmd[j] != '"':
                if cmd[j] == "\\" and j + 1 < n:
                    buf.append(cmd[j + 1] if cmd[j + 1] in '"\\$' else cmd[j:j + 2])
                    j += 2
                else:
                    buf.append(cmd[j])
                    j += 1
            if j >= n:
                return None
            word.append("".join(buf))
            has, i = True, j + 1
        elif c == "\\":
            if i + 1 >= n:
                return None
            word.append(cmd[i + 1])
            has, i = True, i + 2
        else:
            op = next((o for o in SHELL_OPS if cmd.startswith(o, i)), None)
            if op:
                if has:
                    toks.append(("w", "".join(word)))
                word, has = [], False
                toks.append(("op", op))
                i += len(op)
            else:
                word.append(c)
                has, i = True, i + 1
    if has:
        toks.append(("w", "".join(word)))
    out, words, k = [], [], 0
    while k < len(toks):
        kind, t = toks[k]
        nxt = toks[k + 1] if k + 1 < len(toks) else ("op", "")
        if kind == "w":
            words.append(t)
        elif t in ("|", "||", "&&", ";", "|&"):
            if not words:
                return None
            out.append(words)
            words = []
        elif t in (">", ">>", ">|", "&>"):
            if nxt != ("w", "/dev/null"):
                return None
            k += 1
        elif t in (">&", "<&"):
            if nxt[0] != "w" or nxt[1] not in ("1", "2", "-"):
                return None
            k += 1
        elif t == "<":
            if nxt[0] != "w":
                return None
            k += 1
        else:
            return None
        k += 1
    if not words:  # 끝이 | && || 이면 아님 (끝의 ; 하나는 됨: "ls -la;")
        return out if out and toks[-1] == ("op", ";") else None
    out.append(words)
    return out


def _sub(args, with_value=()):
    """옵션을 건너뛴 첫 낱말과 그 뒤 (kubectl -n ns get pods -> get, [pods])"""
    k = 0
    while k < len(args):
        a = args[k]
        if not a.startswith("-") or a == "-":
            return a, args[k + 1:]
        if "=" not in a and a in with_value:
            k += 1
        k += 1
    return "", []


def _git_read(args):
    name, rest = _sub(args, ("-C", "--git-dir", "--work-tree", "--namespace"))
    if any(a == "-c" or a.startswith("--config-env") or a.startswith("--exec-path") for a in args[:len(args) - len(rest)]):
        return False  # 하위 명령 앞의 설정(-c) 은 다른 프로그램을 실행하게 할 수 있음
    if any(re.match(r"^--output(=|$)|^--ext-diff$|^-O|^--open-files-in-pager", a) for a in rest):
        return False
    if name in ("status", "log", "diff", "show", "blame", "ls-files", "ls-tree", "rev-parse", "describe", "shortlog", "grep",
                "cat-file", "show-ref", "for-each-ref", "rev-list", "merge-base", "version"):
        return True
    pos = [a for a in rest if not a.startswith("-")]
    flags = [a for a in rest if a.startswith("-")]
    if name == "branch":
        return not pos and all(f in ("-a", "-r", "-v", "-vv", "--list", "-l", "--show-current", "--all", "--remotes") for f in flags)
    if name in ("remote", "tag"):
        return not pos and all(f in ("-v", "--verbose", "-l", "--list") for f in flags)
    if name == "stash":
        return pos[:1] == ["list"]
    if name == "config":
        return any(f in ("--get", "--get-all", "--list", "-l", "--get-regexp") for f in flags) and len(pos) <= 1
    return False


_KUBE_VALUE = ("-n", "--namespace", "--context", "--kubeconfig", "--cluster", "--user", "-s", "--server")
# sed 는 줄 범위·패턴 보기(-n '10,20p', '/x/p', '5q')와 s/../../ 바꿔 보이기만 (w 파일로 쓰기, e 명령 실행은 아님)
_SED_PRINT = re.compile(r"^\s*(?:(?:\d+|\$)(?:\s*,\s*(?:\d+|\$|\+\d+))?\s*p|\d+q|/(?:[^/\\\n]|\\.)*/p"
                        r"|s/(?:[^/\\\n]|\\.)*/(?:[^/\\\n]|\\.)*/[gpiI0-9]*)\s*$")


def _sed_read(args):
    """sed: 아는 옵션만 (-i 고치기, -f 스크립트 파일은 아님), 스크립트는 _SED_PRINT 만"""
    scripts, files, k = [], [], 0
    while k < len(args):
        a = args[k]
        if a in ("-e", "--expression"):
            if k + 1 >= len(args):
                return False
            scripts.append(args[k + 1])
            k += 2
            continue
        if a.startswith("--expression="):
            scripts.append(a.split("=", 1)[1])
        elif a.startswith("-") and a != "-":
            if a not in ("--quiet", "--silent", "--regexp-extended") and not re.match(r"^-[nErsuz]+$", a):
                return False
        else:
            files.append(a)
        k += 1
    if not scripts:
        if not files:
            return False
        scripts.append(files.pop(0))
    return all(_SED_PRINT.match(x) for sc in scripts for x in sc.split(";") if x.strip())


def read_only_words(w):
    """단순 명령 하나(낱말 목록)가 읽기만 하는지 (모르면 False)"""
    if not w or "/" in w[0] or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", w[0]):
        return False  # 경로로 부른 프로그램(./ls), 변수 대입 (X=1 cmd)
    name, args = w[0], w[1:]
    if name in VERSION_ONLY and args in (["--version"], ["-V"]):
        return True
    if name == "command":
        return args[:1] in (["-v"], ["-V"])  # command -v 이름 (있는지 보기). 그냥 command 는 그 명령을 실행
    if name == "env":
        return not args  # env 이름=값 명령 은 그 명령을 실행
    if name in ("python", "python3") and args[:2] == ["-m", "pip"]:
        name, args = "pip", args[2:]
    if name in ("pip", "pip3"):
        return _sub(args)[0] in ("list", "show", "freeze", "check")
    if name == "conda":
        sub, rest = _sub(args, ("-n", "--name", "-p", "--prefix"))
        return sub in ("list", "info") or (sub == "env" and rest[:1] == ["list"])
    if name == "git":
        return _git_read(args)
    if name == "kubectl":
        if any(re.match(r"^(-w|-f|--watch|--follow)(=|$)|^--watch-only", a) for a in args):
            return False  # 따라가기(끝나지 않음). get -f 파일 도 같은 글자라 함께 뺌
        sub, rest = _sub(args, _KUBE_VALUE)
        nxt = _sub(rest, _KUBE_VALUE)[0]
        return (sub in ("get", "describe", "logs", "top", "version", "explain", "api-resources", "api-versions", "cluster-info", "events")
                or (sub == "config" and nxt in ("view", "get-contexts", "current-context"))
                or (sub == "auth" and nxt == "can-i"))
    if name == "helm":
        if any(re.match(r"^--(output-dir|post-renderer|dependency-update)(=|$)", a) for a in args):
            return False
        return _sub(args, ("-n", "--namespace", "--kube-context", "--kubeconfig"))[0] in (
            "list", "ls", "status", "get", "history", "show", "version", "env", "template", "lint", "search")
    if name == "docker":
        if any(re.match(r"^(-f|--follow)$", a) for a in args):
            return False
        return _sub(args, ("-H", "--host", "--context", "--config"))[0] in ("ps", "images", "logs", "inspect", "version", "info")
    if name == "jupyter":
        return args[:1] in (["--version"], ["--paths"]) or (len(args) >= 2 and args[1] == "list")
    if name == "nvidia-smi":
        return not any(re.match(r"^-(pm|e|p|c|r|ac|rac|acp|pl|am|caa|lgc|rgc|lmc|rmc|mig|cgi|dgi|cci|dci|l|lms)$|^--(persistence-mode|"
                                r"ecc-config|reset-ecc|compute-mode|gpu-reset|applications-clocks|reset-applications-clocks|"
                                r"power-limit|lock-|reset-|loop)", a) for a in args)
    if name not in READ_CMDS:
        return False
    if name in WRITE_FLAG and any(WRITE_FLAG[name].search(a) for a in args):
        return False
    pos = [a for a in args if not a.startswith("-")]
    if name == "sed":
        return _sed_read(args)
    if name in ("awk", "gawk"):
        k = 0
        while k < len(args) and args[k].startswith("-") and args[k] not in ("-", "--"):
            if not re.match(r"^-[Fv]", args[k]):
                return False  # -f 프로그램 파일, -i 불러오기 등
            k += 2 if len(args[k]) == 2 else 1
        prog = args[k] if k < len(args) else ""
        return not re.search(r"[|>@]|system|getline|close\(|fflush", prog)
    if name == "find":
        return not any(re.match(r"^-(delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)$", a) for a in args)
    if name == "uniq":
        return len(pos) <= 1  # 두 번째 이름은 출력 파일
    if name == "hostname":
        return not args
    return True


def read_only_command(cmd):
    """bash 명령이 읽기만 하는지 (모르면 False)"""
    parts = shell_words(str(cmd or ""))
    return bool(parts) and all(read_only_words(w) for w in parts)


def look_call(call):
    """살펴보기만 하는 도구 호출인지 (multi_read 로 한 번에 돌려도 되는 것)"""
    args = call.get("arguments") or {}
    return call["name"] in LOOK_TOOLS or (call["name"] == "bash" and read_only_command(args.get("command")))


# ---------------------------------------------------------------------------
# Copilot 탭 (같은 프로세스에서 bridge.Copilot 으로 직접 조작)
# ---------------------------------------------------------------------------


class RelayError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class ThreadReset(Exception):
    """Copilot 대화를 이어갈 수 없음 (대화 한도, 대화창이 바뀜, 탭 다시 연결) -> 새 대화로 다시"""


def copilot_model_for(model_id, cfg):
    """pi 가 고른 모델 id -> Copilot 화면의 모델 이름 ("" 이면 화면에 선택된 모델 그대로)
    copilot_models 표에 있으면 그 이름, 'copilot'(또는 없음)이면 copilot_model, 표에 없는 id 는 id 자체를 화면 이름으로 쓴다"""
    mid = (model_id or "").strip()
    table = cfg.get("copilot_models") or {}
    if mid in table:
        return table[mid] or ""
    if not mid or mid == MODEL_ID:
        return cfg.get("copilot_model") or ""
    return mid


def default_registry_path():
    agent = os.environ.get("PI_CODING_AGENT_DIR") or os.path.join(os.path.expanduser("~"), ".pi", "agent")
    return os.path.join(agent, "copilot-chats.json")


class ChatRegistry:
    """중계 서버가 만든 Copilot 대화 목록. 삭제는 이 목록에 있는 대화만 한다 (사용자가 직접 쓴 대화는 건드리지 않음)
    파일에 남겨 두므로 중계 서버를 다시 켜도 이어서 정리한다. state: active(쓰는 중) / finished(삭제 대상)"""
    MAX_TRIES = 3

    def __init__(self, path):
        self.path = path
        self.chats = []
        self.lock = threading.RLock()  # 창 여러 개(max_tabs)가 함께 씀
        try:
            with open(path, encoding="utf-8") as f:
                self.chats = json.load(f).get("chats") or []
        except (OSError, ValueError):
            pass
        for c in self.chats:  # 지난번에 쓰던 대화는 이어 쓰지 않으므로 삭제 대상
            if c.get("state") in ("active", "deleting"):
                c["state"] = "finished"

    def save(self):
        with self.lock:
            self._save()

    def _save(self):
        try:
            os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump({"chats": self.chats}, f, ensure_ascii=False, indent=1)
            os.replace(tmp, self.path)
        except OSError as e:
            bridge.log("대화 목록 저장 실패 ({}): {}".format(self.path, e))

    def add(self, cid, url, owner=None):
        with self.lock:
            if cid and not any(c["id"] == cid for c in self.chats):
                c = {"id": cid, "url": url, "created": time.strftime("%Y-%m-%d %H:%M:%S"), "state": "active", "tries": 0}
                if owner:
                    c["owner"] = owner
                self.chats.append(c)
                self.save()

    def finish_all(self, owner=None):
        """한 창은 한 번에 한 대화만 쓰므로, 새 대화를 열거나 세션이 끝나면 그 창이 쓰던 대화는 끝난 것
        (owner: 창 번호. None 이면 모든 대화 - 창이 하나일 때)"""
        with self.lock:
            changed = False
            for c in self.chats:
                if c["state"] == "active" and (owner is None or c.get("owner") == owner):
                    c["state"], changed = "finished", True
            if changed:
                self.save()

    def pending(self):
        with self.lock:
            return [c for c in self.chats if c["state"] == "finished" and c.get("tries", 0) < self.MAX_TRIES]

    def claim_pending(self):
        """창이 여러 개일 때: 지울 대화를 가져가며 '지우는 중' 으로 표시 (다른 창이 같은 대화를 지우지 않게)"""
        with self.lock:
            out = self.pending()
            for c in out:
                c["state"] = "deleting"
            return out

    def deleted(self, cid):
        with self.lock:
            self.chats = [c for c in self.chats if c["id"] != cid]
            self.save()

    def failed(self, cid):
        with self.lock:
            for c in self.chats:
                if c["id"] == cid:
                    c["tries"] = c.get("tries", 0) + 1
                    if c["state"] == "deleting":
                        c["state"] = "finished"
            self.save()


# Copilot 탭 찾기는 한 번에 한 창씩 (max_tabs): 탭 목록 읽기부터 차지하기(필요하면 새 창 열기)까지 한 번에 해야
#  두 창이 동시에 첫 요청을 받아도 같은 탭을 나눠 갖거나, 다른 창이 막 연 탭을 가져가거나 '닫힌 탭' 으로 지우지 않는다
TAB_LOCK = threading.Lock()


class CopilotLink:
    def __init__(self, cfg, registry=None, owner=None, claims=None, bucket=None):
        self.cfg = cfg
        self.cop = None
        self.asked = 0  # 지금 Copilot 대화에서 보낸 질문 수 (max_questions_per_chat 용)
        self.registry = registry
        self.model_now = None  # 지금 대화에서 고른 Copilot 모델 (화면 이름)
        self.model_failed = None  # 고르지 못한 모델 (같은 대화에서는 다시 시도하지 않음)
        # 창이 여러 개일 때(max_tabs): owner = 창 번호 ("1" 은 처음부터 열려 있던 Copilot 탭),
        # claims = {탭 id: 창 번호} (창끼리 탭을 나눠 가짐), bucket = 모든 창이 함께 쓰는 속도 조절
        self.owner, self.claims = owner, claims
        self.bucket = bucket if bucket is not None else {"lock": threading.Lock()}

    def connect(self):
        if not self.cfg.get("copilot_url_contains"):  # 빈 글자는 모든 주소에 들어 있어 아무 탭(Copilot 탭 등)이나 잡게 됨
            raise RelayError(503, "{} 의 주소가 설정되지 않았습니다. 내 설정 파일(사내AI 는 ~/.pi/agent/inhouse.json)에 "
                                  "copilot_url_contains(주소의 호스트 이름)와 copilot_new_chat_url(새 대화 주소)을 적은 뒤 "
                                  "pi 를 다시 실행하세요 (설정 파일이 바뀌면 중계 서버를 새로 켭니다).".format(
                                      self.cfg.get("service_name") or "Copilot"))
        with TAB_LOCK:
            try:
                tabs = bridge.list_tabs(self.cfg["cdp_port"])
            except bridge.BridgeError as e:
                raise RelayError(503, str(e))
            cop = [t for t in tabs if self.cfg["copilot_url_contains"] in t.get("url", "")]
            if self.claims is not None:
                cop = self.pick_tab(tabs, cop)
            name = self.cfg.get("service_name") or "Copilot"
            if not cop and self.cfg.get("open_tab_if_missing") and self.cfg.get("copilot_new_chat_url"):
                # 사내AI 등: 처음 고르면 전용 창에 탭을 새로 연다 (로그인이 필요하면 그 창에서 로그인한 뒤 다시 요청)
                try:
                    cop = [bridge.open_window(self.cfg["cdp_port"], self.cfg["copilot_new_chat_url"])]
                    bridge.log("{} 탭이 없어 전용 창에 새로 열었습니다".format(name))
                    time.sleep(3)
                except bridge.BridgeError as e:
                    raise RelayError(503, "{} 탭을 열지 못했습니다: {}".format(name, e))
        if not cop:
            raise RelayError(503, "{} 탭을 찾지 못했습니다. start-chrome.cmd(또는 start-edge.cmd)로 연 전용 창에서 {} 에 로그인해 열어 두세요.".format(
                name, self.cfg["copilot_url_contains"]))
        self.cop = bridge.Copilot(bridge.Tab(cop[0]), self.cfg)
        bridge.log("{} 탭 연결: {}".format(name, cop[0].get("url", "")[:90]))

    def pick_tab(self, tabs, cop):
        """창이 여러 개일 때 (connect 가 TAB_LOCK 을 잡고 부름): 이 창이 쓰던 탭 > 아무 창도 안 쓰는 Copilot 탭 > 새 창을 열어서
        창 1 은 처음 탭을 다른 창이 이미 가져갔을 때만 새 창을 연다 (Copilot 탭이 하나도 없으면 로그인부터 하도록 오류)"""
        live = {t.get("id") for t in tabs}
        for tid in [k for k in self.claims if k not in live]:  # 닫힌 탭
            del self.claims[tid]
        mine = [t for t in cop if self.claims.get(t.get("id")) == self.owner]
        if not mine:
            mine = [t for t in cop if t.get("id") not in self.claims]
            if not mine and (self.owner != "1" or cop):
                try:
                    mine = [bridge.open_window(self.cfg["cdp_port"], self.cfg["copilot_new_chat_url"])]
                    bridge.log("Copilot 창 {} 을 새로 열었습니다".format(self.owner))
                except bridge.BridgeError as e:
                    raise RelayError(503, "Copilot 창을 새로 열지 못했습니다: {}".format(e))
            if mine:
                self.claims[mine[0]["id"]] = self.owner
        return mine[:1]

    def drop(self):
        if self.cop:
            self.cop.tab.close()
        self.cop = None

    @property
    def turns_left(self):
        return self.cop.turns_left if self.cop else None

    def pace(self):
        """max_questions_per_minute (0 이면 끔): 분당 질문 수를 넘지 않게 기다린다 (Copilot 사용량 제한 예방)
        처음에는 그 수만큼 바로 보내고, 그 뒤로는 일정한 간격으로 보낸다 (토큰 버킷)"""
        rate = float(self.cfg.get("max_questions_per_minute") or 0)
        if rate <= 0:
            return
        cap, b = max(1.0, rate), self.bucket
        with b["lock"]:  # 창이 여러 개면 모든 창의 질문을 합쳐서 셈 (기다릴 몫을 미리 빼 둠)
            now = time.time()
            last = b.get("time")
            tokens = cap if last is None else min(cap, b["tokens"] + (now - last) * rate / 60)
            wait = 0.0 if tokens >= 1 else (1 - tokens) * 60 / rate
            b["tokens"], b["time"] = tokens - 1, now
        if wait > 0:
            bridge.log("  (속도 조절: 분당 {:g}개 -> {:.0f}초 기다림)".format(rate, wait))
            set_phase("속도 조절로 {:.0f}초 기다리는 중".format(wait))
            time.sleep(wait)

    def ui_state(self):
        """오류 때의 화면 상태 (끊김·제한 기록. 글은 없이 참·거짓만): 입력창 찾음·글 받음·포커스, 응답 중지 단추, 보내기 단추"""
        if self.cop is None:
            return None
        st = self.cop.input_state(self.cop.q(self.cfg.get("input_selector") or ""))
        send = self.cop.js("window.__piBridge.buttons(%s).length > 0" % self.cop.q(self.cfg.get("send_button_pattern") or ""))
        return {"input": st.get("found"), "editable": st.get("editable"), "focused": st.get("focused"), "stop": st.get("busy"),
                "send": bool(send)}

    def cleanup(self):
        """끝난 대화(registry 의 finished) 삭제. 실패해도 요청은 계속한다 (3번까지 다시 시도)"""
        if not self.registry or not self.cfg.get("delete_finished_chats", True):
            return
        for c in (self.registry.claim_pending() if getattr(self, "owner", None) else self.registry.pending()):
            set_phase("지난 대화 정리 중")
            try:
                ok, info = self.cop.delete_chat(c["id"])
            except (bridge.BridgeError, TimeoutError) as e:
                ok, info = False, str(e)
            bridge.log("  지난 Copilot 대화 삭제 {}: {}".format("OK" if ok else "실패", info))
            (self.registry.deleted if ok else self.registry.failed)(c["id"])
            if not ok:
                EVENTS.write({"ev": "warn", "kind": "delete"})  # 안내 문구에는 대화 제목(첫 질문에서 만들어짐)이 들어갈 수 있어 남기지 않음

    def request(self, parts, new_thread, model="", images=None):
        """조각들을 차례로 Copilot 에 보내고 마지막 답을 돌려준다. model 은 Copilot 화면의 모델 이름 ("" 이면 그대로).
        images: 마지막 조각(질문)과 함께 붙일 그림 [{"mime", "data"}]"""
        reconnected = self.cop is None
        if reconnected:
            self.connect()
        try:
            limit = int(self.cfg.get("max_questions_per_chat") or 0)
            if new_thread:
                if self.registry:
                    self.registry.finish_all(self.owner)
                    self.cleanup()
                set_phase("새 대화 여는 중")
                self.cop.new_chat()
                self.asked = 0
                self.model_now = self.model_failed = None  # 새 채팅은 '자동' 으로 돌아감
            else:
                if reconnected:
                    raise ThreadReset("Copilot 탭에 다시 연결했습니다")
                self.cop.check_same_thread()
                if self.cop.turns_left is not None and self.cop.turns_left < len(parts):
                    raise ThreadReset("Copilot 대화의 남은 질문 수가 부족합니다 ({}개)".format(self.cop.turns_left))
                if limit and self.asked + len(parts) > limit:
                    raise ThreadReset("설정한 대화당 질문 수 한도({}개)에 닿았습니다".format(limit))
            if model and model not in (self.model_now, self.model_failed):
                set_phase("모델 고르는 중 ({})".format(model))
                ok, info = self.cop.select_model(model)
                bridge.log("  Copilot 모델 {}: {}".format("선택" if ok else "선택 실패 (지금 모델로 계속)", info))
                if ok:
                    self.model_now = model
                else:
                    self.model_failed = model
                    EVENTS.write({"ev": "warn", "kind": "model_select", "model": model})
            reply, waits, mid_not_ok = None, [], 0
            for i, part in enumerate(parts, 1):
                m = re.search(r"\[pi[-#][0-9a-f]+\]\s*$", part)
                if not m:
                    raise RelayError(500, "요청에 marker 가 없습니다")
                self.pace()
                bridge.log("  -> Copilot 에 보냄 ({}/{}, {}자)".format(i, len(parts), len(part)))
                set_phase("보내는 중{}".format(" ({}/{})".format(i, len(parts)) if len(parts) > 1 else ""))
                if images and i == len(parts):
                    set_phase("그림 붙이는 중")
                    self.cop.send(part, images=images)
                else:
                    self.cop.send(part)
                self.asked += 1
                set_phase("답 기다리는 중{}".format(" ({}/{})".format(i, len(parts)) if len(parts) > 1 else ""))
                reply = self.cop.wait_reply(m.group(0).strip())
                bridge.log("  <- 답 받음 ({}자, 코드 블록 {}개)".format(len(reply.get("text", "")), len(reply.get("code_blocks") or [])))
                waits.append(reply.get("_wait") or {})
                if new_thread and i == 1 and self.registry:  # 첫 답에서 대화 주소가 생김 -> 삭제 대상 목록에 기록
                    # 단, 보낸 메시지(marker)가 아직 화면에 있을 때만: 기다리는 동안 사용자가 전용 창에서 자기 대화를 눌렀다면
                    # 지금 주소는 그 대화이므로 절대 기록하면 안 된다 (확인하지 못하면 기록하지 않음. 지우지 못하고 남는 쪽이 안전)
                    try:
                        url = self.cop.marker_url(m.group(0).strip())
                    except (bridge.BridgeError, TimeoutError, OSError):
                        url = None
                    if url and url == self.cop.thread_url:
                        self.registry.add(bridge.conversation_id(url), url, self.owner)
                    else:
                        bridge.log("  (화면에서 보낸 메시지를 찾지 못해 이 대화는 삭제 목록에 넣지 않습니다: {})".format(
                            self.cop.thread_url))
                if i < len(parts):  # 중간 조각은 'OK' 만 답하라고 했음
                    if privacy_refusal(reply, mid=True):
                        raise PrivacyRefused(reply.get("text", ""), i, len(parts), sent=part)
                    said = norm(reply.get("text", ""))
                    if len(said) > 20 or "ok" not in said.lower():
                        bridge.log("  (Copilot 이 중간 조각에 OK 대신 답함: {})".format(said[:100]))
                        mid_not_ok += 1
            return dict(reply, _waits=waits, _mid_not_ok=mid_not_ok)
        except bridge.Throttled as e:
            # 계정 단위 사용량 제한: 새 대화를 열어도 같은 답이 오므로 열지 않고, 지금 대화는 나중에 그대로 이어 쓴다
            self.throttled_at = time.time()
            raise RelayError(429, "Copilot 사용량 제한에 걸렸습니다: {}. 몇 분~수십 분 뒤 다시 시도하세요 "
                                  "(같은 Copilot 대화에 이어서 보냅니다).".format(e))
        except bridge.ThreadReset as e:
            raise ThreadReset(str(e))
        except bridge.SessionExpired as e:
            raise RelayError(401, str(e))
        except (ConnectionError, OSError, TimeoutError) as e:
            self.drop()  # 탭이 닫혔거나 브라우저 연결이 끊김 -> 다음에 다시 찾아서 새 대화로
            raise ThreadReset("브라우저 Copilot 탭과 연결이 끊겼습니다 ({})".format(e))
        except bridge.BridgeError as e:
            raise RelayError(502, "Copilot 처리 실패: {}".format(e))


# ---------------------------------------------------------------------------
# 중계 본체
# ---------------------------------------------------------------------------


class Relay:
    def __init__(self, args, link):
        self.args = args
        self.link = link
        self.renderer = Renderer(args.tool_result_chars)
        self.lock = threading.Lock()
        self.sent = []  # 현재 Copilot 대화창에 들어가 있는 메시지 지문
        self.fresh = True  # True 면 다음 요청은 새 대화로
        self.redo_same_chat = False  # True 면 다음 요청은 지금 대화에 지침과 기록을 처음부터 다시 (개인정보 확인으로 멈춘 뒤)
        self.reminded_at = 0  # 마지막으로 진행 규칙 요약을 붙였을 때의 질문 수
        self.model_label = ""  # 이번 요청에 쓸 Copilot 모델 (화면 이름)
        self.stat = None  # 이번 요청의 통계 (걸린 시간, 보낸 조각 수, 새 대화, Copilot 에 보낸 횟수) -> '답:' 로그 줄 끝에
        self.status = STATUS  # 진행 상태 (GET /status). 창이 여러 개면 Lanes 가 창마다 따로 줌
        self.requests = 0  # 받은 요청 수 (세션 끝 알림 뒤, 정리하기 전에 새 세션의 요청이 먼저 들어왔는지 보려고)
        self.unrun_note = ""  # 앞 답의 도구 블록 중 실행하지 않은 것이 있으면 다음 메시지에 한 번 알림
        # 서비스가 개인정보 확인으로 막은 글에 있던 개인정보 모양 글. 다음 요청에 그대로 있으면 보내지 않고 바로 알린다
        #  (같은 글을 다시 보내면 또 막혀, 새 대화만 계속 열림). 이 프로세스 메모리에만 두고 로그·파일에는 남기지 않음
        self.blocked = set()

    def log(self, *a):
        bridge.log(*a)

    def ask(self, parts, new_thread, images=None):
        self.log("요청 (새 대화={}, 조각 {}개, {}자{})".format(new_thread, len(parts), sum(len(p) for p in parts),
                                                       ", 모델 " + self.model_label if self.model_label else ""))
        st = self.stat
        if st is not None:
            st["parts"] += len(parts)
            st["asks"] += 1
            st["new"] = st["new"] or new_thread
            st["chars"] = st.get("chars", 0) + sum(len(p) for p in parts)
            st["split"] = st.get("split") or len(parts) > 1
        if images:
            self.log("  그림 {}개를 마지막 조각과 함께 보냄".format(len(images)))
        reply = self.link.request(parts, new_thread, model=self.model_label, **({"images": images} if images else {}))
        if st is not None and isinstance(reply, dict):  # 끊김·제한 기록: 조각마다 답이 어떻게 끝났는지
            st.setdefault("waits", []).extend(w for w in reply.get("_waits") or [] if w)
            st["mid_not_ok"] = st.get("mid_not_ok", 0) + (reply.get("_mid_not_ok") or 0)
        return reply

    def refused(self, e):
        """서비스가 개인정보·민감 정보 확인으로 답하지 않음 -> 다시 부탁하지 않고 멈춰서 그 답을 그대로 pi 에 알린다 (오류 422).
        방금 거절당한 글을 같은 대화에 다시 보내지 않는다 (재전송해도 또 거절되거나 응답이 없어 멈춤).
        다음 요청은 새 대화로 깨끗하게 시작한다 (내용을 줄였으면 되고, 그대로면 다시 바로 422)."""
        name = (getattr(self.link, "cfg", None) or {}).get("service_name") or "Copilot"
        where = " (긴 메시지 {}/{})".format(e.part, e.total) if e.part else ""
        rest = " 나머지 {}개 조각은 보내지 않았습니다.".format(e.total - e.part) if e.part and e.total and e.total > e.part else ""
        # 막힌 글은 그 대화에 남지 않으므로 같은 글로 다시 하면 또 막힌다 -> 개인정보 모양 글이 어디 있는지 알려 사람이 빼도록
        # (보낸 글을 고쳐 다시 보내지는 않음. 무엇을 뺄지는 사람이 정함)
        spots = personal_spots(e.sent) if e.sent else None
        self.blocked = personal_values(e.sent) if e.sent else set()
        if spots:
            found = (" 보낸 글에서 찾은 곳: {}. 같은 글로 다시 하면 또 막히므로, 이 정보가 그대로 있으면 다음 요청은 보내지 않고 바로 알립니다. "
                     "꼭 필요한 정보가 아니면 빼고 다시 하세요 ({}).").format(", ".join(spots), spot_advice(spots))
        elif spots is not None:
            found = (" 같은 글로 다시 하면 또 막힐 수 있습니다. 보낸 글에서 이메일·전화번호 모양 글은 찾지 못했습니다 "
                     "(경로의 사용자 폴더 이름 등 다른 글이 걸렸을 수 있음).")
        else:
            found = " 같은 글로 다시 하면 또 막힐 수 있습니다."
        self.log("{}: 개인정보·민감 정보 확인으로 답하지 않음{} -> 멈춤 (다시 보내지 않음){}".format(
            name, where, ". 찾은 곳: " + ", ".join(re.sub(r" \([^)]*…[^)]*\)$", "", s) for s in spots) if spots else ""))
        self.fresh = True  # 다음 요청은 새 대화로 (거절당한 대화에 같은 글을 다시 밀어 넣지 않음)
        self.redo_same_chat = False
        return RelayError(REFUSED_STATUS, "{}: 개인정보·민감 정보 확인으로 답하지 않았습니다{}. 답: «{}»{}{}".format(
            name, where, norm(e.text)[:300], rest, found))

    def held(self, text):
        """지난번에 막힌 글의 개인정보 모양 글이 이번에 보낼 글에도 있으면, 보내지 않고(새 대화도 열지 않고) 돌려줄 오류. 없으면 None"""
        if not self.blocked:
            return None
        if not any(v in text for v in self.blocked):
            self.blocked = set()  # 뺐음 -> 보냄
            return None
        name = (getattr(self.link, "cfg", None) or {}).get("service_name") or "Copilot"
        spots = personal_spots(text, only=self.blocked)
        self.log("{}: 지난번에 막힌 글이 그대로 있어 보내지 않음. 찾은 곳: {}".format(
            name, ", ".join(re.sub(r" \([^)]*…[^)]*\)$", "", s) for s in spots)))
        return RelayError(REFUSED_STATUS, "{}: 지난번에 개인정보·민감 정보 확인으로 막힌 글이 이번 요청에도 그대로 있어 보내지 않았습니다 "
                                          "(새 대화도 열지 않음). 찾은 곳: {}. 그 정보를 빼고 다시 하세요 ({}).".format(
                                              name, ", ".join(spots), spot_advice(spots)))

    def ask_again(self, text):
        """같은 대화에 이어서 다시 부탁 (형식 오류·거절·반복 등). 첫 질문은 이미 들어갔으므로, 여기서 사용량 제한(429)에
        걸리면 새 대화로 바꾸지 않고 풀린 뒤 지금 대화에 이어서 보낸다"""
        try:
            return self.ask(build_parts(text, self.args.max_chars, "[pi-{}]".format(uuid.uuid4().hex[:6])), False)
        except RelayError as e:
            if e.status == 429:
                self.fresh = False
            raise

    def multi_read(self):
        return bool((getattr(self.link, "cfg", None) or {}).get("multi_read"))

    def stat_text(self):
        """'답:' 줄 끝의 통계. diag.py --report 가 이 형식을 읽어 평균을 낸다: (12.3초 · 조각 2 · 새 대화 · 다시 보냄 1)"""
        st = self.stat
        if not st:
            return ""
        return " ({:.1f}초 · 조각 {}{}{})".format(time.time() - st["t0"], st["parts"], " · 새 대화" if st["new"] else "",
                                             " · 다시 보냄 {}".format(st["asks"] - 1) if st["asks"] > 1 else "")

    def end_session(self, reason="", seen=None):
        """pi 세션이 끝남 (pi 확장 copilot-session.ts 가 알림) -> 다음 요청은 새 대화, 쓰던 대화는 삭제 대상으로 정리
        seen: 끝 알림을 받았을 때의 요청 수. 정리는 뒤에서 하므로 그사이 다른 요청이 먼저 처리됐으면 아무것도 하지 않는다
        (그 요청이 새 대화를 열면서 지난 대화는 이미 정리했거나, 같은 대화를 이어 쓰는 중이므로 지우거나 끊으면 안 됨)"""
        with self.lock:
            if seen is not None and seen != self.requests:
                self.log("pi 세션 끝 ({}) -> 그사이 새 요청이 와서 대화 정리는 건너뜁니다".format(reason or "?"))
                return
            self.sent, self.fresh = [], True
            self.finish_chats(reason)
            self.refresh_tab(reason)

    def finish_chats(self, reason):
        """끝난 세션의 Copilot 대화를 삭제 대상으로 돌리고 지움 (delete_finished_chats)"""
        link = self.link
        registry = getattr(link, "registry", None)
        if registry is None:
            return
        registry.finish_all(getattr(link, "owner", None))
        if not link.cfg.get("delete_finished_chats", True) or not registry.pending():
            return
        self.log("pi 세션 끝 ({}) -> 지난 Copilot 대화 정리".format(reason or "?"))
        try:
            if link.cop is None:
                link.connect()
            link.cleanup()
        except (RelayError, bridge.BridgeError, OSError, TimeoutError) as e:
            self.log("대화 정리 실패:", e)
        if link.cop:
            link.cop.thread_url = None
        link.model_now = link.model_failed = None

    def refresh_tab(self, reason):
        """세션이 끝날 때 이 서비스의 탭이 tab_reload_mb 를 넘게 쓰면 페이지를 새로 읽음 (다음 세션은 가벼운 페이지에서 시작).
        이 중계 서버가 이미 탭에 붙어 있을 때만 (쓰지 않던 서비스의 탭을 새로 열지 않음)"""
        cop = getattr(self.link, "cop", None)
        if cop is None:
            return
        try:
            why = cop.heavy()
            if why is None:
                return
            self.log("pi 세션 끝 ({}) -> Copilot 탭 정리".format(reason or "?"))
            cop.reload_page(why)
            self.link.model_now = self.link.model_failed = None  # 새로 읽은 화면은 모델이 '자동' 으로 돌아감
        except (bridge.BridgeError, OSError, TimeoutError) as e:
            self.log("탭을 새로 읽지 못함:", e)

    def handle(self, body):
        with self.lock:
            self.requests += 1
            self.stat = {"t0": time.time(), "parts": 0, "asks": 0, "new": False}
            _tls.status = self.status
            self.status.update(busy=True, started=time.time())
            set_phase("준비 중")
            try:
                try:
                    try:
                        out = self._handle(body, False)
                    except ThreadReset as e:
                        self.log("Copilot 대화를 새로 시작해서 다시 보냅니다:", e)
                        EVENTS.write({"ev": "reset", "kind": events.classify(str(e), events.RESET_KINDS),
                                      "chat_q": getattr(self.link, "asked", None)})  # 문구에 대화 주소가 들어갈 수 있어 종류만
                        set_phase("새 대화로 다시 보내는 중")
                        out = self._handle(body, True)
                except PrivacyRefused as e:
                    raise self.refused(e)
            except Exception as e:  # noqa: BLE001  끊김·제한 기록 (오류 종류 + 그때까지의 사용량). 오류는 그대로 올려 보냄
                self.record_error(e)
                raise
            else:
                self.record_request(out)
                return out
            finally:
                self.status["busy"] = False
                _tls.status = None

    def note_nudge(self, kind):
        if self.stat is not None:
            self.stat.setdefault("nudges", []).append(kind)

    def note_reply(self, reply):
        """마지막 답의 모양 (끊김·제한 기록: 글자 수, ``` 짝, 코드 블록 수)"""
        if self.stat is not None and isinstance(reply, dict):
            self.stat["shape"] = events.reply_shape(reply.get("text"))
            self.stat["code_blocks"] = len(reply.get("code_blocks") or [])

    def record_request(self, out):
        """끊김·제한 기록: 요청 하나가 어떻게 끝났는지 (내용 없이). 기록이 실패해도 답은 그대로 돌려줌"""
        try:
            self._record_request(out)
        except Exception as e:  # noqa: BLE001
            self.log("(끊김·제한 기록 실패: {})".format(e))

    def _record_request(self, out):
        st = self.stat or {}
        EVENTS.write(dict({"ev": "req", "ms": int((time.time() - st.get("t0", time.time())) * 1000), "new": st.get("new", False),
                           "parts": st.get("parts", 0), "asks": st.get("asks", 0), "chars": st.get("chars", 0),
                           "split": bool(st.get("split")), "model": self.model_label, "nudges": st.get("nudges", []),
                           "waits": st.get("waits", []), "mid_not_ok": st.get("mid_not_ok", 0),
                           "result": "tool" if out.get("tool_calls") else "text",
                           "tool": (out.get("tool_calls") or [{}])[0].get("function", {}).get("name"),
                           "chat_q": getattr(self.link, "asked", None), "turns_left": getattr(self.link, "turns_left", None),
                           "code_blocks": st.get("code_blocks", 0)}, **st.get("shape", {})))

    def record_error(self, e):
        """끊김·제한 기록: 오류 종류, 그때까지의 사용량(최근 10분·60분·24시간 요청 수 등), 입력창 상태 (내용 없이)"""
        try:
            self._record_error(e)
        except Exception as x:  # noqa: BLE001  기록이 실패해도 원래 오류를 그대로 알림
            self.log("(끊김·제한 기록 실패: {})".format(x))

    def _record_error(self, e):
        if isinstance(e, RelayError):
            kind = events.classify(str(e), status=e.status)
        elif isinstance(e, ThreadReset):
            kind = "reset_failed"
        else:
            kind = "internal"
        st = self.stat or {}
        ev = {"ev": "err", "kind": kind, "status": getattr(e, "status", None), "ms": int((time.time() - st.get("t0", time.time())) * 1000),
              "new": st.get("new", False), "parts": st.get("parts", 0), "asks": st.get("asks", 0), "model": self.model_label,
              "chat_q": getattr(self.link, "asked", None), "turns_left": getattr(self.link, "turns_left", None)}
        # 안내 문구는 서비스·중계 서버가 만든 정해진 문구일 때만 (이 PC 안에서만 보며 요약에는 안 나옴).
        # 내부 오류 등은 문구에 경로나 처리하던 글이 섞일 수 있어 예외 이름만
        if kind in MSG_KINDS:
            ev["msg"] = str(e)[:200]
        else:
            ev["exc"] = type(e).__name__
        try:
            ev["ctx"] = events.usage_context(EVENTS.read(time.time() - 86400))
        except (OSError, ValueError):
            pass
        if kind in ("input", "send", "no_reply_start", "reply_not_done", "marker_missing"):
            ui = getattr(self.link, "ui_state", None)
            try:
                ev["ui"] = ui() if ui else None
            except Exception:  # noqa: BLE001  화면 상태를 못 읽어도 기록은 남김
                ev["ui"] = None
        EVENTS.write(ev)

    def _handle(self, body, force_new):
        self.model_label = copilot_model_for(body.get("model"), getattr(self.link, "cfg", None) or {})
        messages = body.get("messages") or []
        short = shorten_summary_request(messages)
        if short is not messages:
            self.log("pi 의 요약 요청(compaction)이 길어 대화 가운데를 줄여 보냅니다")
            messages = short
        tools = body.get("tools") or []
        tool_names = tool_table(tools)  # 이름 -> '@tool' 형식에서 여러 줄 글을 받는 인자
        fps = [fingerprint(m) for m in messages]
        names = self.renderer.tool_names_by_id(messages)
        n = len(self.sent)
        redo, self.redo_same_chat = self.redo_same_chat and not force_new, False
        delta = (not force_new) and (not redo) and (not self.fresh) and n and len(fps) > n and fps[:n] == self.sent
        marker = "[pi-{}]".format(uuid.uuid4().hex[:6])
        # 그림: 이번에 새로 온 메시지(새 대화면 마지막 답 뒤의 메시지)의 것만 붙인다 (앞에서 붙인 그림은 이미 대화에 있음)
        last_a = max((i for i, m in enumerate(messages) if m.get("role") == "assistant"), default=-1)
        turn = messages[n:] if delta else messages[last_a + 1:]
        images = [im for m in turn for im in message_images(m)]
        notes = []
        if images and not (getattr(self.link, "cfg", None) or {}).get("send_images"):
            notes.append("(그림 {}개는 보내지 않았습니다: 이 서비스에는 그림을 보내지 않게 설정됨)".format(len(images)))
            images = []
        big = [im for im in images if len(im["data"]) * 3 // 4 > MAX_IMAGE_BYTES]
        if big:
            notes.append("(그림 {}개는 {}MB 가 넘어 붙이지 않았습니다)".format(len(big), MAX_IMAGE_BYTES // 1048576))
            images = [im for im in images if im not in big]
        if len(images) > MAX_IMAGES:
            notes.append("(그림 {}개 중 앞의 {}개만 붙였습니다)".format(len(images), MAX_IMAGES))
            images = images[:MAX_IMAGES]
        img_note = " ".join(notes)
        if delta:
            new = messages[n:]
            text = "\n\n".join(self.renderer.message(m, names) for m in new)
            if img_note:
                text += "\n\n" + img_note
            if any(m.get("role") == "tool" for m in new):
                if self.unrun_note:
                    text += "\n\n" + self.unrun_note
                text += "\n\n(다음 작업 블록 하나를 주시거나, 요청이 끝났으면 최종 답을 주세요.)"
            self.unrun_note = ""
            asked = getattr(self.link, "asked", 0)
            if asked < self.reminded_at:  # 새 대화로 바뀌었으면 다시 센다
                self.reminded_at = 0
            if tool_names and asked >= REMIND_AFTER and asked - self.reminded_at >= REMIND_EVERY:
                text += "\n\n" + PROTOCOL_REMINDER.format(tools=", ".join(sorted(tool_names)),
                                                         multi_read=MULTI_READ_HINT if self.multi_read() else "")
                self.reminded_at = asked
            parts = build_parts(text, self.args.max_chars, marker)
            new_thread = False
        else:
            parts = self.full_parts(messages, tools, names, marker, img_note)
            new_thread = not redo  # 개인정보 확인으로 멈춘 뒤에는 같은 대화에 처음부터 다시
            self.unrun_note = ""
        held = self.held("\n\n".join(parts))
        if held:
            raise held
        was_fresh, self.fresh = self.fresh, True  # 도중에 실패하면 다음 요청은 새 대화로 (성공하면 아래에서 False)
        try:
            reply = self.ask(parts, new_thread, images)
        except RelayError as e:
            if e.status == 429:  # 사용량 제한은 대화를 바꾸지 않음: 풀린 뒤 같은 대화에 이어서
                self.fresh = was_fresh
            raise
        body_text, call, err = parse_reply(reply, tool_names)
        self.note_reply(reply)
        if call is None and privacy_refusal(reply):  # 다시 부탁하지 않고 멈춤
            raise PrivacyRefused(reply.get("text", ""), sent=parts[-1])
        retries, nudged, code_nudged, cont_nudged = 0, False, False, False
        no_tools = bool(NO_TOOLS_RE.search(last_user_text(messages)))
        while call is None and retries < 2:
            if err:  # 형식이 틀리면 다시 요청
                self.log("도구 블록 오류 -> 다시 요청: {}".format(err))
                fix = ("방금 블록은 사용할 수 없었습니다: {}\n올바른 형식의 코드 블록 하나로 다시 적어 주세요 "
                       "(요청이 끝났다면 블록 없이 최종 답).").format(err)
                self.note_nudge("format")
            elif (not nudged and not no_tools and REFUSAL_RE.search(body_text or "") and tool_names
                  and not tools_used_since_user(messages)):  # 도구를 쓴 뒤의 "확인할 수 없습니다" 는 결과에 대한 보통 답
                self.log("Copilot 이 실행을 거절 -> 설명 후 다시 요청")
                fix, nudged = REFUSAL_NUDGE, True
                self.note_nudge("refusal")
            elif (not code_nudged and not no_tools and "write" in tool_names and PROGRAM_FENCE_RE.search(body_text or "")
                  and wants_files_but_none_written(messages)):
                self.log("Copilot 이 파일을 만들지 않고 코드만 보여 줌 -> write 블록으로 다시 요청")
                fix, code_nudged = CODE_NUDGE, True
                self.note_nudge("code")
            elif not cont_nudged and not no_tools and tool_names and UNFINISHED_RE.search(body_text or ""):
                self.log("Copilot 이 일을 마치지 않고 멈춤 -> 이어서 하도록 다시 요청")
                fix, cont_nudged = CONTINUE_NUDGE, True
                self.note_nudge("continue")
            else:
                break
            retries += 1
            set_phase("다시 부탁하는 중")
            reply = self.ask_again(fix)
            body_text, call, err = parse_reply(reply, tool_names)
            self.note_reply(reply)
            if call is None and privacy_refusal(reply):
                raise PrivacyRefused(reply.get("text", ""))
        if call and repeated_calls(messages, call) >= LOOP_LIMIT:
            count = repeated_calls(messages, call)
            self.log("같은 도구 호출 반복({} {}회) -> 다른 작업을 하도록 다시 요청".format(call["name"], count))
            self.note_nudge("loop")
            reply = self.ask_again(LOOP_NUDGE.format(name=call["name"], count=count))
            body_text, call, err = parse_reply(reply, tool_names)
            self.note_reply(reply)
            if call is None and privacy_refusal(reply):
                raise PrivacyRefused(reply.get("text", ""))
            if call and repeated_calls(messages, call) >= LOOP_LIMIT:
                self.log("반복이 계속됨 -> 이 요청을 멈춤")
                body_text, call = LOOP_STOP.format(name=call["name"]), None
        if call:
            calls = [call]
            found = reply_calls(reply, tool_names)
            if found and found[0] == call:
                if self.multi_read() and look_call(call):
                    k = 1
                    while k < len(found) and k < BATCH_MAX and look_call(found[k]):
                        k += 1
                    calls = found[:k]
                    if k > 1:
                        self.log("  (살펴보기 {}개를 한 번에: {})".format(k, ", ".join(c["name"] for c in calls)))
                left = len(found) - len(calls)
                if left:  # 실행하지 않은 블록은 다음 메시지에 알림 (Copilot 이 실행된 줄로 알고 넘어가지 않게)
                    self.log("  (도구 블록 {}개 중 {}개만 실행)".format(len(found), len(calls)))
                    self.unrun_note = ("(앞 답의 도구 블록 {}개 중 {}만 실행했습니다. 파일을 바꾸거나 앞 결과를 보고 정할 작업은 하나씩 "
                                       "주세요. 나머지가 아직 필요하면 다시 주세요.)").format(
                        len(found), "첫 번째" if len(calls) == 1 else "앞의 {}개".format(len(calls)))
            assistant = {"role": "assistant", "content": body_text or None, "tool_calls": [{
                "id": "call_" + uuid.uuid4().hex[:12], "type": "function",
                "function": {"name": c["name"], "arguments": json.dumps(c["arguments"], ensure_ascii=False)}} for c in calls]}
        else:
            assistant = {"role": "assistant", "content": body_text}
        self.sent = fps + [fingerprint(assistant)]
        self.fresh = False
        self.log("답: {}{}".format("도구 " + call["name"] if call else "본문 {}자".format(len(body_text)), self.stat_text()))
        return assistant

    def full_parts(self, messages, tools, names, marker, note=""):
        system = "\n\n".join(content_text(m.get("content")) for m in messages if m.get("role") in ("system", "developer"))
        rules = (getattr(self.link, "cfg", None) or {}).get("extra_rules") or []  # 서비스별로 덧붙일 진행 규칙
        rules = [rules] if isinstance(rules, str) else rules
        head = PREAMBLE.format(tag=PROTOCOL_TAG, tools=render_tools(tools), system=system_for_copilot(system),
                               multi_read=MULTI_READ_RULE.format(n=BATCH_MAX) if self.multi_read() and "read" in names_of(tools) else "",
                               extra="".join("\n- " + r.strip() for r in rules if r and r.strip()))
        convo = [m for m in messages if m.get("role") not in ("system", "developer")]
        # 새 대화에 다시 넣는 기록: 최근 것은 그대로(full_budget), 그 앞은 한 줄 요약(brief_budget), 더 오래된 것은 생략
        full_budget = getattr(self.args, "resend_recent_chars", None) or self.args.max_chars * 2
        brief_budget = getattr(self.args, "resend_summary_chars", None) or self.args.max_chars * 4
        kept, total, i = [], 0, len(convo) - 1
        while i >= 0:
            r = self.renderer.message(convo[i], names)
            if kept and total + len(r) > full_budget:
                break
            kept.insert(0, r)
            total += len(r)
            i -= 1
        briefs, btotal = [], 0
        while i >= 0:
            b = self.renderer.brief(convo[i], names)
            if btotal + len(b) > brief_budget:
                break
            briefs.insert(0, b)
            btotal += len(b) + 1
            i -= 1
        omitted = i + 1
        convo_text = ""
        if omitted:
            convo_text += "[가장 오래된 메시지 {}개 생략]\n\n".format(omitted)
        if briefs:
            convo_text += "(이전 기록 요약)\n" + "\n".join(briefs) + "\n\n(최근 기록)\n\n"
        convo_text += "\n\n".join(kept)
        if note:
            convo_text += "\n\n" + note
        body = (head + "\n대화 내용\n" + convo_text +
                "\n\n(마지막 요청에 대해 다음 작업 블록 하나를 주시거나, 이미 끝났다면 최종 답을 주세요.)")
        return build_parts(body, self.args.max_chars, marker)

    def reset(self):
        with self.lock:
            self.sent, self.fresh = [], True


class Lanes:
    """max_tabs 가 2 이상일 때: pi 프로세스마다(요청 머리글 X-Pi-Session) Copilot 창을 하나씩 따로 써서 pi 여러 개를 동시에 쓴다.
    창 1 은 처음부터 열려 있던 Copilot 탭(다른 창이 먼저 가져갔으면 새 창), 나머지는 필요할 때 새 창으로 연다.
    세션이 끝나면 그 창은 다음 세션이 이어 쓴다.
    창이 모두 쓰이는 중이면 가장 오래 쉰 창을 넘겨받는다 (넘겨준 세션은 다음 요청 때 새 대화로 이어 감)."""

    def __init__(self, args, cfg, registry, max_tabs):
        self.lock = threading.Lock()
        self.max = max_tabs
        self.args, self.cfg, self.registry = args, cfg, registry
        self.claims, self.bucket = {}, {"lock": threading.Lock()}
        self.lanes = []
        self.add()

    def add(self):
        owner = str(len(self.lanes) + 1)
        relay = Relay(self.args, CopilotLink(self.cfg, self.registry, owner=owner, claims=self.claims, bucket=self.bucket))
        relay.status = {"busy": False, "phase": "", "since": 0.0, "started": 0.0}
        lane = {"relay": relay, "session": None, "used": 0.0, "owner": owner}
        self.lanes.append(lane)
        return lane

    def pick(self, session):
        session = session or ""
        with self.lock:
            now = time.time()
            for lane in self.lanes:
                if lane["session"] == session:
                    lane["used"] = now
                    return lane["relay"]
            free = [ln for ln in self.lanes if ln["session"] is None]
            if free:
                lane = free[0]
            elif len(self.lanes) < self.max:
                lane = self.add()
            else:
                idle = [ln for ln in self.lanes if not ln["relay"].lock.locked()] or self.lanes
                lane = min(idle, key=lambda ln: ln["used"])
                lane["relay"].log("창 {} 을 다른 pi 세션이 넘겨받습니다 (창 {}개 모두 쓰는 중)".format(lane["owner"], self.max))
            lane["session"], lane["used"] = session, now
            return lane["relay"]

    def find(self, session):
        with self.lock:
            for lane in self.lanes:
                if lane["session"] == (session or ""):
                    return lane
        return None

    def end(self, session, reason):
        lane = self.find(session)
        if lane:
            with self.lock:
                lane["session"] = None
            # 지금까지의 요청 수를 함께 넘김: 정리하기 전에 이 창을 넘겨받은 새 세션의 요청이 먼저 오면 정리하지 않음
            threading.Thread(target=lane["relay"].end_session, args=(reason, lane["relay"].requests), daemon=True).start()

    def status(self, session):
        lane = self.find(session)
        return status(lane["relay"].status) if lane else status({"busy": False, "phase": "", "since": 0, "started": 0})

    def terminal(self, session):
        """이 세션이 쓰는 창의 노트북 터미널 이름 (창 1: 기본 pibridge -> None)"""
        relay = self.pick(session)
        owner = getattr(relay.link, "owner", "1")
        return None if owner == "1" else "pibridge{}".format(owner)

    def summary(self):
        with self.lock:
            return [{"window": ln["owner"], "session": ln["session"], "busy": ln["relay"].status["busy"]} for ln in self.lanes]


# ---------------------------------------------------------------------------
# HTTP (OpenAI 호환)
# ---------------------------------------------------------------------------


def fs_op(jup, body):
    """Jupyter 파일 작업 (pi 확장의 read/write/edit 도구용). 경로는 노트북 안의 절대 경로"""
    op, path = body.get("op"), body.get("path") or ""
    if not path.startswith("/"):
        raise FsError("EINVAL", "노트북 안의 절대 경로가 아닙니다: " + path)
    if op == "read":
        return {"data": base64.b64encode(jup.read_file(path)).decode()}
    if op == "write":
        jup.write_file(path, base64.b64decode(body.get("data") or ""))
        return {}
    if op == "read_range":  # 큰 파일 나눠 받기 (/download)
        data, total = jup.read_range(path, int(body.get("start") or 0), int(body.get("end") or 0))
        return {"data": base64.b64encode(data).decode(), "total": total}
    if op == "write_chunk":  # 큰 파일 나눠 올리기 (/upload)
        jup.write_chunk(path, base64.b64decode(body.get("data") or ""), int(body.get("chunk") or 1))
        return {}
    if op == "mkdir":
        jup.mkdir(path)
        return {}
    if op == "stat":
        st = jup.stat(path)
        if not st:
            raise FsError("ENOENT", "ENOENT: no such file or directory, access '{}'".format(path))
        return st
    raise FsError("EINVAL", "알 수 없는 파일 작업: {}".format(op))


def make_handler(relay, jup, cfg, lanes=None):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *a):
            pass

        def send_json(self, status, obj):
            data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def read_body(self):
            length = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(length) or b"{}")

        def jupyter(self, fn):
            """Jupyter 쪽 요청: 실패하면 ok=false 와 오류 문구 (파일 오류는 code 포함)"""
            try:
                out = fn() or {}
                out["ok"] = True
                return self.send_json(200, out)
            except FsError as e:
                return self.send_json(200, {"ok": False, "code": e.code, "error": str(e)})
            except bridge.SessionExpired as e:
                relay.log("Jupyter 오류:", e)
                return self.send_json(401, {"ok": False, "code": "AUTH", "error": str(e)})
            except bridge.BridgeError as e:
                relay.log("Jupyter 오류:", e)
                return self.send_json(503, {"ok": False, "code": "BRIDGE", "error": str(e)})
            except Exception as e:  # noqa: BLE001
                relay.log("Jupyter 처리 오류:", repr(e))
                return self.send_json(500, {"ok": False, "code": "EIO", "error": "중계 서버 내부 오류: {}".format(e)})

        def health(self):
            thr = getattr(relay.link, "throttled_at", None)
            # started: 켠 시각(설정을 읽은 시각). bin/pi 가 그 뒤에 바뀐 설정 파일이 있으면 다시 켠다 (일하는 중(busy)이 아닐 때)
            busy = bool(STATUS["busy"]) or (any(w["busy"] for w in lanes.summary()) if lanes else False)
            out = {"server": "ok", "version": RELAY_VERSION, "started": STARTED, "busy": busy, "thread_messages": len(relay.sent),
                   "copilot_turns_left": relay.link.turns_left,
                   "copilot_throttled_at": time.strftime("%H:%M:%S", time.localtime(thr)) if thr else None,
                   "jupyter": {"root": jup.root, "home": jup.home, "terminal": jup.term}}
            if lanes:
                out["windows"] = lanes.summary()
            try:
                tabs = bridge.list_tabs(cfg["cdp_port"])
                out["copilot_tab"] = any(cfg["copilot_url_contains"] in t.get("url", "") for t in tabs)
                want = cfg.get("jupyter_url_contains") or "/lab"
                out["jupyter_tab"] = any(want in t.get("url", "") for t in tabs)
            except bridge.BridgeError as e:
                out["browser_error"] = str(e)
            return out

        def memory(self):
            """전용 창 전체와 이 중계 서버의 메모리(커밋 MB), pi 가 /new 를 권할 기준 (Windows 가 아니면 None)"""
            if time.time() - MEMORY["at"] > 20:
                MEMORY.update(at=time.time(), browser=bridge.browser_memory(cfg["cdp_port"]), relay=bridge.process_memory(os.getpid()))
            b = MEMORY["browser"] or {}
            return {"browser_mb": b.get("mb"), "browser_top_mb": b.get("top_mb"), "browser_procs": b.get("procs"),
                    "relay_mb": round(MEMORY["relay"] / 1048576) if MEMORY["relay"] else None,
                    "warn_mb": int(cfg.get("memory_warn_mb") or 0), "service": cfg.get("service_name") or "Copilot"}

        def do_GET(self):
            u = urllib.parse.urlsplit(self.path)
            q = urllib.parse.parse_qs(u.query)
            if u.path == "/memory":
                return self.send_json(200, self.memory())
            if u.path.rstrip("/").endswith("/models"):
                # max_model_len: vLLM 과 같은 이름의 맥락 한도. 대화 기억은 Copilot 대화창이 갖고 중계 서버는 새로 추가된 부분만
                # 보내므로, 에이전트가 맥락을 줄이느라 앞부분을 바꾸지 않도록 크게 알려 준다
                ids = [MODEL_ID] + [k for k in (cfg.get("copilot_models") or {}) if k != MODEL_ID]
                return self.send_json(200, {"object": "list", "data": [{"id": i, "object": "model", "owned_by": "copilot-web",
                                                                        "max_model_len": 1000000} for i in ids]})
            if u.path.startswith("/health"):
                return self.send_json(200, self.health())
            if u.path == "/status":  # 잠금·브라우저 조작 없이 바로 (pi 확장이 1초마다 물음)
                return self.send_json(200, lanes.status(q.get("session", [""])[0]) if lanes else status())
            if u.path == "/jupyter/info":
                return self.jupyter(jup.info)
            m = re.match(r"^/jupyter/exec/([0-9a-f]+)$", u.path)
            if m:
                offset = int(q.get("offset", ["0"])[0])
                wait = min(float(q.get("wait", ["0"])[0]), 10.0)
                return self.jupyter(lambda: jup.status(m.group(1), offset, wait))
            self.send_json(404, {"error": {"message": "not found"}})

        def do_POST(self):
            u = urllib.parse.urlsplit(self.path)
            if u.path.startswith("/reset"):
                relay.reset()
                return self.send_json(200, {"reset": True})
            if u.path == "/shutdown":  # 새 코드로 바꿀 때 bin/pi 가 부름 (127.0.0.1 에서만 받음)
                self.send_json(200, {"shutdown": True})
                server = getattr(relay, "server", None)
                if server:
                    threading.Thread(target=server.shutdown, daemon=True).start()
                return None
            try:
                body = self.read_body()
            except Exception:  # noqa: BLE001
                return self.send_json(400, {"error": {"message": "invalid json"}})
            if u.path.rstrip("/").endswith("/session/end"):
                # pi 가 끝나는 중이므로 바로 답하고, 대화 정리는 뒤에서 (설정 다시 읽기 reload 는 같은 대화를 이어 감)
                reason = str(body.get("reason") or "")
                if reason != "reload":
                    if lanes:
                        lanes.end(str(body.get("session") or self.headers.get("X-Pi-Session") or ""), reason)
                    else:  # 지금까지의 요청 수를 함께 넘김 (정리하기 전에 새 세션의 요청이 먼저 오면 그 대화는 건드리지 않게)
                        threading.Thread(target=relay.end_session, args=(reason, relay.requests), daemon=True).start()
                return self.send_json(200, {"ok": True})
            if u.path == "/jupyter/exec":
                # 창이 여러 개면(max_tabs) 창마다 노트북 터미널도 따로: 창 1 은 pibridge, 창 2 는 pibridge2 ...
                term = lanes.terminal(self.headers.get("X-Pi-Session")) if lanes else None

                def go():
                    rid = jup.start(body["cwd"], body["command"], int(body.get("timeout") or 0), term=term)
                    relay.log("Jupyter 실행 {}: {}".format(rid, body["command"].strip().split("\n")[0][:100]))
                    return {"id": rid}
                return self.jupyter(go)
            m = re.match(r"^/jupyter/exec/([0-9a-f]+)/abort$", u.path)
            if m:
                return self.jupyter(lambda: jup.abort(m.group(1)))
            if u.path == "/jupyter/fs":
                return self.jupyter(lambda: fs_op(jup, body))
            if not u.path.rstrip("/").endswith("/chat/completions"):
                return self.send_json(404, {"error": {"message": "not found"}})
            return self.chat(lanes.pick(self.headers.get("X-Pi-Session")) if lanes else relay, body)

        def chat(self, relay, body):
            try:
                msg = relay.handle(body)
            except RelayError as e:
                if e.status != 429:  # 사용량 제한이면 지금 대화를 그대로 둔다 (풀린 뒤 이어서). 개인정보 거절은 refused() 가 새 대화로 정리함
                    relay.reset()
                # 로그에는 찾은 곳만: pi 에 보내는 오류의 개인정보 일부 표시 '(ab…@example.com)' 는 뺌
                relay.log("오류:", re.sub(r" \([^)]*…[^)]*\)", "", str(e)))
                return self.send_json(e.status, {"error": {"message": bridge.service_text(e), "type": "copilot_relay_error"}})
            except ThreadReset as e:
                relay.reset()
                relay.log("오류: 새 대화로도 보내지 못했습니다:", e)
                return self.send_json(503, {"error": {"message": bridge.service_text("Copilot 에 보내지 못했습니다: {}".format(e)),
                                                      "type": "copilot_relay_error"}})
            except Exception as e:  # noqa: BLE001
                relay.reset()
                relay.log("오류:", repr(e))
                return self.send_json(500, {"error": {"message": "중계 서버 내부 오류: {}".format(e)}})
            finish = "tool_calls" if msg.get("tool_calls") else "stop"
            model_id = body.get("model") or MODEL_ID
            created = int(time.time())
            cid = "chatcmpl-" + uuid.uuid4().hex[:12]
            usage = {"prompt_tokens": sum(len(content_text(m.get("content"))) for m in body.get("messages", [])) // 4,
                     "completion_tokens": len(json.dumps(msg, ensure_ascii=False)) // 4}
            usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]
            if not body.get("stream"):
                return self.send_json(200, {"id": cid, "object": "chat.completion", "created": created, "model": model_id,
                                            "choices": [{"index": 0, "message": msg, "finish_reason": finish}], "usage": usage})
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "close")
                self.end_headers()

                def chunk(delta, finish_reason=None, **extra):
                    obj = {"id": cid, "object": "chat.completion.chunk", "created": created, "model": model_id,
                           "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}]}
                    obj.update(extra)
                    self.wfile.write(("data: " + json.dumps(obj, ensure_ascii=False) + "\n\n").encode("utf-8"))

                chunk({"role": "assistant", "content": msg.get("content") or ""})
                for i, tc in enumerate(msg.get("tool_calls") or []):
                    chunk({"tool_calls": [dict(tc, index=i)]})
                chunk({}, finish)
                usage_chunk = {"id": cid, "object": "chat.completion.chunk", "created": created, "model": model_id,
                               "choices": [], "usage": usage}
                self.wfile.write(("data: " + json.dumps(usage_chunk) + "\n\n").encode("utf-8"))
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                relay.reset()  # pi 가 중간에 끊음 -> Copilot 쪽 대화와 어긋났을 수 있으니 다음엔 새 대화
            self.close_connection = True

    return Handler


class Server(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        """pi 를 끄는 등 상대가 연결을 끊은 것은 오류로 남기지 않는다 (diag --report 에 오류처럼 보이지 않게)"""
        if isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):
            return
        super().handle_error(request, client_address)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description="브리지 pi 중계 서버 (Copilot 웹 채팅 + Jupyter 실행 통로)")
    ap.add_argument("--config", default=os.environ.get("PI_COPILOT_CONFIG", os.path.join(here, "bridge.json")))
    ap.add_argument("--host", default=os.environ.get("PI_COPILOT_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("PI_COPILOT_PORT", "8765")))
    ap.add_argument("--max-chars", type=int, default=None,
                    help="Copilot 메시지 하나의 최대 글자 수 (넘으면 나눠 보냄. 기본: 설정의 max_chars)")
    ap.add_argument("--tool-result-chars", type=int, default=None, help="도구 결과 하나를 보낼 최대 글자 수 (기본: 설정의 tool_result_chars)")
    ap.add_argument("--chats", default="", help="중계 서버가 만든 Copilot 대화 기록 파일 (기본: ~/.pi/agent/copilot-chats.json)")
    ap.add_argument("--events", default="", help="끊김·제한 기록 파일 (기본: ~/.pi/agent/relay-events.jsonl. 중계 서버마다 따로)")
    args = ap.parse_args()
    if not sys.stdout.isatty():  # 로그 파일로 보낼 때는 UTF-8 (Git Bash 에서 tail 로 읽기 좋게)
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except AttributeError:
            pass
    global STARTED
    STARTED = int(time.time())
    try:
        cfg = bridge.load_config(args.config)
    except bridge.ConfigError as e:
        print(time.strftime("%H:%M:%S"), "설정 파일 오류 - 중계 서버를 켜지 않습니다:", e, flush=True)
        sys.exit(2)
    bridge.set_service(cfg.get("service_name"))
    # 메시지 크기: 실행 옵션 > 환경변수 PI_COPILOT_MAX_CHARS > 설정 (bridge.json, 내 설정 파일)
    if args.max_chars is None:
        args.max_chars = int(os.environ.get("PI_COPILOT_MAX_CHARS") or cfg.get("max_chars") or 10000)
    args.max_chars = max(2000, args.max_chars)
    if args.tool_result_chars is None:
        args.tool_result_chars = int(cfg.get("tool_result_chars") or 6000)
    args.resend_recent_chars = int(cfg.get("resend_recent_chars") or 20000)
    args.resend_summary_chars = int(cfg.get("resend_summary_chars") or 40000)
    registry = ChatRegistry(args.chats or default_registry_path())
    max_tabs = max(1, int(cfg.get("max_tabs") or 1))
    lanes = Lanes(args, cfg, registry, max_tabs) if max_tabs > 1 else None
    relay = lanes.lanes[0]["relay"] if lanes else Relay(args, CopilotLink(cfg, registry))
    jup = Jupyter(cfg)
    try:
        server = Server((args.host, args.port), make_handler(relay, jup, cfg, lanes))
    except OSError as e:
        relay.log("포트 {} 를 열 수 없습니다 (이미 실행 중일 수 있음): {}".format(args.port, e))
        sys.exit(1)
    server.daemon_threads = True
    relay.server = server
    if lanes:
        relay.log("pi 여러 개 동시 실행: 세션마다 Copilot 창을 따로 씀 (최대 {}개, max_tabs)".format(max_tabs))
    user = cfg["_user"]
    relay.log("중계 서버 시작: http://{}:{}/v1  (버전 {}, 브라우저 원격 디버깅 포트 {}, 메시지 최대 {}자, 설정 {}{})".format(
        args.host, args.port, RELAY_VERSION, cfg["cdp_port"], args.max_chars, args.config if os.path.exists(args.config) else "기본값",
        " + 내 설정 {}개 ({}: {})".format(len(user["keys"]), user["path"], ", ".join(user["keys"])) if user["keys"] else ""))
    # 끊김·제한 기록 (내용 없이, 이 PC 의 파일에만). 끄려면 내 설정 파일에 "collect_events": false
    global EVENTS
    EVENTS = events.EventLog(args.events or os.path.join(bridge.agent_dir(), "relay-events.jsonl"),
                             svc=cfg.get("service_name") or "Copilot", enabled=cfg.get("collect_events", True))
    EVENTS.write({"ev": "start", "ver": RELAY_VERSION, "port": args.port, "stream": bool(cfg.get("use_stream")),
                  "stable": cfg.get("stable_seconds"), "busy_lines": len(cfg.get("reply_busy_lines") or []),
                  "max_chars": args.max_chars, "q_per_chat": cfg.get("max_questions_per_chat"),
                  "q_per_min": cfg.get("max_questions_per_minute"), "tabs": max_tabs})
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
