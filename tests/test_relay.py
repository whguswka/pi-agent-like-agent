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

# 실사용 시험(2026-10-21, 작업 표시줄 모니터)에서 Copilot 이 실제로 한 답 그대로
STOP_LATER = """빌드는 성공했습니다.

다만 지금 상태는 사용자가 요청한 "AI 사용량 위젯과 비슷한 디자인"이 구현된 상태가 아닙니다.

하지만 아직 핵심인:
- 둥근 모서리 실제 창 형태 적용
- CPU/RAM/GPU/RX/TX를 칸 단위로 그리기

은 아직 구현되지 않았습니다.

다음 요청에서 이어서 진행하겠습니다. Metrics는 건드리지 않고 UI만 전면 개편하면 됩니다."""
STOP_NOT_DONE = """지금 단계에서는 아직 끝난 게 아닙니다.

남아 있는 항목:
- 총 RX/TX 누적량을 화면에 다시 표시
- 빌드 후 새 커밋

따라서 지금 최종 답을 하면 안 되고, 계속 수정해야 합니다. 다음 단계로 RX/TX 누적량을 포함한 레이아웃과 위치 조정을 먼저 넣어야 합니다."""
STOP_NOT_COMPLETE = """아직 완료가 아닙니다.

하지만 남은 작업:
1. 최적화 후 버전 실행
2. 커밋

즉, 아직 작업이 끝난 상태가 아닙니다."""
NO_TOOLS_REPLY = """지금은 다음 작업 블록을 줄 수 없습니다. 이유는 현재 대화에서 사용 가능한 도구가 `bash/edit/read/write`가 아니라 일반 채팅 도구뿐이라, 실제 파일 수정·빌드·측정·커밋을 더 진행할 수 있는 실행 수단이 없습니다.

또한 현재 상태는 **작업 완료 상태가 아닙니다.**

현재 세션에서는 더 이상 파일을 실제로 수정·빌드·측정할 수 없으므로, 완성되었다고 보고할 수 없습니다."""
DONE_CHECK_SCREEN = """작업 완료했습니다.

- `resmon.cs` 수정
  - 크기 자동 조정 후 재배치하도록 수정

- 커밋 완료
  - 커밋: `b458bbe`

이제 실제 화면에서:
- 높이 정렬이 AI 위젯과 맞는지
- 폭이 과한지

확인해서 알려 주세요. 다음 단계에서는 보이는 결과에 맞춰 픽셀 단위로 다듬겠습니다."""
DONE_COMMITTED = """작업 완료.

주의
- 중간에 잘못 들어갔던 `target.Top ...` 코드는 제거한 뒤 다시 빌드 성공 확인함.
- 현재 상태는 컴파일 및 커밋까지 완료된 상태임.

이제 실제 화면에서 크기·높이 정렬·선명도·누적량 배치를 확인해 보면 된다."""
DONE_MEASURED = """작업 완료.

- 측정 결과
  - `CPU20sAfterWarmup=0.375`

CPU 사용량이 크게 감소했으므로 커밋했습니다.

이번 결과로 보면 병목은 거의 확실하게 GPU 엔진별 `NextValue()` 호출 및 관련 카운터 관리였던 것으로 보입니다."""
for name, text in [("다음 요청에서 이어서", STOP_LATER), ("아직 끝난 게 아닙니다", STOP_NOT_DONE), ("아직 완료가 아닙니다", STOP_NOT_COMPLETE)]:
    check("일을 마치지 않은 멈춤(실제 답): " + name, bool(relay.UNFINISHED_RE.search(text)))
for name, text in [("화면 확인 부탁", DONE_CHECK_SCREEN), ("커밋까지 완료", DONE_COMMITTED), ("측정 후 커밋", DONE_MEASURED)]:
    check("최종 답(실제 답)은 멈춤·도구 없음으로 보지 않음: " + name,
          not relay.UNFINISHED_RE.search(text) and not relay.NO_TOOLS_CLAIM_RE.search(text),
          (relay.UNFINISHED_RE.search(text), relay.NO_TOOLS_CLAIM_RE.search(text)))
check("'이 대화에는 도구가 없다' 답(실제 답)", bool(relay.NO_TOOLS_CLAIM_RE.search(NO_TOOLS_REPLY)))
check("환경에 프로그램이 없다는 보통 답은 도구 없음이 아님",
      not relay.NO_TOOLS_CLAIM_RE.search("이 PC 에는 빌드 도구가 없어서 컴파일하지 못했습니다. csc 를 설치해 주세요."))
rd = '```json\n{"tool": "read", "arguments": {"path": "resmon.cs"}}\n```'
u_go = {"role": "user", "content": "계속해. ReadCategory 로 바꿔 줘"}
lk = FakeLink([NO_TOOLS_REPLY, rd])
out = relay.Relay(A(), lk).handle({"messages": [sys_msg, u_go], "tools": tools})
check("도구가 없다는 답 -> 진행 방식을 다시 알리고 다시 요청 (같은 대화)",
      len(lk.sent_log) == 2 and "진행 방식" in lk.sent_log[1]["parts"][0] and "read" in lk.sent_log[1]["parts"][0]
      and out.get("tool_calls"), (lk.sent_log, out))
lk = FakeLink([NO_TOOLS_REPLY, NO_TOOLS_REPLY, rd])
out = relay.Relay(A(), lk).handle({"messages": [sys_msg, u_go], "tools": tools})
check("다시 알려도 같으면 새 대화에서 지침·도구·대화를 처음부터",
      len(lk.sent_log) == 3 and lk.sent_log[2]["new_thread"] and relay.PROTOCOL_TAG in lk.sent_log[2]["parts"][0]
      and out.get("tool_calls"), (lk.sent_log, out))
lk = FakeLink([NO_TOOLS_REPLY] * 4)
try:
    relay.Relay(A(), lk).handle({"messages": [sys_msg, u_go], "tools": tools})
    check("새 대화에서도 도구가 없다면 오류", False, "예외 없음")
except relay.RelayError as e:
    check("새 대화에서도 도구가 없다면 오류로 알림 (다시 새 대화를 열지 않음)", e.status == 502 and len(lk.sent_log) == 4, (e, lk.sent_log))

# 결과(측정값)만 조금씩 다른 같은 명령을 되풀이 (실제: 빌드 + 60초 측정을 고치는 것 없이 6번)
mcmd = ("powershell -ExecutionPolicy Bypass -NoProfile -Command \"& 'C:/w/resmon/build.ps1'; \\$p=Start-Process -PassThru 'C:/w/resmon/resmon.exe'; "
        "Start-Sleep -Seconds 60; Get-Process -Id \\$p.Id | Select-Object ProcessName,CPU,WS,PM; Stop-Process -Id \\$p.Id -Force\"")
mcall = lambda i: {"role": "assistant", "content": None, "tool_calls": [{"id": "m%d" % i, "type": "function",
                   "function": {"name": "bash", "arguments": json.dumps({"command": mcmd})}}]}
mres = lambda i, v: {"role": "tool", "tool_call_id": "m%d" % i, "content": "ProcessName CPU WS PM\nresmon %s 87515136 63606784" % v}
mhist = [sys_msg, {"role": "user", "content": "resmon 이 CPU 를 너무 많이 써. 줄여 줘"}]
for i, v in enumerate(["1.609375", "1.59375", "1.671875", "1.59375"]):
    mhist += [mcall(i), mres(i, v)]
msame = "```json\n" + json.dumps({"tool": "bash", "arguments": {"command": mcmd}}) + "\n```"
check("측정값만 다른 반복은 '결과까지 같은 반복'으로 세지 않음 (그래서 따로 셈)",
      relay.repeated_calls(mhist, {"name": "bash", "arguments": {"command": mcmd}}) == 1
      and relay.same_calls(mhist, {"name": "bash", "arguments": {"command": mcmd}}) == 4)
lk = FakeLink([msame, "측정 결과 CPU 가 줄었습니다. 끝났습니다."])
out = relay.Relay(A(), lk).handle({"messages": mhist, "tools": tools})
check("같은 명령 5번째(결과만 조금씩 다름) -> 다음 단계로 넘어가도록 한 번 부탁",
      len(lk.sent_log) == 2 and "연달아 실행했습니다" in lk.sent_log[1]["parts"][0] and not out.get("tool_calls"), (lk.sent_log, out))
lk = FakeLink([msame, msame])
out = relay.Relay(A(), lk).handle({"messages": mhist, "tools": tools})
check("부탁한 뒤에도 같은 명령이면 그대로 실행 (기다리는 중일 수 있어 멈추지 않음)", out.get("tool_calls") and len(lk.sent_log) == 2,
      (lk.sent_log, out))
lk = FakeLink([msame])
out = relay.Relay(A(), lk).handle({"messages": mhist[:-2], "tools": tools})
check("같은 명령 4번째까지는 그대로 실행", out.get("tool_calls") and len(lk.sent_log) == 1, (lk.sent_log, out))
tcmd = "tail -n 3 train.log"
tcall = lambda i: {"role": "assistant", "content": None, "tool_calls": [{"id": "t%d" % i, "type": "function",
                   "function": {"name": "bash", "arguments": json.dumps({"command": tcmd})}}]}
thist = [sys_msg, {"role": "user", "content": "학습이 끝날 때까지 지켜봐 줘"}]
for i in range(6):
    thist += [tcall(i), {"role": "tool", "tool_call_id": "t%d" % i, "content": "epoch %d/20 loss 0.%d" % (i + 3, 60 - i)}]
lk = FakeLink(["```json\n" + json.dumps({"tool": "bash", "arguments": {"command": tcmd}}) + "\n```"])
out = relay.Relay(A(), lk).handle({"messages": thist, "tools": tools})
check("읽기만 하는 명령(학습 로그 tail)은 7번째도 묻지 않음", out.get("tool_calls") and len(lk.sent_log) == 1, (lk.sent_log, out))

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
_repo_cfg = relay.bridge.load_config(os.path.join(os.path.dirname(relay.__file__), "bridge.json"), None)
check("저장소 설정의 모델 이름이 지금 화면 이름 (2026-10-13)", relay.copilot_model_for("gpt-6.1-sol", _repo_cfg) == "GPT-6.1 Sol"
      and relay.copilot_model_for("claude-sonnet-5.5", _repo_cfg) == "Sonnet 5.5" and relay.copilot_model_for("claude-opus-5.5", _repo_cfg) == "Opus 5.5")
check("예전 기본 모델 id gpt-6.0-sol 도 같은 모델 (지난 세션·바꾸기 전 settings.json)", relay.copilot_model_for("gpt-6.0-sol", _repo_cfg) == "GPT-6.1 Sol")
_tpl = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(relay.__file__))), "profiles", "pc", "agent-template", "settings.json"), encoding="utf-8"))
check("기본 모델 id 가 화면 이름과 맞음 (pi 화면 아래 상태줄은 id 를 보여 줌)", _tpl["defaultModel"] == "gpt-6.1-sol"
      and _mk(_tpl["defaultModel"]) == _mk("GPT-6.1 Sol"))
# 2026-10-13 메뉴: Claude › Sonnet 5 · Sonnet 5.5 · Opus 5.5, GPT › GPT-5.6 Sol 빠른 응답 · 깊이 생각하기 · GPT-6.1 Sol
_menu13 = [{"title": t, "text": t} for t in ("Sonnet 5", "Sonnet 5.5", "Opus 5.5")]
check("메뉴에서 고르기: 'Sonnet 5' 와 'Sonnet 5.5' 를 헷갈리지 않음", (_pick(_menu13, "Sonnet 5") or {}).get("title") == "Sonnet 5"
      and (_pick(_menu13, "Sonnet 5.5") or {}).get("title") == "Sonnet 5.5")
check("모델 이름 비교: 'GPT-6 Sol' 과 'GPT-6.1 Sol' 은 다른 모델 (그래서 이름을 바꿔 적어야 함)", _mk("GPT-6 Sol") != _mk("GPT-6.1 Sol")
      and _pick([{"title": "GPT-6.1 Sol", "text": "GPT-6.1 Sol"}], "GPT-6 Sol") is None)

# 사내AI (두 번째 중계 서버, copilot/inhouse.json): 모드 단추, 화면 단추 글, 서비스 이름
_kc = relay.bridge.load_config(os.path.join(os.path.dirname(relay.__file__), "inhouse.json"), None)
check("inhouse.json: pi 모델 id -> 모드 단추", relay.copilot_model_for("inhouse-sonnet", _kc) == "성능모드"
      and relay.copilot_model_for("inhouse-gemma4", _kc) == "안전모드" and _kc["model_toggle_buttons"] == ["안전모드", "성능모드"])
check("inhouse.json: 화면에서 읽기 (스트림 아님), 대화 삭제 안 함, 탭이 없으면 엶, 주소는 저장소에 없음 (내 설정 파일에)",
      _kc["use_stream"] is False and _kc["delete_finished_chats"] is False and _kc["open_tab_if_missing"] is True
      and _kc["copilot_url_contains"] == "" and _kc["copilot_new_chat_url"] == "")
check("답에 섞인 화면 단추 줄을 지움 (내 설정의 ui_noise_words)", relay.bridge.strip_ui_noise(
      'json{"tool": "x"}\n자료 검색 전체 대화 공유하기', ["자료 검색", "전체 대화 공유하기"]) == 'json{"tool": "x"}')
# 주소가 비어 있으면 아무 탭이나 고르지 않고 알림 (빈 글자는 모든 주소에 들어 있으므로 Copilot 탭을 잡을 수 있음)
_lk = relay.CopilotLink(dict(_kc, cdp_port=1), None)
try:
    _lk.connect()
    _msg = ""
except relay.RelayError as _e:
    _msg = str(_e)
check("사내AI 주소를 적지 않으면 탭을 찾지 않고 알림", "주소" in _msg and "inhouse.json" in _msg, _msg)
relay.bridge.set_service("사내AI")
_svc = relay.bridge.service_text("Copilot 처리 실패: Copilot 입력창이 글을 받지 않습니다")
relay.bridge.set_service(None)
check("서비스 이름: 사내AI 중계 서버는 문구의 Copilot 을 사내AI 로 (Copilot 중계 서버는 그대로)",
      _svc == "사내AI 처리 실패: 사내AI 입력창이 글을 받지 않습니다" and relay.bridge.service_text("Copilot 오류") == "Copilot 오류", _svc)
# 코드 블록 없이 글 속에 온 JSON 도구 블록 (사내AI 화면에서 읽은 답: 'json' 표시가 붙거나 인라인 코드)
_T = {"bash", "read", "write", "edit"}
_b, _c, _e = relay.parse_reply({"text": 'json{"tool": "bash", "arguments": {"command": "echo diag-ok \\"quoted\\""}}'}, _T)
check("글 속 JSON 도구 블록: 'json' 이 붙어 있어도", _c and _c["arguments"]["command"] == 'echo diag-ok "quoted"' and _b == "", (_b, _c, _e))
_b, _c, _e = relay.parse_reply({"text": '파일을 읽겠습니다. {"tool": "read", "arguments": {"path": "a {b}.txt"}} 그 뒤 진행'}, _T)
check("글 속 JSON 도구 블록: 문장 사이, 문자열 안의 괄호", _c and _c["arguments"]["path"] == "a {b}.txt"
      and _b == "파일을 읽겠습니다.\n\n그 뒤 진행", (_b, _c, _e))
_b, _c, _e = relay.parse_reply({"text": 'json{"tool": "write", "arguments": {"path": "a.py", "content": "x = 1\\n"}}'}, _T)
check("글 속 JSON 도구 블록: write 는 코드 블록으로 다시 부탁", _c is None and "코드 블록" in (_e or ""), (_c, _e))
_b, _c, _e = relay.parse_reply({"text": '예: {"tool": "bash", "arguments": {"command": "ls"}}',
                                "code_blocks": [{"lang": "text", "text": "hello"}]}, _T)
check("코드 블록이 따로 있으면 글 속 JSON 은 도구로 보지 않음", _c is None, (_c, _e))

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

    def heavy(self):  # 세션 끝의 탭 새로 읽기(tab_reload_mb): 이 시험에서는 늘 가벼움
        return None


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
          "10:02:30 답: 도구 write",  # 예전 버전 형식 (통계 없음)
          "10:03:00 답: 도구 edit (5.0초 · 조각 1)"]
_st = diag.request_stats(_lines)
check("diag 통계: 개수·평균·중간·최대", _st and _st["n"] == 4 and abs(_st["avg"] - 25.0) < 0.01 and _st["median"] == 20.0
      and _st["max"] == 65.0, _st)
check("diag 통계: 새 대화·조각 나눔·다시 보냄·오류", _st["new"] == 1 and _st["new_avg"] == 65.0 and _st["split"] == 2
      and _st["retry"] == 1 and _st["errors"] == 1, _st)
check("diag 통계: 기록 없으면 None", diag.request_stats(["10:00:00 답: 도구 read"]) is None)

# multi_read (기본 켜짐, 사내AI 는 꺼짐): 맨 앞부터 이어지는 살펴보기 블록(read, 읽기만 하는 bash 등) 여러 개를 한 번에 tool_calls 로
for _c in ["ls -la", "cat a.py | grep def | wc -l", "git status && git log --oneline -5", "kubectl get pods -n kubeflow -o wide",
           "kubectl -n ns logs pod-1 --tail=50", "pip list 2>/dev/null | grep -i torch", "python -m pip show torch",
           "nvidia-smi --query-gpu=name,memory.used --format=csv", "sed -n '10,20p' train.py", "sed 's/,/ /g' a.csv",
           "head -n 30 logs/train.log; tail -5 logs/train.log", "find . -name '*.py' -newer x | head", "du -sh ~/* 2>/dev/null | sort -h | tail",
           "cd work && ls", "command -v nvcc", "awk -F, '{print $1}' data.csv | head", 'grep -rn "a|b;c" src', "echo 'a;b' && pwd",
           "python --version", "helm list -A", "conda env list", "kubectl config current-context", "ls >/dev/null 2>&1", "ls -la;",
           "git -C repo diff --stat", "jupyter kernelspec list", "df -h ~", "free -h", "env", "ps aux | grep python"]:
    check("읽기만 하는 명령: " + _c, relay.read_only_command(_c), relay.shell_words(_c))
for _c in ["rm -rf x", "ls > out.txt", "cat a >> b", "sed -i 's/a/b/' f", "sed -n '1w out' f", "sed 's/a/b/w out' f", "sed -f s.sed f",
           "find . -name x -delete", "find . -exec rm {} \\;", "tail -f log", "tail -fn 20 log", "kubectl logs -f pod", "kubectl get pods -w",
           "kubectl apply -f x.yaml", "kubectl delete pod x", "kubectl exec -it p -- ls", "git checkout main", "git -c core.pager=x log",
           "git branch -D x", "git diff --output=x", "pip install torch", "python train.py", "python -c 'print(1)'",
           "nohup python train.py > log 2>&1 &", "ls $(pwd)", "ls `pwd`", "ls\nrm x", "sort -o out in", "sort -uo out in", "X=1 ls", "./ls",
           "/bin/rm x", "cat <<EOF\nx\nEOF", "sudo ls", "echo hi | tee out", "ls & rm x", "awk '{print > \"f\"}' a",
           "awk 'BEGIN{system(\"rm x\")}'", "uniq a b", "nvidia-smi -pm 1", "nvidia-smi -l 5", "env FOO=1 python x", "date -s 2020",
           "(ls)", "ls |", "ls 'unclosed", "docker logs -f c", "helm template x --output-dir out", "xargs rm < list", "cat a >&file",
           "file -C -m magic", "echo a > /dev/null2", "command ls", "", "   "]:
    check("읽기만 하는 명령 아님: " + repr(_c), not relay.read_only_command(_c), relay.shell_words(_c))
check("읽기 도구: read·grep·wiki_search, bash 는 명령을 봄", relay.look_call({"name": "read", "arguments": {"path": "a"}})
      and relay.look_call({"name": "wiki_search", "arguments": {}}) and relay.look_call({"name": "bash", "arguments": {"command": "ls"}})
      and not relay.look_call({"name": "bash", "arguments": {"command": "rm x"}}) and not relay.look_call({"name": "write", "arguments": {}})
      and not relay.look_call({"name": "bash", "arguments": {}}))
_blk = lambda name, **a: '```json\n' + json.dumps({"tool": name, "arguments": a}) + '\n```\n'  # noqa: E731
_rb = _blk("read", path="a.py") + "예시:\n```python\nprint(1)\n```\n" + _blk("bash", command="git status") + _blk("read", path="b.py") \
    + _blk("write", path="c.py", content="x") + _blk("read", path="d.py")
_calls = relay.reply_calls({"text": _rb}, TOOLS)
check("reply_calls: 도구 블록만 차례대로 (예시 코드는 건너뜀)", [c["name"] for c in _calls] == ["read", "bash", "read", "write", "read"], _calls)
_mr = FakeLink([_rb, "c.py 를 쓰겠습니다.", "끝"])
_mr.cfg = {"multi_read": True}
_rm = relay.Relay(A(), _mr)
_u = {"role": "user", "content": "a.py 와 b.py 를 비교해 c.py 를 만들어줘"}
with _cl.redirect_stdout(_io.StringIO()):
    _am = _rm.handle({"messages": [_u], "tools": tools})
check("multi_read 켬: 앞의 살펴보기 3개를 한 번에 (write 앞에서 멈춤)",
      [tc["function"]["name"] for tc in _am.get("tool_calls", [])] == ["read", "bash", "read"], _am)
check("multi_read 켬: 지침에 살펴보기 여러 개 허용 안내 (5개까지)", relay.MULTI_READ_RULE.format(n=5).strip() in _mr.sent_log[0]["parts"][0]
      and "5개까지" in _mr.sent_log[0]["parts"][0])
_res = [{"role": "tool", "tool_call_id": tc["id"], "content": "내용 {}".format(i)} for i, tc in enumerate(_am["tool_calls"])]
with _cl.redirect_stdout(_io.StringIO()):
    _a2 = _rm.handle({"messages": [_u, _am] + _res, "tools": tools})
_p1 = _mr.sent_log[1]["parts"][0]
check("multi_read 켬: 결과 세 개를 같은 대화에 한 메시지로", not _mr.sent_log[1]["new_thread"] and _p1.count("TOOL_RESULT (read)") == 2
      and _p1.count("TOOL_RESULT (bash)") == 1 and _a2.get("content") == "c.py 를 쓰겠습니다.", _mr.sent_log[1])
check("실행하지 않은 블록 안내: 다음 메시지에 한 번", "도구 블록 5개 중 앞의 3개만 실행했습니다" in _p1, _p1)
with _cl.redirect_stdout(_io.StringIO()):
    _rm.handle({"messages": [_u, _am] + _res + [_a2, {"role": "user", "content": "좋아"}], "tools": tools})
check("실행하지 않은 블록 안내: 그다음 메시지에는 없음", "실행했습니다" not in _mr.sent_log[2]["parts"][0], _mr.sent_log[2])
# 첫 블록이 바꾸는 작업이면 그것 하나만 (뒤의 읽기도 실행하지 않음)
_fw = FakeLink([_blk("write", path="c.py", content="x") + _blk("read", path="c.py"), "끝"])
_fw.cfg = {"multi_read": True}
_rw = relay.Relay(A(), _fw)
with _cl.redirect_stdout(_io.StringIO()):
    _aw = _rw.handle({"messages": [_u], "tools": tools})
    _rw.handle({"messages": [_u, _aw, {"role": "tool", "tool_call_id": _aw["tool_calls"][0]["id"], "content": "ok"}], "tools": tools})
check("첫 블록이 write: 그것 하나만, 다음 메시지에 '첫 번째만' 안내",
      [tc["function"]["name"] for tc in _aw["tool_calls"]] == ["write"] and "도구 블록 2개 중 첫 번째만 실행했습니다" in _fw.sent_log[1]["parts"][0],
      (_aw, _fw.sent_log[1]))
# 한 번에 5개까지
_f7 = FakeLink(["".join(_blk("read", path="f{}.py".format(i)) for i in range(7)), "끝"])
_f7.cfg = {"multi_read": True}
with _cl.redirect_stdout(_io.StringIO()):
    _a7 = relay.Relay(A(), _f7).handle({"messages": [_u], "tools": tools})
check("살펴보기는 5개까지 한 번에", len(_a7["tool_calls"]) == 5, _a7)
_off = FakeLink([_rb])
_off.cfg = {}
with _cl.redirect_stdout(_io.StringIO()):
    _ao = relay.Relay(A(), _off).handle({"messages": [_u], "tools": tools})
check("multi_read 끔: 첫 블록 하나만, 안내 없음",
      len(_ao["tool_calls"]) == 1 and relay.MULTI_READ_RULE.format(n=5).strip() not in _off.sent_log[0]["parts"][0], _ao)
import bridge as _bridge  # noqa: E402
check("multi_read·multi_write 기본값 켜짐", _bridge.DEFAULT_CONFIG.get("multi_read") is True and _bridge.DEFAULT_CONFIG.get("multi_write") is True)
with open(os.path.join(os.path.dirname(os.path.abspath(relay.__file__)), "inhouse.json"), encoding="utf-8") as _f:
    _ih = json.load(_f)
check("사내AI: 살펴보기·쓰기 한 번에도 기본값(켜짐), 하루 한도 200, 한도 문구", "multi_read" not in _ih and "multi_write" not in _ih
      and _ih.get("daily_question_limit") == 200, _ih)
_yes = [t for t in ['사내AI는 일일 200회 질문이 가능합니다.', '질문은 하루 200회까지 가능합니다.', '1일 최대 200회까지 질문할 수 있습니다.', '하루 200회까지 질문 가능하며 내일 다시 이용해 주세요.', '일일 질문 한도(200회)를 초과했습니다.', '일일 질문 가능 횟수(200회)를 초과하였습니다.', '오늘 질문 가능 횟수를 모두 사용했습니다.'] if not relay.re.search(_ih["throttle_pattern"], t, relay.re.I)]
_no = [t for t in ['파일을 정리했습니다. 오늘 날짜로 저장했습니다.', '오늘 요청하신 1번 작업을 마쳤습니다.', '오늘 요청하신 내용은 바로 적용 가능합니다.', '하루 24회 실행되도록 설정했습니다.', '오늘 3번 고쳤습니다.', '10월 11일 200건을 처리했습니다.', '완료했습니다. 2번 항목도 고쳤습니다.', '하루 평균 120건 요청이 처리됩니다.', '하루 평균 120건 질문이 들어오며 대부분 처리 가능합니다.', '고객 질문이 하루 300건 넘게 들어옵니다.', '하루 100건 초과 거래 계좌를 추렸습니다.', '오늘 사용 횟수가 모두 기록되도록 했습니다.', '고객의 하루 질문 횟수가 모두 집계되었습니다.', '일일 이용 한도 초과 건을 집계했습니다.', 'API 가 429 Too Many Requests 를 돌려주면 5초 기다렸다가 다시 보내도록 retry.py 를 고쳤습니다.', '오늘 작업: 서버 요청이 너무 많을 때 큐에 쌓도록 바꿨습니다.', "'잠시 후 나중에 다시 시도해 주세요' 안내를 띄우도록 바꿨습니다.", '응답 처리 (try again later 응답 처리)'] if relay.re.search(_ih["throttle_pattern"], t, relay.re.I)]
check("사내AI 한도 문구: 하루 한도 말은 잡고, 평범한 짧은 답('오늘 요청하신 1번 작업…', '하루 평균 120건 요청…', '하루 100건 초과 거래…')은 잡지 않음", not _yes and not _no, [_yes, _no])

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
    for _ln in _lanes.lanes:  # 두 창이 거의 같은 때 끝나므로 창 1 을 가장 오래 쉰 창으로 정해 둠 (끝난 차례에 따라 가끔 실패하던 것)
        if _ln["relay"] is _ra:
            _ln["used"] -= 5
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
    check("대화 기록: " + _name, [c["id"] for c in _lk.registry.chats] == _want  # _ 로 시작하는 칸은 끊김·제한 기록용
          and {k: v for k, v in _rep.items() if not k.startswith("_")} == {"text": "답"}
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

# 개인정보·민감 정보 확인으로 답하지 않음: 다시 부탁하지 않고 멈춰서 그 답을 그대로 알림 (422). 대화는 그대로 둠
import re as _re  # noqa: E402
import urllib.error as _ue  # noqa: E402
_REFUSALS = ["죄송합니다. 이름이나 연락처 같은 개인정보는 공유하지 않는 편이 좋겠습니다. 다른 질문이 있으면 알려 주세요.",
             "요청에 개인정보가 포함되어 있어 답변드리기 어렵습니다.",
             "민감정보가 포함된 요청은 처리할 수 없습니다.",
             "I can't help with that because it may contain personal information."]
_NOT_REFUSALS = ["이 테이블에는 개인정보 컬럼(이메일)이 포함되어 있습니다: email, phone",
                 "개인정보 마스킹 함수를 추가했습니다. 테스트도 통과합니다.",
                 "죄송합니다, 앞의 명령에 오타가 있었습니다.",
                 "분석을 마쳤습니다. 모델별 테이블:\n- a: t1, t2\n- b: t3"]
check("개인정보 확인 거절을 알아봄", all(relay.privacy_refusal({"text": t}) for t in _REFUSALS),
      [t for t in _REFUSALS if not relay.privacy_refusal({"text": t})])
check("개인정보 낱말이 든 보통 답은 거절이 아님 (분석 결과 등)", not any(relay.privacy_refusal({"text": t}) for t in _NOT_REFUSALS),
      [t for t in _NOT_REFUSALS if relay.privacy_refusal({"text": t})])
check("코드 블록이 있거나 긴 답은 거절로 보지 않음", not relay.privacy_refusal({"text": _REFUSALS[0], "code_blocks": [{"text": "x"}]})
      and not relay.privacy_refusal({"text": _REFUSALS[0] + " 설명" * 200}))
_nomark = lambda parts: [_re.sub(r"\[pi-[0-9a-f]+\]", "", p) for p in parts]  # noqa: E731
_msgs = [sys_msg, {"role": "user", "content": "~/data 의 표를 정리해줘"}]
_lkp = FakeLink([_REFUSALS[0], "다시 받은 답"])
_rp = relay.Relay(A(), _lkp)
try:
    _quiet(lambda: _rp.handle({"messages": _msgs, "tools": tools}))
    _st, _em = None, ""
except relay.RelayError as _e:
    _st, _em = _e.status, str(_e)
check("새 대화의 첫 메시지 거절: 422 + 받은 답 그대로 + 다시 부탁하지 않음", _st == 422 and "공유하지 않는" in _em and len(_lkp.sent_log) == 1,
      (_st, _em, len(_lkp.sent_log)))
check("거절 뒤: 방금 거절당한 글을 다시 보내지 않도록 다음 요청은 새 대화로", _rp.fresh is True and _rp.redo_same_chat is False)
_a = _quiet(lambda: _rp.handle({"messages": _msgs, "tools": tools}))
check("다시 요청하면: 새 대화로 보냄 (거절당한 대화에 같은 블록을 다시 밀어 넣지 않음)",
      _lkp.sent_log[1]["new_thread"] is True and _a.get("content") == "다시 받은 답", (_lkp.sent_log[1]["new_thread"], _a))
_lk2 = FakeLink([_REFUSALS[0], _REFUSALS[0], "세 번째 답"])  # 거절이 이어져도 매번 새 대화로 깨끗하게 (한 대화에 재전송해서 멈추지 않음)
_r2r = relay.Relay(A(), _lk2)
for _i in range(2):
    try:
        _quiet(lambda: _r2r.handle({"messages": _msgs, "tools": tools}))
    except relay.RelayError:
        pass
_a2r = _quiet(lambda: _r2r.handle({"messages": _msgs, "tools": tools}))
check("거절이 이어져도 매번 새 대화로 (거절당한 대화에 재전송하지 않음)",
      [x["new_thread"] for x in _lk2.sent_log] == [True, True, True] and _a2r.get("content") == "세 번째 답",
      [x["new_thread"] for x in _lk2.sent_log])
_lkd = FakeLink(['```json\n{"tool": "bash", "arguments": {"command": "cat a.csv"}}\n```', _REFUSALS[1], "정리했습니다"])
_rd = relay.Relay(A(), _lkd)
_u = {"role": "user", "content": "a.csv 요약해줘"}
_a1 = _quiet(lambda: _rd.handle({"messages": [sys_msg, _u], "tools": tools}))
_m2 = [sys_msg, _u, _a1, {"role": "tool", "tool_call_id": _a1["tool_calls"][0]["id"], "content": "id,name\n1,a"}]
try:
    _quiet(lambda: _rd.handle({"messages": _m2, "tools": tools}))
    _st = None
except relay.RelayError as _e:
    _st = _e.status
_a3 = _quiet(lambda: _rd.handle({"messages": _m2, "tools": tools}))
check("이어 가던 대화에서 거절: 422, 다음 요청은 새 대화로 (거절당한 대화에 재전송 안 함)",
      _st == 422 and _lkd.sent_log[2]["new_thread"] is True and _a3.get("content") == "정리했습니다", (_st, _lkd.sent_log[2]))


class _CopParts:  # 조각마다 답을 돌려주는 가짜 화면 (CopilotLink.request 시험용)
    def __init__(self, replies):
        self.replies, self.sent, self.thread_url, self.turns_left = list(replies), [], "https://x/chat/c1", None

    def new_chat(self):
        pass

    def check_same_thread(self):
        pass

    def send(self, part):
        self.sent.append(part)

    def wait_reply(self, marker):
        return {"text": self.replies.pop(0)}


_lp = relay.CopilotLink({"cdp_port": 1, "copilot_url_contains": "x", "service_name": "사내AI"}, None)
_lp.cop, _lp.pace = _CopParts([_REFUSALS[0], "끝"]), (lambda: None)
_parts = relay.build_parts("가" * 15000, 10000, "[pi-aaaaaa]")
try:
    _quiet(lambda: _lp.request(_parts, True))
    _pr = None
except relay.PrivacyRefused as _e:
    _pr = _e
check("나눠 보낸 중간 조각이 거절되면 멈춤 (나머지 조각은 보내지 않음)", _pr is not None and (_pr.part, _pr.total) == (1, 2)
      and len(_lp.cop.sent) == 1, (_pr and (_pr.part, _pr.total), len(_lp.cop.sent)))
_rq = relay.Relay(A(), _lp)
_err = _quiet(lambda: _rq.refused(_pr))
check("거절 알림: 몇째 조각인지 + 받은 답 + 나머지 조각을 보내지 않았다는 것 + 같은 글은 또 막힌다는 것 + 다음은 새 대화", _err.status == 422
      and str(_err).startswith("사내AI: ") and "(긴 메시지 1/2)" in str(_err) and "나머지 1개 조각은 보내지 않았습니다" in str(_err)
      and "같은 글로 다시 하면 또 막힐 수 있습니다" in str(_err) and _rq.fresh is True and _rq.redo_same_chat is False, str(_err))
check("거절 알림: 막힌 조각에 개인정보 모양 글이 없으면 그렇다고", "이메일·전화번호·계좌번호 모양 글은 찾지 못했습니다" in str(_err) and _pr.sent == _parts[0],
      str(_err))
_lp.cop = _CopParts(["OK", "끝"])
check("중간 조각에 OK 면 다음 조각까지 보냄", (_quiet(lambda: _lp.request(_parts, True)) or {}).get("text") == "끝" and len(_lp.cop.sent) == 2)
# 막는 문구 뒤에 다른 글이 섞여 길어진 답 (막힌 뒤 전용 창에 직접 'ㅇㅇ' 을 쳐서 인사가 붙음): 중간 조각이면 막힘으로 보고 멈춤
_mixed = _REFUSALS[0] + " ㅇㅇ 안녕하세요! 무엇을 도와드릴까요? 궁금한 점이나 필요한 작업이 있으시면 말씀해 주세요." + "\n설명" * 30
_lp.cop = _CopParts([_mixed, "끝"])
try:
    _quiet(lambda: _lp.request(_parts, True))
    _pm = None
except relay.PrivacyRefused as _e:
    _pm = _e
check("중간 조각: 막는 문구 뒤에 다른 글이 섞여도 막힘으로 보고 멈춤 (막힌 조각을 빼고 나머지만 보내지 않음)",
      _pm is not None and (_pm.part, _pm.total) == (1, 2) and len(_lp.cop.sent) == 1, (_pm and (_pm.part, _pm.total), len(_lp.cop.sent)))
check("마지막 답은 지금처럼 짧은 거절만 (막는 문구로 시작하는 긴 보통 답은 거절로 보지 않음)", not relay.privacy_refusal({"text": _mixed}))
# 막힌 조각에서 개인정보 모양 글이 있는 곳 찾기 (pi 지침 파일의 줄, 스킬, 도구 결과, 요청 글)
_home = os.path.expanduser("~")
_first = ("작업 규칙 (참고)\n<project_context>\n<project_instructions path=\"" + os.path.join(_home, ".pi", "agent", "AGENTS.md") + "\">\n"
          + "".join("{}번째 줄\n".format(i) for i in range(1, 19)) + "- Git 작성자는 `홍길동 <hong.gd@example.com>`\n</project_instructions>\n"
          "<available_skills>\n  <skill>\n    <name>team</name>\n    <description>문의 ab.cd@corp.example.com</description>\n"
          "    <location>/team/skills/team/SKILL.md</location>\n  </skill>\n</available_skills>\n\n"
          "[요청]\n연락처 010-1234-5678 로 알려 주세요\n\nTOOL_RESULT (bash):\n```text\nAuthor: Kim <kim@example.org>\n```\n")
_sp = relay.personal_spots(_first, limit=10)
check("찾은 곳: 지침 파일은 ~ 로 줄인 경로와 줄 번호", _sp and _sp[0] == "~/.pi/agent/AGENTS.md 19번째 줄의 이메일 주소 (ho…@example.com)", _sp)
check("찾은 곳: 스킬·도구 결과·요청 글", "스킬 /team/skills/team/SKILL.md의 이메일 주소 (ab…@corp.example.com)" in _sp
      and "도구 결과 (bash)의 이메일 주소 (ki…@example.org)" in _sp and "요청 글의 전화번호 (010…78)" in _sp, _sp)
check("찾은 곳: 없으면 빈 목록, 많으면 3곳 + 나머지 수", relay.personal_spots("[요청]\n안녕하세요") == []
      and relay.personal_spots(" ".join("u{}@example.com".format(i) for i in range(5)))[-1] == "외 2곳")
_e2 = _quiet(lambda: _rq.refused(relay.PrivacyRefused(_REFUSALS[0], 1, 8, sent=_first)))
check("거절 알림: 찾은 곳과 함께 빼고 /new 로 다시 하라고 (보낸 글은 고치지 않음)",
      "보낸 글에서 찾은 곳: ~/.pi/agent/AGENTS.md 19번째 줄의 이메일 주소 (ho…@example.com)" in str(_e2) and "/new" in str(_e2)
      and "나머지 7개 조각은 보내지 않았습니다" in str(_e2), str(_e2))
check("거절 알림: 지침·스킬 파일은 /reload, 앞 대화(명령 결과)는 /new, 그대로면 다음 요청은 보내지 않는다고",
      "지침·스킬·pi 설정이면 고친 뒤 /reload, 앞 대화(명령 결과·요청 글)에 있으면 /new 로 새로 시작하거나 /tree 로 그 결과 앞으로 돌아가기" in str(_e2)
      and "다음 요청은 보내지 않고 바로 알립니다" in str(_e2), str(_e2))
check("할 일 안내: 지침 파일·pi 설정만이면 /reload 만, 앞 대화만이면 /new 나 /tree",
      relay.spot_advice(["~/.pi/agent/AGENTS.md 19번째 줄의 이메일 주소 (ho…@example.com)"]) == "지침·스킬·pi 설정이면 고친 뒤 /reload"
      and relay.spot_advice(["pi 설정(지침·도구 설명)의 전화번호 (010…78)"]) == "지침·스킬·pi 설정이면 고친 뒤 /reload"
      and relay.spot_advice(["도구 결과 (bash)의 이메일 주소 (ki…@example.org)"]) == "앞 대화(명령 결과·요청 글)에 있으면 /new 로 새로 시작하거나 /tree 로 그 결과 앞으로 돌아가기")
_ts = "진행 방식\n- 연락처 010-1234-5678\n\n대화 내용\n[요청]\n폴더 2026-07-24 와 20260930 과 run-20260727_0755361"
check("찾은 곳: 첫 메시지 앞부분(진행 방식·도구 설명)은 'pi 설정', 의심 후보는 숫자가 많은 것부터",
      relay.personal_spots(_ts) == ["pi 설정(지침·도구 설명)의 전화번호 (010…78)"]
      and relay.personal_spots(_ts, patterns=relay.SUSPECT_RES, longest_first=True)[0] == "요청 글의 긴 숫자 (202…61)", relay.personal_spots(_ts, patterns=relay.SUSPECT_RES, longest_first=True))
check("카드번호 모양은 파일로 붙이지 않음 (날짜 범위는 아님)", bool(relay.CARD_RE.search("카드 1234-5678-9012-3456")) and bool(relay.CARD_RE.search("1234 5678 9012 3456"))
      and not relay.CARD_RE.search("20260101-20261231"))
check("거절 알림: 다시 부탁한 글처럼 막힌 글을 모르면 찾은 곳은 말하지 않음",
      "찾은 곳" not in str(_quiet(lambda: _rq.refused(relay.PrivacyRefused(_REFUSALS[0])))) and
      "찾지 못했습니다" not in str(_quiet(lambda: _rq.refused(relay.PrivacyRefused(_REFUSALS[0])))))
# 막힌 글의 개인정보 모양 글이 다음 요청에 그대로 있으면 보내지 않고(새 대화도 열지 않고) 바로 알림. 빼면 다시 보냄
_sysp = {"role": "system", "content": "<project_instructions path=\"" + os.path.join(_home, ".pi", "agent", "AGENTS.md") + "\">\n- 규칙\n"
         "- Git 작성자 홍길동 <hong.gd@example.com>\n</project_instructions>"}
_mh = [_sysp, {"role": "user", "content": "표를 정리해줘"}]


def _try(r, msgs):
    try:
        return _quiet(lambda: r.handle({"messages": msgs, "tools": tools})), None
    except relay.RelayError as e:
        return None, e


_lkh = FakeLink([_REFUSALS[0], "이메일을 뺀 뒤 답"])
_lkh.cfg = {"service_name": "사내AI"}
_rh2 = relay.Relay(A(), _lkh)
_, _eh1 = _try(_rh2, _mh)
check("막힘: 지침의 이메일 위치를 알림", _eh1 is not None and _eh1.status == 422 and "AGENTS.md 2번째 줄의 이메일 주소" in str(_eh1)
      and len(_lkh.sent_log) == 1, (str(_eh1), len(_lkh.sent_log)))
_, _eh2 = _try(_rh2, _mh + [{"role": "user", "content": "계속"}])
check("같은 이메일이 그대로면 '계속' 이어도 보내지 않음 (새 대화도 열지 않음), 찾은 곳과 /reload 안내",
      _eh2 is not None and _eh2.status == 422 and len(_lkh.sent_log) == 1 and "보내지 않았습니다 (새 대화도 열지 않음)" in str(_eh2)
      and "AGENTS.md 2번째 줄의 이메일 주소 (ho…@example.com)" in str(_eh2) and "/reload" in str(_eh2), (str(_eh2), len(_lkh.sent_log)))
check("보내지 않은 것은 끊김 기록에서 따로 (privacy_held)", relay.events.classify(str(_eh2), status=422) == "privacy_held"
      and relay.events.classify(str(_eh1), status=422) == "privacy")
_mh2 = [{"role": "system", "content": _sysp["content"].replace(" 홍길동 <hong.gd@example.com>", "")}, {"role": "user", "content": "표를 정리해줘"},
        {"role": "user", "content": "계속"}]
_ah3, _eh3 = _try(_rh2, _mh2)
check("지침에서 빼고 /reload: 새 대화로 보내고 기억을 지움", _eh3 is None and (_ah3 or {}).get("content") == "이메일을 뺀 뒤 답"
      and _lkh.sent_log[1]["new_thread"] and not _rh2.blocked, (_eh3, _lkh.sent_log[-1:]))
_o = _io.StringIO()
_lkh2 = FakeLink([_REFUSALS[0]])
_lkh2.cfg = {"service_name": "사내AI"}
_rh3 = relay.Relay(A(), _lkh2)
with _cl.redirect_stdout(_o):
    for _m in (_mh, _mh + [{"role": "user", "content": "계속"}]):
        try:
            _rh3.handle({"messages": _m, "tools": tools})
        except relay.RelayError:
            pass
check("중계 서버 로그에는 찾은 곳만 (이메일 값·일부는 남기지 않음)", "hong.gd" not in _o.getvalue() and "ho…@" not in _o.getvalue()
      and "보내지 않음" in _o.getvalue(), _o.getvalue()[-600:])
_lkt = FakeLink(['```json\n{"tool": "bash", "arguments": {"command": "git log -1"}}\n```', _REFUSALS[0], "새 세션 답"])
_lkt.cfg = {"service_name": "사내AI"}
_rt = relay.Relay(A(), _lkt)
_ut = {"role": "user", "content": "최근 커밋 보여줘"}
_at, _ = _try(_rt, [sys_msg, _ut])
_mt = [sys_msg, _ut, _at, {"role": "tool", "tool_call_id": _at["tool_calls"][0]["id"], "content": "commit abc\nAuthor: Kim <kim@example.org>"}]
_, _et1 = _try(_rt, _mt)
_, _et2 = _try(_rt, _mt + [{"role": "user", "content": "계속"}])
check("명령 결과의 이메일로 막힌 뒤 '계속': 보내지 않고 /new 안내", _et1 is not None and _et2 is not None and "보내지 않았습니다" in str(_et2)
      and "도구 결과 (bash)의 이메일 주소" in str(_et2) and "/new" in str(_et2) and len(_lkt.sent_log) == 2, (str(_et2), len(_lkt.sent_log)))
_at3, _et3 = _try(_rt, [sys_msg, {"role": "user", "content": "다른 일"}])
check("/new (그 결과가 없는 새 세션): 다시 보냄", _et3 is None and (_at3 or {}).get("content") == "새 세션 답" and len(_lkt.sent_log) == 3,
      (_et3, len(_lkt.sent_log)))
# HTTP: 422 로 알리고 대화는 지우지 않음 + /health 에 켠 시각과 일하는 중인지
_rh = relay.Relay(A(), FakeLink([_REFUSALS[0]]))
import types as _types  # noqa: E402
_srv5 = _Srv(("127.0.0.1", 0), relay.make_handler(_rh, _types.SimpleNamespace(root="", home="", term=""),
                                                  {"cdp_port": 1, "copilot_url_contains": "x"}))
_th.Thread(target=_srv5.serve_forever, daemon=True).start()
_b5 = "http://127.0.0.1:{}".format(_srv5.server_address[1])
try:
    _quiet(lambda: _ur.urlopen(_ur.Request(_b5 + "/v1/chat/completions", data=_json.dumps({"messages": _msgs, "tools": tools}).encode(),
                                           headers={"Content-Type": "application/json"}), timeout=10).read())
    _code = 200
except _ue.HTTPError as _e:
    _code = _e.code
_h5 = _json.loads(_ur.urlopen(_b5 + "/health", timeout=5).read())
_srv5.shutdown()
check("HTTP: 422, 다음 요청은 새 대화로", _code == 422 and _rh.fresh is True and _rh.redo_same_chat is False, (_code, _rh.fresh))
check("/health: 켠 시각(started)과 일하는 중(busy) (bin/pi 가 바뀐 설정을 알아보고 다시 켤 때 씀)",
      "started" in _h5 and _h5.get("busy") is False, _h5)

# 자기 도구로 직접 찾아보고 '이 작업 환경에 없다' 는 답 -> 실행 거절처럼 한 번 설명하고 다시 부탁
check("'작업 환경에 존재하지 않습니다' 류는 실행 거절로 봄", bool(relay.REFUSAL_RE.search("~/models 경로가 이 작업 환경에 존재하지 않습니다."))
      and bool(relay.REFUSAL_RE.search("현재 접근 가능한 파일 시스템 어디에서도 확인되지 않습니다."))
      and not relay.REFUSAL_RE.search("오류는 확인되지 않았습니다. 테스트 3개 통과."))
_lks = FakeLink(["요청하신 ~/proj 경로가 이 작업 환경에 존재하지 않습니다.", '```json\n{"tool": "bash", "arguments": {"command": "ls ~/proj"}}\n```'])
_as = _quiet(lambda: relay.Relay(A(), _lks).handle({"messages": [sys_msg, {"role": "user", "content": "~/proj 정리해줘"}], "tools": tools}))
check("그 답이면 '직접 실행하실 필요 없다' 고 다시 부탁해 도구 블록을 받음", len(_lks.sent_log) == 2 and relay.REFUSAL_NUDGE in _lks.sent_log[1]["parts"][0]
      and _as.get("tool_calls") and _as["tool_calls"][0]["function"]["name"] == "bash", (_lks.sent_log, _as))
# 서비스별 규칙(extra_rules): 새 대화의 첫 메시지 진행 방식에 덧붙임
_lx = FakeLink(["답"])
_lx.cfg = {"extra_rules": ["당신의 도구로 직접 실행하지 마세요."]}
_quiet(lambda: relay.Relay(A(), _lx).handle({"messages": _msgs, "tools": tools}))
check("extra_rules: 첫 메시지의 진행 방식에 덧붙임", "표시는 무시하세요.\n- 당신의 도구로 직접 실행하지 마세요.\n" in _lx.sent_log[0]["parts"][0],
      _lx.sent_log[0]["parts"][0][:1200])
check("inhouse.json: 답 끝 기다림 8초, 진행 중 줄은 비워 둠(내 설정 파일에), 자기 도구로 실행하지 말라는 규칙, git log 는 이메일 없이",
      _kc["stable_seconds"] == 8.0 and _kc["reply_busy_lines"] == [] and any("도구" in r for r in _kc["extra_rules"])
      and any("git log --format='%h %ad %s'" in r for r in _kc["extra_rules"])
      and not relay.personal_values(" ".join(_kc["extra_rules"])), _kc)

# 화면에서 읽은 답: 진행 중 줄, 코드 블록 다시 감싸기, 코드 안의 줄은 화면 문구로 지우지 않음
_B = relay.bridge
check("busy_line: 줄 전체가 같을 때만 (앞뒤 ▶ 같은 기호는 빼고 봄)", _B.busy_line("처리 단계\n먼저 확인합니다", ["처리 단계"])
      and _B.busy_line("▼ 처리 단계 ", ["처리 단계"]) and not _B.busy_line("▶ 처리 단계 열기\n답", ["처리 단계"])
      and not _B.busy_line("처리 단계", []))
_rf = _B.refence_code('아래처럼 하면 됩니다.\nJSON\n코드 복사\n{"tool": "bash"}\n끝.', [{"lang": "json", "text": '{"tool": "bash"}\n'}], ["코드 복사"])
check("코드 블록을 ``` 로 다시 감쌈 (언어 표시 줄은 뺌)", _rf == '아래처럼 하면 됩니다.\n코드 복사\n```json\n{"tool": "bash"}\n```\n끝.', _rf)
check("언어 표시와 단추 글이 한 줄에 붙어 있어도 그 줄을 뺌 ('JSON 코드 복사')",
      _B.refence_code('JSON 코드 복사\n{"a": 1}\n', [{"lang": "json", "text": '{"a": 1}'}], ["코드 복사"]) == '```json\n{"a": 1}\n```\n')
check("코드 안의 '#' 줄은 감싸져서 pi 화면에서 제목이 되지 않음",
      _B.refence_code("설명\n# 주석\nls\n", [{"lang": "bash", "text": "# 주석\nls"}]) == "설명\n```bash\n# 주석\nls\n```\n")
check("화면 글에서 코드를 못 찾으면 그대로", _B.refence_code("abc", [{"lang": "x", "text": "zzz"}]) == "abc")
check("화면 문구 줄은 지우되 코드 블록 안의 같은 글은 그대로", _B.strip_ui_noise("코드 복사\n```text\n코드 복사\n```", ["코드 복사"]) == "```text\n코드 복사\n```")
check("코드를 뺀 본문의 언어 표시 줄 지움", _B.drop_lang_lines("JSON\n코드 복사\n설명", [{"lang": "json", "text": "{}"}]) == "코드 복사\n설명")
check("화면 문구는 적은 차례와 상관없이 긴 것부터 ('복사' 를 먼저 적어도 '코드 복사' 줄을 지움)",
      _B.strip_ui_noise("코드 복사\n본문", ["복사", "코드 복사"]) == "본문")

# 끊김·제한 기록 (events.py): 요청마다 어떻게 끝났는지 내용 없이 한 줄씩 -> diag.py --limits 로 한 화면 요약
_E = relay.events
_evp = os.path.join(_tmp, "relay-events.jsonl")
_ev_real = relay.EVENTS
relay.EVENTS = _E.EventLog(_evp, svc="Copilot")
try:
    _lkv = FakeLink(["답 안의 글 REPLY-MARK-7f3a 입니다", "실행해 주시면 다음으로 넘어가겠습니다.", "끝"])
    _rv = relay.Relay(A(), _lkv)
    _u1 = {"role": "user", "content": "요청 PROMPT-MARK-91c2 처리해줘"}
    _av1 = _quiet(lambda: _rv.handle({"messages": [sys_msg, _u1], "tools": tools}))
    _u2 = {"role": "user", "content": "이어서 해줘"}
    _quiet(lambda: _rv.handle({"messages": [sys_msg, _u1, _av1, _u2], "tools": tools}))
    _raw = open(_evp, encoding="utf-8").read()
    check("기록에 요청·답·지침의 글이 남지 않음 (내용 없이)", "PROMPT-MARK-91c2" not in _raw and "REPLY-MARK-7f3a" not in _raw
          and "SYSTEM PROMPT" not in _raw and "이어서 해줘" not in _raw and "넘어가겠습니다" not in _raw, _raw[:400])
    _req = [e for e in _E.read_events(_evp) if e["ev"] == "req"]
    check("요청 기록: 걸린 시간·새 대화·조각·보낸 글자 수·결과·답 글자 수", len(_req) == 2 and _req[0]["new"] and _req[0]["parts"] == 1
          and _req[0]["chars"] > 0 and _req[0]["result"] == "text" and _req[0]["reply_chars"] == len("답 안의 글 REPLY-MARK-7f3a 입니다")
          and "ms" in _req[0] and _req[0]["svc"] == "Copilot", _req)
    check("요청 기록: 다시 부탁한 까닭 (멈춤 -> 이어서)", _req[1]["nudges"] == ["continue"] and _req[1]["asks"] == 2, _req[1])
    # 사용량 제한: 그때까지의 사용량(최근 60분 요청 수·글자 수 등)을 함께 남김
    _lkv.fail = relay.RelayError(429, "Copilot 사용량 제한에 걸렸습니다: 요청이 너무 많습니다 (Throttled)")
    try:
        _quiet(lambda: _rv.handle({"messages": [sys_msg, _u1, _av1, _u2, {"role": "assistant", "content": "끝"},
                                                {"role": "user", "content": "하나 더"}], "tools": tools}))
    except relay.RelayError:
        pass
    _lkv.fail = None
    _err = [e for e in _E.read_events(_evp) if e["ev"] == "err"]
    check("사용량 제한 기록: 종류 + 최근 10분·60분·24시간 요청 수와 글자 수, 오늘 첫 요청부터", len(_err) == 1
          and _err[0]["kind"] == "throttle" and _err[0]["ctx"]["req_60m"] == 2 and _err[0]["ctx"]["req_10m"] == 2
          and _err[0]["ctx"]["chars_60m"] == sum(e["chars"] for e in _req) and "since_first_min" in _err[0]["ctx"], _err)
    # 대화 한도로 새 대화를 열면 '대화 바꿈' 기록
    _lkv.replies, _lkv.reset_once = ["한도 뒤 답"], True
    _quiet(lambda: _rv.handle({"messages": [sys_msg, _u1, _av1, _u2, {"role": "assistant", "content": "끝"},
                                            {"role": "user", "content": "또 하나"}], "tools": tools}))
    _rs = [e for e in _E.read_events(_evp) if e["ev"] == "reset"]
    check("대화 바꿈 기록: 대화 한도", len(_rs) == 1 and _rs[0]["kind"] == "thread_limit", _rs)
    # 개인정보 확인 거절도 오류 종류로 (내용은 요약에 나오지 않음)
    _rvp = relay.Relay(A(), FakeLink([_REFUSALS[0]]))
    try:
        _quiet(lambda: _rvp.handle({"messages": _msgs, "tools": tools}))
    except relay.RelayError:
        pass
    check("개인정보 확인 거절 기록: 종류 privacy, 422", [e.get("kind") for e in _E.read_events(_evp) if e["ev"] == "err"][-1] == "privacy")
    # 요약 (diag.py --limits): 횟수·시간만, 서비스 안내 문구(msg)는 나오지 않음
    _sum = "\n".join(_E.summarize(_E.read_events(_evp)))
    check("요약: 요청 수·다시 부탁·오류 종류·사용량 제한의 직전 사용량", "== Copilot (요청 3" in _sum and "멈춤 1" in _sum
          and "사용량 제한 1" in _sum and "직전 60분 2개" in _sum and "다음 성공까지" in _sum and "대화 한도 1" in _sum
          and "개인정보 확인 거절 1" in _sum, _sum)
    check("요약에는 안내 문구가 나오지 않음 (사진으로 가져가도 되게)", "요청이 너무 많습니다" not in _sum and "Throttled" not in _sum
          and "공유하지" not in _sum and "개인정보는" not in _sum, _sum)
    check("diag --report 한 줄", "Copilot 요청 3 · 오류 2 (사용량 제한 1) · 다시 부탁 1" == _E.summary_line(_E.read_events(_evp)),
          _E.summary_line(_E.read_events(_evp)))
    # 내부 오류·대화 바꿈의 문구에는 경로·대화 주소가 섞일 수 있어 남기지 않음 (예외 이름·종류만)
    _lki = FakeLink(["답"])
    _lki.fail = RuntimeError("처리 중 오류 C:/Users/someone/secret-path-XYZ")
    try:
        _quiet(lambda: relay.Relay(A(), _lki).handle({"messages": _msgs, "tools": tools}))
    except RuntimeError:
        pass

    class _UrlResetLink(FakeLink):
        def request(self, parts, new_thread, model=""):
            if not new_thread and not getattr(self, "_done", False):
                self._done = True
                raise relay.ThreadReset("Copilot 대화창이 바뀌었습니다 (https://x/c/secretA -> https://x/c/secretB)")
            return FakeLink.request(self, parts, new_thread, model)

    _lku = _UrlResetLink(["첫 답", "다시 연 대화의 답"])
    _ru = relay.Relay(A(), _lku)
    _au = _quiet(lambda: _ru.handle({"messages": _msgs, "tools": tools}))
    _quiet(lambda: _ru.handle({"messages": _msgs + [_au, {"role": "user", "content": "다음"}], "tools": tools}))
    _raw2 = open(_evp, encoding="utf-8").read()
    _last = [e for e in _E.read_events(_evp) if e["ev"] in ("err", "reset")][-2:]
    check("내부 오류 문구·대화 주소는 기록에 없음 (예외 이름과 종류만)", "secret-path-XYZ" not in _raw2 and "secretA" not in _raw2
          and _last[0].get("kind") == "internal" and _last[0].get("exc") == "RuntimeError" and "msg" not in _last[0]
          and _last[1].get("kind") == "thread_changed" and "msg" not in _last[1], _last)
finally:
    relay.EVENTS = _ev_real
check("오류 종류 가르기", [_E.classify(m) for m in ("Copilot 처리 실패: Copilot 답이 시작되지 않았습니다 (300초)",
                                                   "Copilot 처리 실패: Copilot 답이 끝나지 않았습니다 (900초)",
                                                   "Copilot 처리 실패: Copilot 입력창이 글을 받지 않습니다",
                                                   "브라우저 원격 디버깅 포트(9222)에 연결할 수 없습니다", "무언가 다른 오류")]
      == ["no_reply_start", "reply_not_done", "input", "browser", "other"])
_now = 1_800_000_000.0
_ctx = _E.usage_context([{"ev": "req", "t": _now - 300, "chars": 10}, {"ev": "req", "t": _now - 1800, "chars": 20},
                         {"ev": "req", "t": _now - 7200, "chars": 40}, {"ev": "err", "t": _now - 60}], _now)
check("사용량 계산: 최근 10분 1·60분 2·24시간 3, 글자 수", (_ctx["req_10m"], _ctx["req_60m"], _ctx["req_24h"], _ctx["chars_60m"],
                                                    _ctx["chars_24h"]) == (1, 2, 3, 30, 70), _ctx)
_off = os.path.join(_tmp, "off.jsonl")
_E.EventLog(_off, enabled=False).write({"ev": "req"})
check("collect_events: false 면 파일을 만들지 않음", not os.path.exists(_off))
_rot = os.path.join(_tmp, "rot.jsonl")
_lg = _E.EventLog(_rot, max_bytes=500)
for _i in range(20):
    _lg.write({"ev": "req", "i": _i})
check("4MB(시험은 500바이트)를 넘으면 하나 전 것(.1)으로 돌림, 읽을 때는 둘 다", os.path.exists(_rot + ".1")
      and [e["i"] for e in _E.read_events(_rot)] == list(range(20)), [e["i"] for e in _E.read_events(_rot)])
check("답 모양: ``` 짝이 안 맞으면 표시 (열린 채 끝남)", _E.reply_shape("```python\nprint(1)\n")["odd_fences"]
      and not _E.reply_shape("```\nx\n```")["odd_fences"])

# 도구 결과 줄이기 (tool_result_chars): 한도 안으로, 줄인 자리에 다시 보는 방법, 끝의 pi 안내(Full output)는 남김
_long = "A" * 5000 + "MIDDLE" + "B" * 5000 + "\n\n[Showing lines 1-9 of 9 (50.0KB limit). Full output: C:/tmp/pi-bash-x.log]"
_cut = relay.truncate_middle(_long, 6000)
check("도구 결과 줄이기: 6000자 안, 줄인 자리에 다시 보는 방법, 끝의 Full output 안내는 남음",
      len(_cut) <= 6000 and "자 생략: " in _cut and "offset·limit" in _cut and "MIDDLE" not in _cut
      and _cut.endswith("Full output: C:/tmp/pi-bash-x.log]") and _cut.startswith("A" * 3600), len(_cut))
check("도구 결과 줄이기: 한도 안이면 그대로", relay.truncate_middle("짧은 결과", 6000) == "짧은 결과")

# '@tool <도구> 이름=값' + 여러 줄 글: 도구 정의의 인자(command·content·text)로 (확장 도구도 이스케이프 없이)
_tools = [{"type": "function", "function": {"name": n, "parameters": {"type": "object", "properties": p}}} for n, p in (
    ("bash", {"command": {"type": "string"}, "timeout": {"type": "number"}}),
    ("write", {"path": {"type": "string"}, "content": {"type": "string"}}),
    ("read", {"path": {"type": "string"}, "offset": {"type": "number"}}),
    ("wiki_write", {"op": {"type": "string"}, "title": {"type": "string"}, "text": {"type": "string"}}),
)]
_tt = relay.tool_table(_tools)
check("도구 표: 여러 줄 글을 받는 인자", _tt == {"bash": "command", "write": "content", "read": None, "wiki_write": "text"}, _tt)
_wb = '@tool wiki_write op=ingest title="회의 요약 정리"\n=== pages/a.md\n---\ntitle: A\n---\nx < y 이고 <b>굵게</b>\n'
_c, _e = relay.parse_block(_wb, "text", _tt)
check("@tool 형식: 첫 줄의 이름=값(따옴표 안 띄어쓰기) + 둘째 줄부터는 text, 내용의 '<' 는 그대로",
      _c == {"name": "wiki_write", "arguments": {"op": "ingest", "title": "회의 요약 정리",
                                                "text": "=== pages/a.md\n---\ntitle: A\n---\nx < y 이고 <b>굵게</b>\n"}}, (_c, _e))
_c, _e = relay.parse_block("@tool bash\npython - <<'EOF'\nprint(1)\nEOF", "text", _tt)
check("@tool bash: heredoc('<<')이 든 명령도 받음 (예전에는 형식 예시로 잘못 알고 거절)",
      _c == {"name": "bash", "arguments": {"command": "python - <<'EOF'\nprint(1)\nEOF"}}, (_c, _e))
_c, _e = relay.parse_block("@tool read path=<파일 경로>", "text", _tt)
check("@tool 형식: 첫 줄에 형식 예시(<…>)를 그대로 쓰면 거절", _c is None and "형식 예시" in (_e or ""), (_c, _e))
_body, _c, _e = relay.parse_reply({"text": _wb}, _tt)
check("내용을 받는 도구가 코드 블록 밖이면 다시 부탁 (기호가 바뀔 수 있음)", _c is None and "코드 블록" in (_e or ""), (_c, _e))
_body, _c, _e = relay.parse_reply({"text": "남기겠습니다.\n```text\n" + _wb + "```\n"}, _tt)
check("코드 블록 안이면 그대로", _c and _c["name"] == "wiki_write" and _c["arguments"]["title"] == "회의 요약 정리", (_c, _e))
_c, _e = relay.parse_block("@tool bash\nls -la", "text", {"bash", "read"})
check("이름만 있는 도구 목록(set)도 예전처럼 bash 는 command", _c == {"name": "bash", "arguments": {"command": "ls -la"}}, (_c, _e))

# 메모리: pi 상태 줄·/doctor 의 숫자 (Windows 의 커밋 크기), 탭을 새로 읽는 기준 (tab_reload_mb)
B = relay.bridge
if os.name == "nt":
    _m = B.process_memory(os.getpid())
    check("process_memory: 이 프로세스의 커밋 바이트", isinstance(_m, int) and (5 << 20) < _m < (4 << 30), _m)
check("process_memory: 없는 프로세스는 None", B.process_memory(0x7FFFFFF0) is None)
check("browser_memory: 브라우저가 없으면 None (오류 없이)", B.browser_memory(9, timeout=1) is None)


class _HeapTab:
    """Runtime.getHeapUsage 만 답하는 가짜 탭 (MB 단위로 줌, None 이면 실패)"""
    events = None

    def __init__(self, used_mb):
        self.used_mb, self.calls = used_mb, []

    def call(self, method, params=None, timeout=30):
        self.calls.append(method)
        if method == "Runtime.getHeapUsage":
            if self.used_mb is None:
                raise B.BridgeError("Runtime.getHeapUsage: 연결 끊김")
            return {"usedSize": self.used_mb << 20, "totalSize": (self.used_mb + 300) << 20, "embedderHeapUsedSize": 40 << 20,
                    "backingStorageSize": 0}
        return {}


def _cop(used_mb, limit, warn=0):
    # warn 0: 전용 창 전체는 보지 않음 (시험이 진짜 브라우저 포트에 묻지 않게)
    return B.Copilot(_HeapTab(used_mb), dict(B.DEFAULT_CONFIG, use_stream=False, tab_reload_mb=limit, memory_warn_mb=warn))


check("heap_mb: 살아 있는 JS + 화면 객체 (totalSize 는 빼고)", _cop(500, 400).heap_mb() == 540)
check("heavy: 탭이 기준을 넘으면 그 크기", _cop(500, 400).heavy() == "탭 메모리 540MB")
check("heavy: 기준 아래면 None", _cop(100, 400).heavy() is None)
_c0 = _cop(5000, 0, 100)
check("heavy: tab_reload_mb 0 이면 끔 (탭·브라우저에 묻지도 않음)", _c0.heavy() is None and "Runtime.getHeapUsage" not in _c0.tab.calls, _c0.tab.calls)
check("heavy: 탭에 묻지 못하면 None (새로 읽지 않음)", _cop(None, 400).heavy() is None)
_bm, _asked = B.browser_memory, []
try:  # 전용 창 전체: 탭(웹 앱)은 작아도 전용 창 전체가 memory_warn_mb 를 넘으면 새로 읽음
    B.browser_memory = lambda port, timeout=5: _asked.append(port) or {"mb": 2700, "top_mb": 2400, "procs": 10}
    check("heavy: 전용 창 전체가 memory_warn_mb 를 넘으면 (웹 앱은 작아도)", _cop(100, 400, 2500).heavy() == "전용 창 메모리 2.6GB")
    check("heavy: 전용 창 전체가 기준 아래면 None", _cop(100, 400, 3000).heavy() is None)
    check("heavy: memory_warn_mb 0 이면 전용 창은 보지 않음", _cop(100, 400, 0).heavy() is None and len(_asked) == 2, _asked)
finally:
    B.browser_memory = _bm

# 그림: 이번에 새로 온 메시지의 그림만 마지막 조각과 함께 (send_images), 도구 결과의 그림 메시지는 요청이 아니라 덧붙임
_png = "iVBORw0KGgoAAAANSUhEUg=="
_img = lambda d=_png, mime="image/png": {"type": "image_url", "image_url": {"url": "data:{};base64,{}".format(mime, d)}}  # noqa: E731
check("그림 읽기: data: 주소만", relay.message_images({"role": "user", "content": [{"type": "text", "text": "x"}, _img(),
                                                                         {"type": "image_url", "image_url": {"url": "https://x/a.png"}}]})
      == [{"mime": "image/png", "data": _png}])
_timg = {"role": "user", "content": [{"type": "text", "text": "Attached image(s) from tool result:"}, _img()]}
check("도구 결과의 그림 메시지 알아보기", relay.tool_image_message(_timg) and not relay.tool_image_message({"role": "user", "content": [_img()]}))
check("글로 바꿀 때 그림 자리는 [그림]", relay.content_text([{"type": "text", "text": "이 그래프"}, _img()]) == "이 그래프\n[그림]")
check("도구 결과의 그림 메시지는 [요청] 이 아님", relay.Renderer(6000).message(_timg, {}) == "(앞 도구 결과의 그림 1개)")
_hist = [{"role": "user", "content": "loss.png 를 보고 설명해줘"},
         {"role": "assistant", "content": None, "tool_calls": [{"id": "t1", "type": "function", "function": {"name": "read", "arguments": "{}"}}]},
         {"role": "tool", "tool_call_id": "t1", "content": "Read image file [image/png]"}, _timg]
check("마지막 요청: 도구 결과의 그림 메시지는 건너뜀", relay.last_user_text(_hist) == "loss.png 를 보고 설명해줘" and relay.tools_used_since_user(_hist))


class _ImgLink(FakeLink):
    def request(self, parts, new_thread, model="", images=None):
        r = FakeLink.request(self, parts, new_thread, model)
        self.sent_log[-1]["images"] = images
        return r


_li = _ImgLink(["그래프는 손실이 줄어드는 모양입니다.", "```json\n{\"tool\": \"read\", \"arguments\": {\"path\": \"loss.png\"}}\n```", "줄어듭니다."])
_li.cfg = {"send_images": True}
_ri = relay.Relay(A(), _li)
_u1 = {"role": "user", "content": [{"type": "text", "text": "이 그래프를 설명해줘"}, _img()]}
_quiet(lambda: _ri.handle({"messages": [sys_msg, _u1], "tools": tools}))
check("사용자 메시지의 그림: 새 대화 마지막 조각과 함께, 글에는 [그림]", _li.sent_log[0]["images"] == [{"mime": "image/png", "data": _png}]
      and "이 그래프를 설명해줘\n[그림]" in _li.sent_log[0]["parts"][-1], _li.sent_log[0])
# 다음 요청(같은 대화): 앞 그림은 다시 붙이지 않고, 도구 결과의 그림만
_a1 = {"role": "assistant", "content": "그래프는 손실이 줄어드는 모양입니다."}
_u2 = {"role": "user", "content": "loss.png 도 봐줘"}
_a2 = _quiet(lambda: _ri.handle({"messages": [sys_msg, _u1, _a1, _u2], "tools": tools}))
check("다음 요청: 앞에서 붙인 그림은 다시 붙이지 않음", not _li.sent_log[1].get("images") and not _li.sent_log[1]["new_thread"], _li.sent_log[1])
_tr = {"role": "tool", "tool_call_id": _a2["tool_calls"][0]["id"], "content": "Read image file [image/png]"}
_quiet(lambda: _ri.handle({"messages": [sys_msg, _u1, _a1, _u2, _a2, _tr, _timg], "tools": tools}))
check("도구 결과의 그림: 그 결과와 함께 붙임 (요청으로 보이지 않게)", _li.sent_log[2]["images"] == [{"mime": "image/png", "data": _png}]
      and "(앞 도구 결과의 그림 1개)" in _li.sent_log[2]["parts"][-1] and "[요청]" not in _li.sent_log[2]["parts"][-1], _li.sent_log[2])
_lo = _ImgLink(["답"])
_lo.cfg = {"send_images": False}
_quiet(lambda: relay.Relay(A(), _lo).handle({"messages": [sys_msg, _u1], "tools": tools}))
check("send_images 끔: 그림은 보내지 않고 글로 알림", not _lo.sent_log[0].get("images")
      and "그림 1개는 보내지 않았습니다" in _lo.sent_log[0]["parts"][-1], _lo.sent_log[0])
_l6 = _ImgLink(["답"])
_l6.cfg = {"send_images": True}
_quiet(lambda: relay.Relay(A(), _l6).handle({"messages": [sys_msg, {"role": "user", "content": [_img("QQ==" * (i + 1)) for i in range(6)]}],
                                              "tools": tools}))
_lb = _ImgLink(["답"])
_lb.cfg = {"send_images": True}
_quiet(lambda: relay.Relay(A(), _lb).handle({"messages": [sys_msg, {"role": "user", "content": [_img("QUFB" * (relay.MAX_IMAGE_BYTES // 3 + 10)), _img()]}],
                                              "tools": tools}))
check("5MB 가 넘는 그림은 붙이지 않고 글로 알림 (나머지는 붙임)", _lb.sent_log[0]["images"] == [{"mime": "image/png", "data": _png}]
      and "그림 1개는 5MB 가 넘어 붙이지 않았습니다" in _lb.sent_log[0]["parts"][-1], (_lb.sent_log[0]["parts"][-1][-300:],))
check("그림은 4개까지, 넘으면 글로 알림", len(_l6.sent_log[0]["images"]) == 4 and "그림 6개 중 앞의 4개만 붙였습니다" in _l6.sent_log[0]["parts"][-1],
      _l6.sent_log[0])


class _ImgCop(_RegCop):
    def __init__(self):
        _RegCop.__init__(self, "c-img", "ours")
        self.sends = []

    def send(self, text, images=None, files=None):
        self.sends.append(images)


_lk2 = relay.CopilotLink({}, None)
_lk2.cop = _ImgCop()
_quiet(lambda: _lk2.request(["앞 조각\n\n[pi-aaaaaa]", "질문\n\n[pi-bbbbbb]"], True, images=[{"mime": "image/png", "data": _png}]))
check("CopilotLink: 그림은 마지막 조각에만", _lk2.cop.sends == [None, [{"mime": "image/png", "data": _png}]], _lk2.cop.sends)
check("그림 보내기 기본값: Copilot 켜짐, 사내AI 꺼짐", relay.bridge.DEFAULT_CONFIG.get("send_images") is True
      and json.load(open(os.path.join(os.path.dirname(os.path.abspath(relay.__file__)), "inhouse.json"), encoding="utf-8")).get("send_images") is False)


# 이메일 감추기 (redact_emails, 사내AI): 보낼 때 [이메일N] (같은 주소는 같은 번호), 답의 도구 인자·본문은 원래 주소로
_rd0 = relay.Redactor()
_t = _rd0.redact("작성자 hong.gd@example.com, 검토 kim@corp.example.org, 다시 hong.gd@example.com")
check("감추기: 주소마다 번호, 같은 주소는 같은 번호", _t == "작성자 [이메일1], 검토 [이메일2], 다시 [이메일1]", _t)
check("되돌리기: 글·목록·사전 안의 번호를 원래 주소로, 모르는 번호는 그대로",
      _rd0.restore({"path": "a.md", "edits": [{"oldText": "[이메일1]", "newText": "[이메일2] [이메일9]"}]})
      == {"path": "a.md", "edits": [{"oldText": "hong.gd@example.com", "newText": "kim@corp.example.org [이메일9]"}]})
check("감추기를 두 번 해도 같음 (번호는 주소 모양이 아님)", _rd0.redact(_t) == _t)
_sysr = {"role": "system", "content": "<project_instructions path=\"/x/AGENTS.md\">\n- Git 작성자 홍길동 <hong.gd@example.com>\n</project_instructions>"}
_ur = {"role": "user", "content": "docs/a.md 를 정리해서 docs/b.md 로 써줘"}
_wr = '```text\n@tool write path=docs/b.md\n# 정리\n- 작성자: [이메일1]\n- 검토: [이메일2]\n```'
_lkr = FakeLink(['```json\n{"tool": "read", "arguments": {"path": "docs/a.md"}}\n```', _wr,
                 '```json\n{"tool": "edit", "arguments": {"path": "docs/b.md", "edits": [{"oldText": "[이메일2]", "newText": "[이메일2] (팀장)"}]}}\n```',
                 '```json\n{"tool": "bash", "arguments": {"command": "grep -rn \'[이메일1]\' docs"}}\n```', "정리했습니다. 작성자는 [이메일1] 입니다."])
_lkr.cfg = {"redact_emails": True, "service_name": "사내AI"}
_rr = relay.Relay(A(), _lkr)
_o = _io.StringIO()
with _cl.redirect_stdout(_o):
    _a1 = _rr.handle({"messages": [_sysr, _ur], "tools": tools})
    _m = [_sysr, _ur, _a1, {"role": "tool", "tool_call_id": _a1["tool_calls"][0]["id"],
                            "content": "author: hong.gd@example.com\nreviewer: kim@corp.example.org\n본문"}]
    _a2 = _rr.handle({"messages": _m, "tools": tools})
    _m += [_a2, {"role": "tool", "tool_call_id": _a2["tool_calls"][0]["id"], "content": "Successfully wrote"}]
    _a3 = _rr.handle({"messages": _m, "tools": tools})
    _m += [_a3, {"role": "tool", "tool_call_id": _a3["tool_calls"][0]["id"], "content": "Successfully replaced"}]
    _a4 = _rr.handle({"messages": _m, "tools": tools})
    _m += [_a4, {"role": "tool", "tool_call_id": _a4["tool_calls"][0]["id"], "content": "docs/b.md:2:- 작성자: hong.gd@example.com"}]
    _a5 = _rr.handle({"messages": _m, "tools": tools})
_sent = "\n".join(p for x in _lkr.sent_log for p in x["parts"])
check("보낸 글에 이메일 주소가 없음 (지침·도구 결과 모두 [이메일N])", "@example.com" not in _sent and "@corp.example.org" not in _sent
      and "Git 작성자 홍길동 <[이메일1]>" in _lkr.sent_log[0]["parts"][0] and "author: [이메일1]\nreviewer: [이메일2]" in _lkr.sent_log[1]["parts"][0],
      _sent[-600:])
_args = lambda a: json.loads(a["tool_calls"][0]["function"]["arguments"])  # noqa: E731
check("write: 파일 내용은 원래 주소로", _args(_a2)["content"].rstrip("\n") == "# 정리\n- 작성자: hong.gd@example.com\n- 검토: kim@corp.example.org", _args(_a2))
check("edit: 찾을 글·바꿀 글도 원래 주소로", _args(_a3)["edits"] == [{"oldText": "kim@corp.example.org", "newText": "kim@corp.example.org (팀장)"}], _args(_a3))
check("bash: 명령 안의 번호도 원래 주소로", _args(_a4)["command"] == "grep -rn 'hong.gd@example.com' docs", _args(_a4))
check("최종 답 본문도 원래 주소로 (pi 화면)", _a5.get("content") == "정리했습니다. 작성자는 hong.gd@example.com 입니다.", _a5)
check("같은 세션이 이어짐 (원래 주소로 되돌린 답을 pi 가 다시 보내도 같은 대화)", all(not x["new_thread"] for x in _lkr.sent_log[1:]),
      [x["new_thread"] for x in _lkr.sent_log])
check("중계 서버 로그에 이메일 주소·짝이 남지 않음", "@example.com" not in _o.getvalue() and "@corp.example.org" not in _o.getvalue(), _o.getvalue()[-400:])
_lkc = FakeLink(["답"])
_lkc.cfg = {}
_quiet(lambda: relay.Relay(A(), _lkc).handle({"messages": [_sysr, _ur], "tools": tools}))
check("redact_emails 꺼짐(Copilot 기본): 그대로 보냄", "hong.gd@example.com" in _lkc.sent_log[0]["parts"][0])
# 감추면 지침의 이메일로는 막히지 않으므로, 지난번 막힘을 기억하는 것(held)도 이메일로는 걸리지 않음 (전화번호 등은 그대로)
_lkq = FakeLink([_REFUSALS[0], "다시 답"])
_lkq.cfg = {"redact_emails": True, "service_name": "사내AI"}
_rq2 = relay.Relay(A(), _lkq)
_sysq = {"role": "system", "content": "<project_instructions path=\"/x/AGENTS.md\">\n- 연락처 010-1234-5678, hong.gd@example.com\n</project_instructions>"}
try:
    _quiet(lambda: _rq2.handle({"messages": [_sysq, _ur], "tools": tools}))
    _eq = None
except relay.RelayError as e:
    _eq = e
check("감춰도 다른 것(전화번호)으로 막히면: 그 찾은 곳만 알리고, 이메일은 찾은 곳에 없음", _eq is not None and "전화번호" in str(_eq)
      and "이메일 주소" not in str(_eq).split("찾은 곳:")[-1] and _rq2.blocked == {"010-1234-5678"}, (str(_eq), _rq2.blocked))
check("bridge 기본은 꺼짐, 사내AI 설정은 켜짐", relay.bridge.DEFAULT_CONFIG.get("redact_emails") is False
      and json.load(open(os.path.join(os.path.dirname(os.path.abspath(relay.__file__)), "inhouse.json"), encoding="utf-8")).get("redact_emails") is True)

# 번호 감추기 (redact_numbers, 사내AI): 계좌번호 모양 번호(합쳐 10~14자리)를 [번호N] 으로. 날짜·IP·버전·UUID 는 그대로
#  (2026-10-20 사내AI 가 폴더 목록의 '20260727_075536' 같은 날짜·시각을 '계좌번호와 같은 민감한 정보' 로 막은 일)
_yes = ["20260727_075536", "20261002_130748", "110-123-456789", "1002-123-456789", "123456-12-123456", "12345678-01", "2026102012345", "backup_20260727_075536", "2026-10-20_15"]
_no = ["2026-10-20", "20260930", "2026-10-20 15:30", "2026-10-20.1", "192.168.100.200", "550e8400-e29b-41d4-a716-446655440000", "1,500,000",
       "pi-reorganization-20261002", "internal-agent_before_merged_20260921", "411 / 311", "v1.2.3", "20260101-20261231"]
_miss = [t for t in _yes if not list(relay.ACCOUNT_RE.finditer(t))]
_wrong = [t for t in _no if list(relay.ACCOUNT_RE.finditer(t))]
check("계좌번호 모양: 날짜·시각이 붙은 이름과 계좌번호 꼴은 잡고, 날짜·IP·버전·UUID·금액·날짜 범위는 잡지 않음", not _miss and not _wrong, (_miss, _wrong))
_rd1 = relay.Redactor()
_tn = _rd1.redact("backup_20260727_075536 작성 hong@example.com 계좌 110-123-456789 다시 20260727_075536 날짜 2026-10-20", True, True)
check("번호 감추기: [번호N] (같은 번호는 같은 표시, 이메일과 따로 셈), 날짜는 그대로, 되돌리기, 두 번 해도 같음",
      _tn == "backup_[번호1] 작성 [이메일1] 계좌 [번호2] 다시 [번호1] 날짜 2026-10-20" and _rd1.restore(_tn).startswith("backup_20260727_075536 작성 hong@example.com 계좌 110-123-456789")
      and _rd1.redact(_tn, True, True) == _tn, _tn)
check("번호 감추기를 켜지 않으면 이메일만", relay.Redactor().redact("a@example.com 20260727_075536") == "[이메일1] 20260727_075536")
_urn = {"role": "user", "content": "백업 폴더를 정리해줘"}
_lkn = FakeLink(['```json\n{"tool": "bash", "arguments": {"command": "ls backup"}}\n```',
                 '```json\n{"tool": "bash", "arguments": {"command": "rm -r backup/document_update_[번호1]"}}\n```', "정리했습니다 ([번호1] 지움)"])
_lkn.cfg = {"redact_emails": True, "redact_numbers": True, "service_name": "사내AI"}
_rn = relay.Relay(A(), _lkn)
_sysn = {"role": "system", "content": "규칙"}
with _cl.redirect_stdout(_io.StringIO()):
    _b1 = _rn.handle({"messages": [_sysn, _urn], "tools": tools})
    _mn = [_sysn, _urn, _b1, {"role": "tool", "tool_call_id": _b1["tool_calls"][0]["id"], "content": "document_update_20260727_075536\npi-reorganization-20261002"}]
    _b2 = _rn.handle({"messages": _mn, "tools": tools})
    _mn += [_b2, {"role": "tool", "tool_call_id": _b2["tool_calls"][0]["id"], "content": "(지움)"}]
    _b3 = _rn.handle({"messages": _mn, "tools": tools})
_sentn = "\n".join(p for x in _lkn.sent_log for p in x["parts"])
check("redact_numbers: 도구 결과의 날짜·시각 이름은 [번호N], 8자리 날짜 이름은 그대로",
      "20260727_075536" not in _sentn and "document_update_[번호1]" in _sentn and "pi-reorganization-20261002" in _sentn, _sentn[-300:])
check("redact_numbers: 명령과 최종 답은 원래 번호로", _args(_b2)["command"] == "rm -r backup/document_update_20260727_075536"
      and _b3.get("content") == "정리했습니다 (20260727_075536 지움)", (_args(_b2), _b3))
# 감추기를 끈 채 계좌번호 모양으로 막히면: 찾은 곳 + 그대로면 다시 보내지 않음. 못 찾으면 긴 숫자를 의심 후보로 (다시 보내기는 막지 않음)
_lkb = FakeLink([_REFUSALS[0]])
_lkb.cfg = {"service_name": "사내AI"}
_rb = relay.Relay(A(), _lkb)
try:
    _quiet(lambda: _rb.handle({"messages": [_sysn, {"role": "user", "content": "폴더 document_update_20260727_075536 정리"}], "tools": tools}))
    _eb = None
except relay.RelayError as e:
    _eb = e
check("감추기를 끈 채 막히면: 찾은 곳에 계좌번호 모양 번호, 그대로면 다음은 보내지 않음",
      _eb is not None and "요청 글의 계좌번호 모양 번호 (202…36)" in str(_eb) and _rb.blocked == {"20260727_075536"}, (str(_eb), _rb.blocked))
_lks = FakeLink([_REFUSALS[0]])
_lks.cfg = {"service_name": "사내AI"}
_rs = relay.Relay(A(), _lks)
try:
    _quiet(lambda: _rs.handle({"messages": [_sysn, {"role": "user", "content": "폴더 2026-07-24_review 와 20260930_phase 정리"}], "tools": tools}))
    _es = None
except relay.RelayError as e:
    _es = e
check("못 찾으면: 긴 숫자를 의심 후보로 알리고 다시 보내기는 막지 않음", _es is not None and "걸렸을 수 있는 곳 (긴 숫자, 확인 필요)" in str(_es)
      and "요청 글의 긴 숫자 (202…24)" in str(_es) and not _rs.blocked, (str(_es), _rs.blocked))
check("bridge(Copilot) 번호 감추기 기본은 꺼짐, 사내AI 는 켜짐", relay.bridge.DEFAULT_CONFIG.get("redact_numbers") is False
      and json.load(open(os.path.join(os.path.dirname(os.path.abspath(relay.__file__)), "inhouse.json"), encoding="utf-8")).get("redact_numbers") is True)

# 서로 다른 파일 쓰기·고치기도 한 번에 (multi_write): 같은 파일, 쓰는 파일을 함께 읽기, 쓰기와 명령은 섞지 않음
_c = lambda name, **a: {"name": name, "arguments": a}  # noqa: E731
_bn = lambda calls, w=True: [c["name"] + ":" + str(c["arguments"].get("path") or c["arguments"].get("command")) for c in relay.batch_calls(calls, writes=w)]  # noqa: E731
check("묶기: 읽기 + 서로 다른 파일 쓰기·고치기", _bn([_c("read", path="a.md"), _c("read", path="b.md"), _c("write", path="c.md", content="x"),
                                          _c("edit", path="d.md", edits=[])]) == ["read:a.md", "read:b.md", "write:c.md", "edit:d.md"])
check("묶기: 같은 파일을 두 번 쓰면 거기서 멈춤", _bn([_c("write", path="a.md", content="1"), _c("edit", path="./a.md", edits=[])]) == ["write:a.md"])
check("묶기: 쓰는 파일을 함께 읽으면 멈춤 (동시에 실행되므로)", _bn([_c("read", path="a.md"), _c("write", path="a.md", content="1")]) == ["read:a.md"]
      and _bn([_c("write", path="a.md", content="1"), _c("read", path="a.md")]) == ["write:a.md"])
check("묶기: 쓰기와 명령은 섞지 않음 (읽기만 하는 명령도)", _bn([_c("write", path="a.md", content="1"), _c("bash", command="ls")]) == ["write:a.md"]
      and _bn([_c("bash", command="ls"), _c("write", path="a.md", content="1")]) == ["bash:ls"])
check("묶기: 5개까지, writes 가 꺼져 있으면 쓰기는 묶지 않음", len(relay.batch_calls([_c("write", path="f{}.md".format(i), content="x") for i in range(7)], writes=True)) == 5
      and _bn([_c("read", path="a.md"), _c("write", path="b.md", content="1")], False) == ["read:a.md"])
_wb = "".join('```json\n' + json.dumps({"tool": "write", "arguments": {"path": "docs/n{}.md".format(i), "content": "# {}".format(i)}}) + '\n```\n' for i in range(3))
_lw = FakeLink([_wb, "정리했습니다"])
_lw.cfg = {"multi_read": True, "multi_write": True}
_aw3 = _quiet(lambda: relay.Relay(A(), _lw).handle({"messages": [_u], "tools": tools}))
check("multi_write 켬: 서로 다른 파일 쓰기 3개를 한 번에, 진행 방식에 쓰기도 묶어도 된다는 안내",
      [json.loads(t["function"]["arguments"])["path"] for t in _aw3.get("tool_calls", [])] == ["docs/n0.md", "docs/n1.md", "docs/n2.md"]
      and relay.MULTI_WRITE_RULE.format(n=5).strip() in _lw.sent_log[0]["parts"][0], (_aw3, _lw.sent_log[0]["parts"][0][-800:]))
# 오늘 보낸 질문 수: 서비스에 보낸 조각마다 하나 (파일에 남아 중계 서버를 다시 켜도 이어 셈, 날짜가 바뀌면 0부터)
_up = os.path.join(_tmp, "inhouse-usage.json")
_old_usage, relay.USAGE = relay.USAGE, relay.Usage(_up, 200)
try:
    _lu = relay.CopilotLink({"cdp_port": 1, "copilot_url_contains": "x", "daily_limit_pattern": _ih["daily_limit_pattern"]}, None)
    _lu.cop, _lu.pace = _CopParts(["OK", "답"]), (lambda: None)
    _quiet(lambda: _lu.request(relay.build_parts("가" * 15000, 10000, "[pi-aaaaaa]"), True))
    check("오늘 질문 수: 나눠 보낸 조각마다 하나", relay.USAGE.today() == 2 and relay.Usage(_up, 200).today() == 2, relay.USAGE.today())
    with open(_up, "w", encoding="utf-8") as _f:
        json.dump({"day": "2000-01-01", "n": 150}, _f)
    check("오늘 질문 수: 날짜가 바뀌면 0부터", relay.Usage(_up, 200).today() == 0)

    class _ThrCop(_CopParts):
        def wait_reply(self, marker):
            raise relay.bridge.Throttled("사내AI는 일일 200회 질문이 가능합니다.")

    _lu.cop = _ThrCop([])
    try:
        _quiet(lambda: _lu.request(["질문\n\n[pi-bbbbbb]"], False))
        _et = None
    except relay.RelayError as e:
        _et = e
    check("하루 한도 문구: 429 + '하루 질문 한도에 닿았습니다' + 오늘 보낸 수 (같은 대화에 이어서)", _et is not None and _et.status == 429
          and "하루 질문 한도에 닿았습니다" in str(_et) and "오늘 이 PC 에서 보낸 질문 2개" in str(_et) and "몇 분~수십 분" not in str(_et), str(_et))
    check("하루 한도에 닿으면: 막힌 질문을 뺀 수(2)를 새 추정치로, 그때를 기록 (파일에 남음)", relay.USAGE.limit == 2
          and relay.USAGE.hits[-1]["n"] == 2 and relay.Usage(_up, 200).limit == 2 and relay.Usage(_up, 200).hits[-1]["n"] == 2,
          (relay.USAGE.limit, relay.USAGE.hits))
    check("막힌 상태는 파일에도 남음 (중계 서버를 다시 켜도)", relay.USAGE.blocked is True and relay.Usage(_up, 200).blocked is True)
    try:
        _quiet(lambda: _lu.request(["질문\n\n[pi-bbbbbc]"], False))
        _et2 = None
    except relay.RelayError as e:
        _et2 = e
    check("막힌 뒤 다시 해 봄: 추정치(2)와 기록은 그대로 (다시 해 본 질문으로 1씩 올라가지 않음)", _et2 is not None and _et2.status == 429
          and "오늘 이 PC 에서 보낸 질문 2개" in str(_et2) and relay.USAGE.limit == 2 and len(relay.USAGE.hits) == 1 and relay.USAGE.today() == 4,
          (str(_et2), relay.USAGE.limit, relay.USAGE.hits, relay.USAGE.today()))
    relay.USAGE.add()
    check("보내기만 해서는 올리지 않음 (답이 와야)", relay.USAGE.limit == 2, relay.USAGE.limit)
    relay.USAGE.passed()
    check("추정치를 넘겨도 답이 오면(막히지 않으면) 그 수로 올리고 막힘도 풂", relay.USAGE.limit == relay.USAGE.today() == 5
          and relay.USAGE.blocked is False and relay.Usage(_up, 200).blocked is False, (relay.USAGE.limit, relay.USAGE.today()))
    _lu.cop = _CopParts(["답"])
    _quiet(lambda: _lu.request(["질문\n\n[pi-bbbbbd]"], False))
    check("요청에서 답이 오면 passed: 오늘 수 6, 추정치 6", relay.USAGE.today() == 6 and relay.USAGE.limit == 6, (relay.USAGE.today(), relay.USAGE.limit))
    _r18 = relay.Relay(A(), FakeLink([]))
    _srv4 = _Srv(("127.0.0.1", 0), relay.make_handler(_r18, None, {"cdp_port": 1, "service_name": "사내AI"}))
    _th.Thread(target=_srv4.serve_forever, daemon=True).start()
    import urllib.request as _ureq  # noqa: E402
    _mem = json.loads(_ureq.urlopen("http://127.0.0.1:{}/memory".format(_srv4.server_address[1]), timeout=10).read())
    check("/memory: 오늘 보낸 질문 수와 추정 한도 (pi 상태 줄용)", _mem.get("questions_today") == relay.USAGE.today()
          and _mem.get("question_limit") == relay.USAGE.limit == 6 and _mem.get("service") == "사내AI", _mem)
    _srv4.shutdown()
    with open(_up, "w", encoding="utf-8") as _f:
        json.dump({"day": "2000-01-01", "n": 150, "limit": 180, "hits": [{"day": "2000-01-01", "time": "14:03", "n": 180}]}, _f)
    _u2 = relay.Usage(_up, 200)
    check("날짜가 바뀌어도 추정 한도와 기록은 남음 (오늘 수만 0부터)", _u2.today() == 0 and _u2.limit == 180 and _u2.hits[0]["n"] == 180,
          (_u2.today(), _u2.limit, _u2.hits))
    check("처음(기록 없음)은 설정값", relay.Usage(os.path.join(_tmp, "none-usage.json"), 200).limit == 200)
finally:
    relay.USAGE = _old_usage

# 긴 글 파일로 붙이기 (attach_long_text): 입력 한도를 넘으면 글 전체는 파일로, 본문에는 읽으라는 말·진행 방식 요약·끝부분 (질문 1번)
import base64 as _b64  # noqa: E402


class _FileLink(FakeLink):
    def __init__(self, replies, fail_files=False):
        FakeLink.__init__(self, replies)
        self.fail_files = fail_files

    def request(self, parts, new_thread, model="", images=None, files=None):
        if files and self.fail_files:
            raise relay.AttachUnavailable("붙지 않음: paste, drop, file (대상 없음)")
        r = FakeLink.request(self, parts, new_thread, model)
        self.sent_log[-1]["files"] = files
        return r


class _AA:
    max_chars = 10000
    tool_result_chars = 6000


_lf = _FileLink(["답"])
_lf.cfg = {"attach_long_text": True, "service_name": "사내AI"}
_rf = relay.Relay(_AA(), _lf)
_big = "가" * 12000 + "\n마지막 요청: 표를 정리해줘"
_pp, _ff = _rf.pack(_big, "[pi-cccccc]", {"read", "bash"})
_ftext = _b64.b64decode(_ff[0]["data"]).decode("utf-8") if _ff else ""
check("긴 글: 본문 하나(입력 한도 안) + 글 파일 하나, 파일에는 글 전체", len(_pp) == 1 and len(_pp[0]) <= 10000 and len(_ff) == 1
      and _ff[0]["name"].startswith("pi-context-") and _ff[0]["name"].endswith(".txt") and _ftext == _big, (len(_pp), len(_pp[0]) if _pp else 0, _ff and _ff[0]["name"]))
check("본문: 파일 이름·읽으라는 말·진행 방식 요약·끝부분(마지막 요청)·marker 는 맨 끝", _ff and _ff[0]["name"] in _pp[0] and "처음부터 끝까지 읽고" in _pp[0]
      and "진행 방식" in _pp[0] and "마지막 요청: 표를 정리해줘" in _pp[0] and _pp[0].endswith("[pi-cccccc]"), _pp[0][:300] + " … " + _pp[0][-200:])
check("짧은 글은 그대로 한 조각 (파일 없음)", _rf.pack("짧은 요청", "[pi-dddddd]") == (["짧은 요청\n\n[pi-dddddd]"], []))
_lf.cfg["attach_long_text"] = False
check("꺼 두면 지금처럼 나눠 보냄", len(_rf.pack(_big, "[pi-eeeeee]")[0]) == 2 and _rf.pack(_big, "[pi-eeeeee]")[1] == [])
_lf.cfg["attach_long_text"] = True
_sysl = {"role": "system", "content": "규칙\n" + "- 긴 규칙 줄입니다.\n" * 800}
_quiet(lambda: _rf.handle({"messages": [_sysl, {"role": "user", "content": "정리해줘"}], "tools": tools}))
check("새 대화의 긴 첫 메시지: 질문 1번 (본문 하나 + 파일)", len(_lf.sent_log[0]["parts"]) == 1 and len(_lf.sent_log[0]["files"] or []) == 1
      and relay.PROTOCOL_TAG in _b64.b64decode(_lf.sent_log[0]["files"][0]["data"]).decode("utf-8"), (len(_lf.sent_log[0]["parts"]), _lf.sent_log[0]["files"]))
_lx2 = _FileLink(["답"], fail_files=True)
_lx2.cfg = {"attach_long_text": True, "service_name": "사내AI"}
_o2 = _io.StringIO()
with _cl.redirect_stdout(_o2):
    _ax = relay.Relay(_AA(), _lx2).handle({"messages": [_sysl, {"role": "user", "content": "정리해줘"}], "tools": tools})
check("글 파일을 못 붙이면 그 요청은 나눠 보냄 (파일 없이, 조각 여러 개)", _ax.get("content") == "답" and len(_lx2.sent_log) == 1
      and len(_lx2.sent_log[0]["parts"]) > 1 and not _lx2.sent_log[0].get("files") and "나눠 보냅니다" in _o2.getvalue(), (_lx2.sent_log, _o2.getvalue()[-300:]))
_lr = _FileLink(["답"])
_lr.cfg = {"attach_long_text": True, "service_name": "사내AI"}
_rr2 = relay.Relay(_AA(), _lr)
_sysph = {"role": "system", "content": "규칙\n" + "- 긴 규칙 줄입니다.\n" * 800 + "- 연락처 010-1234-5678\n"}
_o3 = _io.StringIO()
with _cl.redirect_stdout(_o3):
    _rr2.handle({"messages": [_sysph, {"role": "user", "content": "정리해줘"}], "tools": tools})
check("개인정보 모양 글(전화번호)이 있으면 파일로 붙이지 않고 나눠 보냄 (서비스의 개인정보 확인을 거치게), 로그에 값은 없음",
      len(_lr.sent_log) == 1 and len(_lr.sent_log[0]["parts"]) > 1 and not _lr.sent_log[0].get("files")
      and "개인정보 모양 글이 있어" in _o3.getvalue() and "010-1234" not in _o3.getvalue(), (_lr.sent_log and len(_lr.sent_log[0]["parts"]), _o3.getvalue()[-300:]))
_pe, _fe = _rf.pack("가" * 12000 + "\n작성자 [이메일1]", "[pi-ffffff]")
check("감춘 이메일([이메일N])만 있으면 파일로 붙임", len(_pe) == 1 and len(_fe) == 1, (len(_pe), len(_fe)))
_lc = _FileLink(["답", "다음 답"])
_lc.cfg = {"attach_long_text": True, "service_name": "사내AI"}
_rc = relay.Relay(_AA(), _lc)
_m1 = [_sysl, {"role": "user", "content": "정리해줘"}]
_quiet(lambda: _rc.handle({"messages": _m1, "tools": tools}))
_quiet(lambda: _rc.handle({"messages": _m1 + [{"role": "assistant", "content": "답"},
                                              {"role": "user", "content": "결과 줄입니다.\n" * 1500 + "이 결과로 표를 만들어줘"}], "tools": tools}))
_s2 = _lc.sent_log[-1]
_f2 = _b64.b64decode(_s2["files"][0]["data"]).decode("utf-8") if _s2.get("files") else ""
check("이어지는 대화의 긴 메시지: 질문 1번, 본문은 '이번 메시지' (진행 방식·지금까지의 대화가 파일에 있다고 하지 않음), 파일에는 이번 메시지 전체",
      len(_lc.sent_log) == 2 and not _s2["new_thread"] and len(_s2["parts"]) == 1 and len(_s2["parts"][0]) <= 10000
      and "이번 메시지" in _s2["parts"][0] and "지금까지의 대화" not in _s2["parts"][0] and "이 결과로 표를 만들어줘" in _f2 and "긴 규칙 줄" not in _f2,
      ([(x["new_thread"], len(x["parts"])) for x in _lc.sent_log], _s2["parts"][0][:200], len(_f2)))
check("새 대화의 첫 메시지는 그대로 ('진행 방식·지금까지의 대화' 가 파일에)", "지금까지의 대화" in _lc.sent_log[0]["parts"][0], _lc.sent_log[0]["parts"][0][:200])
check("bridge(Copilot) 기본은 꺼짐, 사내AI 는 켜짐 (2026-10-20 회사 사내AI 에서 확인)", relay.bridge.DEFAULT_CONFIG.get("attach_long_text") is False
      and json.load(open(os.path.join(os.path.dirname(os.path.abspath(relay.__file__)), "inhouse.json"), encoding="utf-8")).get("attach_long_text") is True)

# 중계 서버 보완 (2026-10-21.1)
# Copilot 기본 사용량 제한 문구: 답이 사과·안내로 시작할 때만 (평범한 짧은 답은 아님)
_cp = relay.bridge.DEFAULT_CONFIG["throttle_pattern"]
_normal = ["API 가 429 Too Many Requests 를 돌려주면 5초 기다렸다가 다시 보내도록 retry.py 를 고쳤습니다.", "오늘 작업: 서버 요청이 너무 많을 때 큐에 쌓도록 바꿨습니다.",
           "'잠시 후 나중에 다시 시도해 주세요' 안내를 띄우도록 바꿨습니다.", "응답 처리 (try again later 응답 처리)"]
check("Copilot 사용량 제한 문구: 실제 안내('현재 요청이 너무 많아…', 'Sorry… too many requests')는 잡고 평범한 답은 잡지 않음",
      relay.re.search(_cp, "현재 요청이 너무 많아 일시적으로 응답할 수 없습니다.", relay.re.I) and relay.re.search(_cp, "Sorry, you have sent too many requests. Please try again later.", relay.re.I)
      and not [t for t in _normal if relay.re.search(_cp, t, relay.re.I)], [t for t in _normal if relay.re.search(_cp, t, relay.re.I)])
_lt = relay.CopilotLink({"cdp_port": 1, "copilot_url_contains": "x"}, None)
_lt.cop, _lt.pace = _ThrCop([]), (lambda: None)
try:
    _quiet(lambda: _lt.request(["질문\n\n[pi-bbbbbe]"], False))
    _et3 = None
except relay.RelayError as e:
    _et3 = e
check("하루 한도 문구(daily_limit_pattern)가 없는 서비스는 사용량 제한을 하루 한도로 보지 않음 (추정 한도 그대로)",
      _et3 is not None and "하루 질문 한도" not in str(_et3) and "몇 분~수십 분" in str(_et3), str(_et3))
# 번호 감추기: 파일 이름 끝의 .확장자, run-…, ckpt-…, 17자리(앞 14자리), 띄어 쓰거나 점으로 이은 전화번호
_more = ["log_20260727_075536.txt", "run-20260727_075536", "ckpt-20260727-075536", "backup_20261002_130748.tar.gz", "20260727_075536_123"]
_miss2 = [t for t in _more if not list(relay.ACCOUNT_RE.finditer(t))]
_wrong2 = [t for t in ["3.14159265358", "v2.1.20260727", "20260101-20261231", "550e8400-e29b-41d4-a716-446655440000"] if list(relay.ACCOUNT_RE.finditer(t))]
check("번호 감추기: 파일 이름의 날짜·시각(.확장자, run-…, ckpt-…, 밀리초까지 17자리면 앞 14자리)도, 소수·버전·날짜 범위·UUID 는 아님", not _miss2 and not _wrong2, (_miss2, _wrong2))
_rd2 = relay.Redactor()
_tp = _rd2.redact("전화 010 1234 5678 / 010.1234.5678 / 010-1234-5678, a 20260727_075536_123 b", True, True)
check("번호 감추기: 전화번호(띄어 쓰거나 점으로 이은 것)도 [번호N], 17자리는 앞 14자리만, 되돌리기",
      _tp == "전화 [번호1] / [번호2] / [번호3], a [번호4]_123 b" and _rd2.restore(_tp) == "전화 010 1234 5678 / 010.1234.5678 / 010-1234-5678, a 20260727_075536_123 b", _tp)
# 감춘 자리 규칙은 내 설정이 extra_rules 를 바꿔도 첫 메시지에 늘
_lr5 = FakeLink(["답"])
_lr5.cfg = {"redact_emails": True, "redact_numbers": True, "extra_rules": ["답은 짧게"], "service_name": "사내AI"}
_quiet(lambda: relay.Relay(A(), _lr5).handle({"messages": [{"role": "system", "content": "규칙"}, {"role": "user", "content": "안녕"}], "tools": tools}))
_first5 = _lr5.sent_log[0]["parts"][0]
check("내 설정의 extra_rules 가 목록을 바꿔도 감춘 자리([이메일N]·[번호N]) 규칙은 첫 메시지에 늘 들어감",
      "답은 짧게" in _first5 and relay.EMAIL_TOKEN_RULE in _first5 and relay.NUMBER_TOKEN_RULE in _first5, _first5[:600])
_lr6 = FakeLink(["답"])
_lr6.cfg = {"service_name": "Copilot"}
_quiet(lambda: relay.Relay(A(), _lr6).handle({"messages": [{"role": "system", "content": "규칙"}, {"role": "user", "content": "안녕"}], "tools": tools}))
check("감추기를 끈 서비스(Copilot)는 감춘 자리 규칙을 넣지 않음", relay.EMAIL_TOKEN_RULE not in _lr6.sent_log[0]["parts"][0])
# 다른 pi 가 끝날 때(pi -p 한 번 실행 등) 지금 대화를 쓰는 pi 의 대화는 그대로
_r19 = relay.Relay(A(), FakeLink(["답", "답2"]))
_srv5 = _Srv(("127.0.0.1", 0), relay.make_handler(_r19, None, {"cdp_port": 1, "service_name": "사내AI"}))
_th.Thread(target=_srv5.serve_forever, daemon=True).start()
_port5 = _srv5.server_address[1]


def _post5(path, body, sess):
    req = _ureq.Request("http://127.0.0.1:{}{}".format(_port5, path), data=json.dumps(body).encode("utf-8"),
                        headers={"Content-Type": "application/json", "X-Pi-Session": sess}, method="POST")
    return json.loads(_ureq.urlopen(req, timeout=30).read())


_quiet(lambda: _post5("/v1/chat/completions", {"model": "copilot", "messages": [{"role": "system", "content": "규칙"}, {"role": "user", "content": "안녕"}], "tools": tools}, "A-1"))
_fresh_before = _r19.fresh
_quiet(lambda: _post5("/session/end", {"reason": "quit", "session": "B-2"}, "B-2"))
_time.sleep(0.5)
check("다른 pi(세션 B)가 끝나도 지금 대화(세션 A)는 그대로 (새 대화로 바꾸지 않음)", _r19.session == "A-1" and _r19.fresh is False and _fresh_before is False,
      (_r19.session, _r19.fresh))
_quiet(lambda: _post5("/session/end", {"reason": "quit", "session": "A-1"}, "A-1"))
for _ in range(20):
    if _r19.fresh:
        break
    _time.sleep(0.1)
check("그 대화를 쓰던 pi(세션 A)가 끝나면 다음 요청은 새 대화", _r19.fresh is True)
_srv5.shutdown()

# 노트북에서 pi 가 쓰는 폴더 (bridge.json 의 jupyter_dir, pi 의 /jupyter dir): 공용 노트북에서 홈의 pi-bridge 문의가 많아 바꿀 수 있게
import jupyter as _jup  # noqa: E402
check("노트북 폴더 값: Jupyter 루트 기준 상대 경로 (앞의 ~/ 와 끝의 / 는 뗌, 한글·빈칸 됨)",
      _jup.bridge_dir_of("tools/pi-bridge") == "tools/pi-bridge" and _jup.bridge_dir_of("~/tools/pi-bridge/") == "tools/pi-bridge"
      and _jup.bridge_dir_of("모델 정보/pi-bridge") == "모델 정보/pi-bridge" and _jup.bridge_dir_of("pi-bridge") == "pi-bridge")
check("노트북 폴더 값: 절대 경로·..·점으로 시작하는 폴더(파일 기능이 못 읽음)·셸에서 뜻이 있는 글자는 안 됨",
      all(_jup.bridge_dir_of(v) is None for v in ["/tmp/x", "../x", "a/../b", ".pi-bridge", "tools/.x", "a$b", 'a"b', "a`b", "", "~/", "a;b"]))
_j = _jup.Jupyter({"jupyter_dir": "tools/pi-bridge"})
_jbad = _jup.Jupyter({"jupyter_dir": "../x"})
check("설정한 폴더 아래 run/ 을 실행 폴더로, 쓸 수 없는 값이면 pi-bridge",
      _j.bridge_dir == "tools/pi-bridge" and _j.run_dir == "tools/pi-bridge/run" and _jbad.bridge_dir == "pi-bridge" and _jbad.run_dir == "pi-bridge/run")
_j.ready.add("pibridge")
_out = _j.set_bridge_dir("shared/pi-bridge")
check("실행 중에 바꾸기: 새 폴더, 터미널은 다음 명령 때 다시 준비 (새 폴더를 만듦)",
      _out["bridge_dir"] == "shared/pi-bridge" and _out["old"] == "tools/pi-bridge" and _j.run_dir == "shared/pi-bridge/run" and not _j.ready)
_j.runs["r1"] = {"done": False, "aborted": False, "term": "pibridge"}
try:
    _j.set_bridge_dir("tools/pi-bridge")
    check("실행 중인 명령이 있으면 바꾸지 않음", False, "예외 없음")
except relay.bridge.BridgeError as e:
    check("실행 중인 명령이 있으면 바꾸지 않음", "실행 중인 명령" in str(e) and _j.bridge_dir == "shared/pi-bridge", e)
try:
    _jup.Jupyter({}).set_bridge_dir(".hidden")
    check("쓸 수 없는 값으로는 바꾸지 않음", False, "예외 없음")
except relay.bridge.BridgeError as e:
    check("쓸 수 없는 값으로는 바꾸지 않음", "쓸 수 없는 값" in str(e), e)

print("RESULT:", "PASS" if fails == 0 else "FAIL ({})".format(fails))
sys.exit(1 if fails else 0)
