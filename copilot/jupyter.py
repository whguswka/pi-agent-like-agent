# -*- coding: utf-8 -*-
"""브라우저의 JupyterLab 탭을 통로로 Kubeflow 노트북(pod) 안에서 명령을 실행하고 파일을 읽고 쓴다.

- 명령: JupyterLab 터미널 세션 'pibridge' 에서 실행한다. 출력과 종료 코드는 화면이 아니라 파일
  (Jupyter 루트/pi-bridge/run)로 정확히 받는다. JupyterLab 의 '실행 중인 터미널' 목록에서 pibridge 를 열면
  실행되는 모습을 볼 수 있다 (안 열어도 실행됨).
- 파일: Jupyter 파일 API(Contents API). 숨김 파일·Jupyter 루트 밖 경로는 터미널 명령으로 처리한다.
- Jupyter 쪽에는 아무것도 설치하지 않는다.
"""
import base64
import json
import posixpath
import threading
import time
import uuid

from bridge import BridgeError, SessionExpired, Tab, list_tabs, log

TERM_NAME = "pibridge"  # 터미널 연결 주소는 이름에 영문·숫자·밑줄만 허용 (하이픈 불가)
RUN_DIR = "pi-bridge/run"  # Jupyter 루트 기준 (숨김 폴더는 파일 API 로 읽을 수 없어서 점 없는 이름)

PAGE_JS = r"""
(() => {
  const V = 1;
  if (window.__piJ && window.__piJ.v === V) return true;
  const el = document.getElementById('jupyter-config-data');
  if (!el) return false;
  const cfg = JSON.parse(el.textContent);
  const base = cfg.baseUrl || '/';
  const xsrf = () => { const m = document.cookie.match(/(?:^|;\s*)_xsrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : null; };
  const J = {v: V, base, ws: null, name: null, done: {}, scan: '', tail: ''};
  J.fetch = async (method, path, body) => {
    const headers = {'Content-Type': 'application/json'};
    const x = xsrf(); if (x) headers['X-XSRFToken'] = x;
    if (cfg.token) headers['Authorization'] = 'token ' + cfg.token;
    const r = await fetch(base + path, {method, headers, body: body == null ? undefined : JSON.stringify(body),
                                        credentials: 'same-origin', redirect: 'manual', cache: 'no-store'});
    const text = (r.status === 204 || r.type === 'opaqueredirect') ? '' : await r.text();
    return {status: r.status, type: r.type, text};
  };
  J.cpath = (p) => 'api/contents/' + p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  J.readFile = async (p) => {
    const r = await J.fetch('GET', J.cpath(p) + '?type=file&format=base64&content=1&_=' + Date.now());
    if (r.status !== 200) return {status: r.status, type: r.type, text: r.text.slice(0, 500)};
    const m = JSON.parse(r.text);
    const b64 = m.format === 'base64' ? m.content : btoa(unescape(encodeURIComponent(m.content || '')));
    return {status: 200, b64, size: m.size};
  };
  J.stat = async (p) => {
    const r = await J.fetch('GET', J.cpath(p) + '?content=0&_=' + Date.now());
    if (r.status !== 200) return {status: r.status, type: r.type, text: r.text.slice(0, 300)};
    const m = JSON.parse(r.text);
    return {status: 200, kind: m.type, writable: m.writable, size: m.size};
  };
  J.writeFile = async (p, b64) => {
    const r = await J.fetch('PUT', J.cpath(p), {type: 'file', format: 'base64', content: b64});
    return {status: r.status, type: r.type, text: r.text.slice(0, 500)};
  };
  J.list = async (p) => {
    const r = await J.fetch('GET', J.cpath(p) + '?content=1&_=' + Date.now());
    if (r.status !== 200) return {status: r.status, type: r.type, names: []};
    return {status: 200, names: (JSON.parse(r.text).content || []).map(i => i.name)};
  };
  J.wsUrl = (name) => {
    let u = cfg.wsUrl || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + base);
    if (!u.endsWith('/')) u += '/';
    return u + 'terminals/websocket/' + encodeURIComponent(name) + (cfg.token ? '?token=' + encodeURIComponent(cfg.token) : '');
  };
  // 터미널 출력에 섞여 오는 완료 신호(화면에는 안 보이는 OSC 777 문자열)를 모은다
  const DONE_RE = /\x1b\]777;pi-done;([0-9a-f]+);(-?\d+)\x07/g;
  J.connect = (name) => new Promise((resolve) => {
    if (J.ws && J.ws.readyState === 1 && J.name === name) return resolve('open');
    try { if (J.ws) J.ws.close(); } catch (e) {}
    const ws = new WebSocket(J.wsUrl(name)); J.ws = ws; J.name = name;
    const t = setTimeout(() => resolve('timeout'), 15000);
    ws.onopen = () => { clearTimeout(t); resolve('open'); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m[0] !== 'stdout') return;
      J.tail = (J.tail + m[1]).slice(-6000);
      J.scan += m[1];
      for (const x of J.scan.matchAll(DONE_RE)) J.done[x[1]] = +x[2];
      J.scan = J.scan.slice(-300);
    };
    ws.onclose = () => { clearTimeout(t); resolve('closed'); };
  });
  J.send = (data) => { if (!J.ws || J.ws.readyState !== 1) return false; J.ws.send(JSON.stringify(['stdin', data])); return true; };
  window.__piJ = J;
  return true;
})()
"""

# 실행 감싸개: 작업 폴더로 이동 -> 명령 실행(입력 없음, 출력은 파일+화면) -> 종료 코드 파일 -> 완료 신호
WRAPPER = r"""R={R}; I={I}
printf '\033[36m[pi] %s\033[0m\n' {title}
if ! cd -- {cwd} 2>/dev/null; then
  printf 'pi-bridge: 작업 폴더로 이동할 수 없습니다: %s\n' {cwd} | tee "$R/$I.out"; echo 1 > "$R/$I.rc"
  printf '\033]777;pi-done;%s;1\007' "$I"; exit 0
fi
{{ bash "$R/$I.sh" < /dev/null 2>&1; echo $? > "$R/$I.rc.tmp"; }} | tee "$R/$I.out"
mv -f "$R/$I.rc.tmp" "$R/$I.rc"; rc=$(cat "$R/$I.rc")
printf '\033]777;pi-done;%s;%s\007\033[2m[pi] 끝 (종료 코드 %s)\033[0m\n' "$I" "$rc" "$rc"
"""


def shq(s):
    """bash 작은따옴표 인용"""
    return "'" + str(s).replace("'", "'\\''") + "'"


class FsError(BridgeError):
    """파일 작업 실패 (code: ENOENT, EISDIR, EACCES, EIO)"""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class Jupyter:
    def __init__(self, cfg):
        self.cfg = cfg
        self.tab = None
        self.lock = threading.RLock()       # CDP 탭 하나를 여러 요청이 나눠 쓰므로 한 번에 하나씩
        self.run_lock = threading.RLock()   # 터미널 하나에서는 명령도 한 번에 하나씩
        self.term = None
        self.root = None   # Jupyter 루트 절대 경로 (터미널에서 확인)
        self.home = None
        self.runs = {}
        self.current = None
        self.stale = []    # 다 읽은 실행 파일 (다음 명령 때 지움. 파일 API 의 DELETE 는 휴지통으로 가므로 안 씀)

    # ------------------------------------------------------------------ 탭
    def connect(self):
        want = self.cfg.get("jupyter_url_contains") or ""
        for t in list_tabs(self.cfg["cdp_port"]):
            url = t.get("url", "")
            if self.cfg["copilot_url_contains"] in url or (want and want not in url):
                continue
            tab = Tab(t)
            try:
                if tab.eval(PAGE_JS, timeout=15):
                    self.tab = tab
                    log("JupyterLab 탭 연결: {}".format(url[:90]))
                    return
            except Exception:  # noqa: BLE001
                pass
            tab.close()
        raise BridgeError("JupyterLab 탭을 찾지 못했습니다. 브라우저에서 Kubeflow 노트북의 JupyterLab 을 열어 두세요.")

    def js(self, expr, timeout=60, ensure=True):
        """JupyterLab 탭에서 식 실행. ensure=False 면 페이지 도구(window.__piJ) 확인을 건너뜀 (짧은 반복 확인용)"""
        with self.lock:
            for attempt in (1, 2):
                try:
                    if self.tab is None:
                        self.connect()
                    if (ensure or attempt == 2) and not self.tab.eval(PAGE_JS, timeout=15):  # 페이지가 바뀌었거나 새로고침됨
                        raise ConnectionError("JupyterLab 페이지가 아닙니다")
                    return self.tab.eval(expr, timeout=timeout)
                except BridgeError:
                    if ensure or attempt == 2:
                        raise
                    continue  # 페이지가 새로고침돼 도구가 없어짐 -> 다시 심고 한 번 더
                except (ConnectionError, OSError, TimeoutError) as e:
                    if self.tab:
                        self.tab.close()
                    self.tab = None
                    if attempt == 2:
                        raise BridgeError("JupyterLab 탭과 연결할 수 없습니다: {}".format(e))

    @staticmethod
    def check(r):
        if not isinstance(r, dict):
            raise BridgeError("JupyterLab 탭이 아닙니다 (페이지가 바뀜)")
        if r.get("type") == "opaqueredirect" or r.get("status") in (0, 401):
            raise SessionExpired("JupyterLab 로그인이 만료되었습니다. 브라우저에서 JupyterLab 을 새로고침해 다시 로그인하세요.")
        return r

    def call(self, fn, *args, timeout=60):
        return self.check(self.js("window.__piJ.{}({})".format(fn, ", ".join(json.dumps(a) for a in args)), timeout))

    # ------------------------------------------------------------------ 터미널
    def send(self, data):
        if not self.js("window.__piJ.send({})".format(json.dumps(data))):
            raise BridgeError("Jupyter 터미널로 입력을 보내지 못했습니다")

    def ensure_terminal(self):
        with self.run_lock:
            r = self.call("fetch", "GET", "api/terminals", None)
            if r["status"] != 200:
                raise BridgeError("Jupyter 터미널 목록을 읽지 못했습니다 ({}): {}".format(r["status"], r.get("text", "")[:200]))
            names = [t.get("name") for t in json.loads(r.get("text") or "[]")]
            fresh = False
            if not self.term or self.term not in names:
                if TERM_NAME in names:
                    self.term = TERM_NAME
                else:
                    r = self.call("fetch", "POST", "api/terminals", {"name": TERM_NAME})
                    if r["status"] not in (200, 201):
                        raise BridgeError("Jupyter 터미널을 만들지 못했습니다 ({}): {}".format(r["status"], r.get("text", "")[:200]))
                    self.term = json.loads(r["text"])["name"]
                    log("Jupyter 터미널 생성: {}".format(self.term))
                fresh = True
            state = self.js("window.__piJ.connect({})".format(json.dumps(self.term)), timeout=30)
            if state != "open":
                raise BridgeError("Jupyter 터미널에 연결하지 못했습니다 ({})".format(state))
            if fresh or not self.root:
                self.init_shell()

    def init_shell(self):
        """터미널 셸 준비: 명령 기록을 남기지 않게 하고, 실행 폴더를 만들고, 루트·홈 경로를 알아낸다"""
        token = uuid.uuid4().hex[:8]
        self.send(" unset HISTFILE; set +o history 2>/dev/null; PIB=\"${JUPYTER_SERVER_ROOT:-$PWD}/pi-bridge\"; "
                  "mkdir -p \"$PIB/run\" && rm -f \"$PIB\"/run/*; "
                  "printf '%s\\n%s\\n' \"${JUPYTER_SERVER_ROOT:-$PWD}\" \"$HOME\" > \"$PIB/run/env-" + token + ".txt\"; "
                  "clear; echo '[pi-bridge] PC 의 pi 가 이 터미널에서 명령을 실행합니다.'\r")
        deadline = time.time() + 40
        while time.time() < deadline:
            r = self.call("readFile", RUN_DIR + "/env-" + token + ".txt")
            if r["status"] == 200:
                lines = base64.b64decode(r["b64"]).decode("utf-8", "replace").splitlines()
                self.root, self.home = lines[0].rstrip("/") or "/", lines[1].rstrip("/") or "/"
                self.stale = ["env-" + token]
                self.runs, self.current = {}, None
                log("Jupyter 터미널 준비: 루트 {}  홈 {}".format(self.root, self.home))
                return
            time.sleep(0.5)
        raise BridgeError("Jupyter 터미널이 응답하지 않습니다 (준비 확인 파일이 생기지 않음). "
                          "JupyterLab 의 터미널 기능이 켜져 있는지 확인하세요.")

    def info(self):
        self.ensure_terminal()
        return {"root": self.root, "home": self.home, "terminal": self.term,
                "url": (self.tab.info.get("url", "") if self.tab else "")}

    # ------------------------------------------------------------------ 명령 실행
    def start(self, cwd, command, timeout=0, title=None):
        with self.run_lock:
            if self.current:  # 앞 명령이 남아 있으면 끝날 때까지 (최대 60초) 기다림
                deadline = time.time() + 60
                while self.current and not self.status(self.current, None)["done"]:
                    if time.time() > deadline:
                        raise BridgeError("Jupyter 터미널에서 이전 명령이 아직 실행 중입니다")
                    time.sleep(0.5)
            self.ensure_terminal()
            rid = uuid.uuid4().hex[:10]
            R = self.root.rstrip("/") + "/" + RUN_DIR
            self.write_rel(RUN_DIR + "/" + rid + ".sh", command.encode("utf-8"))
            first = (title or command).strip().split("\n", 1)[0]
            if len(first) > 120:
                first = first[:117] + "..."
            wrapper = WRAPPER.format(R=shq(R), I=rid, cwd=shq(cwd), title=shq(first))
            self.write_rel(RUN_DIR + "/" + rid + ".run", wrapper.encode("utf-8"))
            rm = ("rm -f " + " ".join(shq(R + "/" + s) + ".*" for s in self.stale) + "; ") if self.stale else ""
            self.stale = []
            self.send(" {}bash {}\r".format(rm, shq(R + "/" + rid + ".run")))
            self.runs[rid] = {"start": time.time(), "timeout": timeout or 0, "done": False, "rc": None,
                              "aborted": False, "timed_out": False, "last_list": 0}
            self.current = rid
            return rid

    def status(self, rid, offset=0, wait=0.0):
        """실행 상태. offset 이 None 이면 출력은 읽지 않는다. wait 초 동안 완료를 기다릴 수 있다"""
        run = self.runs.get(rid)
        if not run:
            raise BridgeError("알 수 없는 실행 번호: {}".format(rid))
        deadline = time.time() + max(0.0, wait)
        first = True
        while not run["done"] and not run["aborted"]:
            done = self.js("window.__piJ.done[{}]".format(json.dumps(rid)), timeout=15, ensure=first)
            first = False
            if done is None and time.time() - run["last_list"] > 3:  # 신호를 놓쳤을 때 대비: 폴더 목록으로 확인
                run["last_list"] = time.time()
                lst = self.call("list", RUN_DIR)
                if rid + ".rc" in (lst.get("names") or []):
                    done = -999
            if done is not None:
                r = self.call("readFile", RUN_DIR + "/" + rid + ".rc")
                if r["status"] == 200:
                    try:
                        run["rc"] = int(base64.b64decode(r["b64"]).decode().strip() or "0")
                    except ValueError:
                        run["rc"] = 1
                else:
                    run["rc"] = done if done != -999 else 1
                run["done"] = True
                break
            if run["timeout"] and time.time() - run["start"] > run["timeout"]:
                self.abort(rid)
                run["timed_out"] = True
                break
            if time.time() >= deadline:
                break
            time.sleep(1.0)
        if run["done"] or run["aborted"]:
            if self.current == rid:
                self.current = None
            if rid not in self.stale:
                self.stale.append(rid)
        out = {"done": run["done"], "exitCode": run["rc"], "aborted": run["aborted"] and not run["timed_out"],
               "timedOut": run["timed_out"]}
        if offset is not None:
            data = self.read_rel(RUN_DIR + "/" + rid + ".out") or b""
            out["data"] = base64.b64encode(data[offset:]).decode()
            out["size"] = len(data)
        return out

    def abort(self, rid):
        run = self.runs.get(rid)
        if run and not run["done"]:
            run["aborted"] = True
            try:
                self.send("\x03")
            except BridgeError:
                pass
            if self.current == rid:
                self.current = None

    def run(self, cwd, command, timeout=60, title=None):
        """짧은 내부 명령을 끝까지 실행 -> (종료 코드, 출력 bytes)"""
        rid = self.start(cwd, command, timeout, title)
        while True:
            st = self.status(rid, None, wait=2)
            if st["done"] or st["aborted"] or st["timedOut"]:
                data = self.read_rel(RUN_DIR + "/" + rid + ".out") or b""
                if st["timedOut"]:
                    raise BridgeError("Jupyter 터미널 명령 시간 초과: " + (title or command)[:80])
                return st["exitCode"], data

    # ------------------------------------------------------------------ 파일
    def read_rel(self, rel):
        r = self.call("readFile", rel)
        if r["status"] == 200:
            return base64.b64decode(r["b64"])
        if r["status"] == 404:
            return None
        raise BridgeError("파일 읽기 실패 {} ({}): {}".format(rel, r["status"], r.get("text", "")[:200]))

    def write_rel(self, rel, data):
        r = self.call("writeFile", rel, base64.b64encode(data).decode())
        if r["status"] not in (200, 201):
            raise BridgeError("파일 쓰기 실패 {} ({}): {}".format(rel, r["status"], r.get("text", "")[:200]))

    def rel_of(self, path):
        """절대 경로 -> 파일 API 경로. 루트 밖이거나 숨김 경로면 None"""
        if not self.root:
            self.ensure_terminal()
        p = posixpath.normpath(path)
        root = self.root.rstrip("/")
        if p == root:
            return ""
        if root and not p.startswith(root + "/"):
            return None
        rel = p[len(root) + 1:] if root else p.lstrip("/")
        if any(seg.startswith(".") for seg in rel.split("/")):
            return None
        return rel

    def fs_run(self, script, path, title):
        R = self.root.rstrip("/") + "/" + RUN_DIR
        rc, out = self.run(self.home, script.replace("@R@", shq(R)), 120, title)
        msg = out.decode("utf-8", "replace").strip()
        if rc == 0:
            return
        code = {2: "ENOENT", 21: "EISDIR", 13: "EACCES", 20: "ENOTDIR"}.get(rc, "EIO")
        raise FsError(code, "{}: {} '{}'".format(code, msg or "실패", path))

    def stat(self, path):
        rel = self.rel_of(path)
        if rel is not None:
            r = self.call("stat", rel)
            if r["status"] == 200:
                return {"kind": r.get("kind"), "writable": r.get("writable"), "size": r.get("size")}
            if r["status"] == 404:
                return None
        # 숨김·루트 밖: 터미널로 확인
        rc, out = self.run(self.home, "if [ -d {p} ]; then echo directory; elif [ -e {p} ]; then echo file; else exit 2; fi".format(
            p=shq(path)), 60, "(확인) " + path)
        if rc != 0:
            return None
        kind = out.decode().strip().splitlines()[-1] if out.strip() else "file"
        return {"kind": kind, "writable": None, "size": None}

    def read_file(self, path):
        rel = self.rel_of(path)
        if rel is not None:
            r = self.call("readFile", rel)
            if r["status"] == 200:
                return base64.b64decode(r["b64"])
            if r["status"] == 404:
                raise FsError("ENOENT", "ENOENT: no such file or directory, open '{}'".format(path))
            if r["status"] == 400 and "directory" in (r.get("text") or "").lower():
                raise FsError("EISDIR", "EISDIR: illegal operation on a directory, read '{}'".format(path))
        bin_rel = RUN_DIR + "/" + uuid.uuid4().hex[:10] + ".bin"
        self.fs_run('if [ -d {p} ]; then echo "is a directory"; exit 21; fi; [ -e {p} ] || {{ echo "no such file or directory"; exit 2; }}; '
                    '[ -r {p} ] || {{ echo "permission denied"; exit 13; }}; cat -- {p} > @R@/{b}'.format(
                        p=shq(path), b=shq(posixpath.basename(bin_rel))), path, "(파일 읽기) " + path)
        data = self.read_rel(bin_rel) or b""
        self.stale.append(posixpath.basename(bin_rel)[:-4])
        return data

    def mkdir(self, path):
        st = self.stat(path)
        if st and st["kind"] == "directory":
            return
        self.fs_run("mkdir -p -- {p} || exit 13".format(p=shq(path)), path, "(폴더 만들기) " + path)

    def write_file(self, path, data):
        rel = self.rel_of(path)
        if rel is not None:
            r = self.call("writeFile", rel, base64.b64encode(data).decode())
            if r["status"] in (200, 201):
                return
            parent = posixpath.dirname(path)
            if not self.stat(parent):
                self.mkdir(parent)
                r = self.call("writeFile", rel, base64.b64encode(data).decode())
                if r["status"] in (200, 201):
                    return
        name = uuid.uuid4().hex[:10]
        self.write_rel(RUN_DIR + "/" + name + ".bin", data)
        self.fs_run('mkdir -p -- "$(dirname -- {p})" && cat -- @R@/{b} > {p} || exit 13'.format(
            p=shq(path), b=shq(name + ".bin")), path, "(파일 쓰기) " + path)
        self.stale.append(name)
