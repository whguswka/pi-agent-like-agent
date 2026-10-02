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

사용법: python relay.py [--config bridge.json] [--port 8765] [--max-chars 10000]
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
from jupyter import FsError, Jupyter  # noqa: E402

MODEL_ID = "copilot"
PROTOCOL_TAG = "PI-COPILOT-PROTOCOL v2"
# 코드를 바꾸면 올린다. bin/pi 가 실행 중인 중계 서버의 버전(/health)과 다르면 끄고(/shutdown) 새로 켠다
RELAY_VERSION = "2026-10-02.5"

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
                texts.append("[image omitted]")
    return "\n".join(texts)


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
4. 요청이 끝났으면 코드 블록 없이 결과를 정리해서 답해 주세요.
- JSON 은 올바른 형식이어야 합니다 (문자열 안 줄바꿈은 \\n, 따옴표는 \\").
- 한 번에 블록 하나만 써 주세요.
- 메시지 끝의 [pi-xxxxxx] 표시는 무시하세요.

사용할 수 있는 도구
{tools}

작업 규칙 (참고)
{system}
"""

# Copilot 이 "직접 실행할 수 없다"며 거절하면 한 번 설명하고 다시 부탁한다
REFUSAL_RE = re.compile(r"(실행|접근|확인)(할|하실)? ?수 ?[는가]? ?없|(can ?not|can't|unable to) (run|execute|access)|주장할 ?수 ?는? ?없", re.I)
REFUSAL_NUDGE = ("괜찮습니다. 직접 실행하실 필요는 없습니다. 실행은 제가 pi 로 하고 결과를 그대로 붙여 드릴게요. "
                 "요청을 진행하기 위한 다음 작업 하나를 정해진 형식의 코드 블록(json)으로만 적어 주세요.")

# 대화가 길어지면 Copilot 이 맨 처음 받은 진행 규칙을 놓친다 (시험: 질문 80개를 넘자 도구 대신 중간에 멈추는 답이 더 많아짐)
#  -> 질문 15개 이후 10개마다 짧은 규칙 요약을 붙인다
#     (매번 "블록으로 주세요" 를 강하게 붙였더니 할 일이 없는데도 같은 블록을 반복하는 일이 생겨, 최종 답 안내를 앞에 둠)
REMIND_AFTER = 15
REMIND_EVERY = 10
PROTOCOL_REMINDER = ("(참고 - 진행 방식: 요청이 끝났으면 코드 블록 없이 최종 답을 주세요. 더 할 작업이 있으면 다음 작업 하나만 "
                     "```json {{\"tool\": \"<도구>\", \"arguments\": {{...}}}}``` 블록으로 주세요 (파일 전체 쓰기는 "
                     "```text @tool write path=<경로> ...```). 이미 한 작업을 똑같이 반복하지 마세요. 도구: {tools}.)")

# 같은 도구 호출(도구·인자 같음)이 연달아 반복되면 끊는다 (시험: 같은 write 를 8초마다 60번 넘게 반복한 일이 있었음)
LOOP_LIMIT = 2  # 직전에 이미 연속 2번 같은 호출이 있었으면 3번째는 반복으로 본다
LOOP_NUDGE = ("방금 주신 작업({name})은 바로 앞에서 이미 {count}번 똑같이 실행했고 결과도 같았습니다. "
              "같은 작업을 다시 하지 마시고, 다음 단계로 넘어가거나 요청이 끝났다면 블록 없이 최종 답을 주세요.")
LOOP_STOP = "같은 작업({name})이 계속 반복되어 여기서 멈췄습니다. 요청을 조금 바꾸거나 나눠서 다시 시도해 주세요."


def repeated_calls(messages, call):
    """새 도구 호출과 똑같은 호출이 바로 앞에 연달아 몇 번 있었는지 (도구 결과는 건너뛰고, 다른 메시지가 나오면 멈춤)"""
    fp = fingerprint({"role": "assistant", "tool_calls": [{"function": {
        "name": call["name"], "arguments": json.dumps(call["arguments"], ensure_ascii=False)}}]})
    count = 0
    for m in reversed(messages):
        if m.get("role") == "tool":
            continue
        if m.get("role") == "assistant" and m.get("tool_calls") and fingerprint(m) == fp:
            count += 1
            continue
        break
    return count

# 일을 마치지 않고 "다음 블록을 드리겠습니다", "결과를 본 다음" 처럼 멈추면 한 번 이어서 하도록 부탁한다
CONTINUE_NUDGE = ("아직 끝나지 않았다면 기다리지 마시고 다음 작업을 블록 하나로 바로 주세요. 명령을 글로 보여 주시면 제가 실행할 수 없어요. "
                  "모두 끝났다면 결과를 최종 답으로 정리해 주세요.")
UNFINISHED_RE = re.compile(r"다음 (블록|단계|작업)을? ?(을 )?(드리|진행|하겠|주시)|다음 (단계|작업)는 |결과를 (보|확인)[^\n]{0,12}(다음|뒤|후)|실행해 ?(주시면|보시고|주세요)|"
                           r"완료되지 않|아직 (끝나지|완료되지)|❌|(next|following) (step|block)|once you (run|share)", re.I)
NO_TOOLS_RE = re.compile(r"도구는? (쓰지|사용하지) ?말|도구 없이")


def last_user_text(messages):
    for m in reversed(messages):
        if m.get("role") == "user":
            return content_text(m.get("content"))
    return ""


# 파일을 만들거나 고치라는 요청인데, 도구 블록 없이 코드만 보여 주고 끝내면 한 번 다시 부탁한다
CODE_NUDGE = ("코드를 보여 주시기만 하면 제가 파일로 만들 수가 없어요. 파일은 아래 형식의 write 블록 하나로 만들어 주시고, "
              "실행이나 확인이 필요하면 그다음에 bash 블록으로 요청해 주세요.\n"
              "```text\n@tool write path=<파일 경로>\n<파일 전체 내용>\n```")
CHANGE_REQUEST_RE = re.compile(r"만들|작성|추가|수정|고쳐|고치|바꿔|저장|생성|확장|구현|리팩터|\b(create|write|add|fix|modify|update|implement)\b", re.I)
PROGRAM_FENCE_RE = re.compile(r"```[ \t]*(python|py|bash|sh|shell|javascript|js|typescript|ts|java|go|rust|sql|r|c|cpp|c\+\+|"
                              r"html|css|yaml|yml|toml|ini|dockerfile|makefile|powershell|ps1)[ \t]*\n", re.I)


def wants_files_but_none_written(messages):
    """마지막 사용자 요청이 파일 생성·수정인데, 그 뒤로 도구를 한 번도 쓰지 않고 바로 답했으면 True
    (도구를 쓴 뒤의 답에 있는 코드는 결과 보고·설명일 수 있으므로 다시 부탁하지 않는다)"""
    last_user = max((i for i, m in enumerate(messages) if m.get("role") == "user"), default=None)
    if last_user is None or not CHANGE_REQUEST_RE.search(content_text(messages[last_user].get("content"))):
        return False
    return not any(m.get("tool_calls") or m.get("role") == "tool" for m in messages[last_user + 1:])


ROLE_LINE_RE = re.compile(r"\s*(you are\b|너는\s|당신은\s)", re.I)


def system_for_copilot(system):
    """시스템 프롬프트 맨 앞의 역할 지정 줄("You are ...", "너는 ...", "당신은 ...")은 빼고 나머지 규칙만 참고로 전달
    (Copilot 은 역할을 바꾸라는 지시를 거부하므로). 첫 문단에서 그 줄만 빼고 나머지 줄은 남긴다"""
    paras = [p for p in system.strip().split("\n\n") if p.strip()]
    if paras and ROLE_LINE_RE.match(paras[0]):
        rest = paras[0].strip().split("\n", 1)[1:]
        paras = ([rest[0]] if rest and rest[0].strip() else []) + paras[1:]
    return "\n\n".join(paras) or "(없음)"


def render_tools(tools):
    lines = []
    for t in tools or []:
        f = t.get("function", t)
        params = f.get("parameters") or {}
        lines.append("- {}: {}\n  parameters: {}".format(
            f.get("name"), norm(f.get("description", "")), json.dumps(params, ensure_ascii=False, separators=(",", ":"))))
    return "\n".join(lines) if lines else "(no tools)"


def truncate_middle(text, limit):
    if len(text) <= limit:
        return text
    head = int(limit * 0.6)
    tail = max(0, limit - head - 60)
    omitted = len(text) - head - tail
    return text[:head] + "\n...[{} chars omitted]...\n".format(omitted) + (text[-tail:] if tail else "")


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
        if role == "user":
            return "[요청]\n" + text
        if role == "tool":
            body = truncate_middle(text, limit or self.tool_result_chars)
            return "TOOL_RESULT ({}):\n```text\n{}\n```".format(names.get(m.get("tool_call_id"), "?"), body.replace("```", "'''"))
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
    return [p.strip() for p in parts if p.strip()]


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

FENCE_RE = re.compile(r"```[ \t]*([^\n`]*)\n(.*?)```", re.S)


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
        out.append(ch)
    s = "".join(out)
    return re.sub(r",\s*([}\]])", r"\1", s)


def parse_block(text, lang, tool_names):
    """코드 블록 하나 -> (call dict | None, 오류 문자열 | None)"""
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
    # Copilot 이 write 형식을 흉내 내 다른 도구도 '@tool read path=a.py' 처럼 쓰는 경우 (긴 대화에서 실제로 나옴)
    #  첫 줄의 키=값을 인자로, bash 는 둘째 줄부터를 command 로
    m = re.match(r"@tool[ \t]+(\w+)([^\n]*)\n?", st)
    if m and m.group(1) in tool_names:
        name, rest = m.group(1), st[m.end():].strip()
        args = {k: v.strip("\"'") for k, v in re.findall(r"(\w+)=(\"[^\"]*\"|'[^']*'|\S+)", m.group(2))}
        args = {k: int(v) if v.isdigit() and k in ("offset", "limit", "timeout") else v for k, v in args.items()}
        if name == "bash" and "command" not in args and rest:
            args["command"] = rest
        if any("<" in str(v) for v in args.values()):
            return None, "형식 예시의 값({})을 그대로 쓰셨습니다. 실제 값을 넣어 주세요".format(args)
        if args:
            return {"name": name, "arguments": args}, None
        return None, "'@tool {}' 형식에서 인자를 찾지 못했습니다. json 블록으로 주세요".format(name)
    if not (st.startswith("{") and ('"tool"' in st or '"name"' in st)):
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
    name = obj.get("tool") or obj.get("name")
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
    blocks = reply.get("code_blocks") or []
    if not blocks:  # 원문(markdown)으로 받은 경우
        blocks = [{"lang": m.group(1).strip(), "text": m.group(2)} for m in FENCE_RE.finditer(text)]
    first_err = None
    for b in blocks:
        call, err = parse_block(b.get("text", ""), b.get("lang", ""), tool_names)
        if call:
            body = reply.get("text_without_code")
            if body is None:
                body = FENCE_RE.sub("", text)
            return body.strip(), call, None
        if err and not first_err:
            first_err = err
    # 울타리(```) 없이 온 블록 (Copilot 이 가끔 울타리를 빼고 씀)
    #  - 답 첫머리(300자 안)의 '@tool <도구>' 줄: read·bash 같은 짧은 도구는 그대로 받는다
    #    (긴 설명 중간에 나오는 것은 형식 설명일 수 있으므로 도구로 보지 않음)
    #  - 파일 내용(write)은 코드 블록 밖에 있으면 마크다운 때문에 기호가 바뀔 수 있어(실제: ] 가 \] 로) 다시 부탁한다
    #  - 답 전체가 JSON 도구 블록이면 그대로
    st = text.strip()
    m = re.search(r"(?m)^@tool[ \t]+\w+", st)
    if m and m.start() <= 300:
        call, err = parse_block(st[m.start():], "", tool_names)
        if call and call["name"] == "write":
            call, err = None, ("파일 내용이 코드 블록(```) 밖에 있어 일부 기호가 바뀔 수 있습니다. "
                               "같은 내용을 ```text 코드 블록 안에 넣어 다시 주세요")
        if call:
            return st[:m.start()].strip(), call, None
        first_err = first_err or err
    elif st.startswith("{") and st.endswith("}"):
        call, err = parse_block(st, "", tool_names)
        if call:
            return "", call, None
        first_err = first_err or err
    return st, None, first_err


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
        try:
            with open(path, encoding="utf-8") as f:
                self.chats = json.load(f).get("chats") or []
        except (OSError, ValueError):
            pass
        for c in self.chats:  # 지난번에 쓰던 대화는 이어 쓰지 않으므로 삭제 대상
            if c.get("state") == "active":
                c["state"] = "finished"

    def save(self):
        try:
            os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump({"chats": self.chats}, f, ensure_ascii=False, indent=1)
            os.replace(tmp, self.path)
        except OSError as e:
            bridge.log("대화 목록 저장 실패 ({}): {}".format(self.path, e))

    def add(self, cid, url):
        if cid and not any(c["id"] == cid for c in self.chats):
            self.chats.append({"id": cid, "url": url, "created": time.strftime("%Y-%m-%d %H:%M:%S"), "state": "active",
                               "tries": 0})
            self.save()

    def finish_all(self):
        """한 번에 한 대화만 쓰므로, 새 대화를 열거나 세션이 끝나면 쓰던 대화는 모두 끝난 것"""
        changed = False
        for c in self.chats:
            if c["state"] == "active":
                c["state"], changed = "finished", True
        if changed:
            self.save()

    def pending(self):
        return [c for c in self.chats if c["state"] == "finished" and c.get("tries", 0) < self.MAX_TRIES]

    def deleted(self, cid):
        self.chats = [c for c in self.chats if c["id"] != cid]
        self.save()

    def failed(self, cid):
        for c in self.chats:
            if c["id"] == cid:
                c["tries"] = c.get("tries", 0) + 1
        self.save()


class CopilotLink:
    def __init__(self, cfg, registry=None):
        self.cfg = cfg
        self.cop = None
        self.asked = 0  # 지금 Copilot 대화에서 보낸 질문 수 (max_questions_per_chat 용)
        self.registry = registry
        self.model_now = None  # 지금 대화에서 고른 Copilot 모델 (화면 이름)
        self.model_failed = None  # 고르지 못한 모델 (같은 대화에서는 다시 시도하지 않음)

    def connect(self):
        try:
            tabs = bridge.list_tabs(self.cfg["cdp_port"])
        except bridge.BridgeError as e:
            raise RelayError(503, str(e))
        cop = [t for t in tabs if self.cfg["copilot_url_contains"] in t.get("url", "")]
        if not cop:
            raise RelayError(503, "Copilot 탭을 찾지 못했습니다. start-chrome.cmd(또는 start-edge.cmd)로 연 전용 창에서 {} 에 로그인해 열어 두세요.".format(
                self.cfg["copilot_url_contains"]))
        self.cop = bridge.Copilot(bridge.Tab(cop[0]), self.cfg)
        bridge.log("Copilot 탭 연결: {}".format(cop[0].get("url", "")[:90]))

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
        cap, now = max(1.0, rate), time.time()
        last = getattr(self, "token_time", None)
        self.tokens = cap if last is None else min(cap, self.tokens + (now - last) * rate / 60)
        self.token_time = now
        if self.tokens < 1:
            wait = (1 - self.tokens) * 60 / rate
            bridge.log("  (속도 조절: 분당 {:g}개 -> {:.0f}초 기다림)".format(rate, wait))
            time.sleep(wait)
            self.tokens, self.token_time = 1.0, time.time()
        self.tokens -= 1

    def cleanup(self):
        """끝난 대화(registry 의 finished) 삭제. 실패해도 요청은 계속한다 (3번까지 다시 시도)"""
        if not self.registry or not self.cfg.get("delete_finished_chats", True):
            return
        for c in self.registry.pending():
            try:
                ok, info = self.cop.delete_chat(c["id"])
            except (bridge.BridgeError, TimeoutError) as e:
                ok, info = False, str(e)
            bridge.log("  지난 Copilot 대화 삭제 {}: {}".format("OK" if ok else "실패", info))
            (self.registry.deleted if ok else self.registry.failed)(c["id"])

    def request(self, parts, new_thread, model=""):
        """조각들을 차례로 Copilot 에 보내고 마지막 답을 돌려준다. model 은 Copilot 화면의 모델 이름 ("" 이면 그대로)"""
        reconnected = self.cop is None
        if reconnected:
            self.connect()
        try:
            limit = int(self.cfg.get("max_questions_per_chat") or 0)
            if new_thread:
                if self.registry:
                    self.registry.finish_all()
                    self.cleanup()
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
                ok, info = self.cop.select_model(model)
                bridge.log("  Copilot 모델 {}: {}".format("선택" if ok else "선택 실패 (지금 모델로 계속)", info))
                if ok:
                    self.model_now = model
                else:
                    self.model_failed = model
            reply = None
            for i, part in enumerate(parts, 1):
                m = re.search(r"\[pi[-#][0-9a-f]+\]\s*$", part)
                if not m:
                    raise RelayError(500, "요청에 marker 가 없습니다")
                self.pace()
                bridge.log("  -> Copilot 에 보냄 ({}/{}, {}자)".format(i, len(parts), len(part)))
                self.cop.send(part)
                self.asked += 1
                reply = self.cop.wait_reply(m.group(0).strip())
                bridge.log("  <- 답 받음 ({}자, 코드 블록 {}개)".format(len(reply.get("text", "")), len(reply.get("code_blocks") or [])))
                if new_thread and i == 1 and self.registry:  # 첫 답에서 대화 주소가 생김 -> 삭제 대상 목록에 기록
                    self.registry.add(bridge.conversation_id(self.cop.thread_url), self.cop.thread_url)
            return reply
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
        self.reminded_at = 0  # 마지막으로 진행 규칙 요약을 붙였을 때의 질문 수
        self.model_label = ""  # 이번 요청에 쓸 Copilot 모델 (화면 이름)

    def log(self, *a):
        print(time.strftime("%H:%M:%S"), *a, flush=True)

    def ask(self, parts, new_thread):
        self.log("요청 (새 대화={}, 조각 {}개, {}자{})".format(new_thread, len(parts), sum(len(p) for p in parts),
                                                       ", 모델 " + self.model_label if self.model_label else ""))
        return self.link.request(parts, new_thread, model=self.model_label)

    def end_session(self, reason=""):
        """pi 세션이 끝남 (pi 확장 copilot-session.ts 가 알림) -> 다음 요청은 새 대화, 쓰던 대화는 삭제 대상으로 정리"""
        with self.lock:
            self.sent, self.fresh = [], True
            link = self.link
            registry = getattr(link, "registry", None)
            if registry is None:
                return
            registry.finish_all()
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

    def handle(self, body):
        with self.lock:
            try:
                return self._handle(body, False)
            except ThreadReset as e:
                self.log("Copilot 대화를 새로 시작해서 다시 보냅니다:", e)
                return self._handle(body, True)

    def _handle(self, body, force_new):
        self.model_label = copilot_model_for(body.get("model"), getattr(self.link, "cfg", None) or {})
        messages = body.get("messages") or []
        tools = body.get("tools") or []
        tool_names = {(t.get("function") or t).get("name") for t in tools}
        fps = [fingerprint(m) for m in messages]
        names = self.renderer.tool_names_by_id(messages)
        n = len(self.sent)
        delta = (not force_new) and (not self.fresh) and n and len(fps) > n and fps[:n] == self.sent
        marker = "[pi-{}]".format(uuid.uuid4().hex[:6])
        if delta:
            new = messages[n:]
            text = "\n\n".join(self.renderer.message(m, names) for m in new)
            if any(m.get("role") == "tool" for m in new):
                text += "\n\n(다음 작업 블록 하나를 주시거나, 요청이 끝났으면 최종 답을 주세요.)"
            asked = getattr(self.link, "asked", 0)
            if asked < self.reminded_at:  # 새 대화로 바뀌었으면 다시 센다
                self.reminded_at = 0
            if tool_names and asked >= REMIND_AFTER and asked - self.reminded_at >= REMIND_EVERY:
                text += "\n\n" + PROTOCOL_REMINDER.format(tools=", ".join(sorted(tool_names)))
                self.reminded_at = asked
            parts = build_parts(text, self.args.max_chars, marker)
            new_thread = False
        else:
            parts = self.full_parts(messages, tools, names, marker)
            new_thread = True
        was_fresh, self.fresh = self.fresh, True  # 도중에 실패하면 다음 요청은 새 대화로 (성공하면 아래에서 False)
        try:
            reply = self.ask(parts, new_thread)
        except RelayError as e:
            if e.status == 429:  # 사용량 제한은 대화를 바꾸지 않음: 풀린 뒤 같은 대화에 이어서
                self.fresh = was_fresh
            raise
        body_text, call, err = parse_reply(reply, tool_names)
        retries, nudged, code_nudged, cont_nudged = 0, False, False, False
        while call is None and retries < 2:
            if err:  # 형식이 틀리면 다시 요청
                self.log("도구 블록 오류 -> 다시 요청: {}".format(err))
                fix = ("방금 블록은 사용할 수 없었습니다: {}\n올바른 형식의 코드 블록 하나로 다시 적어 주세요 "
                       "(요청이 끝났다면 블록 없이 최종 답).").format(err)
            elif not nudged and REFUSAL_RE.search(body_text or "") and tool_names:
                self.log("Copilot 이 실행을 거절 -> 설명 후 다시 요청")
                fix, nudged = REFUSAL_NUDGE, True
            elif (not code_nudged and "write" in tool_names and PROGRAM_FENCE_RE.search(body_text or "")
                  and wants_files_but_none_written(messages)):
                self.log("Copilot 이 파일을 만들지 않고 코드만 보여 줌 -> write 블록으로 다시 요청")
                fix, code_nudged = CODE_NUDGE, True
            elif (not cont_nudged and tool_names and UNFINISHED_RE.search(body_text or "")
                  and not NO_TOOLS_RE.search(last_user_text(messages))):
                self.log("Copilot 이 일을 마치지 않고 멈춤 -> 이어서 하도록 다시 요청")
                fix, cont_nudged = CONTINUE_NUDGE, True
            else:
                break
            retries += 1
            reply = self.ask(build_parts(fix, self.args.max_chars, "[pi-{}]".format(uuid.uuid4().hex[:6])), False)
            body_text, call, err = parse_reply(reply, tool_names)
        if call and repeated_calls(messages, call) >= LOOP_LIMIT:
            count = repeated_calls(messages, call)
            self.log("같은 도구 호출 반복({} {}회) -> 다른 작업을 하도록 다시 요청".format(call["name"], count))
            reply = self.ask(build_parts(LOOP_NUDGE.format(name=call["name"], count=count), self.args.max_chars,
                                         "[pi-{}]".format(uuid.uuid4().hex[:6])), False)
            body_text, call, err = parse_reply(reply, tool_names)
            if call and repeated_calls(messages, call) >= LOOP_LIMIT:
                self.log("반복이 계속됨 -> 이 요청을 멈춤")
                body_text, call = LOOP_STOP.format(name=call["name"]), None
        if call:
            assistant = {"role": "assistant", "content": body_text or None, "tool_calls": [{
                "id": "call_" + uuid.uuid4().hex[:12], "type": "function",
                "function": {"name": call["name"], "arguments": json.dumps(call["arguments"], ensure_ascii=False)}}]}
        else:
            assistant = {"role": "assistant", "content": body_text}
        self.sent = fps + [fingerprint(assistant)]
        self.fresh = False
        self.log("답: {}".format("도구 " + call["name"] if call else "본문 {}자".format(len(body_text))))
        return assistant

    def full_parts(self, messages, tools, names, marker):
        system = "\n\n".join(content_text(m.get("content")) for m in messages if m.get("role") in ("system", "developer"))
        head = PREAMBLE.format(tag=PROTOCOL_TAG, tools=render_tools(tools), system=system_for_copilot(system))
        convo = [m for m in messages if m.get("role") not in ("system", "developer")]
        # 새 대화에 다시 넣는 기록: 최근 것은 그대로(full_budget), 그 앞은 한 줄 요약(brief_budget), 더 오래된 것은 생략
        full_budget = self.args.max_chars * 2
        brief_budget = self.args.max_chars * 4
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
        body = (head + "\n대화 내용\n" + convo_text +
                "\n\n(마지막 요청에 대해 다음 작업 블록 하나를 주시거나, 이미 끝났다면 최종 답을 주세요.)")
        return build_parts(body, self.args.max_chars, marker)

    def reset(self):
        with self.lock:
            self.sent, self.fresh = [], True


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
    if op == "mkdir":
        jup.mkdir(path)
        return {}
    if op == "stat":
        st = jup.stat(path)
        if not st:
            raise FsError("ENOENT", "ENOENT: no such file or directory, access '{}'".format(path))
        return st
    raise FsError("EINVAL", "알 수 없는 파일 작업: {}".format(op))


def make_handler(relay, jup, cfg):
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
                return self.send_json(401, {"ok": False, "code": "AUTH", "error": str(e)})
            except bridge.BridgeError as e:
                return self.send_json(503, {"ok": False, "code": "BRIDGE", "error": str(e)})
            except Exception as e:  # noqa: BLE001
                relay.log("Jupyter 처리 오류:", repr(e))
                return self.send_json(500, {"ok": False, "code": "EIO", "error": "중계 서버 내부 오류: {}".format(e)})

        def health(self):
            thr = getattr(relay.link, "throttled_at", None)
            out = {"server": "ok", "version": RELAY_VERSION, "thread_messages": len(relay.sent),
                   "copilot_turns_left": relay.link.turns_left,
                   "copilot_throttled_at": time.strftime("%H:%M:%S", time.localtime(thr)) if thr else None,
                   "jupyter": {"root": jup.root, "home": jup.home, "terminal": jup.term}}
            try:
                tabs = bridge.list_tabs(cfg["cdp_port"])
                out["copilot_tab"] = any(cfg["copilot_url_contains"] in t.get("url", "") for t in tabs)
                want = cfg.get("jupyter_url_contains") or "/lab"
                out["jupyter_tab"] = any(want in t.get("url", "") for t in tabs)
            except bridge.BridgeError as e:
                out["browser_error"] = str(e)
            return out

        def do_GET(self):
            u = urllib.parse.urlsplit(self.path)
            q = urllib.parse.parse_qs(u.query)
            if u.path.rstrip("/").endswith("/models"):
                # max_model_len: vLLM 과 같은 이름의 맥락 한도. 대화 기억은 Copilot 대화창이 갖고 중계 서버는 새로 추가된 부분만
                # 보내므로, 에이전트가 맥락을 줄이느라 앞부분을 바꾸지 않도록 크게 알려 준다
                ids = [MODEL_ID] + [k for k in (cfg.get("copilot_models") or {}) if k != MODEL_ID]
                return self.send_json(200, {"object": "list", "data": [{"id": i, "object": "model", "owned_by": "copilot-web",
                                                                        "max_model_len": 1000000} for i in ids]})
            if u.path.startswith("/health"):
                return self.send_json(200, self.health())
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
                    threading.Thread(target=relay.end_session, args=(reason,), daemon=True).start()
                return self.send_json(200, {"ok": True})
            if u.path == "/jupyter/exec":
                def go():
                    rid = jup.start(body["cwd"], body["command"], int(body.get("timeout") or 0))
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
            try:
                msg = relay.handle(body)
            except RelayError as e:
                if e.status != 429:  # 사용량 제한이면 지금 대화를 그대로 둔다
                    relay.reset()
                relay.log("오류:", e)
                return self.send_json(e.status, {"error": {"message": str(e), "type": "copilot_relay_error"}})
            except ThreadReset as e:
                relay.reset()
                relay.log("오류: 새 대화로도 보내지 못했습니다:", e)
                return self.send_json(503, {"error": {"message": "Copilot 에 보내지 못했습니다: {}".format(e),
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


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description="브리지 pi 중계 서버 (Copilot 웹 채팅 + Jupyter 실행 통로)")
    ap.add_argument("--config", default=os.environ.get("PI_COPILOT_CONFIG", os.path.join(here, "bridge.json")))
    ap.add_argument("--host", default=os.environ.get("PI_COPILOT_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("PI_COPILOT_PORT", "8765")))
    ap.add_argument("--max-chars", type=int, default=int(os.environ.get("PI_COPILOT_MAX_CHARS", "10000")),
                    help="Copilot 메시지 하나의 최대 글자 수 (넘으면 나눠 보냄)")
    ap.add_argument("--tool-result-chars", type=int, default=6000, help="도구 결과 하나를 보낼 최대 글자 수")
    ap.add_argument("--chats", default="", help="중계 서버가 만든 Copilot 대화 기록 파일 (기본: ~/.pi/agent/copilot-chats.json)")
    args = ap.parse_args()
    if not sys.stdout.isatty():  # 로그 파일로 보낼 때는 UTF-8 (Git Bash 에서 tail 로 읽기 좋게)
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except AttributeError:
            pass
    cfg = bridge.load_config(args.config)
    registry = ChatRegistry(args.chats or default_registry_path())
    relay = Relay(args, CopilotLink(cfg, registry))
    jup = Jupyter(cfg)
    try:
        server = ThreadingHTTPServer((args.host, args.port), make_handler(relay, jup, cfg))
    except OSError as e:
        relay.log("포트 {} 를 열 수 없습니다 (이미 실행 중일 수 있음): {}".format(args.port, e))
        sys.exit(1)
    server.daemon_threads = True
    relay.server = server
    relay.log("중계 서버 시작: http://{}:{}/v1  (버전 {}, 브라우저 원격 디버깅 포트 {}, 설정 {})".format(
        args.host, args.port, RELAY_VERSION, cfg["cdp_port"], args.config if os.path.exists(args.config) else "기본값"))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
