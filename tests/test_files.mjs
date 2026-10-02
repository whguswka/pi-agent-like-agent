// @파일(profiles/common/agent-template/extensions/files.ts) 단위 테스트: @ 자동완성, 폴더 훑기, 보낼 때 파일 내용 붙이기
// 사용법: node tests/test_files.mjs   (Node 20.15 이상. 저장소의 runtime/node_modules/jiti 로 .ts 를 불러옴)
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";

const jiti = createJiti(import.meta.url);
const f = await jiti.import("../profiles/common/agent-template/extensions/files.ts");
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(detail)));
	if (!cond) fails++;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 커서 앞의 @글자
check("@ 뒤 글자", f.atPrefix("고쳐줘 @src/ma") === "@src/ma");
check("@ 만", f.atPrefix("@") === "@");
check("메일 주소는 아님", f.atPrefix("a@b.com") === null);
check("따옴표 경로", f.atPrefix('@"my fi') === '@"my fi');
check("괄호 뒤", f.atPrefix("(@x") === "@x");
check("공백 뒤에는 없음", f.atPrefix("@a.py 설명") === null);

// 맞는 것 고르기
const entries = [
	{ path: "src", dir: true }, { path: "src/main.py", dir: false }, { path: "src/util", dir: true },
	{ path: "src/util/main_helper.py", dir: false }, { path: "README.md", dir: false }, { path: "docs/main.md", dir: false },
];
let r = f.rank(entries, "main").map((e) => e.path);
check("이름 앞부분, 얕고 짧은 것 먼저", eq(r, ["src/main.py", "docs/main.md", "src/util/main_helper.py"]), r);
r = f.rank(entries, "src/u").map((e) => e.path);
check("경로로 치면 그 아래", r[0] === "src/util" && r.includes("src/util/main_helper.py"), r);
r = f.rank(entries, "").map((e) => e.path);
check("@ 만 치면 맨 위 것부터", r[0] === "README.md" || r[0] === "src", r);
r = f.rank(entries, "smp").map((e) => e.path);
check("글자 순서만 맞아도 (s..m..p)", r.includes("src/main.py"), r);

// 자동완성 덧씌우기 (가짜 기본 제공자와 가짜 목록)
const calls = [];
const base = {
	triggerCharacters: ["#"],
	async getSuggestions(lines, line, col) {
		calls.push(lines[line].slice(0, col));
		return null; // fd 없음
	},
	applyCompletion(lines, line, col, item, prefix) {
		return { lines: [lines[line].slice(0, col - prefix.length) + item.value + " "], cursorLine: 0, cursorCol: 0 };
	},
};
const local = { remote: false, cwd: process.cwd() };
let w = f.wrapProvider(base, async () => entries, () => local);
check("@ 를 알림 글자로 (기존 것 유지)", w.triggerCharacters.includes("@") && w.triggerCharacters.includes("#"));
let s = await w.getSuggestions(["보자 @main"], 0, 9, {});
check("fd 가 없어도 목록 (값은 @경로)", s && s.prefix === "@main" && s.items[0].value === "@src/main.py" && s.items[0].label === "main.py", s);
s = await w.getSuggestions(["@sr"], 0, 3, {});
const dirItem = s && s.items.find((i) => i.label === "src/");
check("폴더는 / 로 끝남 (이어서 칠 수 있게)", dirItem && dirItem.value === "@src/", s && s.items);
check("고르면 기본 제공자의 방식으로 넣음", eq(w.applyCompletion(["보자 @sr"], 0, 6, s.items[0], "@sr").lines, ["보자 @src/ "]), w.applyCompletion(["보자 @sr"], 0, 6, s.items[0], "@sr"));
s = await w.getSuggestions(["/mod"], 0, 4, {});
check("@ 가 아니면 기본 제공자에게", s === null && calls[calls.length - 1] === "/mod", calls);
const sp = [{ path: "my file.txt", dir: false }];
w = f.wrapProvider(base, async () => sp, () => local);
s = await w.getSuggestions(["@my"], 0, 3, {});
check("공백 있는 경로는 따옴표", s && s.items[0].value === '@"my file.txt"', s);
const withFd = { ...base, async getSuggestions() { return { items: [{ value: "@fd.py", label: "fd.py" }], prefix: "@f" }; } };
w = f.wrapProvider(withFd, async () => entries, () => local);
s = await w.getSuggestions(["@f"], 0, 2, {});
check("fd 가 있으면 pi 기본 목록 그대로", s && s.items[0].value === "@fd.py", s);
let asked = null;
w = f.wrapProvider(withFd, async (wd) => ((asked = wd), entries), () => ({ remote: true, cwd: "/home/jovyan/work" }));
s = await w.getSuggestions(["@main"], 0, 5, {});
check("jupyter 모드는 노트북 목록 (pi 기본 목록은 PC 것이라 안 씀)", s && s.items[0].value === "@src/main.py" && asked && asked.remote, s);

// 요청 글의 @경로
check("@경로 찾기 (중복·문장 부호 정리, 따옴표 경로)", eq(f.refsOf('see @a.py, @"b c.txt" and @a.py.'), ["a.py", "b c.txt"]), f.refsOf('see @a.py, @"b c.txt" and @a.py.'));
check("메일 주소는 아님", eq(f.refsOf("mail a@b.com"), []));

// 폴더 훑기와 붙이기 (임시 폴더)
const T = mkdtempSync(join(tmpdir(), "pi-files-"));
try {
	mkdirSync(join(T, "src", "deep", "a", "b", "c", "d", "e"), { recursive: true });
	mkdirSync(join(T, "node_modules", "x"), { recursive: true });
	mkdirSync(join(T, ".git"), { recursive: true });
	writeFileSync(join(T, "src", "a.py"), "print('hi')\n");
	writeFileSync(join(T, "src", "deep", "a", "b", "c", "d", "e", "too-deep.txt"), "x");
	writeFileSync(join(T, "node_modules", "x", "m.js"), "x");
	writeFileSync(join(T, "big.txt"), "가".repeat(10000));
	writeFileSync(join(T, "bin.dat"), Buffer.from([1, 0, 2]));
	writeFileSync(join(T, "x.ipynb"), "{}");
	const all = (await f.walkLocal(T)).map((e) => e.path);
	check("폴더 훑기: node_modules·.git 건너뜀", all.includes("src/a.py") && !all.some((p) => p.startsWith("node_modules") || p.startsWith(".git")), all);
	check("폴더 훑기: 6단계까지만", !all.some((p) => p.endsWith("too-deep.txt")) && all.includes("src/deep/a/b/c/d"), all);
	const wd = { remote: false, cwd: T };
	const parts = await f.attachments("@src/a.py의 버그 @big.txt @bin.dat @src @x.ipynb @none.py", wd);
	check("붙이기: 텍스트 파일만 (조사 붙은 경로도)", parts.length === 2 && parts[0] === '<file name="src/a.py">\nprint(\'hi\')\n</file>', parts.map((p) => p.slice(0, 80)));
	check("붙이기: 긴 파일은 앞부분만 + 안내", parts[1] && parts[1].startsWith('<file name="big.txt">\n가') && parts[1].includes("앞부분 6000자만") && parts[1].includes("read 로"), parts[1] && parts[1].slice(-120));
	writeFileSync(join(T, "b1.txt"), "q".repeat(5000));
	writeFileSync(join(T, "b2.txt"), "z".repeat(5000));
	const p2 = await f.attachments("@b1.txt @b2.txt", wd);
	const total = p2.reduce((n, p) => n + (p.match(/[qz]/g) || []).length, 0);
	check("붙이기: 모두 8000자까지", total === 8000 && p2.length === 2, total);
	check("@ 가 없으면 붙일 것 없음", (await f.attachments("그냥 요청", wd)).length === 0);
} finally {
	rmSync(T, { recursive: true, force: true });
}

console.log(fails ? `\n실패 ${fails}개` : "\n모두 통과");
process.exit(fails ? 1 : 0);
