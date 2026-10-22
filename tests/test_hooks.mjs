// 키트 훅(profiles/common/agent-template/extensions/hooks.ts) 단위 시험: 문서 규칙, /hooks, 위험 명령 확인 경고
// 사용법: node tests/test_hooks.mjs   (저장소의 runtime/node_modules/jiti 로 .ts 를, pi-tui 는 tests/stubs 의 것으로)
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@earendil-works/pi-tui": join(ROOT, "tests/stubs/pi-tui.mjs") } });
const tmp = mkdtempSync(join(tmpdir(), "hooks-test-"));
const AGENT = join(tmp, "agent");
const EXT = join(AGENT, "extensions");
mkdirSync(EXT, { recursive: true });
process.env.PI_CODING_AGENT_DIR = AGENT;
process.env.PI_COPILOT_USER_CONFIG = join(AGENT, "bridge.json");
const h = await jiti.import("../profiles/common/agent-template/extensions/hooks.ts");
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : `  -> ${typeof detail === "string" ? detail : JSON.stringify(detail)}`.slice(0, 700)));
	if (!cond) fails++;
};
const read = (p) => readFileSync(p, "utf8");

// ── 순수 함수 ─────────────────────────────────────────────────────────────
// 키트 확장 목록: 설치 스크립트의 KIT_EXT 는 모두 hooks.ts 의 KIT_EXT 에 있고, 저장소에 있는 확장은 모두 KIT_EXT 에 (API 키트는 PC 확장이 없음)
const shipped = ["common", "pc", "jupyter"].flatMap((p) => {
	const d = join(ROOT, "profiles", p, "agent-template", "extensions");
	return existsSync(d) ? readdirSync(d).filter((f) => /\.ts$/.test(f)) : [];
});
for (const f of ["install.sh", "update.sh", "api-kit/overlay/install.sh", "api-kit/overlay/update.sh"].filter((x) => existsSync(join(ROOT, x)))) {
	const m = read(join(ROOT, f)).match(/^KIT_EXT="([^"]*)"/m);
	const list = (m ? m[1] : "").split(/\s+/).filter((x) => x && !x.startsWith("lib/"));
	const want = f.startsWith("api-kit") ? shipped.filter((x) => !["copilot-session.ts", "jupyter.ts"].includes(x)) : shipped;
	check(`KIT_EXT: ${f} 의 목록은 모두 hooks.ts 에 있고, 저장소의 확장이 빠짐없이 (내 훅을 가리는 기준)`,
		list.every((x) => h.KIT_EXT.includes(x)) && want.every((x) => list.includes(x)) && shipped.every((x) => h.KIT_EXT.includes(x)), [list, want]);
}
check("문서: Markdown 만, 숨김 폴더·node_modules 는 뺌",
	h.isDoc("docs/a.md") && h.isDoc("x.MARKDOWN") && !h.isDoc("a.txt") && !h.isDoc(".github/x.md") && !h.isDoc("node_modules/p/README.md"));
for (const [rel, kind] of [["docs/작업이력_1022.md", "history"], ["HISTORY.md", "history"], ["진행-상황.md", "history"], ["worklog.md", "history"], ["devlog-3.md", "history"],
	["계획_v2.md", "plan"], ["plan.md", "plan"], ["release-plan.md", "plan"], ["todo.md", "plan"], ["할일.md", "plan"],
	["explanation.md", "doc"], ["planner-notes.md", "doc"], ["log-analysis.md", "doc"], ["설계.md", "doc"], ["README.md", "doc"]])
	check(`문서 종류: ${rel} -> ${kind}`, h.docKind(rel) === kind, h.docKind(rel));
check("규칙 밖: 목록 문서·README·지침·메모·스킬·CHANGELOG (HISTORY.md 는 tool_call 에서 따로)",
	["docs/INDEX.md", "README.md", "sub/readme.md", "AGENTS.md", "NOTES.md", "x/SKILL.md", "CHANGELOG.md"].every((r) => h.ruleFree(r, "docs/INDEX.md")) && !h.ruleFree("HISTORY.md", "docs/INDEX.md") && !h.ruleFree("docs/a.md", "docs/INDEX.md"));
check("링크 밖: 목록 문서 자신·맨 위 README·지침·메모·스킬 (하위 README·HISTORY 는 링크)",
	["docs/INDEX.md", "README.md", "AGENTS.md", "NOTES.md", "x/SKILL.md"].every((r) => h.linkFree(r, "docs/INDEX.md")) && !h.linkFree("docs/README.md", "docs/INDEX.md") && !h.linkFree("docs/HISTORY.md", "docs/INDEX.md"));
check("제목: 첫 '# 제목', 없으면 파일 이름", h.docTitle("앞글\n# 배포 계획 ##\n## 1\n", "x/a.md") === "배포 계획" && h.docTitle("본문만", "x/배포 메모.md") === "배포 메모" && h.docTitle(undefined, "a.md") === "a");
check("제목: '# 제목' 이 없는 이력 문서는 '작업 이력' (첫 줄이 '## 날짜 제목' 절)", h.docTitle("## 2026-10-22 KR 실험\n본문\n", "HISTORY.md") === "작업 이력" && h.docTitle("# 우리 이력\n", "HISTORY.md") === "우리 이력");
check("자리 표시 파일: '# placeholder … will contain …' 만 있는 글 (2026-10 ML 시험의 train_v2.py)",
	h.placeholderOnly("# placeholder\n# train_v2.py will contain the v2 feature generation, LightGBM training,\n# MLflow logging, prediction table write, and KFP pipeline entrypoint.\n# Create this file first, then submit via KFP in the next step.\n")
	&& h.placeholderOnly('"""자리 표시: 나중에 채움"""\npass\n') && h.placeholderOnly("// TODO: implement\n"));
check("자리 표시가 아님: 빈 파일, 실제 코드, 주석에 TODO 가 있는 코드, 긴 글",
	!h.placeholderOnly("") && !h.placeholderOnly("import os\nprint(1)\nx = 2\ny = 3\n# TODO: implement more\n") && !h.placeholderOnly("# 설정 파일\nlr = 0.01\n")
	&& !h.placeholderOnly(`# placeholder 설명\n${"a = 1\n".repeat(200)}`) && !h.placeholderOnly(undefined));
check("링크 대상: 목록 문서 폴더 기준, 빈칸은 %20", h.linkTarget("docs/INDEX.md", "docs/plans/a b.md") === "plans/a%20b.md" && h.linkTarget("docs/INDEX.md", "notes/x.md") === "../notes/x.md" && h.linkTarget("INDEX.md", "docs/y.md") === "docs/y.md");
let t = h.addLink(h.NEW_INDEX, "- [A](a.md) — d", "a.md");
t = h.addLink(t, "- [B](b.md) — d", "b.md");
check("목록: '## 문서' 절 끝에 차례로", t.endsWith("## 문서\n- [A](a.md) — d\n- [B](b.md) — d\n") && h.addLink(t, "- [A](a.md) — d", "a.md") === null, t);
const custom = "# 우리 문서\r\n\r\n## 문서\r\n- [옛](old.md)\r\n\r\n## 참고\r\n- 링크\r\n";
const c2 = h.addLink(custom, "- [새](new.md) — d", "new.md");
check("목록: 다음 절 앞에 넣고 CRLF 는 CRLF 로", c2 === "# 우리 문서\r\n\r\n## 문서\r\n- [옛](old.md)\r\n- [새](new.md) — d\r\n\r\n## 참고\r\n- 링크\r\n", c2);
check("목록: '## 문서' 절이 없으면 끝에 만듦", h.addLink("# 목록\n\n본문\n", "- [A](a.md)", "a.md") === "# 목록\n\n본문\n\n## 문서\n- [A](a.md)\n");
check("설정: 기본값 / 바꾼 값 / 이상한 값", JSON.stringify(h.docCfg({})) === JSON.stringify({ on: true, index: "docs/INDEX.md", limit: 2 })
	&& JSON.stringify(h.docCfg({ doc_rules: false, doc_index: "./notes/목록.md", doc_new_limit: 5 })) === JSON.stringify({ on: false, index: "notes/목록.md", limit: 5 })
	&& JSON.stringify(h.docCfg({ doc_index: "../x.md", doc_new_limit: -1 })) === JSON.stringify({ on: true, index: "docs/INDEX.md", limit: 2 }));
const W = join(tmp, "work");
mkdirSync(W, { recursive: true });
const local = { remote: false, cwd: W };
check("경로: 작업 폴더 기준 상대 경로, 밖이면 null", h.projectRel("docs/a.md", local) === "docs/a.md" && h.projectRel(join(W, "b.md"), local) === "b.md" && h.projectRel("../x.md", local) === null && h.projectRel(join(tmp, "y.md"), local) === null);
const nb = { remote: true, cwd: "/home/jovyan/proj", home: "/home/jovyan" };
check("경로: jupyter 모드는 노트북 경로 (~ 는 노트북 홈, C:/ 는 PC 라 null)", h.projectRel("docs/a.md", nb) === "docs/a.md" && h.projectRel("~/proj/b.md", nb) === "b.md" && h.projectRel("/home/jovyan/other/c.md", nb) === null && h.projectRel("C:/x/d.md", nb) === null);
const bt = (c) => h.docTargets("bash", { command: c }).map((x) => x.path).join(",");
check("bash 로 만드는 문서: > 파일, >> 파일, tee (Markdown 만, /dev/null·따옴표 안은 뺌)",
	bt("cat > docs/a.md <<'EOF'\n# A\nEOF") === "docs/a.md" && bt("echo x >> b.md && tee -a c.md d.txt < x") === "b.md,c.md" && bt("cat a.md > /dev/null") === "" && bt('echo "> e.md"') === "", [bt("echo x >> b.md && tee -a c.md d.txt < x")]);
check("write 의 문서와 내용", JSON.stringify(h.docTargets("write", { path: "a.md", content: "# A" })) === JSON.stringify([{ path: "a.md", content: "# A" }]) && h.docTargets("read", { path: "a.md" }).length === 0);

// ── 가짜 pi 로 이벤트 차례대로 ───────────────────────────────────────────────
function fakePi() {
	const handlers = {};
	const commands = {};
	const entries = [];
	const pi = { on: (e, f) => (handlers[e] ||= []).push(f), registerCommand: (n, o) => (commands[n] = o), registerEntryRenderer: () => {}, appendEntry: (_t, d) => entries.push(d) };
	const emit = async (e, ev, ctx) => {
		let r;
		for (const f of handlers[e] || []) {
			const x = await f(ev, ctx);
			if (x !== undefined) r = x;
		}
		return r;
	};
	return { pi, commands, entries, emit };
}
function fakeCtx(answers = [], opts = {}) {
	const log = [];
	const status = {};
	return {
		log, status, answers, hasUI: opts.hasUI !== false, mode: "tui", cwd: W,
		ui: {
			confirm: async (title) => {
				log.push(title);
				return answers.length ? answers.shift() : true;
			},
			notify: (m) => log.push(`알림:${m}`),
			setStatus: (k, v) => (status[k] = v),
		},
		reload: async () => log.push("reload"),
	};
}
const F = fakePi();
(globalThis.__piDocRules = undefined);
h.default(F.pi);
globalThis.__piWorkDir = local;
globalThis.__piMode = "auto";
let n = 0;
/** 도구 하나: tool_call -> (막히지 않았으면) 파일을 씀 -> tool_result. 결과에 붙은 안내를 돌려줌 */
async function tool(ctx, toolName, input, make) {
	const id = `t${++n}`;
	const r = await F.emit("tool_call", { toolName, toolCallId: id, input }, ctx);
	if (r?.block) return { blocked: r.reason };
	make?.();
	const res = await F.emit("tool_result", { toolName, toolCallId: id, input, content: [{ type: "text", text: "ok" }], isError: false }, ctx);
	return { note: (res?.content || []).slice(1).map((c) => c.text).join("\n") };
}
const writeDoc = (ctx, rel, content = `# ${rel} 제목\n`, cwd = W) =>
	tool(ctx, "write", { path: rel, content }, () => {
		mkdirSync(dirname(join(cwd, rel)), { recursive: true });
		writeFileSync(join(cwd, rel), content);
	});
const request = () => F.emit("agent_start", {}, fakeCtx());
const INDEX = join(W, "docs/INDEX.md");

await F.emit("session_start", { reason: "startup" }, fakeCtx());
await request();
let ctx = fakeCtx([true]);
let r = await writeDoc(ctx, "docs/plans/a.md", "# 배포 계획 A\n본문\n");
check("새 문서: 목록이 없으면 한 번 묻고 만들어 링크 (결과에 안내)", existsSync(INDEX) && read(INDEX).includes("- [배포 계획 A](plans/a.md) — ") && ctx.log.join() === "문서 목록" && r.note.includes("docs/INDEX.md 에 링크"), [ctx.log, r]);
r = await writeDoc(ctx, "notes/b.md");
check("두 번째 새 문서: 묻지 않고 링크 (목록 폴더 기준 ../)", read(INDEX).includes("(../notes/b.md)") && ctx.log.length === 1, ctx.log);
ctx = fakeCtx([false]);
r = await writeDoc(ctx, "c.md");
check("세 번째 새 문서: 한 번 묻고, 아니요면 막고 이유를 모델에게", r.blocked?.includes("사용자 문서 규칙") && r.blocked.includes("docs/plans/a.md") && ctx.log.join() === "새 문서가 많습니다" && !existsSync(join(W, "c.md")), [r, ctx.log]);
r = await writeDoc(ctx, "d.md");
check("네 번째: 다시 묻지 않고 같은 답으로 막음", !!r.blocked && ctx.log.length === 1, ctx.log);
r = await tool(ctx, "read", { path: "c.md" });
check("읽기는 보지 않음", !r.blocked && !r.note);
r = await writeDoc(ctx, "docs/plans/a.md", "# 배포 계획 A\n고침\n");
check("있는 문서를 다시 쓰기: 규칙 밖, 목록 그대로", !r.blocked && !r.note && (read(INDEX).match(/plans\/a\.md/g) || []).length === 1, read(INDEX));

await request();
ctx = fakeCtx([true]);
r = await writeDoc(ctx, "e.md");
check("다음 요청: 개수를 다시 셈 (묻지 않고 만들고 링크)", !r.blocked && ctx.log.length === 0 && read(INDEX).includes("(../e.md)"), ctx.log);
r = await writeDoc(ctx, "docs/작업이력_1022.md");
check("이력 문서: HISTORY 에 이어 쓰게 할지 묻고, 예면 막고 docs/HISTORY.md 로", r.blocked?.includes("docs/HISTORY.md") && ctx.log.join() === "이력 문서", [r, ctx.log]);
r = await writeDoc(ctx, "docs/HISTORY.md", "# 작업 이력\n\n## 2026-10-22 시작\n");
check("이력 파일 자신: 묻지 않고 만들고 목록에 링크 (개수에 넣지 않음)", !r.blocked && ctx.log.length === 1 && read(INDEX).includes("- [작업 이력](HISTORY.md)"), [ctx.log, read(INDEX)]);
await request();
ctx = fakeCtx([true]);
r = await writeDoc(ctx, "HISTORY.md");
check("다른 곳의 HISTORY.md: 이력 문서로 보고 있는 이력 파일(docs/HISTORY.md)로", r.blocked?.includes("docs/HISTORY.md") && ctx.log.join() === "이력 문서", [r, ctx.log]);

await request();
ctx = fakeCtx([false]);
r = await writeDoc(ctx, "plan-a.md");
check("첫 계획 문서: 묻지 않음", !r.blocked && ctx.log.length === 0);
await request();
r = await writeDoc(ctx, "plan-b.md");
check("같은 세션의 두 번째 계획 문서: 묻고, 아니요면 막고 첫 계획 문서를 고치게", r.blocked?.includes("plan-a.md") && ctx.log.join() === "계획 문서", [r, ctx.log]);

// 새 프로젝트에서 지침대로 맨 위 HISTORY.md 를 처음 만들 때: 묻지 않고 그것을 이력 파일로 (없는 docs/HISTORY.md 로 돌리지 않음)
{
	const W3 = join(tmp, "work3");
	mkdirSync(W3, { recursive: true });
	globalThis.__piWorkDir = { remote: false, cwd: W3 };
	await request();
	ctx = fakeCtx([true]);
	r = await writeDoc(ctx, "HISTORY.md", "# 작업 이력\n", W3);
	check("새 프로젝트의 맨 위 HISTORY.md: 이력 질문 없이 만들고 목록에 링크 (개수에 넣지 않음)",
		!r.blocked && !ctx.log.includes("이력 문서") && read(join(W3, "docs/INDEX.md")).includes("- [작업 이력](../HISTORY.md)"), [ctx.log, r]);
	r = await writeDoc(ctx, "docs/작업이력.md", "# x\n", W3);
	check("그다음 이력 문서는 맨 위 HISTORY.md 로 돌림", r.blocked?.includes("HISTORY.md 하나에") && !r.blocked.includes("docs/HISTORY.md") && ctx.log.includes("이력 문서"), [r, ctx.log]);
	globalThis.__piWorkDir = local;
}

// 동시에 (한 답의 도구 호출 여럿): 묻는 것은 한 번
await request();
ctx = fakeCtx([false]);
await writeDoc(ctx, "p1.md");
await writeDoc(ctx, "p2.md");
const both = await Promise.all([writeDoc(ctx, "p3.md"), writeDoc(ctx, "p4.md")]);
check("동시에 온 새 문서 둘: 한 번만 묻고 둘 다 같은 답", both.every((x) => x.blocked) && ctx.log.filter((x) => x === "새 문서가 많습니다").length === 1, [both, ctx.log]);

// bash 로 만든 문서도 같게
await request();
ctx = fakeCtx();
r = await tool(ctx, "bash", { command: "cat > docs/f.md <<'EOF'\n# bash 로 쓴 문서\nEOF" }, () => writeFileSync(join(W, "docs/f.md"), "# bash 로 쓴 문서\n"));
check("bash 로 만든 문서: 목록에 링크 (제목은 파일의 첫 제목)", read(INDEX).includes("- [bash 로 쓴 문서](f.md)") && r.note.includes("docs/f.md"), [r, read(INDEX)]);
r = await tool(ctx, "bash", { command: "echo x > docs/g.md" });
check("bash 명령이 파일을 만들지 못했으면 링크하지 않음", !read(INDEX).includes("g.md") && !r.note);

// 화면이 없을 때 (pi -p): 묻지도 막지도 않고 안내만, 목록 문서는 만들지 않음
const W2 = join(tmp, "work2");
mkdirSync(W2, { recursive: true });
globalThis.__piWorkDir = { remote: false, cwd: W2 };
await request();
ctx = fakeCtx([], { hasUI: false });
await writeDoc(ctx, "x1.md", "# 1", W2);
await writeDoc(ctx, "x2.md", "# 2", W2);
const x3 = await writeDoc(ctx, "x3.md", "# 3", W2);
const xh = await writeDoc(ctx, "변경이력.md", "# h", W2);
check("화면 없음: 막지 않고 결과에 안내 (개수·이력), 목록은 만들지 않음",
	!x3.blocked && x3.note.includes("3개째") && !xh.blocked && xh.note.includes("HISTORY.md") && existsSync(join(W2, "x3.md")) && !existsSync(join(W2, "docs/INDEX.md")) && ctx.log.length === 0 && x3.note.includes("링크를 달지 않았습니다"), [x3, xh, ctx.log]);

// 확인 모드: 묻지 않고 안내, 목록 링크는 함 / 계획 모드: 아무것도 안 함
globalThis.__piWorkDir = local;
globalThis.__piMode = "ask";
await request();
ctx = fakeCtx();
await writeDoc(ctx, "k1.md");
await writeDoc(ctx, "k2.md");
r = await writeDoc(ctx, "k3.md");
check("확인 모드: 묻지 않고 안내, 목록 링크는 함", !r.blocked && r.note.includes("3개째") && read(INDEX).includes("(../k3.md)") && ctx.log.length === 0, [r, ctx.log]);
globalThis.__piMode = "plan";
r = await writeDoc(ctx, "planmode.md");
check("계획 모드: 보지 않음", !r.note && !read(INDEX).includes("planmode"));
globalThis.__piMode = "auto";

// jupyter 모드 (노트북 파일은 jupyter.ts 가 여는 기능으로)
const files = new Map();
globalThis.__piRemoteFs = {
	stat: async (p) => {
		if (!files.has(p)) throw Object.assign(new Error("없음"), { code: "ENOENT" });
		return { kind: "file" };
	},
	read: async (p) => {
		if (!files.has(p)) throw Object.assign(new Error("없음"), { code: "ENOENT" });
		return files.get(p);
	},
	write: async (p, text) => void files.set(p, text),
};
globalThis.__piWorkDir = nb;
await request();
ctx = fakeCtx([true]);
r = await tool(ctx, "write", { path: "docs/r.md", content: "# 노트북 문서\n" }, () => files.set("/home/jovyan/proj/docs/r.md", "# 노트북 문서\n"));
check("jupyter 모드: 노트북의 docs/INDEX.md 를 만들어 링크", (files.get("/home/jovyan/proj/docs/INDEX.md") || "").includes("- [노트북 문서](r.md)") && ctx.log.join() === "문서 목록", [ctx.log, [...files.keys()]]);
globalThis.__piRemoteFs = { stat: async () => { throw new Error("중계 서버 연결 안 됨"); }, read: async () => null, write: async () => {} };
r = await tool(ctx, "write", { path: "docs/s.md", content: "# s" });
check("노트북에 닿지 않으면 보지 않음 (막지 않음)", !r.blocked && !r.note);
globalThis.__piWorkDir = local;

// 자리 표시 파일: 막지 않고 결과에 안내 (문서가 아닌 .py 도)
await request();
ctx = fakeCtx();
r = await tool(ctx, "write", { path: "train_v2.py", content: "# placeholder\n# train_v2.py will contain the training code.\n" }, () => writeFileSync(join(W, "train_v2.py"), "# placeholder\n"));
check("자리 표시 내용만 쓰면 결과에 안내 (막지 않음)", !r.blocked && r.note === h.PLACEHOLDER_NOTE, r);
r = await tool(ctx, "write", { path: "train_v2.py", content: "import pandas as pd\nprint(pd.__version__)\n" }, () => writeFileSync(join(W, "train_v2.py"), "import pandas as pd\n"));
check("실제 내용이면 안내 없음", !r.blocked && !r.note, r);

// 끄기, 지침
writeFileSync(join(AGENT, "bridge.json"), JSON.stringify({ doc_rules: false }));
await request();
ctx = fakeCtx();
r = await writeDoc(ctx, "off.md");
const g1 = { systemPromptOptions: { promptGuidelines: [] } };
await F.emit("before_agent_start", g1, ctx);
check("doc_rules false: 링크·지침 없음", !r.note && !read(INDEX).includes("off.md") && g1.systemPromptOptions.promptGuidelines.length === 0);
writeFileSync(join(AGENT, "bridge.json"), "{}");
const g2 = { systemPromptOptions: { promptGuidelines: ["기존"] } };
await F.emit("before_agent_start", g2, ctx);
await F.emit("before_agent_start", g2, ctx);
check("지침: 문서 규칙 한 줄 (두 번 넣지 않음, 늘 같은 글)", JSON.stringify(g2.systemPromptOptions.promptGuidelines) === JSON.stringify(["기존", h.DOC_GUIDE]) && h.DOC_GUIDE.length <= 300);
check("대화창 [문서] 항목", F.entries.some((e) => e.lines.some((l) => l.includes("→ docs/INDEX.md 에 링크"))) && F.entries.some((e) => e.lines.some((l) => l.includes("대신 docs/HISTORY.md"))), F.entries.slice(0, 3));

// ── /hooks, 위험 명령 확인 경고 ───────────────────────────────────────────────
for (const f of ["guard.ts", "kit.ts", "hooks.ts", "my-plan.ts", "foo.js", "old.ts.off"]) writeFileSync(join(EXT, f), "");
mkdirSync(join(EXT, "lib"));
writeFileSync(join(EXT, "lib", "shell.ts"), "");
mkdirSync(join(EXT, "bar"));
writeFileSync(join(EXT, "bar", "index.ts"), "");
const mine = () => h.myHooks().map((x) => `${x.name}:${x.on ? "on" : "off"}`).join(",");
check("내 훅: 키트 확장·lib 은 빼고, 끈 것(.off)도 보임", mine() === "bar:on,foo.js:on,my-plan.ts:on,old.ts:off", mine());
const cmd = F.commands.hooks.handler;
ctx = fakeCtx();
await cmd("off mine", ctx);
check("/hooks off mine: 내 훅만 끔 (guard.ts 등 키트는 그대로), 다시 불러옴",
	mine() === "bar:off,foo.js:off,my-plan.ts:off,old.ts:off" && existsSync(join(EXT, "guard.ts")) && existsSync(join(EXT, "bar", "index.ts.off")) && ctx.log.includes("reload"), [mine(), ctx.log]);
await cmd("on my-plan", ctx);
check("/hooks on <이름>: 그 훅만 켬", mine() === "bar:off,foo.js:off,my-plan.ts:on,old.ts:off", mine());
ctx = fakeCtx();
await cmd("off wiki", ctx);
check("키트 확장 이름은 여기서 끄지 않고 안내", ctx.log.some((x) => x.includes("키트 확장이라")) && !ctx.log.includes("reload"), ctx.log);
check("위험 명령 확인: guard.ts 가 있고 guard false 가 아니면 켜짐", h.guardState().on);
ctx = fakeCtx([true]);
await cmd("off guard", ctx);
check("/hooks off guard: 경고하고 묻고, 예면 내 설정 파일에 guard false + 상태 줄", JSON.parse(read(join(AGENT, "bridge.json"))).guard === false && ctx.log[0].startsWith("위험 명령 확인을 끌까요") && !!ctx.status.hooks && !h.guardState().on, [ctx.log, ctx.status]);
await cmd("on guard", ctx);
check("/hooks on guard: guard false 를 지움", !("guard" in JSON.parse(read(join(AGENT, "bridge.json")))) && h.guardState().on && ctx.status.hooks === undefined, ctx.status);
rmSync(join(EXT, "guard.ts"));
writeFileSync(join(EXT, "guard.ts.off"), "");
ctx = fakeCtx();
globalThis.__piDocRules.warned = false;
await F.emit("session_start", { reason: "startup" }, ctx);
check("guard.ts.off 면 시작할 때 상태 줄과 한 번 알림", h.guardState().why === "guard.ts.off" && !!ctx.status.hooks && ctx.log.filter((x) => x.startsWith("알림:위험 명령 확인이 꺼져")).length === 1, [ctx.log, ctx.status]);
await cmd("on guard", ctx);
check("/hooks on guard: guard.ts.off 를 되돌리고 다시 불러옴", existsSync(join(EXT, "guard.ts")) && !existsSync(join(EXT, "guard.ts.off")) && ctx.log.includes("reload"), ctx.log);
await cmd("off docs", ctx);
check("/hooks off docs: doc_rules false", JSON.parse(read(join(AGENT, "bridge.json"))).doc_rules === false);
await cmd("on docs", ctx);
ctx = fakeCtx();
await cmd("", ctx);
check("/hooks: 목록 (guard·docs 켜짐, 내 훅)", ctx.log[0].includes("guard  켜짐") && ctx.log[0].includes("docs   켜짐") && ctx.log[0].includes("my-plan.ts 켜짐") && ctx.log[0].includes("/hooks off mine"), ctx.log[0]);

rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `RESULT: FAIL (${fails})` : "RESULT: PASS");
process.exit(fails ? 1 : 0);
