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

# 3) 긴 메시지 나누기
parts = relay.build_parts("가" * 25000, 10000, "[pi-abc]")
check("긴 메시지 분할 (각 1만 자 이하)", len(parts) == 3 and all(len(p) <= 10000 for p in parts) and all(p.endswith("[pi-abc]") for p in parts),
      [len(p) for p in parts])
check("앞 조각은 OK 만 답하라는 안내", "OK 라고만 답해" in parts[0] and "마지막입니다" in parts[-1])

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
        return {"text": self.replies.pop(0)}


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
r15.end_session = lambda reason="": _calls.append(reason)
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
check("/v1/session/end: reload 는 무시, quit 은 정리", _calls == ["quit"], _calls)
check("/v1/models: copilot + 설정한 모델", _ids == ["copilot", "gpt-6.0-sol"], _ids)

print("RESULT:", "PASS" if fails == 0 else "FAIL ({})".format(fails))
sys.exit(1 if fails else 0)
