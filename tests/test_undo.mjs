// 되돌리기(profiles/common/agent-template/extensions/undo.ts) 단위 테스트: git 기준점 제안, HTML 표기 풀기
// 사용법: node tests/test_undo.mjs   (Node 20.15 이상. 저장소의 runtime/node_modules/jiti 로 .ts 를 불러옴. git 이 없으면 git 부분은 건너뜀)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";

const jiti = createJiti(import.meta.url);
const u = await jiti.import("../profiles/common/agent-template/extensions/undo.ts");
// 이 시험은 git 기준점 제안 자체를 보므로, 시험 모음(release-check)이 켜 둔 끄기(PI_GIT_OFFER=0)는 뺀다
const oldGitOffer = process.env.PI_GIT_OFFER;
delete process.env.PI_GIT_OFFER;
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(detail).slice(0, 800)));
	if (!cond) fails++;
};
const win = process.platform === "win32";

// HTML 표기 풀기 (실사용 시험: Copilot 이 'List&lt;PerformanceCounter&gt;' 로 보내 고치기가 실패함)
check("풀기: &lt; &gt; &quot; &#39; &amp; (&amp;lt; 는 &lt; 로 한 번만)",
	u.unescapeHtml("List&lt;int&gt; a = &quot;x&quot; &#39;y&#39; &amp;&amp; b") === "List<int> a = \"x\" 'y' && b" && u.unescapeHtml("&amp;lt;") === "&lt;");
const cs = "    class Metrics\n    {\n        readonly PerformanceCounter cpu;\n        readonly List<PerformanceCounter> gpu = new List<PerformanceCounter>();\n";
let fx = u.fixEntityEdits(cs, [{ oldText: "readonly List&lt;PerformanceCounter&gt; gpu = new List&lt;PerformanceCounter&gt;();", newText: "Dictionary&lt;string, CounterSample&gt; last;" }]);
check("고칠 글이 HTML 표기로 와서 파일에 없고 풀면 있음 -> oldText·newText 를 풂",
	fx && fx[0].oldText === "readonly List<PerformanceCounter> gpu = new List<PerformanceCounter>();" && fx[0].newText === "Dictionary<string, CounterSample> last;", fx);
check("표기가 없는 고치기·이미 맞는 고치기는 그대로 (null)",
	u.fixEntityEdits(cs, [{ oldText: "readonly PerformanceCounter cpu;", newText: "x" }]) === null
	&& u.fixEntityEdits("<p>&lt;b&gt; 는 굵게</p>", [{ oldText: "&lt;b&gt;", newText: "&lt;i&gt;" }]) === null);
check("풀어도 파일에 없으면 그대로 (pi 가 원래대로 '찾지 못함' 을 알림)", u.fixEntityEdits(cs, [{ oldText: "List&lt;Foo&gt;", newText: "x" }]) === null);
fx = u.fixEntityEdits("a\r\nList<int> x;\r\n", [{ oldText: "a\nList&lt;int&gt; x;", newText: "b" }, { oldText: "a", newText: "c" }]);
check("CRLF 파일도 맞춰 보고, 여러 고치기 중 표기가 있는 것만 풂", fx && fx[0].oldText === "a\nList<int> x;" && fx[1].oldText === "a", fx);

// git 을 제안하지 않는 폴더
const H = win ? "C:\\Users\\u" : "/home/u";
check("제안하지 않는 폴더: 홈, 드라이브 맨 위, 시스템 폴더, pi 폴더 / 그 밖은 제안",
	u.gitOfferBlocked(H, H) === "홈 폴더" && u.gitOfferBlocked(win ? "C:\\" : "/", H) === "드라이브 맨 위"
	&& (!win || u.gitOfferBlocked("C:\\Windows\\System32", H) === "시스템 폴더" && u.gitOfferBlocked("c:/program files/app", H) === "시스템 폴더")
	&& u.gitOfferBlocked(join(H, ".pi", "agent"), H) === "pi 폴더" && u.gitOfferBlocked(join(H, "tools", "pi"), H) === "pi 폴더"
	&& u.gitOfferBlocked(join(H, "work", "resmon"), H) === "" && u.gitOfferBlocked(join(H, "tools", "pix"), H) === "",
	[u.gitOfferBlocked(H, H), u.gitOfferBlocked(join(H, "work", "resmon"), H)]);

const tmp = mkdtempSync(join(tmpdir(), "undo-test-"));
const mk = (rel, text = "x\n") => {
	const p = join(tmp, rel);
	mkdirSync(join(p, ".."), { recursive: true });
	writeFileSync(p, text);
	return p;
};
mk("cnt/a.py");
mk("cnt/src/b.py");
mk("cnt/node_modules/m/index.js");
mk("cnt/src/__pycache__/b.pyc");
mk("cnt/.git/HEAD");
const cnt = u.countFiles(join(tmp, "cnt"));
check("파일 세기: node_modules·__pycache__·.git 안은 세지 않고 이름을 알려 줌, 한도를 넘으면 null",
	cnt && cnt.n === 2 && cnt.heavy.sort().join(",") === "__pycache__,node_modules" && u.countFiles(join(tmp, "cnt"), 1) === null, cnt);

// 가짜 pi 로: 처음 고치기 직전에 묻고, '예' 면 기준점 커밋, '아니요' 면 다시 묻지 않음
let hasGit = true;
try {
	execFileSync("git", ["--version"], { stdio: "ignore" });
} catch {
	hasGit = false;
}
const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(tmp, "agent");
const on = {};
u.default({ on: (e, f) => (on[e] ||= []).push(f), registerCommand: () => {} });
const asked = [];
const notes = [];
let answer = true;
let lastOpts = null;
let confirmDelay = 0; // 묻는 창이 저절로 닫히는 것(시간 다 됨)을 흉내
const ctx = {
	hasUI: true,
	ui: {
		notify: (t, l) => notes.push([t, l]),
		confirm: async (title, msg, opts) => {
			asked.push([title, msg]);
			lastOpts = opts;
			if (confirmDelay) await new Promise((r) => setTimeout(r, confirmDelay));
			return answer;
		},
	},
};
const emit = async (e, ev = {}, c = ctx) => {
	let r;
	for (const f of on[e] || []) r = (await f(ev, c)) ?? r;
	return r;
};
const gitOut = (dir, args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

if (!hasGit) {
	console.log("건너뜀: git 이 없어 git 기준점 부분은 시험하지 않음");
} else {
	const proj = join(tmp, "proj");
	mk("proj/main.cs", "class A { List<int> x; }\n");
	mk("proj/node_modules/lib/x.js");
	globalThis.__piWorkDir = { remote: false, cwd: proj };
	await emit("session_start", { reason: "startup" });
	await emit("agent_start");
	const ev1 = { toolName: "edit", input: { path: join(proj, "main.cs"), edits: [{ oldText: "List&lt;int&gt; x;", newText: "List&lt;long&gt; x;" }] } };
	await emit("tool_call", ev1);
	check("처음 고치기 직전에 한 번 물음 (파일 수, .gitignore, 커밋 이름 안내)",
		asked.length === 1 && asked[0][0] === "이 폴더를 git 으로 관리할까요?" && asked[0][1].includes("파일 1개") && asked[0][1].includes("node_modules 폴더는 .gitignore"), asked);
	check("'예' -> git init, .gitignore, 기준점 커밋 (node_modules 는 빠짐)",
		existsSync(join(proj, ".git")) && readFileSync(join(proj, ".gitignore"), "utf8") === "node_modules/\n"
		&& gitOut(proj, ["log", "--format=%s"]) === "pi: 기준점 (pi 가 고치기 전)" && gitOut(proj, ["ls-files"]).split("\n").sort().join(",") === ".gitignore,main.cs",
		[gitOut(proj, ["log", "--format=%s"]), gitOut(proj, ["ls-files"])]);
	check("같은 고치기의 HTML 표기도 풂 (기준점과 함께)", ev1.input.edits[0].oldText === "List<int> x;" && ev1.input.edits[0].newText === "List<long> x;", ev1.input);
	const r = await emit("input", { text: "다음 요청" });
	check("다음 요청에 git 으로 관리하기 시작했다고 알림", r?.text?.startsWith("(이 작업 폴더를 git 으로 관리하기 시작했습니다.") && r.text.endsWith("다음 요청"), r);
	await emit("tool_call", { toolName: "write", input: { path: join(proj, "b.cs") } });
	check("이미 저장소면 다시 묻지 않음", asked.length === 1, asked.length);

	const proj2 = join(tmp, "proj2");
	mk("proj2/a.txt");
	globalThis.__piWorkDir = { remote: false, cwd: proj2 };
	answer = false;
	await emit("session_start", { reason: "new" });
	await emit("tool_call", { toolName: "write", input: { path: join(proj2, "a.txt") } });
	check("'아니요' -> 저장소를 만들지 않고 이 폴더는 기억", asked.length === 2 && !existsSync(join(proj2, ".git"))
		&& Object.keys(JSON.parse(readFileSync(join(tmp, "agent", "git-offer.json"), "utf8")).declined).length === 1);
	await emit("session_start", { reason: "new" });
	await emit("tool_call", { toolName: "write", input: { path: join(proj2, "a.txt") } });
	check("새 세션에서도 그 폴더는 다시 묻지 않음", asked.length === 2, asked.length);

	const proj3 = join(tmp, "proj3");
	mk("proj3/a.txt");
	globalThis.__piWorkDir = { remote: false, cwd: proj3 };
	await emit("session_start", { reason: "new" });
	await emit("tool_call", { toolName: "write", input: { path: join(proj3, "a.txt") } }, { hasUI: false, ui: ctx.ui });
	await emit("tool_call", { toolName: "write", input: { path: join(tmp, "elsewhere.txt") } });
	check("화면이 없는 실행(pi -p)·작업 폴더 밖의 파일이면 묻지 않음", asked.length === 2 && !existsSync(join(proj3, ".git")), asked.length);
	globalThis.__piWorkDir = { remote: true, cwd: "/home/jovyan/proj" };
	await emit("session_start", { reason: "new" });
	await emit("tool_call", { toolName: "write", input: { path: "/home/jovyan/proj/a.py" } });
	check("jupyter 모드(노트북 파일)는 묻지 않음", asked.length === 2, asked.length);

	const proj4 = join(tmp, "proj4");
	mk("proj4/a.txt");
	const cfgFile = join(tmp, "agent", "git-offer.json");
	const declinedBefore = JSON.parse(readFileSync(cfgFile, "utf8")).declined;
	writeFileSync(cfgFile, JSON.stringify({ enabled: false, declined: declinedBefore }));
	globalThis.__piWorkDir = { remote: false, cwd: proj4 };
	await emit("session_start", { reason: "new" });
	await emit("tool_call", { toolName: "write", input: { path: join(proj4, "a.txt") } });
	check("git-offer.json 에 \"enabled\": false 면 어디서도 묻지 않음 (시험용 HOME 등)", asked.length === 2 && !existsSync(join(proj4, ".git")), asked.length);
	writeFileSync(cfgFile, JSON.stringify({ declined: declinedBefore }));
	answer = false;
	await emit("session_start", { reason: "new" });
	await emit("tool_call", { toolName: "write", input: { path: join(proj4, "a.txt") } });
	check("'아니요' 로 더할 때 다른 설정은 그대로", asked.length === 3
		&& Object.keys(JSON.parse(readFileSync(cfgFile, "utf8")).declined).length === Object.keys(declinedBefore).length + 1);
	check("묻는 창에는 시간 제한 (아무도 보지 않는 실행이 멈추지 않게)", lastOpts?.timeout === u.GIT_OFFER.timeoutMs && u.GIT_OFFER.timeoutMs === 120000, lastOpts);

	const proj5 = join(tmp, "proj5");
	mk("proj5/a.txt");
	globalThis.__piWorkDir = { remote: false, cwd: proj5 };
	process.env.PI_GIT_OFFER = "0";
	await emit("session_start", { reason: "new" });
	await emit("tool_call", { toolName: "write", input: { path: join(proj5, "a.txt") } });
	check("환경 변수 PI_GIT_OFFER=0 이면 묻지 않음 (release-check 의 시험용 HOME)", asked.length === 3, asked.length);
	delete process.env.PI_GIT_OFFER;
	u.GIT_OFFER.timeoutMs = 60;
	confirmDelay = 80;
	const nDeclined = Object.keys(JSON.parse(readFileSync(cfgFile, "utf8")).declined).length;
	await emit("session_start", { reason: "new" });
	await emit("tool_call", { toolName: "write", input: { path: join(proj5, "a.txt") } });
	check("시간이 다 돼 저절로 닫히면 '아니요' 로 기억하지 않음 (다음 세션에 다시 물음)",
		asked.length === 4 && Object.keys(JSON.parse(readFileSync(cfgFile, "utf8")).declined).length === nDeclined && !existsSync(join(proj5, ".git")));
	confirmDelay = 0;
	await emit("session_start", { reason: "new" });
	await emit("tool_call", { toolName: "write", input: { path: join(proj5, "a.txt") } });
	check("그래서 다음 세션에는 다시 물음", asked.length === 5, asked.length);
}

if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
if (oldGitOffer !== undefined) process.env.PI_GIT_OFFER = oldGitOffer;
try {
	rmSync(tmp, { recursive: true, force: true });
} catch {}
console.log(fails ? `실패 ${fails}` : "모두 통과");
process.exit(fails ? 1 : 0);
