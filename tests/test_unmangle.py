# Copilot 화면 표시용 가공 되돌리기 단위 테스트 (실제 Copilot 원문으로 확인한 사례)
# 사용법: python tests/test_unmangle.py [bridge.py 가 있는 폴더, 기본: ../copilot]
import os
import sys

sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "copilot"))
import bridge  # noqa: E402

fails = 0


def check(name, got, want):
    global fails
    ok = got == want
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else "\n     기대: {!r}\n     결과: {!r}".format(want, got)))
    if not ok:
        fails += 1


# 실제 Copilot 웹소켓 원문(text) -> 우리가 보낸 원래 코드
check("']:' 앞 역슬래시 제거 (리스트)", bridge.unmangle_copilot_text('for column in ["날짜", "지역", "단가"\\]:'),
      'for column in ["날짜", "지역", "단가"]:')
check("']:' 앞 역슬래시 제거 (인덱스)", bridge.unmangle_copilot_text('if data["a"][0\\]:'), 'if data["a"][0]:')
check("원래 있던 '\\]:' 는 하나만 남김 (정규식)", bridge.unmangle_copilot_text('pattern = r"\\[(\\w+)\\\\]:"'),
      'pattern = r"\\[(\\w+)\\]:"')
check("주소 링크 찌꺼기 제거", bridge.unmangle_copilot_text('link = "[label\\]: http://example.com&quot;http://example.com"</a>'),
      'link = "[label]: http://example.com"')
check("가공 없는 글은 그대로", bridge.unmangle_copilot_text('x: list[int] = data["a"]\nunder_score = "a_b_c * d"'),
      'x: list[int] = data["a"]\nunder_score = "a_b_c * d"')
check("빈 값", bridge.unmangle_copilot_text(None), None)
print("RESULT:", "PASS" if fails == 0 else "FAIL ({})".format(fails))
sys.exit(1 if fails else 0)
