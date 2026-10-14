// API 판 점검: node check.mjs <만든 폴더>
//  1) remove.txt 의 경로가 없는지
//  2) 사람이 읽는 글·스크립트·설정 템플릿에 웹 채팅 중계 내용이 남았는지 (runtime/, 파일 해시 목록, 확장 소스, tests/ 는 뺌)
//  3) 확장: 정한 목록과 같은지 (새 확장은 중계 내용이 없는지 본 뒤 SHARED_EXT 에 더함), kit.ts·wiki.ts 에 isBridge 조건이 있는지,
//     install.sh·update.sh 의 KIT_EXT 에 모든 확장이 있는지
//  4) CHANGELOG.md 에 이 판(VERSION)의 항목이 있는지, 문서의 상대 링크(파일·#제목)가 맞는지
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2];
if (!root || !existsSync(root)) {
	console.error("사용법: node check.mjs <만든 폴더>");
	process.exit(2);
}
const KIT = dirname(fileURLToPath(import.meta.url));
const errors = [];
const read = (p) => readFileSync(join(root, p), "utf8");
function walk(dir, out = []) {
	for (const d of readdirSync(join(root, dir), { withFileTypes: true })) {
		const p = dir ? `${dir}/${d.name}` : d.name;
		if (d.name === ".git") continue;
		if (d.isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}
const files = walk("");

// 1) 지운 경로
for (const line of readFileSync(join(KIT, "remove.txt"), "utf8").split(/\r?\n/)) {
	const p = line.trim();
	if (p && !p.startsWith("#") && existsSync(join(root, p))) errors.push(`남아 있음: ${p}`);
}
if (existsSync(join(root, "api-kit"))) errors.push("남아 있음: api-kit/ (.gitattributes 의 export-ignore 확인)");

// 2) 남은 중계 내용
const TERMS = [
	[/copilot/i, "Copilot"],
	[/사내\s?AI|inhouse/i, "사내AI"],
	[/\b876[56]\b|\b9222\b/, "중계·원격 디버깅 포트"],
	[/전용 창|브리지/, "전용 창·브리지"],
	[/jupyter 모드|--jupyter|pibridge|jupyter-work/i, "jupyter 모드"],
	[/(^|[\s`(|'"])\/(jupyter|web|local|upload|download)\b/m, "jupyter 모드 명령"],
	[/diag\.py|bridge\.py|relay\.py|jupyter\.py|events\.py|start-(chrome|edge)|copilot-relay|relay-events/, "중계 파일"],
	[/중계 서버|중계기/, "중계 서버"],
	[/max_chars|tool_result_chars|max_tabs|multi_read|max_questions|delete_finished_chats|auto_start_browser|jupyter_url|cdp_port|reply_timeout|first_reply|copilot_model|stable_seconds|collect_events/, "중계 서버 설정 항목"],
	[/pi-agent-like-agent-main/, "원래 키트의 zip 이름"],
];
const EXT_DIR = "profiles/common/agent-template/extensions/";
const surface = files.filter((p) => !p.startsWith("runtime/") && !p.startsWith("tests/") && !p.startsWith(EXT_DIR) && p !== "docs/runtime-SHA256SUMS.txt");
for (const p of surface) {
	const lines = read(p).split(/\r?\n/);
	lines.forEach((l, i) => {
		for (const [re, name] of TERMS) if (re.test(l)) errors.push(`${name}: ${p}:${i + 1}: ${l.trim().slice(0, 140)}`);
	});
}
// API 판은 Kubeflow 노트북(Linux) 전용: 사람이 읽는 글과 실행기·설치 스크립트에 Windows PC 안내가 없어야 함
// (CHANGELOG 의 지난 판 항목, 원래 키트와 같은 Node 탐색 스크립트(find-node.sh 등)는 뺌)
const WIN = /Git Bash|PowerShell|pi\.cmd|Code\.exe|cygpath|MINGW|winpty|\b[A-Z]:[\/\\]|%LOCALAPPDATA%|install\.sh pc|Windows|\/\/서버/;
const winSurface = surface.filter((p) => /^(README\.md|docs\/.*\.md|skills\/|prompts\/|profiles\/|install\.sh|update\.sh|check-node\.sh|bin\/pi|bin\/kit-config\.sh)$|^(skills|prompts|profiles)\//.test(p));
for (const p of winSurface)
	read(p).split(/\r?\n/).forEach((l, i) => {
		if (WIN.test(l)) errors.push(`Windows PC 안내: ${p}:${i + 1}: ${l.trim().slice(0, 140)}`);
	});
for (const p of ["bin/pi", "install.sh", "update.sh", "check-node.sh"]) if (!existsSync(join(root, p))) errors.push(`없음: ${p}`);

// 3) 확장
const SHARED_EXT = ["files.ts", "guard.ts", "kit.ts", "memory.ts", "modes.ts", "notify.ts", "undo.ts", "wiki.ts", "lib/paths.ts", "lib/relay.ts", "lib/shell.ts"];
const exts = files.filter((p) => /^profiles\/[^/]+\/agent-template\/extensions\//.test(p));
for (const p of exts) {
	const name = p.replace(/^profiles\/[^/]+\/agent-template\/extensions\//, "");
	if (!p.startsWith(EXT_DIR) || !SHARED_EXT.includes(name)) errors.push(`정하지 않은 확장 (중계 내용이 없는지 보고 SHARED_EXT 에 더하기): ${p}`);
}
for (const n of SHARED_EXT) if (!existsSync(join(root, EXT_DIR, n))) errors.push(`확장이 없음: ${EXT_DIR}${n}`);
for (const n of ["kit.ts", "wiki.ts"]) if (existsSync(join(root, EXT_DIR, n)) && !read(EXT_DIR + n).includes("isBridge(")) errors.push(`${n} 에 isBridge 조건이 없음 (API 판에서 중계 서버 글이 보임)`);
for (const s of ["install.sh", "update.sh"]) {
	const m = read(s).match(/^KIT_EXT="([^"]*)"/m);
	if (!m) {
		errors.push(`${s}: KIT_EXT 줄이 없음`);
		continue;
	}
	const list = m[1].split(/\s+/).filter(Boolean);
	for (const n of SHARED_EXT) if (!list.includes(n)) errors.push(`${s}: KIT_EXT 에 ${n} 가 없음 (되돌릴 때 치우지 못함)`);
}

// 4) CHANGELOG 항목, 상대 링크
const version = read("VERSION").trim();
if (!new RegExp(`^## ${version.replace(/\./g, "\\.")}(\\s|$)`, "m").test(read("CHANGELOG.md"))) errors.push(`CHANGELOG.md 에 '## ${version}' 항목이 없음 (update.sh 가 끝에 보여 줌)`);
const anchor = (h) => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
const anchors = new Map();
function anchorsOf(p) {
	if (!anchors.has(p)) {
		const seen = new Map();
		const set = new Set();
		let fence = false;
		for (const l of read(p).split(/\r?\n/)) {
			if (/^\s*```/.test(l)) fence = !fence;
			const m = !fence && l.match(/^#{1,6}\s+(.*)$/);
			if (!m) continue;
			const a = anchor(m[1]);
			const n = seen.get(a) || 0;
			set.add(n ? `${a}-${n}` : a);
			seen.set(a, n + 1);
		}
		anchors.set(p, set);
	}
	return anchors.get(p);
}
for (const p of files.filter((f) => f.endsWith(".md") && !f.startsWith("runtime/") && !f.startsWith("skills/") && !f.startsWith("prompts/") && !f.startsWith("profiles/"))) {
	let fence = false;
	read(p).split(/\r?\n/).forEach((l, i) => {
		if (/^\s*```/.test(l)) fence = !fence;
		if (fence) return;
		for (const m of l.matchAll(/\]\(([^)\s]+)\)/g)) {
			const href = m[1];
			if (/^[a-z]+:/i.test(href)) continue;
			const [file, hash] = href.split("#");
			const target = file ? posix.normalize(posix.join(posix.dirname(p), decodeURI(file))) : p;
			if (!existsSync(join(root, target))) {
				errors.push(`링크 대상 없음: ${p}:${i + 1}: ${href}`);
				continue;
			}
			if (hash && target.endsWith(".md") && !anchorsOf(target).has(decodeURI(hash))) errors.push(`없는 제목 링크: ${p}:${i + 1}: ${href}`);
		}
	});
}

if (errors.length) {
	console.error(`[api-kit] 점검 실패 ${errors.length}건:\n  ` + errors.join("\n  "));
	process.exit(1);
}
console.log(`[api-kit] 점검 통과 (파일 ${files.length}개, 글 ${surface.length}개 확인, 판 ${version})`);
