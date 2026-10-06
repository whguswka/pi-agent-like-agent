#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""끊김·제한 기록 (중계 서버가 쓰고 diag.py --limits 가 요약한다)

Copilot·사내AI 가 중간에 끊기거나 사용량 제한에 걸리는 상황은 밖에서 재현할 수 없으므로, 중계 서버가 요청마다
'어떻게 끝났는지' 를 한 줄씩 남긴다. 사진 한 장으로 가져올 수 있도록 요약은 횟수와 시간만 보여 준다.

- 내용은 남기지 않는다: 요청·답의 글, 파일 내용, 명령, 도구 결과는 없음. 시각, 글자 수, 횟수, 종류, 모델 이름, 설정 값만.
  (오류·경고에는 서비스나 중계 서버의 안내 문구를 200자까지 남기지만 이 PC 안에서만 보며, 요약 화면에는 나오지 않는다)
- 이 PC 의 파일에만 쓴다 (네트워크 없음). 중계 서버마다 파일 하나: ~/.pi/agent/relay-events.jsonl (사내AI: inhouse-events.jsonl)
- 4MB 를 넘으면 하나 전 것(.1)으로 돌린다. 지워도 된다. 끄려면 내 설정 파일에 "collect_events": false
"""
import json
import os
import re
import threading
import time

MAX_BYTES = 4 * 1024 * 1024


class EventLog:
    def __init__(self, path=None, svc="Copilot", enabled=True, max_bytes=MAX_BYTES):
        self.path, self.svc, self.max_bytes = path, svc, max_bytes
        self.enabled = bool(path) and enabled
        self.lock = threading.Lock()

    def write(self, ev):
        """이벤트 한 줄 쓰기. 기록이 실패해도 중계는 계속한다"""
        if not self.enabled:
            return
        row = {"t": round(time.time(), 1), "svc": self.svc}
        row.update(ev)
        line = json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
        with self.lock:
            try:
                if os.path.exists(self.path) and os.path.getsize(self.path) > self.max_bytes:
                    os.replace(self.path, self.path + ".1")
                with open(self.path, "a", encoding="utf-8") as f:
                    f.write(line)
            except OSError:
                pass

    def read(self, since=0.0):
        return read_events(self.path, since) if self.path else []


def read_events(path, since=0.0):
    """기록 파일(과 하나 전 것 .1)에서 since(초) 이후 이벤트들. 없으면 []"""
    out = []
    for p in (path + ".1", path):
        try:
            with open(p, encoding="utf-8", errors="replace") as f:
                for ln in f:
                    try:
                        ev = json.loads(ln)
                    except ValueError:
                        continue
                    if isinstance(ev, dict) and ev.get("t", 0) >= since:
                        out.append(ev)
        except OSError:
            pass
    return out


def usage_context(events, now=None):
    """지금까지의 사용량 (사용량 제한·오류가 날 때 함께 남김): 최근 10분·60분·24시간 요청 수와 보낸 글자 수,
    오늘 첫 요청부터 지난 분"""
    now = now or time.time()
    reqs = [e for e in events if e.get("ev") == "req"]
    ctx = {}
    for name, sec in (("10m", 600), ("60m", 3600), ("24h", 86400)):
        win = [e for e in reqs if now - e.get("t", 0) <= sec]
        ctx["req_" + name] = len(win)
        if name != "10m":
            ctx["chars_" + name] = sum(e.get("chars", 0) for e in win)
    today = time.strftime("%Y-%m-%d", time.localtime(now))
    first = [e["t"] for e in reqs if time.strftime("%Y-%m-%d", time.localtime(e.get("t", 0))) == today]
    ctx["since_first_min"] = round((now - min(first)) / 60) if first else 0
    return ctx


# 오류 종류: 예외의 종류와 메시지(중계 서버·bridge.py 가 만든 문구)로 가른다
ERROR_KINDS = [
    ("throttle", r"사용량 제한"),
    ("login", r"로그인이 풀렸|세션이 만료|SessionExpired"),
    ("config", r"주소가 설정되지"),
    ("browser", r"원격 디버깅 포트"),
    ("tab", r"탭을 찾지 못|탭과 연결이 끊|창을 열지 못"),
    ("no_reply_start", r"답이 시작되지 않았습니다"),
    ("reply_not_done", r"답이 끝나지 않았습니다"),
    ("input", r"입력창"),
    ("send", r"전송되지 않았습니다"),
    ("marker_missing", r"보낸 메시지를 화면에서 찾지 못"),
]
RESET_KINDS = [
    ("thread_limit", r"대화 한도"),
    ("thread_changed", r"대화창이 바뀌었"),
    ("reconnect", r"다시 연결"),
    ("turns_short", r"남은 질문 수"),
    ("q_limit", r"질문 수 한도"),
    ("tab_lost", r"연결이 끊겼"),
]


def classify(text, kinds=ERROR_KINDS, status=None):
    if status == 422:
        return "privacy"
    if status == 429:
        return "throttle"
    for kind, pat in kinds:
        if re.search(pat, text or ""):
            return kind
    return "other"


def reply_shape(text):
    """답 모양 (내용 없이): 글자 수, ``` 줄이 짝이 안 맞는지 (코드 블록이 열린 채 끝남 = 중간에 끊겼을 수 있음)"""
    text = text or ""
    fences = len(re.findall(r"(?m)^\s*(`{3,}|~{3,})", text))
    return {"reply_chars": len(text), "odd_fences": fences % 2 == 1}


# --------------------------------------------------------------------------- 요약 (diag.py --limits)

WAIT_NAMES = [("stream", "원문"), ("stream-late", "원문(늦게)"), ("dom", "화면"), ("dom-fallback", "원문 못 받아 화면"),
              ("dom-busy", "처리 중 기다림"), ("dom-busycap", "기다림 최대까지")]
NUDGE_NAMES = [("format", "형식"), ("refusal", "실행 거절"), ("code", "코드만"), ("continue", "멈춤"), ("loop", "반복")]
ERROR_NAMES = [("throttle", "사용량 제한"), ("no_reply_start", "답 시작 안 됨"), ("reply_not_done", "답 안 끝남"),
               ("input", "입력"), ("send", "전송"), ("marker_missing", "보낸 글 못 찾음"), ("tab", "탭"), ("browser", "브라우저"),
               ("login", "로그인"), ("config", "설정"), ("privacy", "개인정보 확인 거절"), ("reset_failed", "새 대화로도 실패"),
               ("internal", "중계기 내부"), ("other", "기타")]
RESET_NAMES = [("thread_limit", "대화 한도"), ("thread_changed", "창 바뀜"), ("reconnect", "다시 연결"), ("turns_short", "남은 질문 부족"),
               ("q_limit", "질문 수 설정"), ("tab_lost", "연결 끊김"), ("other", "기타")]
WARN_NAMES = [("model_select", "모델 선택 실패"), ("delete", "대화 삭제 실패"), ("mid_not_ok", "중간 조각에 OK 아님")]


def _counts(items, names):
    got = {}
    for it in items:
        got[it] = got.get(it, 0) + 1
    parts = ["{} {}".format(label, got.pop(key)) for key, label in names if got.get(key)]
    parts += ["{} {}".format(k, v) for k, v in sorted(got.items())]
    return " · ".join(parts)


def _hm(t):
    return time.strftime("%m-%d %H:%M", time.localtime(t))


def summarize(events, days=7, now=None):
    """서비스별 요약 줄들 (사진 한 장용). 서비스 안내 문구(msg)는 넣지 않는다"""
    now = now or time.time()
    since = now - days * 86400
    events = sorted((e for e in events if e.get("t", 0) >= since), key=lambda e: e.get("t", 0))
    lines = ["[끊김·제한 기록] {} ~ {} ({}일, 내용 없이 횟수·시간만)".format(
        time.strftime("%m-%d", time.localtime(since)), time.strftime("%m-%d %H:%M", time.localtime(now)), days)]
    svcs = []
    for e in events:
        if e.get("svc") not in svcs:
            svcs.append(e.get("svc"))
    if not svcs:
        lines.append("  기록 없음 (이 판의 중계 서버로 요청하면 쌓임)")
        return lines
    for svc in svcs:
        ev = [e for e in events if e.get("svc") == svc]
        reqs = [e for e in ev if e.get("ev") == "req"]
        errs = [e for e in ev if e.get("ev") == "err"]
        span = max(1.0, (now - max(since, min(e["t"] for e in ev))) / 86400)
        lines.append("== {} (요청 {}, 하루 평균 {:.0f})".format(svc, len(reqs), len(reqs) / span))
        if reqs:
            ms = sorted(e.get("ms", 0) / 1000 for e in reqs)
            new = [e.get("ms", 0) / 1000 for e in reqs if e.get("new")]
            lines.append("  걸린 시간  평균 {:.0f}초 · 중간 {:.0f} · 최대 {:.0f} · 새 대화 {}번{} · 조각 나눔 {}번".format(
                sum(ms) / len(ms), ms[len(ms) // 2], ms[-1], len(new), " (평균 {:.0f}초)".format(sum(new) / len(new)) if new else "",
                sum(1 for e in reqs if e.get("split"))))
            waits = [w.get("how") for e in reqs for w in e.get("waits") or [] if isinstance(w, dict)]
            if waits:
                busy = [w.get("busy_ms", 0) / 1000 for e in reqs for w in e.get("waits") or [] if isinstance(w, dict) and w.get("busy_ms")]
                lines.append("  답 끝 판단  {}{}".format(_counts(waits, WAIT_NAMES),
                                                    " (처리 중 기다림 평균 {:.0f}초)".format(sum(busy) / len(busy)) if busy else ""))
            nudges = [n for e in reqs for n in e.get("nudges") or []]
            if nudges:
                lines.append("  다시 부탁  {}번: {}".format(len(nudges), _counts(nudges, NUDGE_NAMES)))
            odd = sum(1 for e in reqs if e.get("odd_fences"))
            empty = sum(1 for e in reqs if e.get("result") == "text" and not e.get("reply_chars"))
            if odd or empty:
                lines.append("  답 모양  ``` 짝 안 맞음 {} · 빈 답 {}".format(odd, empty))
        resets = [e.get("kind") for e in ev if e.get("ev") == "reset"]
        if resets:
            lines.append("  대화 바꿈  {}".format(_counts(resets, RESET_NAMES)))
        if errs:
            lines.append("  오류  {}번: {}".format(len(errs), _counts([e.get("kind") for e in errs], ERROR_NAMES)))
        for i in [k for k, x in enumerate(ev) if x.get("ev") == "err" and x.get("kind") == "throttle"][-4:]:
            e, c = ev[i], ev[i].get("ctx") or {}
            nxt = next((x["t"] for x in ev[i + 1:] if x.get("ev") == "req"), None)  # 기록 차례로 그다음 성공
            lines.append("  사용량 제한 {}: 직전 60분 {}개({:.0f}천 자) · 24시간 {}개 · 오늘 첫 요청부터 {:.1f}시간 · 대화 질문 {} -> {}".format(
                _hm(e["t"]), c.get("req_60m", "?"), c.get("chars_60m", 0) / 1000, c.get("req_24h", "?"),
                c.get("since_first_min", 0) / 60, "?" if e.get("chat_q") is None else e["chat_q"],
                "다음 성공까지 {:.0f}분".format((nxt - e["t"]) / 60) if nxt is not None else "아직 성공 없음"))
        warns = [e.get("kind") for e in ev if e.get("ev") == "warn"]
        if warns:
            lines.append("  화면 경고  {}".format(_counts(warns, WARN_NAMES)))
    return lines


def summary_line(events, days=7, now=None):
    """diag.py --report 에 넣는 한 줄"""
    now = now or time.time()
    ev = [e for e in events if e.get("t", 0) >= now - days * 86400]
    if not ev:
        return None
    parts = []
    for svc in sorted({e.get("svc") for e in ev}, key=str):
        s = [e for e in ev if e.get("svc") == svc]
        errs = [e for e in s if e.get("ev") == "err"]
        thr = sum(1 for e in errs if e.get("kind") == "throttle")
        nud = sum(len(e.get("nudges") or []) for e in s if e.get("ev") == "req")
        parts.append("{} 요청 {} · 오류 {}{} · 다시 부탁 {}".format(svc, sum(1 for e in s if e.get("ev") == "req"), len(errs),
                                                          " (사용량 제한 {})".format(thr) if thr else "", nud))
    return " / ".join(parts)
