// /watch (profiles/common/agent-template/extensions/kit.ts) 시험: 로그 끝부분 정리, 끝남·저절로 시작 표시 찾기,
// 그리고 가짜 pi + 가짜 중계 서버로 실제 흐름 (이 PC 의 파일 / 노트북 파일: 파일 API, 터미널로 읽기)
// 사용법: node tests/test_watch.mjs   (Git Bash 가 있는 Windows 또는 Linux. 저장소의 runtime/node_modules/jiti 로 .ts 를 불러옴)
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";

const T = mkdtempSync(join(tmpdir(), "pi-watch-"));
mkdirSync(join(T, "agent"), { recursive: true });
mkdirSync(join(T, "work", "logs"), { recursive: true });
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(detail)));
	if (!cond) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 3000) => {
	for (let t = 0; t < ms; t += 50) {
		if (f()) return true;
		await sleep(50);
	}
	return !!f();
};

// 가짜 중계 서버: /jupyter/fs (stat, read_range), /jupyter/exec (bash 로 바로 실행). 노트북 경로 = 이 PC 의 Git Bash 경로 (/c/...)
const winPath = (p) => (process.platform === "win32" ? p.replace(/^\/([a-zA-Z])\//, (_, d) => `${d.toUpperCase()}:/`) : p);
const bashPath = (p) => (process.platform === "win32" ? p.split("\\").join("/").replace(/^([A-Za-z]):\//, (_, d) => `/${d.toLowerCase()}/`) : p);
const S = { stat: 0, range: 0, exec: 0, nosize: false };
const runs = new Map();
const server = createServer((req, res) => {
	let body = "";
	req.on("data", (d) => (body += d));
	req.on("end", () => {
		const send = (code, v) => {
			res.writeHead(code, { "Content-Type": "application/json" });
			res.end(JSON.stringify(v));
		};
		const u = new URL(req.url, "http://x");
		const b = body ? JSON.parse(body) : {};
		if (u.pathname === "/jupyter/fs") {
			const p = winPath(b.path);
			let st;
			try {
				st = statSync(p);
			} catch {
				return send(404, { ok: false, code: "ENOENT", error: "ENOENT: " + b.path });
			}
			if (b.op === "stat") {
				S.stat++;
				return send(200, { kind: st.isDirectory() ? "directory" : "file", writable: true, size: S.nosize ? null : st.size });
			}
			if (b.op === "read_range") {
				S.range++;
				const all = readFileSync(p);
				return send(200, { data: all.subarray(b.start, b.end + 1).toString("base64"), total: all.length });
			}
			return send(400, { ok: false, code: "EINVAL", error: "op" });
		}
		if (u.pathname === "/jupyter/exec" && req.method === "POST") {
			S.exec++;
			const r = spawnSync("bash", ["-c", b.command], { cwd: winPath(b.cwd), encoding: "buffer" });
			const id = String(runs.size + 1).padStart(4, "0");
			runs.set(id, { rc: r.status, out: Buffer.concat([Buffer.from("pibridge$ (명령)\n"), r.stdout || Buffer.alloc(0)]) });
			return send(200, { id });
		}
		const m = /^\/jupyter\/exec\/(\w+)$/.exec(u.pathname);
		if (m && runs.has(m[1])) {
			const r = runs.get(m[1]);
			const off = Number(u.searchParams.get("offset") || 0);
			return send(200, { done: true, exitCode: r.rc, data: r.out.subarray(off).toString("base64") });
		}
		send(404, { ok: false, error: "없음" });
	});
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
process.env.PI_COPILOT_URL = `http://127.0.0.1:${server.address().port}`;
process.env.PI_CODING_AGENT_DIR = join(T, "agent");
process.env.PI_WATCH_POLL_MS = "120";

const jiti = createJiti(import.meta.url);
const kit = await jiti.import("../profiles/common/agent-template/extensions/kit.ts");
const { tailLines, doneExit, watchMarker, ago, watchStatus } = kit;

// ── 정리 함수 ──
check("끝부분: 색 코드 빼고, \\r 로 덮어쓴 진행 막대는 마지막 것만", JSON.stringify(tailLines("a\n\x1b[32mok\x1b[0m\n 10%|#  \r 50%|### \r 90%|#### \r\nlast\n", 9)) === JSON.stringify(["a", "ok", " 90%|#### ", "last"]));
check("끝부분: 중간부터 읽었으면 잘린 첫 줄을 뺌, 줄이 하나뿐이면 그대로", JSON.stringify(tailLines("ut line\nb\nc", 9, true)) === JSON.stringify(["b", "c"]) && tailLines("only", 9, true)[0] === "only");
check("끝부분: 빈 줄 빼고 마지막 n 줄", JSON.stringify(tailLines("1\n\n2\n3\n\n", 2)) === JSON.stringify(["2", "3"]));
check("끝남 표시: 마지막 [pi-done] exit=N", doneExit(["x", "[pi-done] exit=0"]) === 0 && doneExit(["[pi-done] exit=1", "y", "[pi-done] exit=137"]) === 137 && doneExit(["echo \"[pi-done] exit=$?\""]) === null);
check("저절로 시작 표시: 줄 맨 앞 [pi-watch] <경로> (마지막 것, CRLF 도)", watchMarker("PID 12\r\n[pi-watch] /home/jovyan/work/logs/a b.log\r\n") === "/home/jovyan/work/logs/a b.log" && watchMarker("[pi-watch] a\n[pi-watch] b") === "b");
check("저절로 시작 표시: 변수가 풀리지 않았거나 다른 글 안이면 무시", watchMarker('[pi-watch] $LOG') === null && watchMarker('  echo "[pi-watch] $PWD/x"') === null && watchMarker("x [pi-watch] /a") === null);
check("걸린 시간", ago(30e3) === "1분 안" && ago(12 * 60e3) === "12분" && ago(125 * 60e3) === "2시간 5분");
check("상태 줄: 마지막 줄은 60자로 줄임", watchStatus("t.log", ["3분", ""], "x".repeat(80)) === `지켜보기: t.log · 3분 · ${"x".repeat(59)}…`);

// ── 가짜 pi ──
const commands = new Map();
const handlers = new Map();
const sent = [];
const pi = {
	registerCommand: (name, c) => commands.set(name, c),
	on: (ev, h) => (handlers.get(ev) || handlers.set(ev, []).get(ev)).push(h),
	sendUserMessage: (text, opts) => sent.push({ text, opts }),
};
kit.default(pi);
const emit = async (ev, event, ctx) => {
	for (const h of handlers.get(ev) || []) await h(event, ctx);
};
const makeCtx = () => {
	const c = { hasUI: true, mode: "rpc", idle: true, answer: false, status: undefined, notes: [], asked: [] };
	c.isIdle = () => c.idle;
	c.ui = {
		setStatus: (k, v) => {
			if (k === "watch") c.status = v;
		},
		notify: (m, l) => c.notes.push(`${l}: ${m}`),
		confirm: async (t, m) => (c.asked.push(m), c.answer),
		getEditorText: () => "",
		setWidget: () => {},
	};
	return c;
};
const watch = (args, ctx) => commands.get("watch").handler(args, ctx);
const lastNote = (c) => c.notes[c.notes.length - 1] || "";

// 1) 이 PC 의 파일
globalThis.__piWorkDir = { remote: false, cwd: join(T, "work") };
let ctx = makeCtx();
await emit("session_start", { reason: "startup" }, ctx);
await watch("", ctx);
check("/watch (없음): 시작하는 방법 안내", lastNote(ctx).includes("지켜보는 로그가 없습니다"), ctx.notes);
await watch("logs/none.log", ctx);
check("/watch 없는 파일: 오류, 지켜보지 않음", lastNote(ctx).startsWith("error: 그 로그 파일이 없습니다") && ctx.status === undefined, ctx.notes);
const L = join(T, "work", "logs", "train.log");
writeFileSync(L, "epoch 1/3 loss 0.9\n");
await watch("logs/train.log", ctx);
check("/watch <로그>: 시작 알림과 상태 줄", lastNote(ctx).includes("로그를 지켜봅니다: logs/train.log") && /^지켜보기: train\.log · 1분 안 · epoch 1\/3 loss 0\.9$/.test(ctx.status || ""), [ctx.notes, ctx.status]);
appendFileSync(L, "epoch 2/3 loss 0.5\n");
check("늘어나면 상태 줄의 마지막 줄이 바뀜", await until(() => (ctx.status || "").endsWith("epoch 2/3 loss 0.5")), ctx.status);
// 세션이 끝나면 멈추고, 새 세션에서 이어서 봄 (/new)
await emit("session_shutdown", { reason: "new" }, ctx);
const old = ctx;
ctx = makeCtx();
appendFileSync(L, "epoch 3/3 loss 0.2\n");
await sleep(400);
check("세션이 끝난 뒤에는 그 세션의 화면을 건드리지 않음", old.status === undefined && !old.notes.some((n) => n.includes("epoch 3")), old.status);
await emit("session_start", { reason: "new" }, ctx);
check("새 세션에서 이어서 지켜봄", await until(() => (ctx.status || "").endsWith("epoch 3/3 loss 0.2")), ctx.status);
await watch("보내기 손실 추이만", ctx);
check("/watch 보내기 [요청]: 끝부분과 요청을 보냄, 계속 지켜봄", sent.length === 1 && sent[0].text.includes("아직 진행 중") && sent[0].text.includes("epoch 3/3 loss 0.2") && sent[0].text.endsWith("손실 추이만") && !!ctx.status, sent);
ctx.answer = true;
appendFileSync(L, "saved model.pt\n[pi-done] exit=0\n");
check("[pi-done] exit=0: 알림, 쉬고 있으면 보낼지 물음", await until(() => ctx.asked.length === 1) && ctx.notes.some((n) => n.startsWith("info: 작업이 끝났습니다: logs/train.log (exit 0")), ctx.notes);
check("물음에 예: 끝부분을 보내고 지켜보기 끝", await until(() => sent.length === 2) && sent[1].text.startsWith("작업이 끝났습니다. 로그 logs/train.log") && sent[1].text.includes("결과를 짧게 정리해 주세요") && ctx.status === undefined, [sent[1], ctx.status]);

// 2) bash 결과의 [pi-watch] 로 저절로 시작, 바쁠 때 끝나면 묻지 않고 안내만
const L2 = join(T, "work", "logs", "auto.log");
writeFileSync(L2, "start\n");
await emit("tool_result", { toolName: "read", content: [{ type: "text", text: `[pi-watch] ${bashPath(L2)}` }] }, ctx);
check("read 결과의 표시는 무시", ctx.status === undefined);
await emit("tool_result", { toolName: "bash", content: [{ type: "text", text: `12345\n[pi-watch] ${bashPath(L2)}\n` }] }, ctx);
check("bash 결과의 [pi-watch] <경로>: 저절로 지켜봄", (ctx.status || "").startsWith("지켜보기: auto.log") && lastNote(ctx).includes("로그를 지켜봅니다"), [ctx.status, ctx.notes]);
ctx.idle = false;
const asked = ctx.asked.length;
appendFileSync(L2, "Traceback (most recent call last):\nValueError: bad\n[pi-done] exit=1\n");
check("exit=1 이고 바쁠 때: 경고 알림에 /watch 보내기 안내, 묻지 않음", await until(() => lastNote(ctx).startsWith("warning: 작업이 오류로 끝났습니다")) && lastNote(ctx).endsWith("/watch 보내기") && ctx.asked.length === asked, ctx.notes);
check("끝난 뒤 상태 줄: 오류로 끝남", (ctx.status || "").startsWith("지켜보기: auto.log · 오류로 끝남 exit=1"), ctx.status);
ctx.idle = true;
await watch("보내기", ctx);
check("끝난 작업 보내기: 오류 원인 찾기 요청, 지켜보기 끝", sent.length === 3 && sent[2].text.includes("오류로 끝났습니다 (exit 1)") && sent[2].text.includes("ValueError: bad") && sent[2].text.includes("오류의 원인과 고칠 곳") && ctx.status === undefined, sent[2]);
writeFileSync(L, "x\n");
await watch("logs/train.log", ctx);
await watch("끄기", ctx);
check("/watch 끄기: 상태 줄을 지우고 작업은 그대로라고 알림", ctx.status === undefined && lastNote(ctx).includes("작업은 그대로 돕니다"), ctx.notes);

// 3) 노트북 파일 (jupyter 모드): 파일 API 로 크기와 끝부분만, 크기가 그대로면 끝부분은 읽지 않음
const R = join(T, "work", "logs", "remote.log");
writeFileSync(R, "step 1\n");
globalThis.__piWorkDir = { remote: true, cwd: bashPath(join(T, "work")), home: bashPath(T) };
await watch("logs/remote.log", ctx);
check("노트북 로그: 상태 줄", (ctx.status || "").endsWith("step 1") && S.exec === 0, [ctx.status, S]);
const r0 = S.range;
const s0 = S.stat;
await until(() => S.stat >= s0 + 2);
check("크기가 그대로면 stat 만 (끝부분은 다시 읽지 않음)", S.range === r0, S);
appendFileSync(R, "x".repeat(20000) + "\nstep 2\n");
check("늘어나면 끝부분만 다시 (8KB)", await until(() => (ctx.status || "").endsWith("step 2")) && S.range === r0 + 1 && S.exec === 0, [ctx.status, S]);
// 크기를 알려 주지 않는 경로(노트북 홈 밖·숨김): 노트북 터미널로
S.nosize = true;
writeFileSync(R, "a\nb\n");
await watch("logs/remote.log", ctx);
check("크기를 모르면 터미널로 읽음", (ctx.status || "").endsWith("· b") && S.exec >= 1, [ctx.status, S]);
ctx.answer = false;
appendFileSync(R, "c\n[pi-done] exit=0\n");
check("터미널로 읽어도 끝남을 알아챔 (물음에 아니요: 상태 줄은 남김)", await until(() => (ctx.status || "").includes("끝남")) && sent.length === 3, [ctx.status, sent.length]);
await emit("session_shutdown", { reason: "quit" }, ctx);

server.close();
rmSync(T, { recursive: true, force: true });
console.log(fails ? `RESULT: FAIL (${fails})` : "RESULT: PASS");
process.exit(fails ? 1 : 0);
