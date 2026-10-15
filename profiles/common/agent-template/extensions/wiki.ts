/**
 * LLM 위키 (안드레 카파시의 'LLM Wiki' 방식): pi 가 쌓아 가는 마크다운 위키
 *
 * 원본(raw/, 읽기만) -> pi 가 쓰는 페이지(pages/) -> 목록(index.md)·기록(log.md). 위키의 규칙은 위키 폴더의 WIKI.md.
 * Copilot·사내AI 중계 서버는 도구 한 번이 대화 한 번이라 느리고 도구 결과가 6000자로 잘리므로
 *  - 목록·기록 고치기와 기계적 점검(깨진 링크, 고아 페이지, 반영 안 된 원본)은 이 확장의 코드가 하고
 *  - 모델은 짧은 검색 결과(wiki_search)와 여러 페이지를 한 번에 읽고 쓰는 도구(wiki_read, wiki_write)를 쓴다.
 * 위키는 PC 폴더 (jupyter 모드에서도 PC). 링크는 Obsidian 형식 [[페이지 제목]]. 고치기 전 페이지는 .history/ 에 남긴다.
 *
 * 명령: /wiki (상태), /wiki init [이름] [폴더], /wiki use <이름>, /wiki off, /wiki ingest <raw/ 안 파일·폴더>,
 *       /wiki ask <질문>, /wiki save [제목], /wiki lint, /wiki reindex
 *   폴더를 주면 그 아래 모든 깊이의 원본을 하나씩 차례로 반영해 달라고 보낸다 (앞 요청이 끝나면 다음, 한 번에 INGEST_LIMIT 개)
 * 설정: ~/.pi/agent/wiki.json {"wikis": {"이름": "폴더"}, "active": "이름", "auto": "write" | "ask" | "search" | "off"}
 *   auto: 위키가 켜져 있을 때 모델이 알아서 위키를 쓰는 정도 (write: 찾고 남김, ask: 찾고 남길지 물음, search: 찾기만, off: 부탁할 때만)
 */

import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------

export type Auto = "write" | "ask" | "search" | "off";
export interface Config {
	wikis: Record<string, string>;
	active: string;
	auto: Auto;
}
const agentDir = () => process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
export const configFile = () => join(agentDir(), "wiki.json");
export const defaultDir = (name: string) => join(homedir(), "pi-wiki", name);
/** /wiki init 에 준 폴더: ~ 는 홈, 상대 경로는 지금 폴더 기준 (설정에는 전체 경로로 남김). 비었으면 "" */
export function wikiDir(arg: string, cwd = process.cwd()): string {
	const s = arg.trim().replace(/^["']|["']$/g, "");
	if (!s) return "";
	if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) return join(homedir(), s.slice(1));
	return isAbsolute(s) ? s : resolve(cwd, s);
}
export const slash = (p: string) => p.replace(/\\/g, "/");
/** 중계 서버(Copilot·사내AI)로 쓰는 설정인지 (models.json 에 127.0.0.1:8765·8766). 그때만 wiki_write 설명에 중계 서버의 '@tool' 글 형식을 적는다
 *  (API 로 바로 쓰는 모델은 보통의 도구 호출을 쓴다. 그 형식을 보면 도구를 부르지 않고 글로만 쓸 수 있음) */
export function isBridge(file = join(agentDir(), "models.json")): boolean {
	try {
		return /127\.0\.0\.1:876[56]/.test(readFileSync(file, "utf8"));
	} catch {
		return false;
	}
}

export function readConfig(file = configFile()): Config {
	try {
		const v = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
		const auto: Auto = ["write", "ask", "search", "off"].includes(v.auto) ? v.auto : "write";
		const wikis = v.wikis && typeof v.wikis === "object" && !Array.isArray(v.wikis) ? v.wikis : {};
		return { wikis, active: typeof v.active === "string" ? v.active : "", auto };
	} catch {
		return { wikis: {}, active: "", auto: "write" };
	}
}

export function writeConfig(c: Config, file = configFile()) {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(c, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// 페이지: 머리말, 이름, 링크
// ---------------------------------------------------------------------------

export type Meta = Record<string, string | string[]>;
/** YAML 따옴표 풀기: '...' (안의 '' 는 '), "..." (JSON 과 같은 이스케이프) */
const unquote = (s: string) => {
	const t = s.trim();
	if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
	if (/^".*"$/.test(t)) {
		try {
			return JSON.parse(t);
		} catch {
			return t.slice(1, -1);
		}
	}
	return t;
};
const str = (v: unknown) => (Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : "");
const list = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []);

/** 머리말(--- ... ---)의 단순한 YAML (키: 값, 키: [a, b], 키: 아래 '- 값' 목록) */
export function parseFrontmatter(text: string): { meta: Meta; body: string; ok: boolean } {
	const m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
	if (!m) return { meta: {}, body: text, ok: false };
	const meta: Meta = {};
	let listKey = "";
	for (const raw of m[1].split(/\r?\n/)) {
		const line = raw.replace(/\s+$/, "");
		if (!line.trim() || line.trim().startsWith("#")) continue;
		const item = /^\s*-\s+(.*)$/.exec(line);
		if (item && listKey) {
			(meta[listKey] as string[]).push(unquote(item[1]));
			continue;
		}
		const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
		if (!kv) continue;
		const [, k, v] = kv;
		if (v === "") {
			meta[k] = [];
			listKey = k;
			continue;
		}
		listKey = "";
		meta[k] = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(",").map(unquote).filter(Boolean) : unquote(v);
	}
	return { meta, body: text.slice(m[0].length), ok: true };
}

/** 제목 -> 파일 이름 (= Obsidian 링크 이름). Windows·Obsidian 에서 못 쓰는 문자는 띄어쓰기로 */
export function pageName(title: string): string {
	return title.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

/** 글 속 [[링크]] 의 대상 이름 ([[이름|보일 글]], [[이름#제목]], ![[그림]] 포함) */
export function wikilinks(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(/!?\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g)) out.push(m[1].trim());
	return out;
}

const baseOf = (rel: string) => (rel.split("/").pop() || rel).replace(/\.md$/i, "");
const key = (name: string) => name.trim().toLowerCase();

export interface Page {
	rel: string;
	name: string;
	title: string;
	summary: string;
	type: string;
	sources: string[];
	body: string;
	links: string[];
	ok: boolean;
}

function walk(dir: string, rel: string, out: string[]) {
	let names: string[] = [];
	try {
		names = readdirSync(dir);
	} catch {
		return;
	}
	for (const n of names.sort()) {
		if (n.startsWith(".")) continue; // .obsidian, .history
		const p = join(dir, n);
		let st;
		try {
			st = statSync(p);
		} catch {
			continue;
		}
		if (st.isDirectory()) walk(p, rel ? `${rel}/${n}` : n, out);
		else out.push(rel ? `${rel}/${n}` : n);
	}
}

export function listFiles(root: string, sub: string): string[] {
	const out: string[] = [];
	walk(join(root, sub), sub, out);
	return out;
}

export function loadPages(root: string): Page[] {
	return listFiles(root, "pages")
		.filter((r) => r.toLowerCase().endsWith(".md"))
		.map((rel) => {
			let text = "";
			try {
				text = readFileSync(join(root, rel), "utf8");
			} catch {}
			const { meta, body, ok } = parseFrontmatter(text);
			return {
				rel,
				name: baseOf(rel),
				title: str(meta.title) || baseOf(rel),
				summary: str(meta.summary),
				type: str(meta.type),
				sources: list(meta.sources),
				body,
				links: wikilinks(body),
				ok: ok && !!str(meta.title) && !!str(meta.summary) && !!str(meta.type),
			};
		});
}

// ---------------------------------------------------------------------------
// 분류와 목록 (index.md)
// ---------------------------------------------------------------------------

export interface TypeDef {
	id: string;
	label: string;
}
export const DEFAULT_TYPES: TypeDef[] = [
	{ id: "overview", label: "개요" },
	{ id: "model", label: "모델" },
	{ id: "pipeline", label: "파이프라인·작업" },
	{ id: "data", label: "데이터" },
	{ id: "metric", label: "지표" },
	{ id: "runbook", label: "운영 절차" },
	{ id: "incident", label: "장애·이슈" },
	{ id: "decision", label: "결정" },
	{ id: "concept", label: "개념" },
	{ id: "source", label: "원본 요약" },
	{ id: "answer", label: "질문 답" },
];

/** WIKI.md 의 '## 분류' 아래 '- `model` — 모델: ...' 줄 (없으면 기본 분류) */
export function readTypes(wikiMd: string): TypeDef[] {
	const sec = /^##\s*분류[^\n]*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m.exec(wikiMd);
	const out: TypeDef[] = [];
	for (const m of (sec?.[1] || "").matchAll(/^\s*-\s*`([\w-]+)`\s*[—–-]+\s*([^:：\n]+)/gm)) out.push({ id: m[1], label: m[2].trim() });
	return out.length ? out : DEFAULT_TYPES;
}

/** WIKI.md 의 '## 주제' 다음 첫 줄 (없으면 첫 제목) */
export function readTopic(wikiMd: string, fallback: string): string {
	const sec = /^##\s*주제[^\n]*\n+([^\n]+)/m.exec(wikiMd);
	if (sec) return sec[1].split(/[:：]/)[0].trim() || fallback;
	const h = /^#\s+(.+)$/m.exec(wikiMd);
	return h ? h[1].replace(/위키$/, "").trim() || fallback : fallback;
}

export function buildIndex(name: string, pages: Page[], types: TypeDef[]): string {
	const out = [`# ${name} 목록`, "", "pi 가 페이지 머리말(title·summary·type)로 만듭니다. 직접 고치지 마세요 (다시 만들기: /wiki reindex).", ""];
	const known = new Set(types.map((t) => t.id));
	const groups: [string, Page[]][] = types.map((t) => [t.label, pages.filter((p) => p.type === t.id)]);
	groups.push(["기타", pages.filter((p) => !known.has(p.type))]);
	for (const [label, ps] of groups) {
		if (!ps.length) continue;
		out.push(`## ${label}`);
		for (const p of [...ps].sort((a, b) => a.name.localeCompare(b.name, "ko"))) out.push(`- [[${p.name}]] — ${p.summary || "(요약 없음)"}`);
		out.push("");
	}
	return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

export function logEntry(date: string, op: string, title: string, names: string[]): string {
	const links = names.map((n) => `[[${n}]]`).join(" · ");
	return `\n## [${date}] ${op || "note"} | ${title || "(제목 없음)"}\n${links ? `- ${links}\n` : ""}`;
}

// ---------------------------------------------------------------------------
// 검색 (외부 패키지 없이: 단어 + 한글은 두 글자 조각, BM25 비슷한 점수)
// ---------------------------------------------------------------------------

export function tokens(s: string): string[] {
	const out: string[] = [];
	for (const w of s.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []) {
		if (/[가-힣]/.test(w)) {
			// 한글이 든 단어: 두 글자 조각 (조사·띄어쓰기가 달라도 맞게)
			if (w.length <= 2) out.push(w);
			else for (let i = 0; i + 2 <= w.length; i++) out.push(w.slice(i, i + 2));
		} else if (w.length >= 2) out.push(w);
	}
	return out;
}

export interface Hit {
	page: Page;
	score: number;
	lines: string[];
}

function bestLines(body: string, q: Set<string>, n = 2): string[] {
	const scored: [number, string][] = [];
	for (const line of body.split(/\r?\n/)) {
		const t = line.trim();
		if (!t || t.startsWith("```")) continue;
		const hits = new Set(tokens(t).filter((x) => q.has(x))).size;
		if (hits) scored.push([hits, t.length > 140 ? `${t.slice(0, 140)}…` : t]);
	}
	return scored.sort((a, b) => b[0] - a[0]).slice(0, n).map((x) => x[1]);
}

export function search(pages: Page[], query: string, limit = 8): Hit[] {
	const q = [...new Set(tokens(query))];
	if (!q.length) return [];
	const qs = new Set(q);
	const docs = pages.map((p) => {
		const tf = new Map<string, number>();
		const add = (arr: string[], w: number) => {
			for (const t of arr) if (qs.has(t)) tf.set(t, (tf.get(t) || 0) + w);
		};
		add(tokens(p.title), 3);
		add(tokens(p.summary), 2);
		add(tokens(p.body), 1);
		return { p, tf };
	});
	const df = new Map<string, number>();
	for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
	const N = Math.max(1, pages.length);
	const hits: Hit[] = [];
	for (const d of docs) {
		let score = 0;
		for (const [t, f] of d.tf) score += Math.log(1 + N / (df.get(t) || 1)) * (f / (f + 1.5));
		if (score > 0) hits.push({ page: d.p, score, lines: bestLines(d.p.body, qs) });
	}
	return hits.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit));
}

export function formatSearch(query: string, hits: Hit[], total: number, max = 2500): string {
	if (!hits.length) return `위키 검색 "${query}": 맞는 페이지 없음 (전체 ${total}쪽). 다른 말로 찾거나, 새로 알게 된 것이면 wiki_write 로 남기세요.`;
	const out = [`위키 검색 "${query}": ${hits.length}개 (전체 ${total}쪽). 읽기: wiki_read paths=[...]`];
	for (const [i, h] of hits.entries()) {
		const block = [`${i + 1}. [[${h.page.name}]] (${h.page.rel}) — ${h.page.summary || "(요약 없음)"}`, ...h.lines.map((l) => `   · ${l}`)].join("\n");
		if (out.join("\n").length + block.length + 1 > max) {
			out.push(`… (${hits.length - i}개 더: 말을 좁혀 다시 찾기)`);
			break;
		}
		out.push(block);
	}
	return out.join("\n");
}

// ---------------------------------------------------------------------------
// 읽기 (여러 파일을 한 번에, 합쳐서 한도 안)
// ---------------------------------------------------------------------------

const READABLE = /^(pages\/.+|raw\/.+|index\.md|log\.md|WIKI\.md)$/;

/** 위키 안 경로 또는 페이지 이름 -> 위키 안 경로 (없으면 null) */
export function resolveTarget(root: string, pages: Page[], target: string): string | null {
	const t = slash(target.trim()).replace(/^\.\//, "").replace(/^\[\[|\]\]$/g, "");
	if (!t || t.split("/").some((s) => s === "..")) return null;
	if (READABLE.test(t) && existsSync(join(root, t))) return t;
	if (READABLE.test(`${t}.md`) && existsSync(join(root, `${t}.md`))) return `${t}.md`;
	const byName = pages.find((p) => key(p.name) === key(t) || key(p.title) === key(t));
	if (byName) return byName.rel;
	const raw = listFiles(root, "raw").find((r) => key(r.split("/").pop() || "") === key(t));
	return raw || null;
}

export function readTargets(root: string, pages: Page[], targets: string[], offset = 1, limit = 0, budget = 5500): string {
	const out: string[] = [];
	const per = Math.max(800, Math.floor(budget / Math.max(1, targets.length)));
	for (const target of targets) {
		const rel = resolveTarget(root, pages, target);
		if (!rel) {
			out.push(`=== ${target}\n(없음: wiki_search 로 찾아보세요)`);
			continue;
		}
		let lines: string[];
		try {
			lines = readFileSync(join(root, rel), "utf8").split(/\r?\n/);
		} catch (e) {
			out.push(`=== ${rel}\n(읽지 못함: ${(e as Error).message})`);
			continue;
		}
		const start = Math.max(1, offset);
		const end = limit > 0 ? Math.min(lines.length, start - 1 + limit) : lines.length;
		let text = "";
		let i = start - 1;
		for (; i < end; i++) {
			if (text.length + lines[i].length + 1 > per && text) break;
			text += `${lines[i]}\n`;
		}
		const more = i < lines.length ? `\n(… ${lines.length - i}줄 더: wiki_read path="${rel}" offset=${i + 1})` : "";
		out.push(`=== ${rel}${start > 1 ? ` (${start}줄부터)` : ""}\n${text.replace(/\n$/, "")}${more}`);
	}
	return out.join("\n\n");
}

// ---------------------------------------------------------------------------
// 원본 (raw/): 찾기, 반영했는지, 요약 페이지 이름, 폴더째 반영할 차례
// ---------------------------------------------------------------------------

/** 경로 차례: '/' 마디마다 견주고, 숫자는 크기 순 (1월, 2월, 10월) */
export function pathOrder(a: string, b: string): number {
	const x = a.split("/");
	const y = b.split("/");
	for (let i = 0; i < Math.min(x.length, y.length); i++) {
		const c = x[i].localeCompare(y[i], undefined, { numeric: true });
		if (c) return c;
	}
	return x.length - y.length;
}

/** 원본으로 다루는 파일 (raw/assets/ 는 페이지에 넣는 그림이라 뺌) */
export const rawFilesOf = (root: string) => listFiles(root, "raw").filter((r) => !r.startsWith("raw/assets/"));

const BINARY = /\.(pdf|docx?|xlsx?|xlsm|pptx?|hwpx?|od[tsp]|rtf|zip|7z|rar|gz|tgz|bz2|xz|tar|jar|png|jpe?g|gif|bmp|tiff?|webp|svg|ico|heic|mp3|wav|m4a|mp4|mov|avi|mkv|exe|dll|so|bin|class|pyc|parquet|feather|orc|avro|pkl|pickle|joblib|npy|npz|h5|hdf5|onnx|pt|pth|ckpt|safetensors|db|sqlite3?)$/i;
/** 원본이 글(텍스트)인지: 문서·그림·압축 파일은 이름으로, 그 밖은 앞부분에 0 바이트가 있으면 글이 아님. maxBytes 를 넘으면 big */
export function rawKind(root: string, rel: string, maxBytes = 0): "text" | "binary" | "big" {
	if (BINARY.test(rel)) return "binary";
	let fd = -1;
	try {
		const p = join(root, rel);
		if (maxBytes && statSync(p).size > maxBytes) return "big";
		fd = openSync(p, "r");
		const buf = Buffer.alloc(4096);
		const n = readSync(fd, buf, 0, buf.length, 0);
		return buf.subarray(0, n).includes(0) ? "binary" : "text";
	} catch {
		return "binary";
	} finally {
		if (fd >= 0) closeSync(fd);
	}
}

/** 반영한 원본: 페이지 머리말 sources 에 적힌 raw/ 파일. 전체 경로로 맞추고 (raw/ 나 .md 를 빼고 적어도 됨),
 *  폴더를 빼고 이름만 적은 것은 그 이름의 원본이 raw/ 안에 하나뿐일 때만 맞춤 (같은 이름이 여러 폴더에 있으면 경로로만) */
export function reflectedRaw(rawFiles: string[], pages: Page[]): Set<string> {
	const byPath = new Map<string, string>();
	const byName = new Map<string, string[]>();
	for (const r of rawFiles) {
		byPath.set(key(r), r);
		const n = key(baseOf(r));
		byName.set(n, [...(byName.get(n) || []), r]);
	}
	const out = new Set<string>();
	for (const p of pages)
		for (const s0 of p.sources) {
			const s = slash(String(s0)).trim().replace(/^\[\[|\]\]$/g, "").replace(/^\.\//, "");
			if (!s) continue;
			const hit = [s, `raw/${s}`, `${s}.md`, `raw/${s}.md`].map((c) => byPath.get(key(c))).find(Boolean);
			if (hit) out.add(hit);
			else {
				const same = byName.get(key(baseOf(s))) || [];
				if (same.length === 1) out.add(same[0]);
			}
		}
	return out;
}

/** /wiki ingest 에 준 대상 -> raw/ 안의 파일·폴더. raw/ 를 빼고 적거나, 이름이나 경로 끝만 적어도 찾음 (파일은 .md 없이도).
 *  여러 개가 맞으면 many 에 후보 (경로 차례). raw/ 전체는 'raw' */
export function rawTarget(root: string, arg: string): { rel?: string; dir?: boolean; many?: string[] } {
	let t = slash(arg.trim().replace(/^["']|["']$/g, "").trim()).replace(/^\.\//, "").replace(/\/+$/, "");
	if (t && isAbsolute(t)) t = slash(relative(root, t));
	if (!t || t.split("/").some((s) => s === "..")) return {};
	if (t === "raw" || t === ".") return { rel: "raw", dir: true };
	if (t.startsWith("raw/")) t = t.slice(4);
	const isDir = (rel: string) => {
		try {
			return statSync(join(root, rel)).isDirectory();
		} catch {
			return false;
		}
	};
	for (const rel of [`raw/${t}`, `raw/${t}.md`]) if (existsSync(join(root, rel))) return { rel, dir: isDir(rel) };
	const files = listFiles(root, "raw");
	const dirs = new Set<string>();
	for (const f of files) {
		const parts = f.split("/");
		for (let i = 2; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
	}
	const k = key(t);
	const ends = (p: string) => key(p).endsWith(`/${k}`) || key(p).endsWith(`/${k}.md`);
	const hits = [...files.filter(ends), ...[...dirs].filter(ends)].sort(pathOrder);
	if (hits.length === 1) return { rel: hits[0], dir: dirs.has(hits[0]) };
	return hits.length ? { many: hits } : {};
}

/** 원본의 요약(source) 페이지 제목. 그 원본의 요약 페이지가 이미 있으면 그 제목, 없으면 파일 이름 (확장자는 뺌).
 *  같은 이름의 원본이 다른 폴더에도 있거나 다른 페이지가 그 이름을 쓰면, 겹치지 않을 때까지 위 폴더 이름을 앞에 붙임
 *  ('2025 1월', '회의록 2025 1월'). 붙일 폴더가 없으면 끝에 '원본', 같은 폴더에 확장자만 다른 원본이 있으면 확장자까지 */
export function sourceTitle(rel: string, rawFiles: string[], pages: Page[]): string {
	const all = rawFiles.includes(rel) ? rawFiles : [...rawFiles, rel];
	const mine = pages.find((p) => p.type === "source" && reflectedRaw(all, [p]).has(rel));
	if (mine) return mine.title || mine.name;
	const file = (r: string) => r.split("/").pop() || r;
	const dirsOf = (r: string) => r.split("/").slice(1, -1);
	const name = (r: string, k: number, last = file(r).replace(/\.[^.]+$/, "") || file(r)) =>
		pageName([...dirsOf(r).slice(Math.max(0, dirsOf(r).length - k)), last].join(" "));
	const taken = (n: string) => pages.some((p) => key(p.name) === key(n));
	const group = all.filter((r) => r !== rel && key(name(r, 0)) === key(name(rel, 0)));
	const deepest = Math.max(dirsOf(rel).length, ...group.map((r) => dirsOf(r).length));
	for (let k = 0; k <= deepest; k++) {
		const n = name(rel, k);
		if (!taken(n) && !group.some((r) => key(name(r, k)) === key(n))) return n;
	}
	const suffixed = pageName(`${name(rel, deepest)} 원본`);
	if (!group.length && !taken(suffixed)) return suffixed;
	const full = name(rel, deepest, file(rel));
	let n = full;
	for (let i = 2; taken(n); i++) n = pageName(`${full} ${i}`);
	return n;
}

export const INGEST_LIMIT = 10; // 폴더째 반영: 한 번에 반영하는 원본 수 (Copilot·사내AI 는 원본 하나에 4~12번 오감)
export const INGEST_MAX_BYTES = 200_000; // 폴더째 반영에서 빼는 큰 원본 (하나씩은 반영할 수 있음)
export interface IngestPlan {
	items: string[]; // 이번에 반영할 원본 (차례대로)
	later: string[]; // 한 번에 하는 수를 넘어 다음에
	done: string[]; // 이미 반영함
	binary: string[]; // 글이 아님 (문서·그림 등)
	big: string[]; // 너무 큼
}
/** 폴더째 반영할 원본: 그 폴더 아래 모든 깊이 (숨김 폴더·raw/assets/ 는 빼고), 경로 차례 */
export function planIngest(root: string, dir: string, pages = loadPages(root), limit = INGEST_LIMIT, maxBytes = INGEST_MAX_BYTES): IngestPlan {
	const all = rawFilesOf(root);
	const reflected = reflectedRaw(all, pages);
	const plan: IngestPlan = { items: [], later: [], done: [], binary: [], big: [] };
	for (const r of all.filter((f) => dir === "raw" || f.startsWith(`${dir}/`)).sort(pathOrder)) {
		if (reflected.has(r)) plan.done.push(r);
		else {
			const kind = rawKind(root, r, maxBytes);
			if (kind === "binary") plan.binary.push(r);
			else if (kind === "big") plan.big.push(r);
			else if (plan.items.length < limit) plan.items.push(r);
			else plan.later.push(r);
		}
	}
	return plan;
}

/** 원본 하나를 반영해 달라는 부탁. 폴더째 반영이면 몇 번째인지와, 반영 방향을 묻지 말라는 말을 더함 */
export function ingestPrompt(name: string, rel: string, title: string, batch?: { i: number; n: number }): string {
	const dir = rel.split("/").slice(1, -1).join("/");
	return [
		`'${name}' 위키의 ${rel} 을 llm-wiki 스킬의 ingest 순서대로 위키에 반영해 줘.`,
		batch ? `폴더째 반영의 ${batch.i}/${batch.n} 번째라 반영 방향은 묻지 말고 바로 반영해 줘.` : "",
		`원본 요약 페이지는 제목을 '${title}' 로 하고 sources 에 ${rel} 을 그대로 적어 줘.`,
		dir ? `원본이 있는 폴더: ${dir} (폴더 이름도 참고).` : "",
	]
		.filter(Boolean)
		.join(" ");
}

// ---------------------------------------------------------------------------
// 쓰기 (pages/ 아래만, 여러 페이지를 한 번에) + 목록·기록 자동
// ---------------------------------------------------------------------------

/** '=== pages/<분류>/<제목>.md' 줄로 나눈 페이지들 */
export function splitBundle(text: string): { path: string; content: string }[] {
	const out: { path: string; content: string }[] = [];
	let cur: { path: string; lines: string[] } | null = null;
	const flush = () => {
		if (cur) out.push({ path: cur.path, content: `${cur.lines.join("\n").replace(/^\n+/, "").replace(/\s+$/, "")}\n` });
	};
	for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
		const m = /^===\s+(\S.*?)\s*$/.exec(line);
		if (m) {
			flush();
			cur = { path: m[1], lines: [] };
		} else if (cur) cur.lines.push(line);
	}
	flush();
	return out;
}

export function checkWritePath(path: string): string | null {
	const p = slash(path.trim()).replace(/^\.\//, "");
	if (!p.startsWith("pages/")) return "pages/ 아래만 쓸 수 있습니다 (raw/ 의 원본과 WIKI.md 는 고치지 않음)";
	if (!p.toLowerCase().endsWith(".md")) return ".md 파일만 쓸 수 있습니다";
	if (p.split("/").some((s) => !s || s === ".." || s.startsWith("."))) return "경로에 .. 이나 빈 이름, . 으로 시작하는 이름은 쓸 수 없습니다";
	if (/[:*?"<>|]/.test(p)) return "파일 이름에 쓸 수 없는 문자가 있습니다";
	return null;
}

/** Obsidian(엄격한 YAML)이 머리말을 받도록: title·summary 값에 ': '·' #' 이 있거나 특수 문자로 시작하면 따옴표로 감싼다 */
export function quoteMeta(content: string): string {
	const m = /^(﻿?---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/.exec(content);
	if (!m) return content;
	const head = m[2].replace(/^(title|summary)[ \t]*:[ \t]*(.*?)[ \t]*$/gm, (all: string, k: string, v: string) => {
		if (!v || /^'.*'$|^".*"$/.test(v)) return all;
		if (!/: |:$|\s#|^[[\]{}#&*!|>'"%@`,]|^[-?:](\s|$)/.test(v)) return all;
		return `${k}: ${v.includes("'") ? JSON.stringify(v) : `'${v}'`}`;
	});
	return m[1] + head + m[3] + content.slice(m[0].length);
}

/** 머리말의 updated 를 오늘로 (없으면 닫는 --- 앞에 넣음) */
export function stampUpdated(content: string, date: string): string {
	const m = /^(﻿?---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/.exec(content);
	if (!m) return content;
	const head = /^updated\s*:.*$/m.test(m[2]) ? m[2].replace(/^updated\s*:.*$/m, `updated: ${date}`) : `${m[2]}\nupdated: ${date}`;
	return m[1] + head + m[3] + content.slice(m[0].length);
}

export interface WriteResult {
	written: string[];
	names: string[];
	errors: string[];
	warnings: string[];
}

export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function backup(root: string, rel: string, date: string) {
	const src = join(root, rel);
	if (!existsSync(src)) return;
	let dst = join(root, ".history", date, rel);
	if (existsSync(dst)) dst = dst.replace(/\.md$/i, `-${Date.now()}.md`);
	mkdirSync(dirname(dst), { recursive: true });
	copyFileSync(src, dst);
}

/** 페이지들을 쓰고 목록을 다시 만들고 기록을 남긴다 (부르는 쪽에서 한 번에 하나씩: 동시에 쓰면 목록·기록이 섞임) */
export function applyWrite(root: string, name: string, text: string, op = "note", title = "", date = today()): WriteResult {
	const res: WriteResult = { written: [], names: [], errors: [], warnings: [] };
	const items = splitBundle(text);
	if (!items.length) {
		res.errors.push("페이지가 없습니다. 페이지마다 '=== pages/<분류>/<제목>.md' 줄 다음에 머리말(---)과 본문을 쓰세요");
		return res;
	}
	let pages = loadPages(root);
	for (const it of items) {
		const bad = checkWritePath(it.path);
		if (bad) {
			res.errors.push(`${it.path}: ${bad}`);
			continue;
		}
		const fm = parseFrontmatter(it.content);
		const t = str(fm.meta.title);
		if (!fm.ok || !t || !str(fm.meta.summary) || !str(fm.meta.type)) {
			res.errors.push(`${it.path}: 머리말(--- title / summary / type ---)이 없거나 빠진 항목이 있습니다`);
			continue;
		}
		let rel = slash(it.path.trim()).replace(/^\.\//, "");
		// 새 페이지는 파일 이름 = 제목 (링크 [[제목]] 이 이어지게). 이미 있는 파일을 고칠 때는 그 경로 그대로
		if (!existsSync(join(root, rel)) && baseOf(rel) !== pageName(t)) {
			const fixed = `${rel.slice(0, rel.lastIndexOf("/") + 1)}${pageName(t)}.md`;
			res.warnings.push(`${rel} -> ${fixed} (파일 이름을 제목과 같게)`);
			rel = fixed;
		}
		const dup = pages.find((p) => key(p.name) === key(baseOf(rel)) && p.rel !== rel);
		if (dup) {
			res.errors.push(`${rel}: 같은 이름의 페이지가 이미 있습니다 (${dup.rel}). 그 페이지를 고치거나 다른 제목을 쓰세요`);
			continue;
		}
		backup(root, rel, date);
		mkdirSync(dirname(join(root, rel)), { recursive: true });
		writeFileSync(join(root, rel), stampUpdated(quoteMeta(it.content), date));
		res.written.push(rel);
		res.names.push(baseOf(rel));
		pages = loadPages(root);
	}
	if (!res.written.length) return res;
	reindex(root, name, pages);
	appendFileSync(join(root, "log.md"), logEntry(date, op, title || res.names[0], res.names));
	const names = new Set(pages.map((p) => key(p.name)));
	const rawNames = new Set(listFiles(root, "raw").map((r) => key(baseOf(r.split("/").pop() || ""))));
	for (const rel of res.written) {
		const p = pages.find((x) => x.rel === rel);
		const broken = (p?.links || []).filter((l) => !names.has(key(baseOf(l))) && !rawNames.has(key(baseOf(l))));
		if (broken.length) res.warnings.push(`${rel}: 아직 없는 페이지로 가는 링크 ${broken.map((b) => `[[${b}]]`).join(", ")}`);
	}
	return res;
}

export function wikiMd(root: string): string {
	try {
		return readFileSync(join(root, "WIKI.md"), "utf8");
	} catch {
		return "";
	}
}

export function reindex(root: string, name: string, pages = loadPages(root)): boolean {
	const next = buildIndex(name, pages, readTypes(wikiMd(root)));
	let cur = "";
	try {
		cur = readFileSync(join(root, "index.md"), "utf8");
	} catch {}
	if (cur === next) return false;
	writeFileSync(join(root, "index.md"), next);
	return true;
}

// ---------------------------------------------------------------------------
// 점검 (기계적인 것만. 모순·낡은 내용은 모델이)
// ---------------------------------------------------------------------------

export interface LintReport {
	pages: number;
	broken: string[];
	orphans: string[];
	noMeta: string[];
	dupNames: string[];
	unknownType: string[];
	rawUnused: string[];
	indexStale: boolean;
}

export function lint(root: string, name: string, pages = loadPages(root)): LintReport {
	const types = readTypes(wikiMd(root));
	const known = new Set(types.map((t) => t.id));
	const byName = new Map<string, Page[]>();
	for (const p of pages) byName.set(key(p.name), [...(byName.get(key(p.name)) || []), p]);
	const rawFiles = rawFilesOf(root);
	const rawNames = new Set(listFiles(root, "raw").map((r) => key(baseOf(r.split("/").pop() || ""))));
	const inbound = new Map<string, number>();
	const broken: string[] = [];
	for (const p of pages)
		for (const l of new Set(p.links)) {
			const k = key(baseOf(l));
			if (byName.has(k)) {
				if (k !== key(p.name)) inbound.set(k, (inbound.get(k) || 0) + 1);
			} else if (!rawNames.has(k)) broken.push(`${p.name} -> [[${l}]]`);
		}
	const reflected = reflectedRaw(rawFiles, pages);
	let indexText = "";
	try {
		indexText = readFileSync(join(root, "index.md"), "utf8");
	} catch {}
	return {
		pages: pages.length,
		broken,
		orphans: pages.filter((p) => p.type !== "overview" && !inbound.get(key(p.name))).map((p) => p.name),
		noMeta: pages.filter((p) => !p.ok).map((p) => p.rel),
		dupNames: [...byName.values()].filter((ps) => ps.length > 1).map((ps) => ps.map((p) => p.rel).join(" / ")),
		unknownType: pages.filter((p) => p.type && !known.has(p.type)).map((p) => `${p.name} (${p.type})`),
		rawUnused: rawFiles.filter((r) => !reflected.has(r)).sort(pathOrder),
		indexStale: indexText !== buildIndex(name, pages, types),
	};
}

export function formatLint(r: LintReport, max = 3000): string {
	const sec = (label: string, items: string[], hint: string) =>
		items.length ? `${label} ${items.length}개 (${hint}):\n${items.slice(0, 8).map((x) => `  - ${x}`).join("\n")}${items.length > 8 ? `\n  - … ${items.length - 8}개 더` : ""}` : "";
	const parts = [
		`위키 점검: ${r.pages}쪽`,
		sec("깨진 링크", r.broken, "그 페이지를 만들거나 링크를 고침"),
		sec("같은 이름", r.dupNames, "하나로 합치거나 제목을 바꿈 — 링크가 어디로 갈지 모름"),
		sec("머리말 없음·빠짐", r.noMeta, "title·summary·type"),
		sec("모르는 분류", r.unknownType, "WIKI.md 의 분류에 넣거나 type 을 고침"),
		sec("고아 페이지", r.orphans, "다른 페이지에서 [[링크]]"),
		sec("아직 반영 안 된 원본", r.rawUnused, "/wiki ingest <파일·폴더>"),
		r.indexStale ? "목록(index.md)이 페이지와 다름 (/wiki reindex)" : "",
	].filter(Boolean);
	if (parts.length === 1) parts.push("문제 없음");
	const text = parts.join("\n\n");
	return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

// ---------------------------------------------------------------------------
// 새 위키
// ---------------------------------------------------------------------------

export const WIKI_TEMPLATE = (name: string) => `# ${name} 위키

이 위키의 규칙(스키마)입니다. pi 와 사람이 같이 고칩니다. 키트를 업데이트해도 바뀌지 않습니다.

## 주제
모델 운영: 모델과 학습·배포 파이프라인, 입력 데이터, 지표, 운영 절차, 장애와 해결, 결정 사항

## 분류
페이지 머리말의 type 에 아래 이름을 씁니다. 목록(index.md)이 이 순서로 묶입니다.
- \`overview\` — 개요: 위키 전체 지도와 주요 페이지 안내
- \`model\` — 모델: 목적, 입력·출력, 버전, 학습 주기, 배포 위치, 담당
- \`pipeline\` — 파이프라인·작업: 학습·배포·배치 작업의 단계, 일정, 의존, 실행 방법
- \`data\` — 데이터: 테이블·파일·특징량의 정의, 출처, 갱신 주기, 주의점
- \`metric\` — 지표: 정의, 계산식, 기준값, 보는 곳
- \`runbook\` — 운영 절차: 반복 작업·점검·복구 순서 (명령은 코드 블록)
- \`incident\` — 장애·이슈: 날짜, 증상, 원인, 해결, 재발 방지
- \`decision\` — 결정: 무엇을 왜 정했는지, 다른 안, 날짜
- \`concept\` — 개념: 위 분류에 들지 않는 용어·방법
- \`source\` — 원본 요약: raw/ 의 원본 하나마다 한 페이지
- \`answer\` — 질문 답: 남겨 둘 만한 질문과 답

## 페이지 규칙
- 파일은 \`pages/<분류>/<제목>.md\`, 파일 이름 = 제목 (링크 [[제목]] 이 그 파일로 이어짐)
- 머리말 (updated 는 pi 가 적음):
  \`\`\`yaml
  ---
  title: 제목
  summary: 한 줄 요약 (목록에 나옴)
  type: model
  sources: [raw/원본.md]
  ---
  \`\`\`
- 한 페이지에 한 주제. 길어지면 나누고 서로 [[링크]]. 근거가 된 원본은 sources 에
- 확인한 사실과 추측을 나눈다. 확인 안 된 것은 "(확인 필요)"
- 남기지 않는 것: 비밀번호·토큰·접속 정보, 개인정보

## 작업
- ingest: raw/ 의 원본 하나를 읽고 요약(source) 페이지를 쓴 뒤 관련 페이지를 고친다 (목록·기록은 pi 가 고침)
- query: wiki_search 로 찾고 wiki_read 로 읽어 답한다. 근거 페이지를 [[제목]] 으로 밝히고, 남길 만한 답은 answer 로
- lint: /wiki lint 결과를 고치고, 분류 하나씩 모순·낡은 내용을 찾는다
`;

export function initWiki(root: string, name: string, date = today()): string[] {
	const made: string[] = [];
	for (const d of ["raw", "raw/assets", "pages/overview"]) mkdirSync(join(root, d), { recursive: true });
	const put = (rel: string, text: string) => {
		if (existsSync(join(root, rel))) return;
		writeFileSync(join(root, rel), text);
		made.push(rel);
	};
	put("WIKI.md", WIKI_TEMPLATE(name));
	put(
		`pages/overview/${pageName(`${name} 개요`)}.md`,
		`---\ntitle: ${name} 개요\nsummary: 이 위키의 지도. 분류별 주요 페이지와 읽는 순서\ntype: overview\nsources: []\nupdated: ${date}\n---\n# ${name} 개요\n\n(pi 가 페이지를 쓰면서 이 지도를 채웁니다.)\n`,
	);
	put("log.md", `# ${name} 기록\n\n시간순 기록입니다. pi 가 덧붙입니다 (\`grep "^## \\[" log.md | tail -5\` 로 최근 것).\n${logEntry(date, "init", "위키 만들기", [])}`);
	reindex(root, name);
	if (!made.includes("index.md")) made.push("index.md");
	return made;
}

// ---------------------------------------------------------------------------
// 확장
// ---------------------------------------------------------------------------

export const WIKI_TOOLS = ["wiki_search", "wiki_read", "wiki_write"];

/** 위키가 켜져 있을 때 지침에 더할 규칙 (세션 안에서는 매번 같은 글: Copilot·사내AI 대화를 새로 열지 않게) */
export function guideLines(name: string, root: string, auto: Auto, topic: string): string[] {
	if (auto === "off") return [];
	const g = [
		`'${name}' 위키(${slash(root)})가 켜져 있다. 위키 도구: wiki_search(찾기), wiki_read(여러 쪽 읽기), wiki_write(여러 쪽 쓰기, 목록·기록은 자동). 순서와 형식은 llm-wiki 스킬`,
		`${topic}에 관한 질문·작업이면 시작할 때 wiki_search 로 위키를 먼저 찾아보고, 찾은 페이지를 근거로 쓰고 답에 [[페이지 제목]] 으로 밝힌다`,
	];
	if (auto === "write")
		g.push("작업 중 새로 확인한 사실·결정·절차·장애 원인과 해결이 위키에 없거나 다르면, 끝내기 전에 wiki_write 로 한 번에 남기고 답 끝에 '위키에 남김: [[제목]]' 을 적는다. 추측·비밀번호·개인정보는 남기지 않는다");
	if (auto === "ask") g.push("작업 중 새로 확인한 것 가운데 위키에 남길 만한 것이 있으면 답 끝에 한두 줄로 제안하고, 사용자가 원하면 wiki_write 로 남긴다");
	return g;
}

const textOf = (m: any): string =>
	typeof m?.content === "string" ? m.content : (m?.content || []).filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n");

export default function (pi: ExtensionAPI) {
	let chain: Promise<unknown> = Promise.resolve();
	/** 위키를 바꾸는 일은 한 번에 하나씩 (한 답의 도구들은 동시에 실행되므로) */
	const locked = <T>(fn: () => T): Promise<T> => {
		const run = chain.then(fn, fn) as Promise<T>;
		chain = run.catch(() => undefined);
		return run;
	};
	let lastPrompt = "";
	let lastAnswer = "";
	let shown = false;
	/** 폴더째 반영: 원본 하나를 요청 하나로, 앞 요청이 끝나면(agent_settled) 다음을 보냄 */
	let batch: null | {
		name: string;
		root: string;
		dir: string; // raw/... 또는 raw
		items: string[];
		i: number; // 지금 반영하는 원본
		ok: string[];
		missed: string[]; // 요청은 끝났는데 반영되지 않음
		streak: number; // 연달아 반영되지 않은 수
		stop: string; // 멈출 까닭 (abort, error, unfinished, user)
		later: number; // 한 번에 하는 수를 넘어 다음에 할 수
		prompt: string; // 지금 보낸 부탁
		sent: boolean; // 부탁을 보냈고 그 요청이 아직 끝나지 않음 (요청 하나에 한 번만 다음으로)
	} = null;

	const current = () => {
		const cfg = readConfig();
		const root = cfg.active ? cfg.wikis[cfg.active] : "";
		return { cfg, name: cfg.active, root: root && existsSync(root) ? root : "" };
	};
	const need = () => {
		const c = current();
		if (!c.root) throw new Error("켜진 위키가 없습니다. 사용자에게 /wiki init 또는 /wiki use <이름> 을 부탁하세요");
		return c;
	};
	const applyTools = (on: boolean) => {
		try {
			const cur: string[] = pi.getActiveTools();
			const next = on ? [...new Set([...cur, ...WIKI_TOOLS])] : cur.filter((t) => !WIKI_TOOLS.includes(t));
			if (next.length !== cur.length) pi.setActiveTools(next);
		} catch {}
	};
	const status = (ctx: any) => {
		const { name, root } = current();
		const prog = batch ? ` · 반영 ${batch.i + 1}/${batch.items.length}` : "";
		if (ctx?.hasUI) ctx.ui.setStatus?.("wiki", root ? ctx.ui.theme.fg("accent", `위키: ${name}${prog}`) : undefined);
	};
	const show = (ctx: any, text: string | undefined) => {
		if (!ctx?.hasUI) return;
		ctx.ui.setWidget("pi-wiki", text ? [text] : undefined);
		shown = !!text;
	};
	const send = (text: string) => {
		try {
			pi.sendUserMessage(text);
		} catch {
			pi.sendUserMessage(text, { deliverAs: "followUp" });
		}
	};
	const result = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });

	// 폴더째 반영
	const few = (list: string[], n = 2) => `${list.slice(0, n).map((r) => r.split("/").pop()).join(", ")}${list.length > n ? " 등" : ""}`;
	const byFolder = (list: string[]) => {
		const m = new Map<string, number>();
		for (const r of list) {
			const d = r.split("/").slice(1, -1).join("/") || "raw/";
			m.set(d, (m.get(d) || 0) + 1);
		}
		const all = [...m].map(([d, n]) => `${d} ${n}개`);
		return `${all.slice(0, 5).join(" · ")}${all.length > 5 ? ` 외 ${all.length - 5}곳` : ""}`;
	};
	const sendItem = (ctx: any) => {
		if (!batch) return;
		const rel = batch.items[batch.i];
		const title = sourceTitle(rel, rawFilesOf(batch.root), loadPages(batch.root));
		batch.prompt = ingestPrompt(batch.name, rel, title, { i: batch.i + 1, n: batch.items.length });
		batch.sent = true;
		status(ctx);
		try {
			send(batch.prompt);
		} catch {
			finish(ctx, "error"); // 보내지 못하면 '반영 중' 으로 남지 않게
		}
	};
	const finish = (ctx: any, why: string) => {
		const b = batch;
		batch = null;
		status(ctx);
		if (!b || !ctx?.hasUI) return;
		const rest = b.items.length - b.ok.length + b.later; // 반영 안 된 것도 같은 명령을 다시 치면 다시 함
		const again = `/wiki ingest ${b.dir === "raw" ? "raw" : b.dir.slice(4)}`;
		const missed = b.missed.length ? `, 반영 안 됨 ${b.missed.length}개 (${few(b.missed, 3)})` : "";
		const cont = rest ? ` 남은 ${rest}개는 ${again} 로 이어 갑니다.` : "";
		const reason: Record<string, string> = {
			abort: "Esc",
			error: "오류. 잠시 뒤에",
			unfinished: "답이 끝나지 않음",
			user: "다른 요청이 들어옴",
		};
		if (why === "done") return ctx.ui.notify(`위키 반영을 마쳤습니다: ${b.ok.length}개 반영${missed}.${cont}`, b.missed.length ? "warning" : "info");
		if (why === "miss")
			return ctx.ui.notify(
				`원본 2개가 연달아 위키에 반영되지 않아 멈췄습니다 (${few(b.missed.slice(-2))}). 모델의 답을 보고 고친 뒤 ${again} (계획 모드면 /plan 으로 끈 뒤). 반영 ${b.ok.length}개.${cont}`,
				"warning",
			);
		ctx.ui.notify(`위키 반영을 멈췄습니다 (${reason[why] || why}): ${b.ok.length}개 반영${missed}.${cont}`, "warning");
	};
	/** 요청 하나가 끝난 뒤: 그 원본이 반영됐는지 보고 다음 원본을 보내거나 끝냄 */
	const step = (ctx: any) => {
		const b = batch;
		if (!b) return;
		const rel = b.items[b.i];
		const done = reflectedRaw(rawFilesOf(b.root), loadPages(b.root)).has(rel);
		if (b.stop) {
			if (done) b.ok.push(rel); // 멈춘 원본이 반영되지 않았으면 남은 것으로 셈
			return finish(ctx, b.stop);
		}
		if (done) {
			b.ok.push(rel);
			b.streak = 0;
		} else {
			b.missed.push(rel);
			b.streak++;
		}
		if (b.streak >= 2) return finish(ctx, "miss");
		b.i++;
		if (b.i >= b.items.length) return finish(ctx, "done");
		sendItem(ctx);
	};

	pi.registerTool({
		name: "wiki_search",
		label: "위키 찾기",
		description: "켜진 위키에서 찾기. 맞는 페이지의 [[제목]]·경로·요약과 맞은 줄을 돌려준다 (짧게). 읽을 때는 wiki_read",
		parameters: Type.Object({
			query: Type.String({ description: "찾을 말 (여러 단어 가능)" }),
			limit: Type.Optional(Type.Number({ description: "최대 개수 (기본 8)" })),
		}),
		async execute(_id: string, params: any) {
			const { root } = need();
			const pages = loadPages(root);
			return result(formatSearch(params.query, search(pages, String(params.query || ""), Number(params.limit) || 8), pages.length));
		},
	});

	pi.registerTool({
		name: "wiki_read",
		label: "위키 읽기",
		description:
			"위키 파일 읽기 (pages/·raw/·index.md·log.md·WIKI.md). path 에 위키 안 경로나 페이지 제목, 여러 개는 paths. 합쳐 5500자까지, 길면 이어 읽을 offset 을 알려 준다",
		parameters: Type.Object({
			path: Type.Optional(Type.String({ description: "위키 안 경로 또는 페이지 제목" })),
			paths: Type.Optional(Type.Array(Type.String(), { description: "여러 개를 한 번에" })),
			offset: Type.Optional(Type.Number({ description: "몇째 줄부터 (path 하나일 때)" })),
			limit: Type.Optional(Type.Number({ description: "몇 줄 (path 하나일 때)" })),
		}),
		async execute(_id: string, params: any) {
			const { root } = need();
			const targets = [...(Array.isArray(params.paths) ? params.paths : []), ...(params.path ? [params.path] : [])].map(String);
			if (!targets.length) throw new Error("path 또는 paths 를 주세요 (예: index.md)");
			const one = targets.length === 1;
			return result(readTargets(root, loadPages(root), targets, one ? Number(params.offset) || 1 : 1, one ? Number(params.limit) || 0 : 0));
		},
	});

	pi.registerTool({
		name: "wiki_write",
		label: "위키 쓰기",
		description:
			"위키 페이지 쓰기 (pages/ 아래만, 여러 페이지를 한 번에). text 에 페이지마다 '=== pages/<분류>/<제목>.md' 줄, 이어서 머리말(--- title / summary / type / sources ---)과 본문. " +
			"링크는 [[페이지 제목]]. 목록(index.md)과 기록(log.md)은 자동. op(ingest·query·lint·note)와 title 은 기록에 남는다." +
			(isBridge() ? " 이스케이프 없이 ```text 블록에 '@tool wiki_write op=ingest title=\"제목\"' 줄 다음에 text 를 이어 써도 된다" : ""),
		parameters: Type.Object({
			text: Type.String({ description: "'=== pages/<분류>/<제목>.md' 줄로 나눈 페이지들 (머리말 포함)" }),
			op: Type.Optional(Type.String({ description: "ingest | query | lint | note" })),
			title: Type.Optional(Type.String({ description: "기록에 남길 제목" })),
		}),
		async execute(_id: string, params: any) {
			const { root, name } = need();
			const r = await locked(() => applyWrite(root, name, String(params.text || ""), String(params.op || "note"), String(params.title || "")));
			const lines = [
				r.written.length ? `썼습니다 ${r.written.length}쪽: ${r.names.map((n) => `[[${n}]]`).join(", ")} (목록·기록 고침)` : "쓴 페이지 없음",
				...r.errors.map((e) => `오류: ${e}`),
				...r.warnings.map((w) => `참고: ${w}`),
			];
			if (!r.written.length) throw new Error(lines.join("\n"));
			return result(lines.join("\n"));
		},
	});

	pi.registerCommand("wiki", {
		description: "LLM 위키: /wiki (상태), init [이름] [폴더], use <이름>, off, ingest <raw/ 파일·폴더>, ask <질문>, save [제목], lint, reindex",
		handler: async (args: string, ctx: any) => {
			const [sub = "", ...rest] = (args || "").trim().split(/\s+/);
			const arg = rest.join(" ").trim();
			const cfg = readConfig();
			const notify = (m: string, level = "info") => ctx.ui.notify(m, level);
			if (sub === "init") {
				const name = rest[0] || "모델운영";
				const root = wikiDir(rest.slice(1).join(" ")) || cfg.wikis[name] || defaultDir(name);
				const made = await locked(() => initWiki(root, name));
				cfg.wikis[name] = slash(root);
				cfg.active = name;
				writeConfig(cfg);
				applyTools(true);
				status(ctx);
				return notify(`위키 '${name}' 를 켰습니다: ${slash(root)}${made.length ? ` (만듦: ${made.join(", ")})` : ""}. Obsidian 같은 마크다운 편집기로 이 폴더를 열어 보면 됩니다 (Obsidian 은 보관소(vault)로 열기)`);
			}
			if (sub === "use") {
				if (!cfg.wikis[arg]) return notify(`등록되지 않은 위키입니다: ${arg || "(이름 없음)"}. 있는 위키: ${Object.keys(cfg.wikis).join(", ") || "없음"}`, "warning");
				cfg.active = arg;
				writeConfig(cfg);
				applyTools(true);
				status(ctx);
				return notify(`위키 '${arg}' 를 켰습니다: ${cfg.wikis[arg]}`);
			}
			if (sub === "off") {
				cfg.active = "";
				writeConfig(cfg);
				applyTools(false);
				status(ctx);
				return notify("위키를 껐습니다 (위키 도구도 모델에게 보이지 않음). 다시 켜기: /wiki use <이름>");
			}
			const c = current();
			if (!c.root) return notify(`켜진 위키가 없습니다. /wiki init [이름] [폴더] 로 만들거나 /wiki use <이름> (있는 위키: ${Object.keys(cfg.wikis).join(", ") || "없음"})`, "warning");
			if (sub === "ingest") {
				if (!arg) return notify("/wiki ingest <raw/ 안의 파일·폴더> (예: /wiki ingest 회의록.md, /wiki ingest 회의록). raw/ 전체는 /wiki ingest raw", "warning");
				if (batch) return notify(`폴더째 반영 중입니다 (${batch.i + 1}/${batch.items.length}). 멈추려면 Esc`, "warning");
				const t = rawTarget(c.root, arg);
				if (t.many)
					return notify(`'${arg}' 에 맞는 원본이 여러 개입니다. 경로를 적어 주세요: ${t.many.slice(0, 6).map((r) => r.slice(4)).join(", ")}${t.many.length > 6 ? ` 외 ${t.many.length - 6}개` : ""}`, "warning");
				if (!t.rel) return notify(`raw/ 에서 찾지 못했습니다: ${arg}. 원본은 위키의 raw/ 폴더(${slash(c.root)}/raw)에 넣고, raw/ 안의 경로나 이름을 적으세요`, "warning");
				const pages = loadPages(c.root);
				if (!t.dir) {
					if (rawKind(c.root, t.rel) === "binary") return notify(`${t.rel} 은 글(텍스트)이 아니라 반영하지 못합니다. 문서는 텍스트(.md·.txt)로 바꿔 raw/ 에 넣으세요`, "warning");
					return send(ingestPrompt(c.name, t.rel, sourceTitle(t.rel, rawFilesOf(c.root), pages)));
				}
				// 폴더째: 원본 하나를 요청 하나로 차례로 (한 요청에 몰면 대화가 길어지고, 끊기면 어디까지 했는지 알기 어려움)
				if (!ctx.hasUI) return notify("폴더째 반영은 pi 화면에서 합니다 (물어볼 수 없는 실행 방식)", "warning");
				if (!ctx.isIdle()) return notify("지금 하는 작업이 끝난 뒤 다시 입력해 주세요", "warning");
				const plan = planIngest(c.root, t.rel, pages);
				const where = t.rel === "raw" ? "raw/ 전체" : `${t.rel.slice(4)} 폴더`;
				const skipped = [
					plan.done.length ? `이미 반영함 ${plan.done.length}개` : "",
					plan.binary.length ? `글이 아니라 뺌 ${plan.binary.length}개 (${few(plan.binary)}: 텍스트로 바꿔 넣기)` : "",
					plan.big.length ? `커서 뺌 ${plan.big.length}개 (${few(plan.big)}: 하나씩 /wiki ingest <경로>)` : "",
				].filter(Boolean);
				if (!plan.items.length) return notify(`${where}에 반영할 원본이 없습니다${skipped.length ? ` (${skipped.join(", ")})` : ""}`, "info");
				const lines = [`이번에 반영: ${plan.items.length}개 (${byFolder(plan.items)})`];
				if (plan.later.length) lines.push(`다음에: ${plan.later.length}개 (한 번에 ${INGEST_LIMIT}개까지. 끝난 뒤 같은 명령으로 이어 감)`);
				lines.push(...skipped, "", "원본 하나를 요청 하나로 차례로 보냅니다. Esc 로 멈추고, 같은 명령으로 남은 것부터 이어 갑니다.");
				if (isBridge()) lines.push("Copilot·사내AI 는 원본 하나에 4~12번 오갑니다. 사용량 제한이 있는 계정이면 내 설정 파일의 max_questions_per_minute 를 2 정도로 두세요.");
				if (!(await ctx.ui.confirm(`${where}의 원본 ${plan.items.length}개를 위키에 반영할까요?`, lines.join("\n")))) return notify("위키 반영을 하지 않았습니다", "info");
				batch = { name: c.name, root: c.root, dir: t.rel, items: plan.items, i: 0, ok: [], missed: [], streak: 0, stop: "", later: plan.later.length, prompt: "", sent: false };
				return sendItem(ctx);
			}
			if (sub === "ask") {
				if (!arg) return notify("/wiki ask <질문>", "warning");
				return send(`'${c.name}' 위키를 근거로 답해 줘. 먼저 wiki_search 로 찾고 wiki_read 로 읽은 뒤, 답 끝에 근거 페이지를 [[제목]] 으로 밝혀 줘. 위키에 없으면 없다고 말해 줘.\n\n질문: ${arg}`);
			}
			if (sub === "save") {
				if (!lastAnswer.trim()) return notify("저장할 답이 없습니다 (pi 의 답이 나온 뒤에 /wiki save)", "warning");
				const t = pageName(arg || `${today()} ${lastPrompt.split("\n")[0].slice(0, 30)}`) || `${today()} 답`;
				const summary = lastAnswer.replace(/\s+/g, " ").trim().slice(0, 100);
				const body = `---\ntitle: ${t}\nsummary: ${summary.replace(/^[-#>*\s]+/, "")}\ntype: answer\nsources: []\n---\n# ${t}\n\n**질문:** ${lastPrompt.trim()}\n\n${lastAnswer.trim()}\n`;
				const r = await locked(() => applyWrite(c.root, c.name, `=== pages/answer/${t}.md\n${body}`, "query", t));
				return r.written.length ? notify(`저장했습니다: [[${r.names[0]}]] (${r.written[0]})`) : notify(r.errors.join("\n"), "error");
			}
			if (sub === "lint") {
				const text = formatLint(lint(c.root, c.name));
				show(ctx, text);
				return notify(text.split("\n")[0]);
			}
			if (sub === "reindex") {
				const changed = await locked(() => reindex(c.root, c.name));
				return notify(changed ? "목록(index.md)을 다시 만들었습니다" : "목록(index.md)이 이미 페이지와 같습니다");
			}
			// 상태
			if (shown) return show(ctx, undefined);
			const pages = loadPages(c.root);
			const r = lint(c.root, c.name, pages);
			let recent: string[] = [];
			try {
				recent = readFileSync(join(c.root, "log.md"), "utf8").split(/\r?\n/).filter((l) => l.startsWith("## [")).slice(-3);
			} catch {}
			show(
				ctx,
				[
					`── 위키 '${c.name}' (닫기: /wiki 다시 입력) ──`,
					` 폴더  ${slash(c.root)}   (Obsidian 보관소로 열기)`,
					` 페이지 ${pages.length}쪽 · 반영 안 된 원본 ${r.rawUnused.length}개 · 깨진 링크 ${r.broken.length}개 · 모델이 알아서 쓰기: ${c.cfg.auto}`,
					` 최근  ${recent.length ? recent.map((l) => l.slice(3)).join("\n       ") : "(기록 없음)"}`,
					" 명령  /wiki ingest <raw/ 파일·폴더> · ask <질문> · save [제목] · lint · reindex · use <이름> · off",
				].join("\n"),
			);
		},
	});

	pi.on("session_start", async (_event: unknown, ctx: any) => {
		batch = null; // 새 세션에서는 폴더째 반영을 이어 가지 않음 (같은 명령으로 남은 것부터)
		applyTools(!!current().root);
		status(ctx);
	});

	// 폴더째 반영 중에 사용자가 직접 요청하면 지금 원본까지만 하고 멈춤 (/ 로 시작하는 명령은 그대로)
	pi.on("input", async (event: any) => {
		if (batch && event.source !== "extension" && !String(event.text || "").trim().startsWith("/")) batch.stop ||= "user";
	});

	// 요청이 제대로 끝났는지: 마지막이 끝까지 쓴 답이어야 함 (Esc·오류·도구 실행 중에 끊김이면 멈춤)
	pi.on("agent_end", async (event: any) => {
		if (!batch) return;
		const msgs: any[] = event.messages || [];
		const last = msgs[msgs.length - 1];
		if (!(last?.role === "assistant" && last.stopReason === "stop"))
			batch.stop ||= last?.stopReason === "aborted" ? "abort" : last?.stopReason === "error" ? "error" : "unfinished";
		const asked = batch.prompt;
		if (msgs.some((m) => m?.role === "user" && textOf(m).trim() && !textOf(m).includes(asked))) batch.stop ||= "user";
	});

	pi.on("agent_settled", async (_event: unknown, ctx: any) => {
		if (!batch?.sent) return;
		batch.sent = false;
		setTimeout(() => step(ctx), 0); // 다른 확장의 '끝남' 처리가 늦어지지 않게 따로
	});

	pi.on("before_agent_start", async (event: any) => {
		lastPrompt = String(event.prompt || "");
		const { cfg, name, root } = current();
		if (!root) return;
		const g = event.systemPromptOptions?.promptGuidelines;
		if (!Array.isArray(g)) return;
		for (const line of guideLines(name, root, cfg.auto, readTopic(wikiMd(root), name))) if (!g.includes(line)) g.push(line);
	});

	pi.on("message_end", async (event: any) => {
		const m = event.message;
		if (m?.role === "assistant" && m.stopReason !== "error" && m.stopReason !== "aborted") {
			const t = textOf(m);
			if (t.trim()) lastAnswer = t;
		}
	});

	pi.on("agent_start", async (_event: unknown, ctx: any) => {
		if (shown) show(ctx, undefined);
	});
}
