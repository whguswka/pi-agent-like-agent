# relay.py 핵심 로직 단위 테스트 (python tests/test_relay.py [relay.py 가 있는 폴더, 기본: ../copilot])
import json
import os
import sys

sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "copilot"))
import relay  # noqa: E402

TOOLS = {"read", "bash", "edit", "write"}
fails = 0


def check(name, cond, detail=""):
    global fails
    print(("OK   " if cond else "FAIL ") + name + ("" if cond else "  -> " + str(detail)))
    if not cond:
        fails += 1


# 1) 도구 블록 해석
call, err = relay.parse_block('{"tool": "bash", "arguments": {"command": "ls -la"}}', "json", TOOLS)
check("JSON 블록", call == {"name": "bash", "arguments": {"command": "ls -la"}}, (call, err))
call, err = relay.parse_block('json\n{"tool": "read", "arguments": {"path": "a.txt"}}', "", TOOLS)
check("화면에서 읽은 블록(첫 줄 언어 이름)", call and call["name"] == "read", (call, err))
raw_nl = '{"tool": "edit", "arguments": {"path": "a.py", "edits": [{"oldText": "x = 1", "newText": "x = 1\ny = 2"}]}}'
raw_nl = raw_nl.replace("\\n", "\n")
call, err = relay.parse_block(raw_nl, "json", TOOLS)
check("문자열 안 실제 줄바꿈 보정", call and call["arguments"]["edits"][0]["newText"] == "x = 1\ny = 2", (call, err))
call, err = relay.parse_block('{"tool": "bash", "arguments": {"command": "echo hi",},}', "json", TOOLS)
check("끝 쉼표 보정", call and call["arguments"]["command"] == "echo hi", (call, err))
call, err = relay.parse_block('@tool write path=src/hello.py\nprint("hi \\"q\\"")\n', "text", TOOLS)
check("raw write 블록", call == {"name": "write", "arguments": {"path": "src/hello.py", "content": 'print("hi \\"q\\"")\n'}}, (call, err))
call, err = relay.parse_block('{"tool": "rm_rf", "arguments": {}}', "json", TOOLS)
check("모르는 도구 -> 오류", call is None and "rm_rf" in (err or ""), (call, err))
call, err = relay.parse_block("print('hello')", "python", TOOLS)
check("일반 코드 블록은 무시", call is None and err is None, (call, err))
call, err = relay.parse_block('{"name": "bash", "arguments": "{\\"command\\": \\"pwd\\"}"}', "json", TOOLS)
check("arguments 가 문자열 JSON", call and call["arguments"]["command"] == "pwd", (call, err))
# 도구 호출은 "tool" 이 있거나 "name" + arguments/args/input 이 있는 JSON 만 (최종 답의 예시 JSON 은 형식 오류로 다시 부탁하지 않음)
call, err = relay.parse_block('{"name": "my-app", "version": "1.0.0"}', "json", TOOLS)
check("예시 JSON(name 만 있음)은 도구 블록 아님 (오류도 아님)", call is None and err is None, (call, err))
call, err = relay.parse_block('{"name": "my-app",\n  // 주석\n  "version": "1.0.0"\n}', "json", TOOLS)
check("해석되지 않는 예시 JSON 도 name 만 있으면 오류 아님", call is None and err is None, (call, err))
call, err = relay.parse_block('{"name": "bash", "input": {"command": "ls"}}', "json", TOOLS)
check("name + input 은 도구 호출", call == {"name": "bash", "arguments": {"command": "ls"}}, (call, err))
# 끝 쉼표는 문자열 밖에서만 뺌: 다른 보정(문자열 안 실제 줄바꿈)이 필요한 JSON 이어도 문자열 안의 r'[,]' 는 그대로
call, err = relay.parse_block('{"tool": "write", "arguments": {"path": "a.py", "content": "parts = re.split(r\'[,]\', s)\nprint(parts)"},}',
                              "json", TOOLS)
check("끝 쉼표 보정은 문자열 밖에서만 (r'[,]' 그대로)",
      call and call["arguments"]["content"] == "parts = re.split(r'[,]', s)\nprint(parts)", (call, err))

# 2) 답 전체 해석 (markdown 원문 / 화면 code_blocks)
text, call, err = relay.parse_reply({"text": "파일을 봅니다.\n```json\n{\"tool\": \"read\", \"arguments\": {\"path\": \"x\"}}\n```"}, TOOLS)
check("markdown 원문에서 도구 찾기", call and call["name"] == "read" and text == "파일을 봅니다.", (text, call, err))
text, call, err = relay.parse_reply({"text": "설명\n{...}", "text_without_code": "설명", "code_blocks": [
    {"lang": "python", "text": "print(1)"}, {"lang": "json", "text": '{"tool": "bash", "arguments": {"command": "ls"}}'}]}, TOOLS)
check("화면 code_blocks 중 도구 블록 선택", call and call["name"] == "bash" and text == "설명", (text, call, err))
text, call, err = relay.parse_reply({"text": "완료했습니다. 결과는 다음과 같습니다."}, TOOLS)
check("최종 답(도구 없음)", call is None and err is None and text.startswith("완료"), (text, call, err))
# 울타리(```) 없이 온 블록 (실제 Copilot 에서 나온 형태)
#  파일 내용(write)은 코드 블록 밖이면 마크다운 때문에 기호가 바뀔 수 있어(실제: ] -> \]) 바로 쓰지 않고 다시 부탁
text, call, err = relay.parse_reply({"text": "@tool write path=make_data.py\nimport csv\n\nprint(\"created\")"}, TOOLS)
check("울타리 없는 write 블록은 코드 블록 안에 다시 달라고 함", call is None and err and "코드 블록" in err, (text, call, err))
text, call, err = relay.parse_reply({"text": "파일을 만듭니다.\n@tool write path=a.py\nprint(1)\n"}, TOOLS)
check("설명 뒤 울타리 없는 write 블록도 다시 달라고 함", call is None and err and "코드 블록" in err, (text, call, err))
text, call, err = relay.parse_reply({"text": '{"tool": "bash", "arguments": {"command": "ls"}}'}, TOOLS)
check("울타리 없는 JSON 도구 블록", call == {"name": "bash", "arguments": {"command": "ls"}}, (text, call, err))
text, call, err = relay.parse_reply({"text": "README 예시: `@tool write` 는 쓰지 않습니다."}, TOOLS)
check("문장 속 @tool 언급은 도구 아님", call is None, (text, call, err))
# 형식 예시를 그대로 옮겨 적은 블록은 쓰기로 처리하지 않고 오류 (실제로 '파일경로' 파일이 생겼던 경우)
text, call, err = relay.parse_reply({"text": "```text\n@tool write path=<파일 경로>\n<파일 전체 내용>\n```"}, TOOLS)
check("예시 경로(<파일 경로>)는 오류", call is None and err and "예시" in err, (text, call, err))
text, call, err = relay.parse_reply({"text": "@tool write path=<파일 경로>\n<파일 전체 내용>"}, TOOLS)
check("울타리 없는 예시 경로도 오류", call is None and err and "예시" in err, (text, call, err))
text, call, err = relay.parse_reply({"text": "설명 " * 120 + "\n@tool write path=a.py\nprint(1)"}, TOOLS)
check("긴 설명 중간의 울타리 없는 블록은 도구 아님", call is None, (text[:30], call, err))
# 울타리 없는 '@tool bash' 는 첫 빈 줄까지만 명령 (뒤 설명 속 `git commit -am wip` 이 명령에 섞여 실행되면 안 됨)
text, call, err = relay.parse_reply({"text": "@tool bash\ngit status\n\n결과를 본 뒤 `git commit -am wip` 로 커밋하겠습니다."}, TOOLS)
check("울타리 없는 블록은 첫 빈 줄까지, 나머지는 본문", call == {"name": "bash", "arguments": {"command": "git status"}}
      and text == "결과를 본 뒤 `git commit -am wip` 로 커밋하겠습니다.", (text, call, err))
# 파일 내용 안에 코드 블록이 있어도(README 의 ```bash) 바깥 블록이 거기서 끝나지 않음
_readme = "# T\n\n```bash\nls\n```\n\n끝\n"
text, call, err = relay.parse_reply({"text": "```text\n@tool write path=README.md\n" + _readme + "```"}, TOOLS)
check("write 내용 안의 ```bash 블록", call == {"name": "write", "arguments": {"path": "README.md", "content": _readme}}, (text, call, err))
_readme4 = "# T\n\n```\nls\n```\n\n끝\n"
text, call, err = relay.parse_reply({"text": "````text\n@tool write path=README.md\n" + _readme4 + "````"}, TOOLS)
check("` 4개 바깥 블록 안의 이름 없는 ``` 블록은 내용",
      call == {"name": "write", "arguments": {"path": "README.md", "content": _readme4}}, (text, call, err))
text, call, err = relay.parse_reply({"text": "README 를 씁니다.\n```text\n@tool write path=README.md\n" + _readme + "```\n쓴 뒤 확인합니다."}, TOOLS)
check("본문은 블록 전체(안쪽 블록 포함)를 뺀 앞뒤 글", call and text == "README 를 씁니다.\n\n쓴 뒤 확인합니다.", (text, call, err))
check("끝나지 않은 블록은 블록 아님", relay.fenced_blocks('```json\n{"tool": "bash"}\n') == [])
_src = "앞\n   ```json\n{}\n   ```\n뒤"
_fb = relay.fenced_blocks(_src)
check("울타리 앞 공백 3개까지는 블록 (span 은 울타리 줄까지)", [(b["lang"], b["text"]) for b in _fb] == [("json", "{}\n")]
      and relay.cut_spans(_src, _fb) == "앞\n\n뒤" and relay.fenced_blocks("    ```json\n{}\n    ```") == [], _fb)

# 3) 긴 메시지 나누기
parts = relay.build_parts("가" * 25000, 10000, "[pi-abc]")
check("긴 메시지 분할 (각 1만 자 이하)", len(parts) == 3 and all(len(p) <= 10000 for p in parts) and all(p.endswith("[pi-abc]") for p in parts),
      [len(p) for p in parts])
check("앞 조각은 OK 만 답하라는 안내", "OK 라고만 답해" in parts[0] and "마지막입니다" in parts[-1])
_sp = relay.split_text("a" * 50 + "\n\n    def f():\n        return 1\n", 60)
check("나눈 조각이 들여쓴 줄로 시작해도 앞 공백은 그대로 (앞뒤 줄바꿈만 뺌)", _sp == ["a" * 50, "    def f():\n        return 1"], _sp)

# 3-1) 아주 긴 기록을 새 대화에 다시 넣을 때: 최근은 그대로, 오래된 것은 요약, 맨 처음 요청도 남아야 함
class A0:
    max_chars = 10000
    tool_result_chars = 6000


r0 = relay.Relay(A0(), None)
hist, tools0 = [{"role": "system", "content": "SYS"}], [{"type": "function", "function": {"name": "bash", "parameters": {}}}]
for i in range(1, 301):
    cid = "call_{}".format(i)
    hist += [{"role": "user", "content": "단계 {}: bash 로 echo $(( {} * 7 )) 를 실행하고 숫자만 답해줘.".format(i, i)},
             {"role": "assistant", "content": None, "tool_calls": [{"id": cid, "type": "function",
              "function": {"name": "bash", "arguments": json.dumps({"command": "echo $(( {} * 7 ))".format(i)})}}]},
             {"role": "tool", "tool_call_id": cid, "content": str(i * 7)},
             {"role": "assistant", "content": str(i * 7)}]
hist.append({"role": "user", "content": "단계 1 과 단계 2 의 숫자는?"})
p0 = r0.full_parts(hist, tools0, r0.renderer.tool_names_by_id(hist), "[pi-abc123]")
joined = "\n".join(p0)
check("300단계 기록 재주입: 조각 수/크기", 2 <= len(p0) <= 8 and all(len(p) <= 10000 for p in p0), [len(p) for p in p0])
check("300단계 기록 재주입: 맨 처음 요청(요약)과 마지막 질문 포함",
      "[요청] 단계 1: bash" in joined and "[답변] 7" in joined and "단계 1 과 단계 2 의 숫자는?" in p0[-1], joined[:200])

# 3-2) 도구 결과: 안의 ``` 는 그대로 두고 더 긴 울타리로 감쌈 (예전: ''' 로 바꿔서 Copilot 이 그대로 옮겨 쓰면 파일이 달라짐)
_res = "# README\n```bash\nls\n```\n"
_rendered = relay.Renderer(6000).message({"role": "tool", "tool_call_id": "r1", "content": _res}, {"r1": "read"})
check("도구 결과: ``` 그대로 + ` 4개 울타리", _rendered.startswith("TOOL_RESULT (read):\n````text\n") and _rendered.endswith("\n````")
      and "```bash\nls\n```" in _rendered and "'''" not in _rendered, _rendered)
check("도구 결과: 울타리 안 내용이 그대로 읽힘", [b["text"] for b in relay.fenced_blocks(_rendered)] == [_res], relay.fenced_blocks(_rendered))
check("도구 결과: ``` 가 없으면 ``` 울타리", relay.Renderer(6000).message({"role": "tool", "tool_call_id": "r1", "content": "a `b` c"},
                                                                 {"r1": "read"}) == "TOOL_RESULT (read):\n```text\na `b` c\n```")
check("지침: 파일 내용에 ``` 가 있으면 ` 4개 바깥 블록 (````text ... ````)", "````text" in relay.PREAMBLE and "````" in relay.PREAMBLE.split("````text", 1)[1])

# 4) 같은 대화 이어쓰기 / 어긋나면 새 대화 / 한도에 닿으면 새 대화로 다시 (Copilot 탭 흉내)
class A:
    max_chars = 10000
    tool_result_chars = 6000


class FakeLink:
    def __init__(self, replies):
        self.replies, self.sent_log, self.reset_once, self.fail = list(replies), [], False, None
        self.turns_left = None

    def request(self, parts, new_thread, model=""):
        if self.fail:
            raise self.fail
        if self.reset_once and not new_thread:
            self.reset_once = False
            raise relay.ThreadReset("Copilot 대화 한도")
        self.sent_log.append({"new_thread": new_thread, "parts": parts, "model": model})
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):  # 이 차례의 질문에서 오류 (예: 다시 부탁할 때 사용량 제한)
            raise reply
        return {"text": reply}


link = FakeLink(['```json\n{"tool": "write", "arguments": {"path": "hello.txt", "content": "hi"}}\n```', "다 만들었습니다.",
                 "새 세션 답", "한도 뒤 새 대화 답"])
r = relay.Relay(A(), link)
sent_log = link.sent_log
tools = [{"type": "function", "function": {"name": n, "description": n + " tool", "parameters": {"type": "object"}}} for n in TOOLS]
sys_msg = {"role": "system", "content": "SYSTEM PROMPT"}
u1 = {"role": "user", "content": [{"type": "text", "text": "hello.txt 만들어줘"}]}
a1 = r.handle({"messages": [sys_msg, u1], "tools": tools})
check("1차: 새 대화 + 지침 포함", sent_log[0]["new_thread"] and relay.PROTOCOL_TAG in sent_log[0]["parts"][0] and "SYSTEM PROMPT" in sent_log[0]["parts"][0])
check("1차: tool_calls 로 변환", a1.get("tool_calls") and a1["tool_calls"][0]["function"]["name"] == "write", a1)
# pi 는 받은 assistant 메시지 + 도구 결과를 붙여서 다시 보냄 (arguments 공백/순서가 달라도 같은 것으로 인식해야 함)
a1_echo = json.loads(json.dumps(a1))
a1_echo["tool_calls"][0]["function"]["arguments"] = json.dumps(json.loads(a1["tool_calls"][0]["function"]["arguments"]), indent=1)
tool_res = {"role": "tool", "tool_call_id": a1["tool_calls"][0]["id"], "content": "Successfully wrote 2 bytes"}
a2 = r.handle({"messages": [sys_msg, u1, a1_echo, tool_res], "tools": tools})
check("2차: 같은 대화에 이어서 (새 대화 아님)", sent_log[1]["new_thread"] is False, sent_log[1])
check("2차: 새로 추가된 도구 결과만 전송 (지침 없음)", "TOOL_RESULT (write)" in sent_log[1]["parts"][0] and relay.PROTOCOL_TAG not in sent_log[1]["parts"][0],
      sent_log[1]["parts"][0][:200])
check("2차: 최종 답", a2.get("content") == "다 만들었습니다." and not a2.get("tool_calls"), a2)
# 다른 세션 (기록이 다름) -> 새 대화
u3 = {"role": "user", "content": "다른 질문"}
a3 = r.handle({"messages": [sys_msg, u3], "tools": tools})
check("3차: 기록이 다르면 새 대화 + 지침 재주입", sent_log[2]["new_thread"] and relay.PROTOCOL_TAG in sent_log[2]["parts"][0])
# 이어서 보내려는데 Copilot 대화 한도 -> 같은 요청을 새 대화로 (지침 + 이전 기록 포함) 다시
link.reset_once = True
a4 = r.handle({"messages": [sys_msg, u3, a3, {"role": "user", "content": "이어지는 질문"}], "tools": tools})
check("4차: 한도 -> 새 대화로 다시 보냄 (이전 기록 포함)", sent_log[3]["new_thread"] and "다른 질문" in sent_log[3]["parts"][0]
      and "이어지는 질문" in sent_log[3]["parts"][-1] and a4.get("content") == "한도 뒤 새 대화 답", sent_log[3]["parts"][0][-300:])
# 브라우저/Copilot 탭이 없으면 오류(503)를 그대로 돌려줌
link.fail = relay.RelayError(503, "Copilot 탭을 찾지 못했습니다")
try:
    r.handle({"messages": [sys_msg, u1], "tools": tools})
    check("Copilot 탭 없으면 오류", False, "예외 없음")
except relay.RelayError as e:
    check("Copilot 탭 없으면 503 오류", e.status == 503, e)
check("오류 뒤에는 다음 요청을 새 대화로", r.fresh is True)

# 파일을 만들라는데 코드만 보여 주면 -> write 블록으로 다시 부탁
link2 = FakeLink(["설명입니다.\n```python\nprint(1)\n```", "```text\n@tool write path=a.py\nprint(1)\n```"])
r2 = relay.Relay(A(), link2)
a5 = r2.handle({"messages": [sys_msg, {"role": "user", "content": "a.py 를 만들어줘"}], "tools": tools})
check("코드만 보여 주면 write 블록으로 다시 요청", len(link2.sent_log) == 2 and "write 블록" in link2.sent_log[1]["parts"][0]
      and a5.get("tool_calls") and a5["tool_calls"][0]["function"]["name"] == "write", (link2.sent_log, a5))
# 질문(파일 생성 요청 아님)에 코드 예시로 답하면 그대로 최종 답
link3 = FakeLink(["예시입니다.\n```python\nprint(1)\n```"])
r3 = relay.Relay(A(), link3)
a6 = r3.handle({"messages": [sys_msg, {"role": "user", "content": "파이썬에서 출력은 어떻게 해?"}], "tools": tools})
check("질문에 코드 예시로 답하면 그대로 최종 답", len(link3.sent_log) == 1 and not a6.get("tool_calls"), (link3.sent_log, a6))
# '실패가 있으면 고쳐줘' -> 테스트를 돌려 보고(도구 사용) 코드 블록이 섞인 보고로 끝내면 다시 부탁하지 않음 (실제 오작동 사례)
link4 = FakeLink(["모두 통과해서 고칠 것이 없습니다.\n```python\nRan 7 tests OK\n```"])
r4 = relay.Relay(A(), link4)
u7 = {"role": "user", "content": "전체 테스트를 실행하고 실패가 있으면 고쳐줘."}
call7 = {"role": "assistant", "content": None, "tool_calls": [{"id": "c7", "type": "function",
         "function": {"name": "bash", "arguments": "{\"command\": \"python -m unittest\"}"}}]}
a7 = r4.handle({"messages": [sys_msg, u7, call7, {"role": "tool", "tool_call_id": "c7", "content": "OK"}], "tools": tools})
check("도구를 쓴 뒤의 코드 섞인 보고는 그대로 최종 답", len(link4.sent_log) == 1 and not a7.get("tool_calls"), (link4.sent_log, a7))
# 사용량 제한(429, Copilot "요청이 너무 많아..."): 새 대화를 열지 않고 오류로 알리고, 풀린 뒤 같은 대화에 이어서 보냄
link5 = FakeLink(["첫 답", "제한 뒤 답"])
r5 = relay.Relay(A(), link5)
u8 = {"role": "user", "content": "안녕"}
a8 = r5.handle({"messages": [sys_msg, u8], "tools": tools})
link5.fail = relay.RelayError(429, "Copilot 사용량 제한")
u9 = {"role": "user", "content": "다음 질문"}
try:
    r5.handle({"messages": [sys_msg, u8, a8, u9], "tools": tools})
    ok429 = False
except relay.RelayError as e:
    ok429 = e.status == 429
link5.fail = None
a9 = r5.handle({"messages": [sys_msg, u8, a8, u9], "tools": tools})
check("사용량 제한(429)은 오류로 알리고, 풀린 뒤 같은 대화에 이어서", ok429 and len(link5.sent_log) == 2
      and link5.sent_log[-1]["new_thread"] is False and a9.get("content") == "제한 뒤 답", link5.sent_log)

# 분당 질문 수 상한(max_questions_per_minute): 처음 그 수만큼은 바로, 그 뒤로는 일정 간격 (가짜 시계로 확인)
clock = {"t": 1000.0}
waits = []
real_time, real_sleep = relay.time.time, relay.time.sleep
relay.time.time = lambda: clock["t"]
relay.time.sleep = lambda s: (waits.append(round(s, 1)), clock.__setitem__("t", clock["t"] + s))
try:
    pl = relay.CopilotLink({"max_questions_per_minute": 2})
    for _ in range(4):
        pl.pace()  # 질문 4개를 연달아: 앞 2개는 바로, 뒤 2개는 30초씩 기다림
    off = relay.CopilotLink({"max_questions_per_minute": 0})
    off.pace()
finally:
    relay.time.time, relay.time.sleep = real_time, real_sleep
check("분당 2개 상한: 2개는 바로, 이후 30초 간격 (끄면 기다리지 않음)", waits == [30.0, 30.0], waits)

# JSON 안의 잘못된 역슬래시(\d, \] 등)는 짐작해서 고치지 않고 다시 부탁 (\] 를 살렸다가 파이썬 파일이 깨진 일이 있었음)
call, err = relay.parse_block('{"tool": "bash", "arguments": {"command": "grep -E \'\\d+\' a.txt"}}', "json", TOOLS)
check("JSON 안 잘못된 이스케이프 -> 오류와 안내 (역슬래시 두 번 / @tool write)", call is None and err and "역슬래시" in err
      and "@tool write" in err, (call, err))
call, err = relay.parse_block('{"tool": "write", "arguments": {"path": "io.py", "content": "cols = [\\"a\\"\\]"}}', "json", TOOLS)
check("JSON 안 \\] (마크다운식) 도 그대로 쓰지 않음", call is None and err, (call, err))

# write 형식을 흉내 낸 다른 도구 블록 (긴 대화에서 실제로 나온 형태)
text, call, err = relay.parse_reply({"text": "```text\n@tool read path=sales/io.py\n```"}, TOOLS)
check("'@tool read path=...' 형식", call == {"name": "read", "arguments": {"path": "sales/io.py"}}, (text, call, err))
text, call, err = relay.parse_reply({"text": "```text\n@tool bash\npython -m unittest discover -s tests -t . -v\n```"}, TOOLS)
check("'@tool bash' + 다음 줄 명령 형식", call == {"name": "bash", "arguments": {"command": "python -m unittest discover -s tests -t . -v"}},
      (text, call, err))
text, call, err = relay.parse_reply({"text": "```text\n@tool read path=a.py offset=10 limit=20\n```"}, TOOLS)
check("'@tool read' 숫자 인자", call and call["arguments"] == {"path": "a.py", "offset": 10, "limit": 20}, (text, call, err))
text, call, err = relay.parse_reply({"text": "파일을 봅니다.\n@tool bash\nls -la"}, TOOLS)
check("울타리 없는 '@tool bash' 블록", call == {"name": "bash", "arguments": {"command": "ls -la"}} and text == "파일을 봅니다.", (text, call, err))

# 대화가 길어지면(질문 15개 이상) 보내는 메시지마다 진행 규칙 요약을 붙임
link6 = FakeLink(["첫 답", "둘째 답"])
r6 = relay.Relay(A(), link6)
u10 = {"role": "user", "content": "첫 요청"}
a10 = r6.handle({"messages": [sys_msg, u10], "tools": tools})
link6.asked = 20
u11 = {"role": "user", "content": "다음 요청"}
a12 = r6.handle({"messages": [sys_msg, u10, a10, u11], "tools": tools})
check("질문 15개 이후 진행 방식 요약 첨부 (최종 답 안내가 먼저)", "진행 방식: 요청이 끝났으면" in link6.sent_log[-1]["parts"][0]
      and "bash" in link6.sent_log[-1]["parts"][0] and "참고 - 진행 방식" not in link6.sent_log[0]["parts"][0], link6.sent_log[-1]["parts"][0][-300:])
link6.replies.append("셋째 답")
link6.asked = 21
r6.handle({"messages": [sys_msg, u10, a10, u11, a12, {"role": "user", "content": "또 요청"}], "tools": tools})
check("요약은 10개마다 한 번 (바로 다음 메시지에는 없음)", "진행 방식" not in link6.sent_log[-1]["parts"][0], link6.sent_log[-1]["parts"][0][-200:])

# 다른 에이전트(internal-agent-p0) 연결 대비
#  - 역할 지정 줄은 영어·한국어 모두 빼고, 같은 문단의 나머지 규칙은 남김
check("한국어 역할 지정 줄만 빼고 나머지 규칙은 남김",
      relay.system_for_copilot("너는 정해진 범위 안에서 일하는 코딩 도우미다.\n작업 폴더 밖은 건드리지 마라.\n\n규칙 B")
      == "작업 폴더 밖은 건드리지 마라.\n\n규칙 B", relay.system_for_copilot("너는 코딩 도우미다.\n규칙\n\n규칙 B"))
check("영어 역할 지정 문단(pi)은 그대로 빠짐",
      relay.system_for_copilot("You are an expert coding assistant.\n\nRule A") == "Rule A", relay.system_for_copilot("You are x.\n\nRule A"))
#  - 에이전트가 맥락을 줄이려고 오래된 도구 결과를 비우거나 요약해도 같은 대화로 이어 감
link12 = FakeLink(['```json\n{"tool": "bash", "arguments": {"command": "ls"}}\n```', "끝났습니다."])
r12 = relay.Relay(A(), link12)
u12 = {"role": "user", "content": "목록 보여줘"}
a16 = r12.handle({"messages": [sys_msg, u12], "tools": tools})
cid = a16["tool_calls"][0]["id"]
pruned = {"role": "tool", "tool_call_id": cid, "content": "[오래된 결과 생략]"}
r12.handle({"messages": [sys_msg, u12, a16, {"role": "tool", "tool_call_id": cid, "content": "a.txt b.txt"}], "tools": tools})
link12.replies.append("다음 답")
r12.handle({"messages": [sys_msg, u12, a16, pruned, {"role": "assistant", "content": "끝났습니다."},
                         {"role": "user", "content": "다음 요청"}], "tools": tools})
check("오래된 도구 결과를 비워도 새 대화 없이 이어 감", link12.sent_log[-1]["new_thread"] is False, link12.sent_log[-1])
#  - /v1/models 에 맥락 한도(max_model_len)
import json as _json, threading as _th, urllib.request as _ur
from http.server import ThreadingHTTPServer as _Srv
_srv = _Srv(("127.0.0.1", 0), relay.make_handler(r12, None, {"cdp_port": 1}))
_th.Thread(target=_srv.serve_forever, daemon=True).start()
_m = _json.loads(_ur.urlopen("http://127.0.0.1:{}/v1/models".format(_srv.server_address[1]), timeout=5).read())
_srv.shutdown()
check("/v1/models 에 max_model_len", _m["data"][0].get("id") == "copilot" and _m["data"][0].get("max_model_len") == 1000000, _m)

# 같은 도구 호출이 연달아 반복되면 끊음 (실제: 같은 write 를 60번 넘게 반복)
same = '```json\n{"tool": "write", "arguments": {"path": "a.py", "content": "x = 1\\n"}}\n```'
wcall = lambda i: {"role": "assistant", "content": None, "tool_calls": [{"id": "w%d" % i, "type": "function",
                   "function": {"name": "write", "arguments": json.dumps({"path": "a.py", "content": "x = 1\n"})}}]}
wres = lambda i: {"role": "tool", "tool_call_id": "w%d" % i, "content": "Successfully wrote 6 bytes to a.py"}
hist = [sys_msg, {"role": "user", "content": "a.py 를 만들어줘"}, wcall(1), wres(1), wcall(2), wres(2)]
link9 = FakeLink([same, "a.py 를 만들었습니다. 끝났습니다."])
r9 = relay.Relay(A(), link9)
a13 = r9.handle({"messages": hist, "tools": tools})
check("같은 호출 3번째 -> 다른 작업을 하라고 다시 요청 후 최종 답", len(link9.sent_log) == 2 and "이미 2번 똑같이" in link9.sent_log[1]["parts"][0]
      and not a13.get("tool_calls") and "끝났습니다" in (a13.get("content") or ""), (link9.sent_log, a13))
link10 = FakeLink([same, same])
r10 = relay.Relay(A(), link10)
a14 = r10.handle({"messages": hist, "tools": tools})
check("다시 요청해도 반복하면 그 요청을 멈춤", not a14.get("tool_calls") and "반복되어 여기서 멈췄습니다" in (a14.get("content") or ""), a14)
link11 = FakeLink([same])
r11 = relay.Relay(A(), link11)
a15 = r11.handle({"messages": hist[:4], "tools": tools})
check("두 번째 같은 호출까지는 그대로 실행", a15.get("tool_calls") and len(link11.sent_log) == 1, (link11.sent_log, a15))

# 일을 마치지 않고 "다음 블록을 드리겠습니다" 로 멈추면 이어서 하도록 한 번 부탁 (실제 사례 문구)
link7 = FakeLink(["Git 저장소가 맞다면, 결과를 본 다음 커밋하는 다음 블록을 드리겠습니다.",
                  "```json\n{\"tool\": \"bash\", \"arguments\": {\"command\": \"git status\"}}\n```"])
r7 = relay.Relay(A(), link7)
a11 = r7.handle({"messages": [sys_msg, {"role": "user", "content": "git status 를 보고 커밋해줘"}], "tools": tools})
check("중간에 멈춘 답 -> 이어서 하도록 다시 요청", len(link7.sent_log) == 2 and "기다리지 마시고" in link7.sent_log[1]["parts"][0]
      and a11.get("tool_calls"), (link7.sent_log, a11))
# 도구를 쓰지 말라는 질문에는 이어서 하라고 하지 않음
link8 = FakeLink(["최근에는 그래프를 추가했고, 다음 단계는 README 갱신입니다."])
r8 = relay.Relay(A(), link8)
r8.handle({"messages": [sys_msg, {"role": "user", "content": "도구는 쓰지 말고 기억으로만 답해줘: 최근 작업은?"}], "tools": tools})
check("도구 없이 답하라는 질문에는 이어서 하라고 하지 않음", len(link8.sent_log) == 1, link8.sent_log)
# 계획 모드(pi 의 /plan: 요청 앞에 "[계획 모드] ...")에서는 계획 글에 흔한 말이 있어도 도구를 쓰라고 다시 부탁하지 않음
plan_req = {"role": "user", "content": "[계획 모드] 지금은 계획만 세웁니다. 승인하면 그때 진행합니다.\n\nlogin.py 에 로그 기능을 추가해줘"}
for reply, name in [
    ("계획:\n1. login.py 수정\n```python\nimport logging\n```\n2. 확인", "코드 예시가 있어도 write 를 부탁하지 않음"),
    ("계획 모드라서 지금은 실행할 수 없습니다. 계획:\n1. a\n2. b", "'실행할 수 없' 이 있어도 거절로 보지 않음"),
    ("1. a 확인\n2. 다음 단계는 b 수정입니다.", "'다음 단계는' 이 있어도 이어서 하라고 하지 않음"),
]:
    lk = FakeLink([reply, "다시 부탁한 뒤의 답"])
    out = relay.Relay(A(), lk).handle({"messages": [sys_msg, plan_req], "tools": tools})
    check("계획 모드: " + name, len(lk.sent_log) == 1 and out.get("content") == reply, (lk.sent_log, out))
lk = FakeLink(["```python\nimport logging\n```", "다시 부탁한 뒤의 답"])
relay.Relay(A(), lk).handle({"messages": [sys_msg, {"role": "user", "content": "login.py 에 로그 기능을 추가해줘"}], "tools": tools})
check("(비교) 계획 모드가 아니면 코드만 보여 줄 때 write 블록을 부탁함", len(lk.sent_log) == 2, lk.sent_log)

# 모델 선택: pi 모델 id -> Copilot 화면의 모델 이름 (Copilot 은 새 채팅마다 '자동' 으로 돌아가므로 중계 서버가 고름)
cfgm = {"copilot_model": "GPT 6.0 Sol", "copilot_models": {"gpt-5.6-sol-think": "GPT 5.6 Sol 깊이 생각하기", "screen": ""}}
check("모델: 표에 있는 id", relay.copilot_model_for("gpt-5.6-sol-think", cfgm) == "GPT 5.6 Sol 깊이 생각하기")
check("모델: 'copilot'(또는 없음)은 copilot_model", relay.copilot_model_for("copilot", cfgm) == "GPT 6.0 Sol"
      and relay.copilot_model_for(None, cfgm) == "GPT 6.0 Sol")
check("모델: 표에 없는 id 는 그대로 화면 이름", relay.copilot_model_for("Claude Opus 4.8", cfgm) == "Claude Opus 4.8")
check("모델: 표의 값이 비어 있으면 화면 그대로", relay.copilot_model_for("screen", cfgm) == "")
link13 = FakeLink(["답1"])
link13.cfg = cfgm
r13 = relay.Relay(A(), link13)
r13.handle({"model": "gpt-5.6-sol-think", "messages": [sys_msg, {"role": "user", "content": "안녕"}], "tools": tools})
check("요청의 모델을 Copilot 화면 이름으로 넘김", link13.sent_log[0]["model"] == "GPT 5.6 Sol 깊이 생각하기", link13.sent_log)
# 메뉴에서 이름 찾기: Copilot 이 표기만 바꾼 이름(2026-10: 'GPT 6.0 Sol' -> 'GPT-6 Sol', 'GPT 5.6 Sol' -> 'GPT-5.6 Sol')도 같은 모델
_mk = relay.bridge.model_key
check("모델 이름 비교: '.0'·띄어쓰기·'-' 차이는 같음", _mk("GPT 6.0 Sol") == _mk("GPT-6 Sol") == _mk("gpt-6 sol ⌄")
      and _mk("GPT 5.6 Sol 빠른 응답") == _mk("GPT-5.6 Sol 빠른 응답"))
check("모델 이름 비교: 다른 버전은 다름", _mk("GPT-5.6 Sol") != _mk("GPT-5 Sol") and _mk("GPT-6 Sol") != _mk("GPT-60 Sol")
      and _mk("GPT 6.05") != _mk("GPT 6.5") and _mk("Sonnet 4.5") != _mk("Sonnet 4"))
_menu = [{"title": t, "text": t} for t in ("GPT-5.6 Sol 빠른 응답", "GPT-5.6 Sol 깊이 생각하기", "GPT-6 Sol")]
_pick = relay.bridge.Copilot.pick
check("메뉴에서 고르기: 예전 이름 'GPT 6.0 Sol' -> 화면의 'GPT-6 Sol'", (_pick(_menu, "GPT 6.0 Sol") or {}).get("title") == "GPT-6 Sol")
check("메뉴에서 고르기: 새 이름 그대로", (_pick(_menu, "GPT-6 Sol") or {}).get("title") == "GPT-6 Sol"
      and (_pick(_menu, "GPT 5.6 Sol 깊이 생각하기") or {}).get("title") == "GPT-5.6 Sol 깊이 생각하기")
check("메뉴에서 고르기: 'GPT-5.6 Sol' 처럼 여럿에 걸리면 고르지 않음", _pick(_menu, "GPT-5.6 Sol") is None
      and _pick(_menu, "GPT-7 Sol") is None)
check("저장소 설정의 모델 이름이 지금 화면 이름 (2026-10)", relay.copilot_model_for("gpt-6.0-sol", relay.bridge.load_config(
      os.path.join(os.path.dirname(relay.__file__), "bridge.json"), None)) == "GPT-6 Sol")

# 끝난 대화 정리: 중계 서버가 만든 대화만 기록해 두고 그것만 지움
import tempfile  # noqa: E402
_tmp = tempfile.mkdtemp()
_path = os.path.join(_tmp, "copilot-chats.json")
reg = relay.ChatRegistry(_path)
reg.add("c1", "https://x/chat/conversation/c1")
reg.add("c1", "https://x/chat/conversation/c1")
check("대화 기록: 같은 대화는 한 번만, 쓰는 중이면 삭제 대상 아님", len(reg.chats) == 1 and reg.pending() == [], reg.chats)
reg.finish_all()
check("대화 기록: 새 대화를 열거나 세션이 끝나면 삭제 대상", [c["id"] for c in reg.pending()] == ["c1"])
for _ in range(3):
    reg.failed("c1")
check("대화 기록: 3번 실패하면 더 시도하지 않음", reg.pending() == [])
reg.add("c2", "https://x/chat/conversation/c2")
reg2 = relay.ChatRegistry(_path)
check("대화 기록: 중계 서버를 다시 켜면 지난번에 쓰던 대화도 삭제 대상", [c["id"] for c in reg2.pending()] == ["c2"], reg2.chats)
reg2.deleted("c2")
check("대화 기록: 지운 대화는 기록에서 빠짐", [c["id"] for c in relay.ChatRegistry(_path).chats] == ["c1"])


class FakeCop:
    def __init__(self):
        self.thread_url, self.deleted = "https://x/chat/conversation/c9", []

    def delete_chat(self, cid):
        self.deleted.append(cid)
        return True, "ok"


link14 = FakeLink([])
link14.cfg = {"delete_finished_chats": True}
link14.registry = relay.ChatRegistry(os.path.join(_tmp, "c14.json"))
link14.registry.add("c9", "https://x/chat/conversation/c9")
link14.cop = FakeCop()
link14.cleanup = lambda: relay.CopilotLink.cleanup(link14)
r14 = relay.Relay(A(), link14)
r14.sent, r14.fresh = ["x"], False
r14.end_session("quit")
check("pi 세션 끝: 쓰던 대화 삭제 + 다음 요청은 새 대화", link14.cop.deleted == ["c9"] and r14.fresh and r14.sent == []
      and link14.registry.chats == [], (link14.cop.deleted, link14.registry.chats))
link14.cfg["delete_finished_chats"] = False
link14.registry.add("c10", "u")
r14.end_session("quit")
check("delete_finished_chats=false 면 지우지 않음", link14.cop.deleted == ["c9"] and link14.registry.pending()[0]["id"] == "c10")

# HTTP: /v1/session/end (reload 는 같은 대화를 이어 가므로 무시) + /v1/models 에 설정한 모델들
_calls = []
r15 = relay.Relay(A(), FakeLink([]))
r15.end_session = lambda reason="", seen=None: _calls.append((reason, seen))
_srv2 = _Srv(("127.0.0.1", 0), relay.make_handler(r15, None, {"cdp_port": 1, "copilot_models": {"gpt-6.0-sol": "GPT 6.0 Sol"}}))
_th.Thread(target=_srv2.serve_forever, daemon=True).start()
_base = "http://127.0.0.1:{}".format(_srv2.server_address[1])
for _reason in ("reload", "quit"):
    _req = _ur.Request(_base + "/v1/session/end", data=_json.dumps({"reason": _reason}).encode(),
                       headers={"Content-Type": "application/json"})
    _ur.urlopen(_req, timeout=5).read()
_ids = [m["id"] for m in _json.loads(_ur.urlopen(_base + "/v1/models", timeout=5).read())["data"]]
import time as _time  # noqa: E402
_time.sleep(0.3)
_srv2.shutdown()
check("/v1/session/end: reload 는 무시, quit 은 정리 (알림 때의 요청 수를 함께 넘김)", _calls == [("quit", 0)], _calls)
check("/v1/models: copilot + 설정한 모델", _ids == ["copilot", "gpt-6.0-sol"], _ids)

# '답:' 로그 줄의 통계 (걸린 시간 · 조각 · 새 대화 · 다시 보냄) + diag --report 의 최근 요청 통계
import io as _io  # noqa: E402
import contextlib as _cl  # noqa: E402
_out = _io.StringIO()
_link16 = FakeLink(['```json\n{"tool": "bash", "arguments": {"command": "ls"\n```',  # 형식 오류 -> 다시 부탁
                    '```json\n{"tool": "bash", "arguments": {"command": "ls"}}\n```'])
_r16 = relay.Relay(A(), _link16)
with _cl.redirect_stdout(_out):
    _r16.handle({"messages": [{"role": "user", "content": "파일 목록 만들어줘"}], "tools": tools})
_ans = [ln for ln in _out.getvalue().splitlines() if "답:" in ln]
check("'답:' 줄에 통계 (새 대화 + 다시 보냄)", len(_ans) == 1 and "· 조각 2 · 새 대화 · 다시 보냄 1)" in _ans[0], _out.getvalue())
import diag  # noqa: E402
_lines = ["10:00:00 요청 (새 대화=True, 조각 3개, 25000자)",
          "10:01:05 답: 도구 read (65.0초 · 조각 3 · 새 대화)",
          "10:01:20 답: 도구 bash (10.0초 · 조각 1)",
          "10:01:40 오류: Copilot 처리 실패: x",
          "10:02:00 답: 본문 20자 (20.0초 · 조각 3 · 다시 보냄 1)",
          "10:02:30 답: 도구 write",  # 예전 판 형식 (통계 없음)
          "10:03:00 답: 도구 edit (5.0초 · 조각 1)"]
_st = diag.request_stats(_lines)
check("diag 통계: 개수·평균·중간·최대", _st and _st["n"] == 4 and abs(_st["avg"] - 25.0) < 0.01 and _st["median"] == 20.0
      and _st["max"] == 65.0, _st)
check("diag 통계: 새 대화·조각 나눔·다시 보냄·오류", _st["new"] == 1 and _st["new_avg"] == 65.0 and _st["split"] == 2
      and _st["retry"] == 1 and _st["errors"] == 1, _st)
check("diag 통계: 기록 없으면 None", diag.request_stats(["10:00:00 답: 도구 read"]) is None)

# multi_read (bridge.json, 기본 꺼짐): 맨 앞부터 이어지는 read 블록 여러 개를 한 번에 tool_calls 로
_rb = ('```json\n{"tool": "read", "arguments": {"path": "a.py"}}\n```\n'
       '```json\n{"tool": "read", "arguments": {"path": "b.py"}}\n```\n'
       '```json\n{"tool": "bash", "arguments": {"command": "ls"}}\n```')
_calls = relay.leading_reads({"text": _rb}, TOOLS)
check("leading_reads: 앞의 read 2개만 (bash 앞에서 멈춤)", [c["arguments"]["path"] for c in _calls] == ["a.py", "b.py"], _calls)
check("leading_reads: 첫 블록이 read 가 아니면 없음", relay.leading_reads(
    {"text": '```json\n{"tool": "bash", "arguments": {"command": "ls"}}\n```\n```json\n{"tool": "read", "arguments": {"path": "a"}}\n```'},
    TOOLS) == [])
_mr = FakeLink([_rb, "비교했습니다."])
_mr.cfg = {"multi_read": True}
_rm = relay.Relay(A(), _mr)
_u = {"role": "user", "content": "a.py 와 b.py 를 비교해줘"}
with _cl.redirect_stdout(_io.StringIO()):
    _am = _rm.handle({"messages": [_u], "tools": tools})
check("multi_read 켬: tool_calls 2개 (read 만)", [tc["function"]["name"] for tc in _am.get("tool_calls", [])] == ["read", "read"], _am)
check("multi_read 켬: 지침에 read 여러 개 허용 안내", relay.MULTI_READ_RULE.strip() in _mr.sent_log[0]["parts"][0])
_res = [{"role": "tool", "tool_call_id": tc["id"], "content": "내용 {}".format(i)} for i, tc in enumerate(_am["tool_calls"])]
with _cl.redirect_stdout(_io.StringIO()):
    _a2 = _rm.handle({"messages": [_u, _am] + _res, "tools": tools})
check("multi_read 켬: 결과 두 개를 같은 대화에 한 메시지로", not _mr.sent_log[1]["new_thread"]
      and _mr.sent_log[1]["parts"][0].count("TOOL_RESULT (read)") == 2 and _a2.get("content") == "비교했습니다.", _mr.sent_log[1])
_off = FakeLink([_rb])
_off.cfg = {}
with _cl.redirect_stdout(_io.StringIO()):
    _ao = relay.Relay(A(), _off).handle({"messages": [_u], "tools": tools})
check("multi_read 끔(기본): 첫 블록 하나만, 안내 없음",
      len(_ao["tool_calls"]) == 1 and relay.MULTI_READ_RULE.strip() not in _off.sent_log[0]["parts"][0], _ao)

# GET /status: 요청을 처리하는 중(잠금이 잡혀 있어도) 바로 지금 하는 일을 돌려줌
_r17 = relay.Relay(A(), FakeLink([]))
_srv3 = _Srv(("127.0.0.1", 0), relay.make_handler(_r17, None, {"cdp_port": 1}))
_th.Thread(target=_srv3.serve_forever, daemon=True).start()
_base3 = "http://127.0.0.1:{}".format(_srv3.server_address[1])
_idle = _json.loads(_ur.urlopen(_base3 + "/status", timeout=5).read())
_r17.lock.acquire()
relay.STATUS.update(busy=True, started=_time.time() - 3)
relay.set_phase("답 기다리는 중 (2/3)")
_t0 = _time.time()
_busy = _json.loads(_ur.urlopen(_base3 + "/status", timeout=5).read())
_waited = _time.time() - _t0
_r17.lock.release()
relay.STATUS["busy"] = False
_srv3.shutdown()
check("/status: 쉴 때", _idle["busy"] is False and _idle["phase"] == "" and _idle["version"] == relay.RELAY_VERSION, _idle)
check("/status: 일하는 중 (잠금이 잡혀 있어도 바로)", _busy["busy"] and _busy["phase"] == "답 기다리는 중 (2/3)"
      and _busy["total_seconds"] >= 3 and _waited < 1.0, (_busy, _waited))
with _cl.redirect_stdout(_io.StringIO()):
    _r18 = relay.Relay(A(), FakeLink(["끝"]))
    _r18.handle({"messages": [{"role": "user", "content": "x"}], "tools": tools})
check("/status: 요청이 끝나면 다시 쉼", relay.status()["busy"] is False)

# max_tabs (pi 여러 개 동시 실행): 세션(X-Pi-Session)마다 Copilot 창 하나씩
_reg19 = relay.ChatRegistry(os.path.join(_tmp, "c19.json"))
_reg19.add("a1", "u", "1")
_reg19.add("b1", "u", "2")
_reg19.finish_all("1")
check("기록: 창 번호(owner)별로 끝냄 (다른 창의 대화는 그대로)",
      [(c["id"], c["state"]) for c in _reg19.chats] == [("a1", "finished"), ("b1", "active")], _reg19.chats)
_cl19 = _reg19.claim_pending()
check("기록: 지울 대화를 가져가면 '지우는 중' (다른 창은 못 가져감)", [c["id"] for c in _cl19] == ["a1"] and _reg19.claim_pending() == []
      and _reg19.chats[0]["state"] == "deleting")
_reg19.failed("a1")
check("기록: 지우기 실패하면 다시 지울 대상", _reg19.chats[0]["state"] == "finished" and _reg19.chats[0]["tries"] == 1)
check("기록: 다시 켜면 '지우는 중' 도 지울 대상", relay.ChatRegistry(os.path.join(_tmp, "c19.json")).chats[0]["state"] == "finished")


class _LaneLink:
    made = []

    def __init__(self, cfg, registry=None, owner=None, claims=None, bucket=None):
        self.cfg, self.registry, self.owner, self.turns_left = cfg, registry, owner, None
        self.sent_log = []
        _LaneLink.made.append(self)

    def request(self, parts, new_thread, model=""):
        self.sent_log.append(new_thread)
        _time.sleep(0.6)
        return {"text": "창 {} 의 답".format(self.owner)}


_real_link = relay.CopilotLink
relay.CopilotLink = _LaneLink
try:
    _lanes = relay.Lanes(A(), {}, None, 2)
    _ra, _rb2 = _lanes.pick("A"), _lanes.pick("B")
    check("창 나누기: 세션 A 는 창 1, B 는 새 창 2", _ra.link.owner == "1" and _rb2.link.owner == "2" and len(_lanes.lanes) == 2)
    check("창 나누기: 같은 세션은 같은 창", _lanes.pick("A") is _ra)
    _out = {}

    def _go(name, rl):  # (redirect_stdout 는 스레드끼리 섞이므로 로그만 끔)
        _out[name] = rl.handle({"messages": [{"role": "user", "content": name}], "tools": tools})["content"]

    _ra.log = _rb2.log = lambda *a: None
    _t0 = _time.time()
    _ths = [_th.Thread(target=_go, args=(n, rl)) for n, rl in (("A", _ra), ("B", _rb2))]
    [t.start() for t in _ths]
    [t.join() for t in _ths]
    _el = _time.time() - _t0
    check("창 나누기: 두 세션을 동시에 처리 (0.6초씩 -> 합쳐 1초 안)", _out == {"A": "창 1 의 답", "B": "창 2 의 답"} and _el < 1.0, (_out, _el))
    _rc = _lanes.pick("C")
    check("창 나누기: 창이 모두 쓰이면 가장 오래 쉰 창을 넘겨받음", _rc is _ra and len(_lanes.lanes) == 2, [ln["session"] for ln in _lanes.lanes])
    _lanes.end("B", "quit")
    _time.sleep(0.2)
    check("창 나누기: 세션이 끝나면 그 창은 비어 다음 세션이 씀", _lanes.pick("D") is _rb2)
    check("창 나누기: 진행 상태는 창마다 따로", _ra.status is not _rb2.status and _lanes.status("zzz")["busy"] is False)
finally:
    relay.CopilotLink = _real_link


def _quiet(fn):
    with _cl.redirect_stdout(_io.StringIO()):
        return fn()


# 거절 문구: 도구를 쓰기 전이면 설명하고 다시 부탁, 도구를 쓴 뒤의 "확인할 수 없습니다" 는 결과에 대한 보통 답
_lk = FakeLink(["저는 파일에 접근할 수 없습니다.", '```json\n{"tool": "read", "arguments": {"path": "a.txt"}}\n```'])
_out = _quiet(lambda: relay.Relay(A(), _lk).handle({"messages": [sys_msg, {"role": "user", "content": "a.txt 내용을 보여줘"}],
                                                     "tools": tools}))
check("도구를 쓰기 전의 거절 -> 설명 후 다시 부탁", len(_lk.sent_log) == 2 and "직접 실행하실 필요는 없습니다" in _lk.sent_log[1]["parts"][0]
      and _out.get("tool_calls"), (_lk.sent_log, _out))
_tcall = lambda i: {"role": "assistant", "content": None, "tool_calls": [{"id": "t%d" % i, "type": "function",
                    "function": {"name": "bash", "arguments": json.dumps({"command": "tail -n 3 train.log"})}}]}
_tres = lambda i, out: {"role": "tool", "tool_call_id": "t%d" % i, "content": out}
_lk = FakeLink(["로그를 봤지만 멈춘 원인은 확인할 수 없습니다. 설정 파일을 더 봐야 합니다.", "다시 부탁한 뒤의 답"])
_out = _quiet(lambda: relay.Relay(A(), _lk).handle({"messages": [sys_msg, {"role": "user", "content": "학습이 왜 멈췄는지 봐줘"},
                                                                  _tcall(1), _tres(1, "epoch 3")], "tools": tools}))
check("도구를 쓴 뒤의 '확인할 수 없습니다' 는 그대로 최종 답", len(_lk.sent_log) == 1 and _out.get("content", "").startswith("로그를"),
      (_lk.sent_log, _out))

# 코드만 보여 준 답: 방법·예시를 묻는 질문이면 write 를 부탁하지 않음 ("...만들어줘" 는 그대로 부탁 - 위 시험)
_code = "예시입니다.\n```python\nwith open('a.txt', 'w') as f:\n    f.write('hi')\n```"
for _q in ("csv 파일을 작성하는 방법을 예시로 알려줘", "config.yaml 은 어떻게 수정해?"):
    _lk = FakeLink([_code, "다시 부탁한 뒤의 답"])
    _out = _quiet(lambda: relay.Relay(A(), _lk).handle({"messages": [sys_msg, {"role": "user", "content": _q}], "tools": tools}))
    check("방법·예시 질문에는 write 를 부탁하지 않음: " + _q, len(_lk.sent_log) == 1 and _out.get("content") == _code, (_lk.sent_log, _out))
check("write 부탁에 '설명·예시만 원했다면 방금 답을 최종 답으로' 안내", "방금 답을 그대로 최종 답으로" in relay.CODE_NUDGE)
_lk = FakeLink([_code, "```text\n@tool write path=README.md\n설명\n```"])
_quiet(lambda: relay.Relay(A(), _lk).handle({"messages": [sys_msg, {"role": "user", "content": "README 에 설명을 추가해줘"}], "tools": tools}))
check("'설명을 추가해줘' 같은 고치기 요청은 그대로 write 를 부탁", len(_lk.sent_log) == 2, _lk.sent_log)

# 블록 하나를 닫지 않고 다음 블록을 열면: 예전처럼 가장 가까운 ``` 까지를 첫 블록으로
text, call, err = relay.parse_reply({"text": '```json\n{"tool": "read", "arguments": {"path": "a.py"}}\n\n```json\n{"tool": "read", "arguments": {"path": "b.py"}}\n```'}, TOOLS)
check("닫지 않은 블록 뒤에 블록: 첫 블록을 도구로 (예전과 같음)", call and call["arguments"].get("path") == "a.py", (call, err))
# 도구 이름이 문자열이 아니면 오류 안내 (예전: TypeError 로 500)
call, err = relay.parse_block('{"tool": {"name": "read"}, "arguments": {}}', "json", TOOLS)
check("도구 이름이 문자열이 아니면 형식 오류로 다시 부탁", call is None and err and "문자열" in err, (call, err))

# 사용량 제한(429)이 첫 질문이 아니라 다시 부탁하는 중에 걸려도 같은 대화를 이어 감 (예전: 다음 요청이 새 대화로)
_lk = FakeLink(["첫 답", '```json\n{"tool": "bash", "arguments": {"command": "ls"\n```', relay.RelayError(429, "Copilot 사용량 제한"),
                "제한 뒤 답"])
_r429 = relay.Relay(A(), _lk)
_u1, _u2 = {"role": "user", "content": "안녕"}, {"role": "user", "content": "파일 목록 보여줘"}
_a1 = _quiet(lambda: _r429.handle({"messages": [sys_msg, _u1], "tools": tools}))
try:
    _quiet(lambda: _r429.handle({"messages": [sys_msg, _u1, _a1, _u2], "tools": tools}))
    _st429 = None
except relay.RelayError as e:
    _st429 = e.status
_fresh429 = _r429.fresh
_a3 = _quiet(lambda: _r429.handle({"messages": [sys_msg, _u1, _a1, _u2], "tools": tools}))
check("다시 부탁하다 429 -> 같은 대화 유지, 풀린 뒤 같은 대화에 이어서", _st429 == 429 and _fresh429 is False
      and _lk.sent_log[-1]["new_thread"] is False and _a3.get("content") == "제한 뒤 답", (_st429, _fresh429, _lk.sent_log))

# 같은 명령이라도 결과가 계속 바뀌면(학습 로그 지켜보기) 반복이 아님: 결과까지 같을 때만 반복으로 셈
_tail = {"name": "bash", "arguments": {"command": "tail -n 3 train.log"}}
_poll = [sys_msg, {"role": "user", "content": "학습이 끝날 때까지 지켜봐줘"}, _tcall(1), _tres(1, "epoch 1"), _tcall(2), _tres(2, "epoch 2")]
_same = _poll[:3] + [_tres(1, "epoch 2")] + _poll[4:]
check("반복 세기: 결과가 바뀌면 1번, 결과까지 같으면 2번", relay.repeated_calls(_poll, _tail) == 1 and relay.repeated_calls(_same, _tail) == 2,
      (relay.repeated_calls(_poll, _tail), relay.repeated_calls(_same, _tail)))
_lk = FakeLink(['```json\n{"tool": "bash", "arguments": {"command": "tail -n 3 train.log"}}\n```', "다시 부탁한 뒤의 답"])
_out = _quiet(lambda: relay.Relay(A(), _lk).handle({"messages": _poll, "tools": tools}))
check("결과가 바뀌는 같은 명령은 반복으로 끊지 않음", len(_lk.sent_log) == 1 and _out.get("tool_calls"), (_lk.sent_log, _out))


# 끝난 대화 삭제 안전장치: 새 대화의 첫 답을 받은 뒤, 보낸 메시지(marker)가 아직 화면에 있을 때만 '중계 서버가 만든 대화' 로 기록
#  (기다리는 동안 사용자가 전용 창에서 자기 대화를 눌렀다면 그 대화를 기록해서 지우면 안 됨)
class _RegCop:
    def __init__(self, conv, page):
        self.conv, self.page, self.thread_url, self.turns_left = conv, page, None, None

    def new_chat(self):
        self.thread_url = None

    def send(self, text):
        pass

    def wait_reply(self, marker):
        self.thread_url = "https://x/chat/conversation/" + self.conv  # 답을 받은 때의 화면 주소
        return {"text": "답"}

    def marker_url(self, marker):
        if self.page == "error":
            raise relay.bridge.BridgeError("페이지 스크립트 오류")
        return self.thread_url if self.page == "ours" else None

    def delete_chat(self, cid):
        return True, "ok"


for _conv, _page, _want, _name in (("c-ours", "ours", ["c-ours"], "보낸 메시지가 화면에 있으면 기록"),
                                   ("c-users-own", "other", [], "사용자가 자기 대화를 눌렀으면(메시지 없음) 기록하지 않음"),
                                   ("c-err", "error", [], "화면을 확인하지 못하면 기록하지 않음 (답은 그대로)")):
    _lk = relay.CopilotLink({}, relay.ChatRegistry(os.path.join(_tmp, "c8-{}.json".format(_conv))))
    _lk.cop = _RegCop(_conv, _page)
    _o = _io.StringIO()
    with _cl.redirect_stdout(_o):
        _rep = _lk.request(["질문\n\n[pi-abc123]"], True)
    check("대화 기록: " + _name, [c["id"] for c in _lk.registry.chats] == _want and _rep == {"text": "답"}
          and (_want or "삭제 목록에 넣지 않습니다" in _o.getvalue()), (_lk.registry.chats, _o.getvalue()))

# 세션 끝 정리는 뒤에서(다른 스레드) 하므로, 그사이 새 세션의 요청이 먼저 처리됐으면 그 대화를 끝내거나 지우지 않음
_le = FakeLink(["새 세션 답"])
_le.cfg = {"delete_finished_chats": True}
_le.registry = relay.ChatRegistry(os.path.join(_tmp, "c13.json"))
_le.cop = FakeCop()
_le.cleanup = lambda: relay.CopilotLink.cleanup(_le)
_re = relay.Relay(A(), _le)
_seen = _re.requests  # 세션 끝 알림을 받은 때의 요청 수
_quiet(lambda: _re.handle({"messages": [sys_msg, {"role": "user", "content": "새 세션"}], "tools": tools}))
_le.registry.add("new1", "https://x/chat/conversation/new1")  # 새 세션이 연 대화 (실제로는 CopilotLink.request 가 기록)
_quiet(lambda: _re.end_session("quit", _seen))
check("세션 끝: 그사이 새 요청이 왔으면 정리하지 않음 (새 세션의 대화·이어 쓰기 유지)", _le.cop.deleted == [] and _re.fresh is False
      and _re.sent and [c["state"] for c in _le.registry.chats] == ["active"], (_le.cop.deleted, _re.fresh, _le.registry.chats))
_quiet(lambda: _re.end_session("quit", _re.requests))
check("세션 끝: 그사이 요청이 없었으면 그대로 정리", _le.cop.deleted == ["new1"] and _re.fresh is True, (_le.cop.deleted, _re.fresh))

# max_tabs: 탭 찾기·차지하기는 한 번에 한 창씩 (두 창이 동시에 첫 요청을 받아도 탭을 하나씩), 창 1 도 처음 탭을 뺏겼으면 새 창
_bridge_real = (relay.bridge.list_tabs, relay.bridge.open_window, relay.bridge.Tab, relay.bridge.Copilot)
_tabs14, _opened14 = [], []


def _list14(port):
    _time.sleep(0.05)  # (여러 창이 동시에 목록을 읽게)
    return list(_tabs14)


def _open14(port, url):
    t = {"id": "W{}".format(len(_opened14) + 1), "url": url}
    _opened14.append(t)
    _tabs14.append(t)
    return t


class _Cop14:
    def __init__(self, tab, cfg):
        self.tab = tab


relay.bridge.list_tabs, relay.bridge.open_window = _list14, _open14
relay.bridge.Tab, relay.bridge.Copilot = (lambda info: info), _Cop14
_cfg14 = {"cdp_port": 1, "copilot_url_contains": "/chat", "copilot_new_chat_url": "https://x/chat"}
try:
    _tabs14[:] = [{"id": "T", "url": "https://x/chat"}]
    _claims, _errs = {}, []
    _l2, _l1 = relay.CopilotLink(_cfg14, owner="2", claims=_claims), relay.CopilotLink(_cfg14, owner="1", claims=_claims)
    _quiet(_l2.connect)
    try:
        _quiet(_l1.connect)  # 예전: 창 1 은 새 창을 열지 않아 탭 없이 503 (다시 켤 때까지)
    except relay.RelayError as e:
        _errs.append(e)
    check("창 1: 처음 탭을 다른 창이 먼저 가져갔으면 새 창을 엶", not _errs and _l2.cop.tab["id"] == "T" and _l1.cop.tab["id"] == "W1"
          and _claims == {"T": "2", "W1": "1"}, (_errs, _claims))
    _tabs14[:], _opened14[:] = [{"id": "T", "url": "https://x/chat"}], []
    _claims, _errs = {}, []
    _links = [relay.CopilotLink(_cfg14, owner=o, claims=_claims) for o in ("1", "2", "3")]

    def _con(lk):
        try:
            lk.connect()
        except Exception as e:  # noqa: BLE001
            _errs.append(e)

    def _all():
        ths = [_th.Thread(target=_con, args=(lk,)) for lk in _links]
        [t.start() for t in ths]
        [t.join() for t in ths]

    _quiet(_all)
    _got = sorted(lk.cop.tab["id"] for lk in _links if lk.cop)
    check("창 3개가 동시에 연결해도 창마다 다른 탭 (오류 없음)", not _errs and _got == ["T", "W1", "W2"]
          and sorted(_claims.values()) == ["1", "2", "3"], (_errs, _got, _claims))
    _tabs14[:], _opened14[:] = [], []
    try:
        _quiet(relay.CopilotLink(_cfg14, owner="1", claims={}).connect)
        _st14 = None
    except relay.RelayError as e:
        _st14 = e.status
    check("Copilot 탭이 하나도 없으면 창 1 은 새 창 대신 로그인 안내 (503)", _st14 == 503 and _opened14 == [], (_st14, _opened14))
finally:
    relay.bridge.list_tabs, relay.bridge.open_window, relay.bridge.Tab, relay.bridge.Copilot = _bridge_real

# pi 의 요약 요청(compaction): 대화가 아주 길면 가운데를 줄여 조각 수를 제한 (앞=처음 요청, 뒤=최근 작업, 이전 요약·형식 안내는 그대로)
_sum_sys = {"role": "system", "content": "You are a context summarization assistant. Your task is to read a conversation between a user "
            "and an AI assistant, then produce a structured summary following the exact format specified.\n\n"
            "Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary."}
_conv = "\n".join("[User]: 질문 {} ".format(i) + "가" * 2900 for i in range(100))
_sum_user = {"role": "user", "content": [{"type": "text", "text": "<conversation>\n[User]: 처음 목표 FIRST-GOAL\n" + _conv +
             "\n[Assistant]: 마지막 작업 LAST-WORK\n</conversation>\n\n<previous-summary>\n이전 요약 PREV-SUM\n</previous-summary>\n\n"
             "The messages above are a conversation to summarize.\n\n## Goal\n[...]"}]}
_lk = FakeLink(["## Goal\n- 요약입니다"])
_out = _quiet(lambda: relay.Relay(A(), _lk).handle({"messages": [_sum_sys, _sum_user], "tools": []}))
_sent = "".join(_lk.sent_log[0]["parts"])
check("긴 요약 요청: 조각 수 제한 ({}개, 원래 대화 {}자)".format(len(_lk.sent_log[0]["parts"]), len(_conv)),
      len(_lk.sent_log[0]["parts"]) <= 8, len(_lk.sent_log[0]["parts"]))
check("긴 요약 요청: 처음 요청·최근 작업·이전 요약·형식 안내는 남고 가운데를 줄였다고 알림",
      all(w in _sent for w in ("FIRST-GOAL", "LAST-WORK", "PREV-SUM", "## Goal", "가운데", "자를 줄였습니다")), _sent[-600:])
check("긴 요약 요청: 요약을 그대로 돌려줌", (_out.get("content") or "").startswith("## Goal"), _out)
_lk = FakeLink(["답"])
_quiet(lambda: relay.Relay(A(), _lk).handle({"messages": [sys_msg, {"role": "user", "content": "<conversation>\n" + _conv + "\n</conversation>\n"}], "tools": tools}))
check("요약 요청이 아니면 긴 글도 줄이지 않음", "가운데" not in "".join(_lk.sent_log[0]["parts"]) and len(_lk.sent_log[0]["parts"]) > 20,
      len(_lk.sent_log[0]["parts"]))
_short = [_sum_sys, {"role": "user", "content": "<conversation>\n[User]: 짧은 대화\n</conversation>\n\n## Goal"}]
check("짧은 요약 요청은 그대로", relay.shorten_summary_request(_short) is _short)

print("RESULT:", "PASS" if fails == 0 else "FAIL ({})".format(fails))
sys.exit(1 if fails else 0)
