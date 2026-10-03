#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""브라우저 조작 모듈 (Windows PC, Python 3.8+ 표준 라이브러리만 사용) - relay.py 가 불러서 쓴다

브라우저(Chrome 또는 Edge 전용 창)를 원격 디버깅(CDP)으로 제어한다.
 - Copilot 탭: 질문을 입력하고, 답이 끝날 때까지 기다린 뒤 답을 읽는다 (같은 대화창에 이어서).
 - JupyterLab 탭 조작은 jupyter.py 에 있다.
먼저 브라우저를 원격 디버깅 포트와 함께 실행해야 한다 (start-chrome.cmd 또는 start-edge.cmd).
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
    "browser": "chrome",  # 전용 창 브라우저: chrome 또는 edge (bin/pi 가 꺼져 있으면 start-<browser>.cmd 로 띄움)
    "auto_start_browser": True,
    "jupyter_url": "",  # 전용 창을 띄울 때 함께 열 JupyterLab 주소
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
    "first_reply_timeout_seconds": 300,
    "reply_timeout_seconds": 900,
    "max_questions_per_chat": 100,  # 이 수만큼 질문하면 새 대화로 (긴 대화에서 Copilot 이 규칙을 놓치므로). 0 이면 Copilot 한도까지
    "max_questions_per_minute": 0,  # 0 이면 끔. Copilot 사용량 제한을 피하려면 분당 질문 수 상한을 넣음
    # 메시지 크기: Copilot 메시지 하나의 최대 글자 수(넘으면 나눠 보내고, 조각마다 왕복 한 번), 도구 결과 하나의 최대 글자 수,
    #  새 대화를 열 때 다시 넣는 기록 (최근 것은 그대로 resend_recent_chars, 그 앞은 한 줄 요약 resend_summary_chars)
    "max_chars": 10000,
    "tool_result_chars": 6000,
    "resend_recent_chars": 20000,
    "resend_summary_chars": 40000,
    "multi_read": False,  # True 면 Copilot 이 파일 읽기(read) 블록을 여러 개 한 번에 줄 수 있음 (왕복 횟수 줄이기)
    "max_tabs": 1,  # 2 이상이면 pi 를 여러 개 동시에 쓸 때 세션마다 Copilot 창을 따로 씀 (최대 그 수만큼 창을 엶)
    # 모델 선택: Copilot 은 새 채팅마다 '자동' 으로 돌아가므로 중계 서버가 화면의 모델 메뉴에서 고른다
    "copilot_model": "",  # pi 모델 id 'copilot' 일 때 고를 화면 이름 (예: "GPT 6.0 Sol"). 비우면 화면 그대로
    "copilot_models": {},  # pi 모델 id -> 화면 이름. 표에 없는 id 는 id 자체를 화면 이름으로 씀
    "model_button_selector": "",  # 모델 메뉴 버튼 (비우면 자동: 메뉴가 달린 버튼 중 이름이 아래 이름으로 시작하는 것)
    "model_button_names": ["자동", "빠른 응답", "깊이 생각하기", "Auto", "Quick response", "Think deeper", "GPT", "Claude"],
    # 끝난 대화 삭제: 중계 서버가 만든 대화(copilot-chats.json 에 기록)만 왼쪽 목록에서 '… > 삭제 > 확인' 으로 지운다
    "delete_finished_chats": True,
    "chat_item_selector": "",  # 왼쪽 채팅 목록 항목 (비우면 자동: 대화 주소로 가는 링크)
    "chat_more_pattern": "옵션|자세히|더 보기|추가 작업|기타|more|options|actions|…|\\.\\.\\.",
    "delete_menu_pattern": "^(삭제|delete)$",
    "delete_confirm_pattern": "^(삭제|delete)$",
    "sidebar_pattern": "사이드바|탐색 창|navigation pane|sidebar|side ?panel",
}


def sq(s):
    """이름 비교용: 소문자 + 글자·숫자만 ('GPT-6.0 Sol ⌄' == 'gpt 6.0 sol'). 버튼의 화살표 같은 기호는 무시"""
    return re.sub(r"[\W_]+", "", (s or "").lower())


def conversation_id(url):
    """Copilot 대화 주소의 대화 id (https://m365.cloud.microsoft/chat/conversation/<id>)"""
    m = re.search(r"/conversation/([^/?#]+)", url or "")
    return m.group(1) if m else None


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


def open_window(port, url, timeout=20):
    """전용 브라우저에 새 창(탭 하나)을 열고 그 탭 정보를 돌려준다 (pi 여러 개 동시 실행: 세션마다 Copilot 창 하나)
    새 창은 뒤에서 열려 지금 보는 창을 가리지 않는다"""
    try:
        with urllib.request.urlopen("http://127.0.0.1:{}/json/version".format(port), timeout=5) as r:
            ws_url = json.load(r)["webSocketDebuggerUrl"]
    except (OSError, ValueError, KeyError) as e:
        raise BridgeError("브라우저에 연결할 수 없습니다: {}".format(e))
    deadline = time.time() + timeout
    ws = WebSocket(ws_url)
    try:
        ws.send(json.dumps({"id": 1, "method": "Target.createTarget",
                            "params": {"url": url, "newWindow": True, "background": True}}))
        tid = None
        while tid is None:
            if time.time() > deadline:
                raise BridgeError("새 창을 여는 데 응답이 없습니다")
            try:
                msg = json.loads(ws.recv(deadline - time.time()))
            except socket.timeout:
                continue
            if msg.get("id") == 1:
                if "error" in msg:
                    raise BridgeError("새 창 열기 실패: {}".format(msg["error"].get("message")))
                tid = msg["result"]["targetId"]
    finally:
        ws.close()
    while time.time() < deadline:
        for t in list_tabs(port):
            if t.get("id") == tid:
                return t
        time.sleep(0.5)
    raise BridgeError("새 창의 탭을 찾지 못했습니다")


def list_tabs(port):
    try:
        with urllib.request.urlopen("http://127.0.0.1:{}/json/list".format(port), timeout=5) as r:
            return [t for t in json.load(r) if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
    except OSError as e:
        raise BridgeError("브라우저 원격 디버깅 포트({})에 연결할 수 없습니다. start-chrome.cmd(또는 start-edge.cmd)로 전용 창을 띄웠는지 "
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

# 모델 메뉴·채팅 목록 메뉴·확인 창 찾기 (PAGE_LIB 다음에 불러옴). 클릭은 파이썬에서 실제 마우스 동작(CDP Input)으로 한다
UI_LIB = r"""
(() => {
  const V = 2;
  if (window.__piUI && window.__piUI.v === V) return true;
  const B = window.__piBridge;
  const sq = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');  // 글자·숫자만 (파이썬 sq 와 같게)
  const lines = (el) => (el.innerText || el.textContent || '').split('\n').map(s => s.trim()).filter(Boolean);
  const title = (el) => lines(el)[0] || (el.getAttribute('aria-label') || '').trim();
  const box = (el) => { el.scrollIntoView({block: 'nearest', inline: 'nearest'}); const r = el.getBoundingClientRect();
    return {x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height)}; };
  const snip = (el) => el ? el.outerHTML.replace(/\s+/g, ' ').slice(0, 260) : '';
  const MENU = '[role="menu"], [role="listbox"]';
  const ITEM = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"]';
  const popup = (el) => { const h = el.getAttribute('aria-haspopup'); return !!h && h !== 'false'; };
  const allMenus = () => [...document.querySelectorAll(MENU)].filter(B.visible);
  // 메뉴를 열기 전에 이미 보이던 목록(채팅 목록이 listbox 일 수 있음)은 표시해 두고, 새로 뜬 메뉴만 본다
  function markMenus() { allMenus().forEach(m => m.setAttribute('data-pi-old', '1')); return true; }
  const fresh = () => allMenus().filter(m => !m.hasAttribute('data-pi-old'));
  function menuItems(level) {
    const ms = fresh(); const m = level < 0 ? ms[ms.length - 1] : ms[level];
    if (!m) return null;
    const its = [...m.querySelectorAll(ITEM)].filter(it => B.visible(it) && it.closest(MENU) === m);
    return its.length ? its.map(it => ({title: title(it), text: lines(it).join(' / ').slice(0, 80),
      sub: popup(it) || it.hasAttribute('aria-expanded'), checked: it.getAttribute('aria-checked') === 'true', rect: box(it)})) : null;
  }
  const inChatList = (el) => !!el.closest('a[href*="/conversation/"]');
  function modelButton(sel, names) {
    if (sel) { const el = document.querySelector(sel); return el && B.visible(el) ? el : null; }
    const ns = names.map(sq).filter(Boolean);
    const hit = (b) => { const t = sq(title(b)); return !!t && t.length <= 40 && ns.some(n => t === n || t.startsWith(n)); };
    const all = [...document.querySelectorAll('button, [role="button"], [role="combobox"]')]
      .filter(b => B.visible(b) && !b.closest(MENU) && !b.closest('[role="dialog"], [role="alertdialog"]') && !inChatList(b) && hit(b));
    const top = (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top;
    return all.filter(popup).sort(top)[0] || all.sort(top)[0] || null;
  }
  function modelState(sel, names) {
    const b = modelButton(sel, names);
    return b ? {found: true, text: title(b), rect: box(b), html: snip(b)} : {found: false};
  }
  function dialogState(pattern) {
    const d = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(B.visible).pop();
    if (!d) return null;
    const re = new RegExp(pattern, 'i');
    const btns = [...d.querySelectorAll('button, [role="button"]')].filter(B.visible);
    const ok = btns.find(b => re.test(title(b)) || re.test((b.getAttribute('aria-label') || '').trim()));
    return {text: lines(d).join(' ').slice(0, 400), buttons: btns.map(title), confirm: ok ? box(ok) : null, html: snip(d)};
  }
  function chatItem(id, morePattern, itemSel) {
    let links = [...document.querySelectorAll('a[href*="' + id + '"]')];
    if (!links.length && itemSel) links = [...document.querySelectorAll(itemSel)].filter(e => e.outerHTML.includes(id));
    const vis = links.filter(B.visible);
    if (!vis.length) return {found: false, exists: links.length > 0};
    const a = vis[0];
    const re = new RegExp(morePattern, 'i');
    const isMore = (b) => b !== a && B.visible(b) && !/고정|pin/i.test(B.label(b)) && (popup(b) || re.test(B.label(b)));
    let boxEl = a, more = null;
    for (let el = a, i = 0; el && el !== document.body && i < 5; el = el.parentElement, i++) {
      if (el.querySelectorAll('a[href*="/conversation/"]').length > 1) break;  // 다른 대화까지 품은 목록으로는 올라가지 않음
      boxEl = el;
      more = [...el.querySelectorAll('button, [role="button"]')].find(isMore) || null;
      if (more) break;
    }
    return {found: true, title: title(a) || title(boxEl), rect: box(boxEl),
            more: more ? {rect: box(more), label: B.label(more)} : null, html: snip(boxEl)};
  }
  function chatList(limit) {
    return [...document.querySelectorAll('a[href*="/conversation/"]')].filter(B.visible).slice(0, limit)
      .map(a => ({title: title(a), href: a.getAttribute('href'), html: snip(a)}));
  }
  function sidebarToggle(pattern) {
    const re = new RegExp(pattern, 'i');
    const b = [...document.querySelectorAll('button, [role="button"]')].find(b => B.visible(b) && re.test(B.label(b)));
    return b ? {rect: box(b), label: B.label(b)} : null;
  }
  // 메뉴·확인 창에 role 표시가 없는 화면 대비: 누르기 전에 보이던 요소를 기억해 두고(DOM 은 건드리지 않음),
  // 누른 뒤 새로 나타난 요소 중에서 이름으로 찾는다
  function markSeen() { window.__piSeen = new WeakSet([...document.querySelectorAll('body *')].filter(B.visible)); return true; }
  const newOnes = () => { const s = window.__piSeen || new WeakSet();
    return [...document.querySelectorAll('body *')].filter(e => !s.has(e) && B.visible(e)); };
  function newHits(pattern) {
    const re = new RegExp(pattern, 'i');
    const own = (e) => [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join('').trim();
    const hits = newOnes().filter(e => re.test(own(e)) || re.test(title(e)) || re.test((e.getAttribute('aria-label') || '').trim()));
    return hits.filter(e => !hits.some(o => o !== e && e.contains(o)));  // 가장 안쪽 요소
  }
  function newMatch(pattern) {
    const e = newHits(pattern)[0];
    return e ? {title: title(e), rect: box(e), html: snip(e)} : null;
  }
  // 확인 버튼 + 둘레의 글: 버튼에서 위로 올라가며 hint(대화 제목, 비교용 글자)를 품은 곳의 글을 함께 돌려줌.
  // 확인 창은 글이 짧으므로, 글이 긴 영역(왼쪽 대화 목록까지 품은 화면 전체 등)이나 대화창 경계에 닿으면 멈춘다
  function newConfirm(pattern, hint) {
    const b = newHits(pattern)[0];
    if (!b) return null;
    let text = '';
    for (let el = b.parentElement, i = 0; el && el !== document.body && i < 10; el = el.parentElement, i++) {
      const t = el.innerText || '';
      if (t.length > 800) break;
      if (hint && sq(t).includes(hint)) { text = t; break; }
      if (el.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) break;
    }
    return {title: title(b), rect: box(b), text: text.replace(/\s+/g, ' ').slice(0, 400), html: snip(b)};
  }
  function newSummary(limit) {
    const seen = new Set(), out = [];
    for (const e of newOnes()) {
      const t = title(e).slice(0, 30);
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push((e.getAttribute('role') || e.tagName.toLowerCase()) + ':' + t);
      if (out.length >= limit) break;
    }
    return out;
  }
  window.__piUI = {v: V, markMenus, menus: () => fresh().length, menuItems, modelState, dialogState, chatItem, chatList, sidebarToggle,
                   markSeen, newMatch, newConfirm, newSummary};
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

    def probe_input_limit(self, sizes=(10000, 16000, 24000, 32000, 48000, 64000)):
        """입력창이 한 번에 받는 글자 수 확인 (보내지 않음). 크기마다 붙여 넣어 보고 들어간 글자 수, 보내기 버튼 상태,
        화면의 'n / m' 글자 수 표시를 읽은 뒤 지운다. 다 들어가지 않거나 보내기 버튼이 꺼지면 거기서 멈춘다.
        끝나면 새 대화 화면으로 바꿔 입력창을 처음 상태로 돌린다 (긴 글을 첨부 파일로 바꾸는 화면 대비).
        돌려주는 값: [{"size", "accepted"(들어간 글자 수 어림), "full", "send"(True/False/None=못 찾음), "counter"}]"""
        self.wait_input(30)
        sel = self.q(self.cfg["input_selector"])
        line = "pi 입력 한도 확인 0123456789 abcdefghij ABCDEFGHIJ\n"
        out = []
        try:
            for size in sizes:
                text = (line * (size // len(line) + 1))[:size]
                want = len(re.sub(r"\s+", "", text))
                self.clear_input(sel)
                self.js("""(() => { const el = window.__piBridge.findInput(%s); el.focus();
                    const dt = new DataTransfer(); dt.setData('text/plain', %s);
                    el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true})); })()""" % (
                    sel, self.q(text)))
                got = self.wait_stable(sel, want)
                info = self.js("""(() => { const B = window.__piBridge; const inp = B.findInput(%s);
                    const custom = %s; const re = new RegExp(%s, 'i');
                    const all = custom ? [document.querySelector(custom)].filter(Boolean)
                        : [...document.querySelectorAll('button, [role="button"]')].filter(b => B.visible(b) && re.test(B.label(b)));
                    const b = B.nearest(all, inp);
                    const send = b ? !(b.disabled || b.getAttribute('aria-disabled') === 'true') : null;
                    let counter = null, el = inp;
                    for (let i = 0; i < 4 && el && !counter; i++) {
                        el = el.parentElement; if (!el) break;
                        const m = [...el.querySelectorAll('*')].filter(e => !e.children.length && !e.closest('[contenteditable], textarea'))
                            .map(e => (e.textContent || '').trim()).find(t => /^\\d[\\d,]*\\s*\\/\\s*\\d[\\d,]*$/.test(t));
                        if (m) counter = m;
                    }
                    return {send, counter}; })()""" % (sel, self.q(self.cfg["send_button_selector"]), self.q(self.cfg["send_button_pattern"])))
                full = got >= want * 0.99
                out.append({"size": size, "accepted": int(size * got / want) if want else 0, "full": full,
                            "send": info.get("send"), "counter": info.get("counter")})
                if not full or info.get("send") is False:
                    break
        finally:
            try:
                self.clear_input(sel)
            finally:
                self.new_chat()
        return out

    def wait_stable(self, sel, want, timeout=20.0):
        """입력창 글자 수가 want 에 닿거나 2초 동안 그대로이거나 timeout 이 될 때까지 기다린다"""
        deadline, last, last_change = time.time() + timeout, -1, time.time()
        while True:
            time.sleep(0.4)
            got = self.input_len(sel)
            if got >= want:
                return got
            if got != last:
                last, last_change = got, time.time()
            elif time.time() - last_change >= 2.0 or time.time() >= deadline:
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
                              "내 설정 파일의 max_chars 를 줄이세요 (확인: diag.py --input-limit).".format(got, len(text)))
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

    def marker_url(self, marker):
        """보낸 메시지(marker)가 지금 화면에 있으면 화면의 대화 주소, 없으면 None (둘을 한 번에 읽음)
        답을 기다리는 동안 사용자가 전용 창에서 자기 대화를 눌렀으면 None -> 그 대화를 중계 서버가 만든 대화로 기록하지 않게"""
        return self.js("window.__piBridge.findMarker(%s) ? location.origin + location.pathname : null" % self.q(marker))

    # ---- 화면 조작: 모델 선택, 끝난 대화 삭제 (메뉴는 실제 마우스 동작으로 연다) ----

    def ui(self, expr, timeout=30):
        self.tab.eval(PAGE_LIB, timeout)
        self.tab.eval(UI_LIB, timeout)
        return self.tab.eval(expr, timeout)

    def mouse(self, rect, kind="click"):
        """move(올려 두기) / click(왼쪽 클릭) / right(오른쪽 클릭). rect 는 화면 좌표 {x, y}"""
        x, y = rect["x"], rect["y"]
        self.tab.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y, "button": "none", "buttons": 0})
        if kind == "move":
            return
        btn, mask = ("right", 2) if kind == "right" else ("left", 1)
        for t, b in (("mousePressed", mask), ("mouseReleased", 0)):
            self.tab.call("Input.dispatchMouseEvent", {"type": t, "x": x, "y": y, "button": btn, "buttons": b, "clickCount": 1})

    def escape(self):
        self.key("Escape", "Escape", 27)

    @staticmethod
    def poll(fn, timeout=3.0, every=0.15):
        """fn() 이 참이 될 때까지 기다린다 (마지막 값을 돌려줌)"""
        deadline = time.time() + timeout
        while True:
            v = fn()
            if v or time.time() >= deadline:
                return v
            time.sleep(every)

    def model_names(self, extra=()):
        names = list(self.cfg.get("model_button_names") or [])
        names += [v for v in (self.cfg.get("copilot_models") or {}).values() if v]
        return names + [n for n in [self.cfg.get("copilot_model")] + list(extra) if n]

    def model_state(self, label=""):
        return self.ui("window.__piUI.modelState(%s, %s)" % (self.q(self.cfg.get("model_button_selector") or ""),
                                                                self.q(self.model_names([label]))))

    @staticmethod
    def pick(items, label):
        """메뉴 항목에서 label 찾기: 이름(첫 줄)이 같은 것 우선, 없으면 label 을 포함하는 항목이 하나뿐일 때만"""
        want = sq(label)
        same = [i for i in items if sq(i["title"]) == want]
        if same:
            return same[0]
        part = [i for i in items if want and want in sq(i["text"])]
        return part[0] if len(part) == 1 else None

    def open_menu(self, rect):
        self.ui("window.__piUI.markMenus()")
        self.mouse(rect)
        return self.poll(lambda: self.ui("window.__piUI.menuItems(0)"), 3)

    def open_submenu(self, item, prev=None):
        """하위 메뉴(예: GPT ›) 열기: 마우스를 올리고, 안 열리면 클릭. prev 는 직전에 열었던 하위 메뉴의 항목 이름들"""
        def get():
            subs = self.ui("window.__piUI.menus() > 1 && window.__piUI.menuItems(-1)")
            return subs if subs and [s["title"] for s in subs] != prev else None
        self.mouse(item["rect"], "move")
        subs = self.poll(get, 1.5)
        if not subs:
            self.mouse(item["rect"])
            subs = self.poll(get, 1.5)
        return subs or None

    def close_menus(self):
        for _ in range(3):
            if not self.ui("window.__piUI.menus()"):
                return
            self.escape()
            time.sleep(0.2)

    def model_menu(self):
        """진단용: 모델 메뉴 항목 목록 (하위 메뉴 포함). 메뉴는 닫고 끝낸다"""
        st = self.model_state()
        if not st.get("found"):
            return st, None
        tree, prev = [], None
        for it in self.open_menu(st["rect"]) or []:
            entry = {"title": it["title"], "text": it["text"], "checked": it["checked"], "sub": None}
            if it["sub"]:
                subs = self.open_submenu(it, prev) or []
                prev = [s["title"] for s in subs] or prev
                entry["sub"] = [s["title"] for s in subs]
            tree.append(entry)
        self.close_menus()
        return st, tree

    def select_model(self, label):
        """모델 메뉴에서 label(화면에 보이는 이름)을 고른다 -> (성공 여부, 설명)
        맨 위 항목(자동·빠른 응답·깊이 생각하기 등)에서 찾고, 없으면 하위 메뉴(GPT ›, Claude › 등)를 차례로 열어 찾는다"""
        st = self.model_state(label)
        if not st.get("found"):
            return False, "모델 메뉴 버튼을 찾지 못했습니다 (bridge.json 의 model_button_selector 확인)"
        if sq(st["text"]) == sq(label):
            return True, "이미 '{}'".format(st["text"])
        items = self.open_menu(st["rect"])
        if not items:
            return False, "모델 메뉴가 열리지 않았습니다 (버튼: {})".format(st["text"])
        seen, hit, prev = [i["title"] for i in items], self.pick(items, label), None
        if not hit:
            for it in [i for i in items if i["sub"]]:
                subs = self.open_submenu(it, prev)
                if not subs:
                    continue
                prev = [s["title"] for s in subs]
                seen += ["{} › {}".format(it["title"], t) for t in prev]
                hit = self.pick(subs, label)
                if hit:
                    break
        if not hit:
            self.close_menus()
            return False, "메뉴에서 '{}' 을(를) 찾지 못했습니다. 있는 항목: {}".format(label, ", ".join(seen))
        self.mouse(hit["rect"])
        time.sleep(0.6)
        self.close_menus()
        now = self.model_state(label)
        return True, "'{}' 선택 (버튼 표시: {})".format(hit["title"], now.get("text") if now.get("found") else "?")

    def find_chat(self, conv_id):
        return self.ui("window.__piUI.chatItem(%s, %s, %s)" % (self.q(conv_id), self.q(self.cfg["chat_more_pattern"]),
                                                              self.q(self.cfg.get("chat_item_selector") or "")))

    def chat_list(self, limit=10):
        return self.ui("window.__piUI.chatList(%d)" % limit)

    def delete_chat(self, conv_id):
        """왼쪽 채팅 목록에서 conv_id 대화를 '… > 삭제 > 확인' 으로 지운다 -> (성공 여부, 설명)
        안전장치: 확인 창 문구에 그 대화의 제목이 있을 때만 마지막 '삭제' 를 누른다"""
        def found():
            r = self.find_chat(conv_id)
            return r if r.get("found") else None
        it = self.find_chat(conv_id)
        widened = False
        try:
            if not it.get("found"):
                # 창이 좁으면 왼쪽 목록이 접힘 -> 화면을 넓게 그리게 하고, 그래도 없으면 사이드바 열기 버튼
                self.tab.call("Emulation.setDeviceMetricsOverride", {"width": 1400, "height": 900, "deviceScaleFactor": 0,
                                                                     "mobile": False})
                widened = True
                it = self.poll(found, 3) or it
            if not it.get("found"):
                tog = self.ui("window.__piUI.sidebarToggle(%s)" % self.q(self.cfg["sidebar_pattern"]))
                if tog:
                    self.mouse(tog["rect"])
                    it = self.poll(found, 3) or it
            if not it.get("found"):
                return False, "왼쪽 채팅 목록에서 대화를 찾지 못했습니다{}".format(
                    " (목록에 있지만 화면에 안 보임)" if it.get("exists") else "")
            title = it.get("title") or ""
            if not sq(title):
                return False, "대화 제목을 읽지 못해서 지우지 않았습니다"
            self.mouse(it["rect"], "move")  # 마우스를 올려야 '…' 버튼이 나타나는 목록
            time.sleep(0.4)
            it = found() or it
            # 메뉴·확인 창에 role 표시가 없는 화면도 있으므로, 누르기 전에 보이던 요소를 기억해 두고 새로 나타난 것에서도 찾는다
            self.ui("window.__piUI.markMenus() && window.__piUI.markSeen()")
            how = "'…' 버튼({})".format(it["more"]["label"]) if it.get("more") else "오른쪽 클릭"
            self.mouse(it["more"]["rect"] if it.get("more") else it["rect"], "click" if it.get("more") else "right")
            del_pat, ok_pat = self.cfg["delete_menu_pattern"], self.cfg["delete_confirm_pattern"]

            def find_delete():
                items = self.ui("window.__piUI.menuItems(0)")
                if items:  # 일반 메뉴 (role=menu)
                    hit = next((i for i in items if re.search(del_pat, i["title"], re.I)), None)
                    return dict(hit, path="메뉴") if hit else {"missing": [i["title"] for i in items]}
                m = self.ui("window.__piUI.newMatch(%s)" % self.q(del_pat))  # role 없는 메뉴: 새로 나타난 '삭제'
                return dict(m, path="새 요소") if m else None

            hit = self.poll(find_delete, 4)
            if not hit or "missing" in hit:
                listed = hit["missing"] if hit else self.ui("window.__piUI.newSummary(12)")
                self.close_menus()
                self.escape()
                return False, "대화 메뉴에서 삭제를 찾지 못했습니다 ({}). 새로 나타난 항목: {}".format(how, ", ".join(listed) or "없음")
            hint = sq(title)[:12]  # 확인 창에 이 대화의 제목이 있어야만 지운다
            self.ui("window.__piUI.markSeen()")
            self.mouse(hit["rect"])

            def find_confirm():
                d = self.ui("window.__piUI.dialogState(%s)" % self.q(ok_pat))
                if d and d.get("confirm") and hint in sq(d["text"]):
                    return {"rect": d["confirm"], "text": d["text"], "path": "확인 창"}
                c = self.ui("window.__piUI.newConfirm(%s, %s)" % (self.q(ok_pat), self.q(hint)))
                return dict(c, path="새 요소") if c else None

            dlg = self.poll(find_confirm, 4)
            if not dlg:
                listed = self.ui("window.__piUI.newSummary(12)")
                self.escape()
                return False, "삭제 확인 창의 삭제 버튼을 찾지 못했습니다. 새로 나타난 항목: {}".format(", ".join(listed) or "없음")
            if hint not in sq(dlg.get("text")):
                self.escape()
                return False, "확인 창에서 이 대화의 제목을 확인하지 못해 취소했습니다 (목록: {} / 확인 창: {})".format(
                    title, (dlg.get("text") or "")[:80])
            self.mouse(dlg["rect"])
            if self.poll(lambda: not self.find_chat(conv_id).get("found"), 6):
                return True, "'{}' 삭제 ({} > 삭제[{}] > 확인[{}])".format(title, how, hit["path"], dlg["path"])
            return False, "삭제를 눌렀지만 목록에 남아 있습니다: {}".format(title)
        finally:
            if widened:
                try:
                    self.tab.call("Emulation.clearDeviceMetricsOverride")
                except (BridgeError, TimeoutError):
                    pass


class ConfigError(Exception):
    """설정 파일(JSON) 형식 오류"""


def agent_dir():
    return os.environ.get("PI_CODING_AGENT_DIR") or os.path.join(os.path.expanduser("~"), ".pi", "agent")


def user_config_path():
    """내 설정 파일: 저장소의 bridge.json 위에 덮어쓰는 값만 적는다. 업데이트로 저장소 폴더를 바꿔도 남는다"""
    return os.environ.get("PI_COPILOT_USER_CONFIG") or os.path.join(agent_dir(), "bridge.json")


def read_config_file(path):
    """JSON 설정 파일 -> dict ('_' 로 시작하는 키는 설명용이라 뺌). 파일이 없으면 None, 형식이 틀리면 ConfigError"""
    try:
        with open(path, encoding="utf-8-sig") as f:
            text = f.read()
    except FileNotFoundError:
        return None
    except UnicodeDecodeError:  # 메모장 등에서 ANSI(cp949)로 저장한 경우 (OSError 가 아니므로 따로)
        raise ConfigError("{} 를 UTF-8 로 읽을 수 없습니다 (ANSI 등 다른 인코딩으로 저장된 것 같습니다). "
                          "메모장의 '다른 이름으로 저장'에서 인코딩을 UTF-8 로 골라 저장해 주세요".format(path))
    except OSError as e:
        raise ConfigError("{} 를 읽을 수 없습니다: {}".format(path, e))
    try:
        data = json.loads(text) if text.strip() else {}
    except ValueError as e:
        where = " (줄 {}, 칸 {})".format(e.lineno, e.colno) if hasattr(e, "lineno") else ""
        hint = ". Windows 경로의 \\ 는 / 로 쓰세요 (예: C:/Users/...)" if "escape" in str(e).lower() else ""
        raise ConfigError("{} 의 JSON 형식 오류{}: {}{}".format(path, where, getattr(e, "msg", e), hint))
    if not isinstance(data, dict):
        raise ConfigError("{} 는 {{ ... }} 형식의 JSON 이어야 합니다".format(path))
    return {k: v for k, v in data.items() if not str(k).startswith("_")}


_USER = object()  # load_config 의 user_path 기본값 = user_config_path()


def load_config(path, user_path=_USER):
    """기본값 <- 저장소의 bridge.json(path) <- 내 설정 파일(user_path, 기본 ~/.pi/agent/bridge.json) 순서로 덮어쓴다
    표(dict) 값은 항목별로 합친다 (예: copilot_models 에 모델 하나만 추가). 형식이 틀리면 ConfigError.
    cfg["_user"] = {"path": 내 설정 파일, "keys": 덮어쓴 항목}"""
    cfg = dict(DEFAULT_CONFIG)
    cfg.update((read_config_file(path) or {}) if path else {})
    if user_path is _USER:
        user_path = user_config_path()
    user = (read_config_file(user_path) or {}) if user_path else {}
    for k, v in user.items():
        cfg[k] = dict(cfg[k], **v) if isinstance(cfg.get(k), dict) and isinstance(v, dict) else v
    cfg["_user"] = {"path": user_path, "keys": sorted(user)}
    return cfg


def main_print_shell(path):
    """bin/pi 용: 실행기가 쓰는 값을 key=value 줄로 (설정 형식이 틀리면 오류를 알리고 2 로 끝냄)"""
    for s in (sys.stdout, sys.stderr):  # Git Bash 창(UTF-8)에서 한글이 깨지지 않게
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except AttributeError:
            pass
    try:
        cfg = load_config(path)
    except ConfigError as e:
        print("[pi] 설정 파일 오류: {}".format(e), file=sys.stderr)
        return 2
    for k in ("browser", "auto_start_browser", "jupyter_url", "cdp_port"):
        v = cfg.get(k)
        v = ("true" if v else "false") if isinstance(v, bool) else str(v if v is not None else "")
        print("{}={}".format(k, v.replace("\n", " ")))
    return 0


if __name__ == "__main__":  # python bridge.py --shell-config  (bin/pi 가 부름)
    if sys.argv[1:2] == ["--shell-config"]:
        sys.exit(main_print_shell(os.path.join(os.path.dirname(os.path.abspath(__file__)), "bridge.json")))
