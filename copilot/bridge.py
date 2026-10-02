#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""브라우저 조작 모듈 (Windows PC, Python 3.8+ 표준 라이브러리만 사용) - relay.py 가 불러서 쓴다

브라우저(Edge/Chrome)를 원격 디버깅(CDP)으로 제어한다.
 - Copilot 탭: 질문을 입력하고, 답이 끝날 때까지 기다린 뒤 답을 읽는다 (같은 대화창에 이어서).
 - JupyterLab 탭 조작은 jupyter.py 에 있다.
먼저 브라우저를 원격 디버깅 포트와 함께 실행해야 한다 (start-edge.cmd 참고).
"""
import base64
import json
import os
import re
import socket
import struct
import sys
import threading
import time
import urllib.parse
import urllib.request

DEFAULT_CONFIG = {
    "cdp_port": 9222,
    "copilot_url_contains": "m365.cloud.microsoft/chat",
    "copilot_new_chat_url": "https://m365.cloud.microsoft/chat",
    "jupyter_url_contains": "",
    "input_selector": "",
    "send_button_selector": "",
    "new_chat_selector": "",
    "reply_selector": "",
    "send_button_pattern": "send|submit|보내기|전송|제출",
    "stop_button_pattern": "stop|cancel generat|중지|멈춤|그만",
    "new_chat_pattern": "new chat|new conversation|새 채팅|새 대화|새 채팅 시작",
    "thread_limit_pattern": "reached (its|the) (limit|end)|conversation limit|start a new (chat|topic|conversation)|대화.{0,12}(한도|최대)|새 (대화|채팅).{0,6}시작",
    "throttle_pattern": "too many requests|try again later|요청이 너무 많|나중에 다시 시도",
    "stable_seconds": 4.0,
    "use_stream": True,
    "stream_wait_after_dom_seconds": 15,
    "ui_noise_words": ["Microsoft 365 Copilot", "Copilot said:", "Copilot의 말:", "Copilot", "Copy", "Copied", "복사",
                       "Like", "Dislike", "좋아요", "싫어요", "Share", "공유", "Edit in Pages", "Pages에서 편집", "Edit", "편집",
                       "Regenerate", "다시 생성", "AI-generated content may be incorrect", "AI 생성 콘텐츠가 잘못되었을 수 있습니다"],
    "ui_noise_selectors": ["[data-testid=\"chat-suggestion\"]"],
    "first_reply_timeout_seconds": 180,
    "reply_timeout_seconds": 900,
    "max_questions_per_chat": 100,  # 이 수만큼 질문하면 새 대화로 (긴 대화에서 Copilot 이 규칙을 놓치므로). 0 이면 Copilot 한도까지
    "max_questions_per_minute": 0,  # 0 이면 끔. Copilot 사용량 제한을 피하려면 분당 질문 수 상한을 넣음
}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


LINKIFY_RE = re.compile(r'(https?://[^\s"&<]+)&quot;\1"</a>')


def unmangle_copilot_text(text):
    """Copilot 이 화면 표시용으로 가공한 글을 원래대로 되돌린다 (웹소켓 원문·화면 모두 같은 가공이 들어 있음)
    - ']:' 앞에 역슬래시 하나를 덧붙임 (마크다운 링크 정의 막기): 'x["a"]:' -> 'x["a"\\]:', 원래 '\\]:' 는 '\\\\]:'
      -> 역슬래시 하나만 빼면 원래대로
    - 따옴표에 붙은 주소를 링크로 바꾸며 HTML 찌꺼기를 남김: 'http://a.com"' -> 'http://a.com&quot;http://a.com"</a>'"""
    if not text:
        return text
    return LINKIFY_RE.sub(r'\1"', text.replace("\\]:", "]:"))


def strip_ui_noise(text, words):
    """답 영역에 섞여 들어온 화면 문구(이름표, Copy/좋아요 버튼 등)만으로 된 짧은 줄을 지운다"""
    out = []
    for line in (text or "").split("\n"):
        s = line.strip()
        if s and len(s) <= 60:
            rest = s
            for w in words:
                rest = re.sub(re.escape(w), "", rest, flags=re.I)
            if not re.sub(r"[\s\W_]+", "", rest):
                continue
        out.append(line)
    return "\n".join(out).strip()


class BridgeError(Exception):
    pass


class SessionExpired(BridgeError):
    pass


class ThreadReset(BridgeError):
    pass


class Throttled(BridgeError):
    """Copilot 계정 단위 사용량 제한 ("현재 요청이 너무 많아 일시적으로 응답할 수 없습니다")"""


# ---------------------------------------------------------------------------
# 최소 WebSocket 클라이언트 (CDP 용) - 외부 패키지 없이 동작
# ---------------------------------------------------------------------------


class WebSocket:
    def __init__(self, url, timeout=10):
        u = urllib.parse.urlsplit(url)
        port = u.port or 80
        self.sock = socket.create_connection((u.hostname, port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        path = u.path + ("?" + u.query if u.query else "")
        req = ("GET {} HTTP/1.1\r\nHost: {}:{}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               "Sec-WebSocket-Key: {}\r\nSec-WebSocket-Version: 13\r\n\r\n").format(path, u.hostname, port, key)
        self.sock.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("websocket 연결 실패")
            buf += chunk
        head, self.buf = buf.split(b"\r\n\r\n", 1)
        if b" 101" not in head.split(b"\r\n", 1)[0]:
            raise ConnectionError("websocket 연결 거부: " + head.decode("utf-8", "replace")[:300])
        self.lock = threading.Lock()

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(max(65536, n - len(self.buf)))
            if not chunk:
                raise ConnectionError("브라우저와의 연결이 끊어졌습니다")
            self.buf += chunk
        data, self.buf = self.buf[:n], self.buf[n:]
        return data

    def _frame(self, opcode, payload):
        n = len(payload)
        head = bytearray([0x80 | opcode])
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head.append(0x80 | 126)
            head += struct.pack(">H", n)
        else:
            head.append(0x80 | 127)
            head += struct.pack(">Q", n)
        mask = os.urandom(4)
        head += mask
        if n:
            m = (mask * (n // 4 + 1))[:n]
            payload = (int.from_bytes(payload, "big") ^ int.from_bytes(m, "big")).to_bytes(n, "big")
        with self.lock:
            self.sock.sendall(bytes(head) + payload)

    def send(self, text):
        self._frame(0x1, text.encode("utf-8"))

    def recv(self, timeout):
        self.sock.settimeout(max(0.05, timeout))
        message = b""
        while True:
            b1, b2 = self._read(2)
            opcode, n = b1 & 0x0F, b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            mask = self._read(4) if b2 & 0x80 else None
            data = self._read(n)
            if mask and n:
                m = (mask * (n // 4 + 1))[:n]
                data = (int.from_bytes(data, "big") ^ int.from_bytes(m, "big")).to_bytes(n, "big")
            if opcode == 0x8:
                raise ConnectionError("브라우저가 연결을 닫았습니다")
            if opcode == 0x9:
                self._frame(0xA, data)
                continue
            if opcode == 0xA:
                continue
            message += data
            if b1 & 0x80:
                return message.decode("utf-8", "replace")

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


class Tab:
    """브라우저 탭 하나 (CDP)"""

    def __init__(self, info):
        self.info = info
        self.ws = WebSocket(info["webSocketDebuggerUrl"])
        self.next_id = 0
        self.events = None  # 리스트로 바꾸면 CDP 이벤트(Network 등)를 모아 둠
        self.last_wake = 0

    def wake(self, every=2.0):
        """뒤쪽(숨겨진) 탭은 브라우저가 '얼려서' 스크립트·fetch 가 멈춘다 -> 작업 전에 활성 상태로 깨운다"""
        if time.time() - self.last_wake < every:
            return
        self.last_wake = time.time()
        try:
            if not getattr(self, "page_enabled", False):
                self.call("Page.enable", timeout=10)
                self.page_enabled = True
            self.call("Page.setWebLifecycleState", {"state": "active"}, timeout=10)
        except (BridgeError, TimeoutError):
            pass

    def call(self, method, params=None, timeout=30):
        self.next_id += 1
        mid = self.next_id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                raise TimeoutError("CDP 응답 없음: " + method)
            try:
                msg = json.loads(self.ws.recv(remaining))
            except socket.timeout:
                raise TimeoutError("CDP 응답 없음: " + method)
            if msg.get("id") == mid:
                if "error" in msg:
                    raise BridgeError("{}: {}".format(method, msg["error"].get("message")))
                return msg.get("result", {})
            if self.events is not None and "method" in msg:
                self.events.append(msg)

    def eval(self, expression, timeout=30):
        self.wake()
        r = self.call("Runtime.evaluate", {"expression": expression, "awaitPromise": True,
                                           "returnByValue": True, "userGesture": True}, timeout)
        if r.get("exceptionDetails"):
            ex = r["exceptionDetails"]
            desc = (ex.get("exception") or {}).get("description") or ex.get("text")
            raise BridgeError("페이지 스크립트 오류: " + str(desc)[:400])
        return (r.get("result") or {}).get("value")

    def close(self):
        self.ws.close()


def list_tabs(port):
    try:
        with urllib.request.urlopen("http://127.0.0.1:{}/json/list".format(port), timeout=5) as r:
            return [t for t in json.load(r) if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
    except OSError as e:
        raise BridgeError("브라우저 원격 디버깅 포트({})에 연결할 수 없습니다. start-edge.cmd 로 브라우저를 실행했는지 "
                          "확인하세요. ({})".format(port, e))


# ---------------------------------------------------------------------------
# Copilot 탭 조작
# ---------------------------------------------------------------------------

PAGE_LIB = r"""
(() => {
  const V = 4;
  if (window.__piBridge && window.__piBridge.v === V) return true;
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const label = (el) => [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('placeholder'),
                         el.getAttribute('data-testid'), (el.innerText || '').trim().slice(0, 40)].filter(Boolean).join(' | ');
  const EDITABLE = 'textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]';
  function inputs() {
    return [...document.querySelectorAll(EDITABLE)].filter(el => visible(el) && !el.disabled &&
      el.getBoundingClientRect().width > 150 && !el.closest('[aria-hidden="true"]'))
      .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
  }
  function findInput(sel) {
    if (sel) { const el = document.querySelector(sel); return visible(el) ? el : null; }
    return inputs()[0] || null;
  }
  const inputText = (el) => !el ? '' : (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') ? el.value : (el.innerText || '');
  function buttons(pattern) {
    const re = new RegExp(pattern, 'i');
    return [...document.querySelectorAll('button, [role="button"], a[role="link"], a')]
      .filter(b => visible(b) && !b.disabled && re.test(label(b)));
  }
  function nearest(list, el) {
    if (!el || !list.length) return list[0] || null;
    const r = el.getBoundingClientRect();
    const d = (b) => { const q = b.getBoundingClientRect(); return Math.hypot(q.left - r.right, q.top - r.top); };
    return list.slice().sort((a, b) => d(a) - d(b))[0];
  }
  function findMarker(marker) {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n, last = null;
    while ((n = w.nextNode())) {
      if (n.nodeValue.includes(marker)) {
        const el = n.parentElement;
        if (el && !el.closest(EDITABLE)) last = el;
      }
    }
    return last;
  }
  function chain(el, depth) {
    const out = [];
    while (el && el !== document.body && out.length < depth) { out.push(el); el = el.parentElement; }
    return out;
  }
  function following(el, input) {
    const out = [];
    for (let s = el.nextElementSibling; s; s = s.nextElementSibling) if (!(input && s.contains(input))) out.push(s);
    return out;
  }
  // 답 영역 텍스트 (추천 질문 버튼 같은 화면 요소는 제외)
  function textOf(els, noiseSel) {
    return els.map(e => {
      let t = e.innerText || '';
      if (noiseSel) for (const n of e.querySelectorAll(noiseSel)) { const nt = (n.innerText || '').trim(); if (nt) t = t.replace(nt, ''); }
      return t;
    }).join('\n').trim();
  }
  // 줄 단위로 그려지는 코드 뷰어(가상화) : 스크롤하면서 모든 줄을 모은다
  async function viewerText(root) {
    const lines = new Map();
    const grab = () => root.querySelectorAll('[data-line-index]').forEach(e => lines.set(+e.getAttribute('data-line-index'), e.textContent));
    grab();
    const sc = [root, ...root.querySelectorAll('*')].find(e => e.scrollHeight > e.clientHeight + 5);
    if (sc) {
      const orig = sc.scrollTop;
      for (let y = 0; y <= sc.scrollHeight; y += Math.max(40, sc.clientHeight * 0.8)) {
        sc.scrollTop = y; await new Promise(r => setTimeout(r, 60)); grab();
      }
      sc.scrollTop = orig;
    }
    return [...lines.keys()].sort((a, b) => a - b).map(k => lines.get(k)).join('\n');
  }
  async function codeBlocks(els) {
    const out = [];
    for (const e of els) {
      for (const pre of e.querySelectorAll('pre')) {
        const code = pre.querySelector('code') || pre;
        const cls = (code.className || '') + ' ' + (pre.className || '');
        const m = cls.match(/(?:language|lang)-([\w-]+)/);
        out.push({lang: m ? m[1] : (pre.getAttribute('data-language') || code.getAttribute('data-language') || ''), text: code.textContent});
      }
      const viewers = [...e.querySelectorAll('[data-virtualized-code-find-root], [role="textbox"][aria-readonly="true"]')]
        .filter(v => !v.parentElement.closest('[data-virtualized-code-find-root], [role="textbox"][aria-readonly="true"]') && v.querySelector('[data-line-index]'));
      for (const v of viewers) out.push({lang: '', text: await viewerText(v)});
    }
    return out;
  }
  function replyEls(marker, level, sel, input) {
    const mk = findMarker(marker);
    if (!mk) return null;
    if (sel) {
      const all = [...document.querySelectorAll(sel)].filter(e => !e.contains(mk) &&
        (mk.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING));
      return all.length ? [all[all.length - 1]] : [];
    }
    const a = chain(mk, 16)[level];
    return a ? following(a, input) : [];
  }
  window.__piBridge = {v: V, visible, label, inputs, findInput, inputText, buttons, nearest, findMarker, chain,
                       following, textOf, codeBlocks, replyEls};
  return true;
})()
"""


class Copilot:
    def __init__(self, tab, cfg):
        self.tab = tab
        self.cfg = cfg
        self.thread_url = None
        self.on_tick = None  # 오래 기다리는 동안 부를 콜백 (없어도 됨)
        self.turns_left = None  # Copilot 이 알려주는 이 대화의 남은 질문 수
        self.stream_ok = False  # WebSocket 으로 답을 받은 적이 있으면 True
        try:
            tab.call("Emulation.setFocusEmulationEnabled", {"enabled": True})  # 뒤쪽 탭이어도 포커스가 있는 것처럼
        except BridgeError:
            pass
        if cfg.get("use_stream", True):
            # Copilot 은 답을 WebSocket(Chathub)으로 받는다. 화면 대신 그 원문(markdown)을 읽으면 코드 블록이 정확함
            try:
                tab.events = []
                tab.call("Network.enable", {"maxTotalBufferSize": 100000000, "maxResourceBufferSize": 50000000})
            except BridgeError:
                tab.events = None

    def stream_reply(self, marker):
        """모아 둔 WebSocket 프레임에서 marker 가 붙은 우리 질문의 최종 답(type 2 레코드)을 찾는다"""
        evs = self.tab.events
        if evs is None:
            return None
        self.tab.events = []
        found = None
        for ev in evs:
            if ev.get("method") != "Network.webSocketFrameReceived":
                continue
            payload = ev.get("params", {}).get("response", {}).get("payloadData", "")
            if marker not in payload:
                continue
            for raw in payload.split("\x1e"):
                if marker not in raw:
                    continue
                try:
                    rec = json.loads(raw)
                except ValueError:
                    continue
                if rec.get("type") != 2:
                    continue
                item = rec.get("item") or {}
                msgs = item.get("messages") or []
                if not any(marker in (m.get("text") or "") for m in msgs if m.get("author") == "user"):
                    continue
                bots = [m for m in msgs if m.get("author") == "bot" and not m.get("messageType") and (m.get("text") or "").strip()]
                result = item.get("result") or {}
                found = {"text": bots[-1]["text"] if bots else (result.get("message") or ""),
                         "result": result.get("value"), "throttling": item.get("throttling") or {}}
        return found

    def use_stream_reply(self, got):
        thr = got.get("throttling") or {}
        mx, num = thr.get("maxNumUserMessagesInConversation"), thr.get("numUserMessagesInConversation")
        if isinstance(mx, int) and isinstance(num, int):
            self.turns_left = mx - num
            log("  (이 Copilot 대화: 질문 {}/{} 사용)".format(num, mx))
        elif thr:
            log("  (Copilot throttling 정보: {})".format(json.dumps(thr, ensure_ascii=False)[:200]))
        if got.get("result") and got["result"] != "Success":
            if "throttl" in got["result"].lower():  # 계정 단위 사용량 제한: 새 대화를 열어도 같음 -> 기다려야 함
                raise Throttled("{} ({})".format((got.get("text") or "요청이 너무 많습니다").strip()[:150], got["result"]))
            if "limit" in got["result"].lower() or self.turns_left == 0:
                raise ThreadReset("Copilot 대화 한도 ({})".format(got["result"]))
            raise BridgeError("Copilot 응답 오류: {}".format(got["result"]))
        self.stream_ok = True
        url = self.js("location.origin + location.pathname")
        self.thread_url = url
        return {"text": unmangle_copilot_text(got["text"]), "code_blocks": [], "text_without_code": None, "url": url,
                "source": "stream"}

    def tick(self):
        if self.on_tick:
            self.on_tick()

    def js(self, expr, timeout=30):
        self.tab.eval(PAGE_LIB, timeout)
        return self.tab.eval(expr, timeout)

    def q(self, value):
        return json.dumps(value)

    def wait_input(self, seconds=30):
        deadline = time.time() + seconds
        while time.time() < deadline:
            if self.js("!!window.__piBridge.findInput({})".format(self.q(self.cfg["input_selector"]))):
                return
            time.sleep(0.5)
        raise BridgeError("Copilot 입력창을 찾지 못했습니다. Copilot 페이지가 열려 있는지, input_selector 설정을 확인하세요.")

    def new_chat(self):
        clicked = self.js("""(() => { const B = window.__piBridge;
            const sel = %s; let b = sel ? document.querySelector(sel) : B.buttons(%s)[0];
            if (b && B.visible(b)) { b.click(); return B.label(b); } return null; })()""" % (
            self.q(self.cfg["new_chat_selector"]), self.q(self.cfg["new_chat_pattern"])))
        if clicked:
            log("Copilot: 새 대화 ({})".format(clicked))
        else:
            log("Copilot: 새 대화 (주소로 이동: {})".format(self.cfg["copilot_new_chat_url"]))
            self.tab.call("Page.navigate", {"url": self.cfg["copilot_new_chat_url"]})
            time.sleep(2)
        time.sleep(1.5)
        self.wait_input(60)
        self.thread_url = None
        self.turns_left = None

    def key(self, key, code, vk, modifiers=0):
        for t in ("keyDown", "keyUp"):
            self.tab.call("Input.dispatchKeyEvent", {"type": t, "key": key, "code": code, "windowsVirtualKeyCode": vk,
                                                     "nativeVirtualKeyCode": vk, "modifiers": modifiers})

    def input_len(self, sel):
        return self.js("window.__piBridge.inputText(window.__piBridge.findInput({})).replace(/[\\s\\u200b\\u200c]+/g, '').length".format(sel))

    def clear_input(self, sel):
        """비우기: 실제 키 입력(Ctrl+A, Backspace) - Lexical 같은 편집기도 정상 처리. 안 되면 execCommand"""
        self.js("""(() => { const el = window.__piBridge.findInput(%s); if (el) el.focus(); })()""" % sel)
        self.key("a", "KeyA", 65, modifiers=2)
        self.key("Backspace", "Backspace", 8)
        if self.input_len(sel) > 0:  # textarea 등
            self.js("""(() => { const el = window.__piBridge.findInput(%s); el.focus();
                document.execCommand('selectAll', false, null); document.execCommand('delete', false, null); })()""" % sel)

    def wait_filled(self, sel, want, timeout=8.0):
        """입력창 글자 수가 want 의 90% 에 닿거나, 1.5초 동안 더 늘지 않거나, timeout 이 될 때까지 기다린다"""
        deadline, last, last_change = time.time() + timeout, -1, time.time()
        while True:
            time.sleep(0.3)
            got = self.input_len(sel)
            if got >= want * 0.9:
                return got
            if got != last:
                last, last_change = got, time.time()
            elif time.time() - last_change >= 1.5 or time.time() >= deadline:
                return got

    def send(self, text):
        self.wait_input(30)
        if self.tab.events is not None:
            self.tab.events = []  # 이전 프레임 버림
        sel = self.q(self.cfg["input_selector"])
        focus = """(() => { const el = window.__piBridge.findInput(%s); if (!el) return false;
            el.scrollIntoView({block: 'center'}); el.focus(); return true; })()""" % sel
        if not self.js(focus):
            raise BridgeError("Copilot 입력창을 찾지 못했습니다")
        want = len(re.sub(r"\s+", "", text))
        got = 0
        # 넣기: 붙여넣기 이벤트 (여러 줄·코드 블록이 그대로 들어감. 한 글자씩 치면 줄바꿈이 '보내기'로 처리됨)
        # 긴 글은 편집기가 처리하는 데 시간이 걸리므로 다 찰 때까지 기다리고, 덜 들어가면 지우고 한 번 더
        for attempt in (1, 2):
            self.clear_input(sel)
            self.js("""(() => { const el = window.__piBridge.findInput(%s); el.focus();
                const dt = new DataTransfer(); dt.setData('text/plain', %s);
                el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true})); })()""" % (
                sel, self.q(text)))
            got = self.wait_filled(sel, want)
            if got >= want * 0.9:
                break
            log("  (붙여넣기가 덜 들어감 {}/{}자 -> {})".format(got, want, "다시 붙여넣기" if attempt == 1 else "줄 단위 입력"))
        if got < want * 0.9:  # 붙여넣기를 처리하지 않는 입력창: 줄 단위 입력 + Shift+Enter
            self.clear_input(sel)
            for i, line in enumerate(text.split("\n")):
                if i:
                    self.key("Enter", "Enter", 13, modifiers=8)
                if line:
                    self.tab.call("Input.insertText", {"text": line}, timeout=60)
            got = self.wait_filled(sel, want)
        if got < want * 0.9:
            self.clear_input(sel)
            raise BridgeError("입력창에 글자가 다 들어가지 않았습니다 ({}/{}자). Copilot 의 글자 수 제한일 수 있으니 "
                              "중계 서버의 --max-chars 를 줄이세요.".format(got, len(text)))
        if self.cfg["send_button_selector"]:
            self.click_send(self.cfg["send_button_selector"])
        else:
            for t in ("keyDown", "keyUp"):
                p = {"type": t, "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13, "nativeVirtualKeyCode": 13}
                if t == "keyDown":
                    p.update(text="\r", unmodifiedText="\r")
                self.tab.call("Input.dispatchKeyEvent", p)
        # 입력창이 비면 전송된 것. 안 비면 보내기 버튼을 눌러 본다
        for i in range(20):
            time.sleep(0.5)
            self.tick()
            left = self.input_len(sel)
            if left < 5:
                return
            if i == 6:
                self.click_send(None)
        raise BridgeError("메시지가 전송되지 않았습니다 (입력창이 비워지지 않음). send_button_selector 설정을 확인하세요.")

    def click_send(self, selector):
        self.js("""(() => { const B = window.__piBridge; const input = B.findInput(%s);
            const b = %s ? document.querySelector(%s) : B.nearest(B.buttons(%s), input);
            if (b) b.click(); return !!b; })()""" % (self.q(self.cfg["input_selector"]), self.q(bool(selector)),
                                                    self.q(selector or ""), self.q(self.cfg["send_button_pattern"])))

    def wait_reply(self, marker):
        """답 받기. 1순위: Copilot WebSocket 의 최종 답(원문 markdown).
        2순위(화면): 질문(marker 가 붙은 메시지) 아래에서 늘어나는 영역을 답으로 보고, 멈추면 읽는다"""
        cfg = self.cfg
        sel_in, sel_reply = self.q(cfg["input_selector"]), self.q(cfg["reply_selector"])
        noise = self.q(", ".join(cfg.get("ui_noise_selectors") or []))
        probe = """(() => { const B = window.__piBridge; const input = B.findInput(%s);
            const mk = B.findMarker(%s); if (!mk) return null;
            let levels;
            if (%s) { const els = B.replyEls(%s, 0, %s, input); levels = [B.textOf(els || [], %s).length]; }
            else levels = B.chain(mk, 16).map(a => B.textOf(B.following(a, input), %s).length);
            const stop = B.buttons(%s).length > 0;
            const tail = document.body.innerText.slice(-4000);
            return {levels, stop, limit: new RegExp(%s, 'i').test(tail), url: location.origin + location.pathname}; })()""" % (
            sel_in, self.q(marker), self.q(bool(cfg["reply_selector"])), self.q(marker), sel_reply, noise, noise,
            self.q(cfg["stop_button_pattern"]), self.q(cfg["thread_limit_pattern"]))
        start = time.time()
        base, level, last_len, last_change, limit_seen, base_limit = None, None, None, time.time(), False, None
        while True:
            now = time.time()
            if now - start > cfg["reply_timeout_seconds"]:
                raise BridgeError("Copilot 답이 끝나지 않았습니다 ({}초)".format(cfg["reply_timeout_seconds"]))
            self.tick()
            got = self.stream_reply(marker)
            if got:
                return self.use_stream_reply(got)
            st = self.js(probe)
            if st is None:
                if now - start > 30:
                    raise BridgeError("보낸 메시지를 화면에서 찾지 못했습니다 (marker {})".format(marker))
                time.sleep(0.5)
                continue
            levels = st["levels"]
            if base_limit is None:
                base_limit = st["limit"]
            limit_new = st["limit"] and not base_limit  # 보내기 전부터 있던 문구는 무시
            if base is None:
                base = levels
            if level is None:
                if cfg["reply_selector"]:
                    level = 0 if levels and levels[0] > 0 else None
                else:
                    for i, n in enumerate(levels):
                        if i < len(base) and n - base[i] > 8:
                            level = i
                            break
                if level is None:
                    if limit_new and now - start > 10:
                        raise ThreadReset("Copilot 대화 한도에 도달")
                    if now - start > cfg["first_reply_timeout_seconds"]:
                        raise BridgeError("Copilot 답이 시작되지 않았습니다 ({}초)".format(cfg["first_reply_timeout_seconds"]))
                    time.sleep(0.5)
                    continue
                last_len, last_change = levels[level], now
                self.last_level = level
            cur = levels[level] if level < len(levels) else 0
            if cur != last_len:
                last_len, last_change = cur, now
            limit_seen = limit_new
            if not st["stop"] and now - last_change >= cfg["stable_seconds"]:
                break
            time.sleep(0.5)
        if self.stream_ok:  # 화면은 끝났는데 WebSocket 최종 답이 아직이면 조금 더 기다린다
            deadline = time.time() + cfg.get("stream_wait_after_dom_seconds", 15)
            while time.time() < deadline:
                self.js("1")  # 이벤트 수거
                got = self.stream_reply(marker)
                if got:
                    return self.use_stream_reply(got)
                time.sleep(0.5)
            log("  (WebSocket 답을 못 찾아 화면에서 읽습니다)")
        reply = self.js("""(async () => { const B = window.__piBridge; const input = B.findInput(%s);
            const els = B.replyEls(%s, %d, %s, input) || [];
            const text = B.textOf(els, %s); const code_blocks = await B.codeBlocks(els);
            let rest = text; for (const c of code_blocks) rest = rest.replace(c.text.trim(), '');
            return {text, code_blocks, text_without_code: rest.trim(), url: location.origin + location.pathname,
                    source: 'dom'}; })()""" % (sel_in, self.q(marker), level, sel_reply, noise), timeout=60)
        if (len(reply.get("text", "")) < 400 and not reply.get("code_blocks")
                and re.search(cfg["throttle_pattern"], reply.get("text", ""), re.I)):
            raise Throttled(reply.get("text", "").strip()[:150])
        if limit_seen and len(reply.get("text", "")) < 400 and not reply.get("code_blocks"):
            raise ThreadReset("Copilot 대화 한도에 도달")
        self.thread_url = reply.get("url")
        for k in ("text", "text_without_code"):
            reply[k] = unmangle_copilot_text(strip_ui_noise(reply.get(k), cfg["ui_noise_words"]))
        for c in reply.get("code_blocks") or []:
            c["text"] = unmangle_copilot_text(c.get("text"))
        return reply

    def check_same_thread(self):
        if self.thread_url:
            url = self.js("location.origin + location.pathname")
            if url != self.thread_url:
                raise ThreadReset("Copilot 대화창이 바뀌었습니다 ({} -> {})".format(self.thread_url, url))


def load_config(path):
    cfg = dict(DEFAULT_CONFIG)
    if path and os.path.exists(path):
        with open(path, encoding="utf-8-sig") as f:
            cfg.update({k: v for k, v in json.load(f).items() if not k.startswith("_")})
    return cfg
