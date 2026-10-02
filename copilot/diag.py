#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""브리지 pi 진단 도구 (Windows PC). 실제 Copilot 페이지에서 입력창·버튼·답 읽기가 되는지 확인하고
필요하면 bridge.json 에 넣을 값을 알려준다.

사용법:  python diag.py             (브라우저 탭 + Copilot 페이지 구조 확인)
         python diag.py --jupyter   (+ JupyterLab 터미널에서 시험 명령 실행: jupyter 모드 확인)
         python diag.py --send      (+ Copilot 에 시험 질문 1개를 새 대화로 보내서 답 읽기까지 확인)
         python diag.py --model "GPT 6.0 Sol"   (+ 모델 메뉴 항목을 보여 주고 그 모델을 골라 봄. 이름 생략 시 copilot_model)
         python diag.py --chats     (+ 왼쪽 채팅 목록을 어떻게 찾는지 보여 줌)
         python diag.py --delete-test   (+ 시험 대화를 하나 만들어 '… > 삭제 > 확인' 으로 지워 봄. 다른 대화는 건드리지 않음)
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bridge  # noqa: E402

TEST_BLOCK = '{"tool": "bash", "arguments": {"command": "echo diag-ok \\"quoted\\""}}'


def show(title, value):
    print("  {:<22} {}".format(title, value))


def server_get(server, path, body=None):
    req = urllib.request.Request(server + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=90).read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}")


def jupyter_check(cfg):
    """노트북 안에서 시험 명령 실행. 중계 서버가 켜져 있으면 pi 와 같은 길(중계 서버)로 확인"""
    cmd = "echo diag-ok; uname -sm; pwd"
    server = "http://127.0.0.1:{}".format(os.environ.get("PI_COPILOT_PORT", "8765"))
    try:
        urllib.request.urlopen(server + "/health", timeout=3).read()
        running = True
    except OSError:
        running = False
    t0 = time.time()
    if running:
        info = server_get(server, "/jupyter/info")
        if not info.get("ok"):
            raise bridge.BridgeError(info.get("error"))
        st = server_get(server, "/jupyter/exec", {"cwd": info["home"], "command": cmd})
        if not st.get("ok"):
            raise bridge.BridgeError(st.get("error"))
        rid = st["id"]
        while True:
            st = server_get(server, "/jupyter/exec/{}?offset=0&wait=2".format(rid))
            if not st.get("ok"):
                raise bridge.BridgeError(st.get("error"))
            if st.get("done") or st.get("aborted") or st.get("timedOut"):
                break
        rc, out = st.get("exitCode"), base64.b64decode(st.get("data") or "").decode("utf-8", "replace")
        how = "중계 서버 경유"
    else:
        from jupyter import Jupyter
        jup = Jupyter(cfg)
        info = jup.info()
        rc, data = jup.run(info["home"], cmd, 60)
        out = data.decode("utf-8", "replace")
        how = "직접 (중계 서버 꺼져 있음)"
    show("경로", how)
    show("노트북 루트 / 홈", "{} / {}".format(info.get("root"), info.get("home")))
    show("터미널 세션", info.get("terminal"))
    good = rc == 0 and "diag-ok" in out
    show("실행 결과", "OK ({:.1f}초, 종료 코드 {})".format(time.time() - t0, rc) if good else "X 종료 코드 {}".format(rc))
    print("  --- 출력 ---\n  " + out.strip().replace("\n", "\n  "))
    return good


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(HERE, "bridge.json"))
    ap.add_argument("--send", action="store_true", help="Copilot 에 시험 질문을 실제로 보냄")
    ap.add_argument("--jupyter", action="store_true", help="JupyterLab 터미널에서 시험 명령을 실행")
    ap.add_argument("--model", nargs="?", const="", default=None, help="모델 메뉴 확인 + 그 모델 고르기")
    ap.add_argument("--chats", action="store_true", help="왼쪽 채팅 목록 찾기 확인")
    ap.add_argument("--delete-test", action="store_true", help="시험 대화를 만들어 삭제해 봄")
    args = ap.parse_args()
    cfg = bridge.load_config(args.config)
    ok = True

    print("[1] 브라우저 연결 (원격 디버깅 포트 {})".format(cfg["cdp_port"]))
    tabs = bridge.list_tabs(cfg["cdp_port"])
    for t in tabs:
        print("  - {} | {}".format(t.get("title", "")[:40], t.get("url", "")[:90]))
    cop = [t for t in tabs if cfg["copilot_url_contains"] in t.get("url", "")]
    if not cop:
        print("  X Copilot 탭 없음 (copilot_url_contains={!r})".format(cfg["copilot_url_contains"]))
        return 1
    tab = bridge.Tab(cop[0])
    copilot = bridge.Copilot(tab, cfg)

    print("\n[2] Copilot 페이지 구조")
    info = copilot.js("""(() => { const B = window.__piBridge;
        const sel = el => el.id ? '#' + el.id : el.getAttribute('aria-label') ? el.tagName.toLowerCase() + '[aria-label="' + el.getAttribute('aria-label') + '"]' :
                    el.getAttribute('data-testid') ? '[data-testid="' + el.getAttribute('data-testid') + '"]' : el.tagName.toLowerCase();
        const input = B.findInput(%s);
        return {
          inputs: B.inputs().slice(0, 3).map(el => ({tag: el.tagName, label: B.label(el), selector: sel(el)})),
          chosen: input ? sel(input) : null,
          send: B.buttons(%s).slice(0, 3).map(B.label),
          stop: B.buttons(%s).slice(0, 3).map(B.label),
          newchat: B.buttons(%s).slice(0, 3).map(B.label),
        }; })()""" % (json.dumps(cfg["input_selector"]), json.dumps(cfg["send_button_pattern"]),
                      json.dumps(cfg["stop_button_pattern"]), json.dumps(cfg["new_chat_pattern"])))
    for i in info["inputs"]:
        show("입력창 후보", "{} | {} | 선택자 {}".format(i["tag"], i["label"][:50], i["selector"]))
    show("사용할 입력창", info["chosen"] or "X 없음 -> input_selector 를 지정하세요")
    show("보내기 버튼", info["send"] or "(없음: Enter 키로 보냄)")
    show("새 채팅 버튼", info["newchat"] or "(없음: copilot_new_chat_url 로 이동)")
    show("응답 중지 버튼(지금)", info["stop"] or "(없음 - 정상)")
    ok = ok and bool(info["chosen"])

    print("\n[3] JupyterLab 탭 (jupyter 모드에서만 필요)")
    want = cfg.get("jupyter_url_contains") or ""
    jl = [t for t in tabs if t is not cop[0] and (want in t.get("url", "") if want else "/lab" in t.get("url", ""))]
    show("JupyterLab 탭", jl[0].get("url", "")[:90] if jl else "없음")
    if args.jupyter:
        print("\n[4] JupyterLab 터미널에서 시험 명령")
        try:
            ok = jupyter_check(cfg) and ok
        except (bridge.BridgeError, OSError, KeyError, ValueError) as e:
            show("실행 결과", "X " + str(e))
            ok = False

    if args.send:
        print("\n[5] 시험 질문 (새 대화)")
        copilot.new_chat()
        marker = "[pi-d1a90e]"
        q = ("진단 테스트입니다. 설명 없이 아래 코드 블록을 그대로 한 번만 출력하세요.\n\n```json\n{}\n```\n\n{}").format(TEST_BLOCK, marker)
        t0 = time.time()
        copilot.send(q)
        show("보내기", "OK ({:.1f}초)".format(time.time() - t0))
        reply = copilot.wait_reply(marker)
        show("답 받기", "OK ({:.1f}초, 영역 단계 {})".format(time.time() - t0, getattr(copilot, "last_level", "?")))
        show("답 글자 수", len(reply.get("text", "")))
        show("코드 블록", ["{}: {}".format(c.get("lang"), c.get("text", "").strip()[:80]) for c in reply.get("code_blocks") or []])
        import relay  # 같은 폴더의 relay.py 로 해석 확인
        text, call, err = relay.parse_reply(reply, {"bash"})
        good = bool(call) and call["arguments"].get("command") == 'echo diag-ok "quoted"'
        show("도구 블록 해석", "OK {}".format(call) if good else "X {} / {}".format(call, err))
        ok = ok and good
        print("  --- 답 앞부분 ---\n  " + reply.get("text", "")[:300].replace("\n", "\n  "))

    if args.model is not None:
        print("\n[6] 모델 선택")
        label = args.model or cfg.get("copilot_model") or ""
        st, tree = copilot.model_menu()
        if not st.get("found"):
            show("모델 메뉴 버튼", "X 못 찾음 -> bridge.json 의 model_button_selector 를 지정하세요")
            ok = False
        else:
            show("모델 메뉴 버튼", "'{}'".format(st["text"]))
            show("  (버튼 HTML)", st.get("html", "")[:160])
            for e in tree or []:
                show("  메뉴 항목", "{}{}  ({})".format("(현재) " if e["checked"] else "", e["title"], e["text"]))
                if e["sub"] is not None:
                    show("    └ 하위 메뉴", ", ".join(e["sub"]) or "(열리지 않음)")
            if not tree:
                show("  메뉴 항목", "X 메뉴가 열리지 않음")
                ok = False
            if label:
                good, info = copilot.select_model(label)
                show("'{}' 고르기".format(label), ("OK " if good else "X ") + info)
                ok = ok and good
            else:
                show("고르기", "건너뜀 (모델 이름이 없음: --model \"GPT 6.0 Sol\")")

    if args.chats:
        print("\n[7] 왼쪽 채팅 목록")
        items = copilot.chat_list(8)
        show("찾은 대화 수 (최대 8)", len(items))
        for c in items:
            show("  대화", "{} | {}".format(c["title"][:30], c["href"]))
        if items:
            show("  (첫 항목 HTML)", items[0]["html"][:200])
        else:
            show("  ", "X 대화 링크를 찾지 못함 (창이 좁아 목록이 접혀 있으면 펼친 뒤 다시 해 보세요)")
            ok = False

    if args.delete_test:
        print("\n[8] 대화 삭제 시험 (시험 대화를 새로 만들어 그것만 지움)")
        copilot.new_chat()
        marker = "[pi-de1e7e]"
        copilot.send("삭제 시험용 대화입니다. 'ok' 한 단어만 답하세요. {}".format(marker))
        copilot.wait_reply(marker)
        cid = bridge.conversation_id(copilot.thread_url)
        show("시험 대화", cid or "X 대화 주소를 얻지 못함 ({})".format(copilot.thread_url))
        if cid:
            # 왼쪽 목록에 새 대화가 나타날 때까지 (몇 초 걸릴 수 있음)
            it = copilot.poll(lambda: (lambda r: r if r.get("found") else None)(copilot.find_chat(cid)), 10) or {}
            show("목록에서 찾기", "OK '{}'".format(it.get("title")) if it.get("found") else "X 못 찾음")
            if it.get("found"):
                show("  '…' 버튼", it["more"]["label"] if it.get("more") else "(안 보임: 마우스를 올리거나 오른쪽 클릭으로 시도)")
                show("  (항목 HTML)", it.get("html", "")[:200])
            good, info = copilot.delete_chat(cid)
            show("삭제", ("OK " if good else "X ") + info)
            ok = ok and good
        else:
            ok = False

    print("\n결과:", "정상" if ok else "확인 필요 (위의 X 항목)")
    if not ok:
        print("bridge.json 에서 input_selector / send_button_selector / new_chat_selector / reply_selector 를 지정할 수 있습니다.")
    return 0 if ok else 1


if __name__ == "__main__":
    if sys.platform == "win32" and not sys.stdout.isatty():
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:  # noqa: BLE001
            pass
    sys.exit(main())
