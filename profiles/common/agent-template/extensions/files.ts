/**
 * @파일: 입력창에서 @ 를 치면 작업 폴더의 파일을 골라 넣고, 보낼 때 그 파일 내용을 요청에 함께 붙인다.
 *
 *  "@src/ma" 까지 치면 목록이 뜨고 Tab 으로 고름  ->  "@src/main.py 의 오류 처리를 고쳐줘"
 *  - pi 의 기본 @ 목록은 fd 프로그램이 있어야 나온다. 없으면(사내 PC 등) 여기서 작업 폴더를 직접 훑어 보여 준다.
 *    jupyter 모드에서는 노트북 작업 폴더의 파일을 보여 준다 (중계 서버로 find). 목록은 30초 동안 기억하고, 요청이 끝나면 새로 읽는다
 *  - .git, node_modules, __pycache__, .venv, venv, .ipynb_checkpoints 등은 건너뛴다. 6단계 깊이, 5000개까지
 *  - 보낼 때: @경로 가 텍스트 파일이면 내용을 <file name="경로"> ... </file> 로 요청 앞에 붙인다 (LLM 이 따로 읽는 왕복이 준다).
 *    파일 하나 6000자, 모두 8000자까지 (넘으면 앞부분만 붙이고 나머지는 LLM 이 read 로). 파일은 5개까지.
 *    폴더·바이너리·노트북(.ipynb)·없는 파일은 붙이지 않는다 (글은 그대로). "@a.py의" 처럼 조사가 붙어도 찾는다
 *  - / 로 시작하는 명령·템플릿은 건드리지 않는다
 */

import { promises as fsp } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { nbRun, readHead, shown, shq, target, type WorkDir, workDir } from "./lib/relay.ts";

export type Entry = { path: string; dir: boolean }; // 작업 폴더 기준 상대 경로 (/ 구분)
const SKIP = [".git", "node_modules", "__pycache__", ".venv", "venv", ".ipynb_checkpoints", ".mypy_cache", ".pytest_cache", ".tox", ".idea", ".cache"];
const SKIP_SET = new Set(SKIP);
const MAX_DEPTH = 6;
const MAX_ENTRIES = 5000;
const CACHE_MS = 30_000;
const PER_FILE = 6000;
const TOTAL = 8000;
const MAX_REFS = 5;

/** PC 폴더 훑기 (얕은 것부터, 깊이·개수 제한, 링크 폴더는 따라가지 않음) */
export async function walkLocal(root: string): Promise<Entry[]> {
	const out: Entry[] = [];
	let level = [""];
	for (let depth = 0; depth < MAX_DEPTH && level.length && out.length < MAX_ENTRIES; depth++) {
		const next: string[] = [];
		for (const rel of level) {
			let items;
			try {
				items = await fsp.readdir(join(root, rel), { withFileTypes: true });
			} catch {
				continue;
			}
			items.sort((a, b) => a.name.localeCompare(b.name));
			for (const d of items) {
				if (out.length >= MAX_ENTRIES) break;
				const dir = d.isDirectory();
				if (dir && SKIP_SET.has(d.name)) continue;
				const p = rel ? `${rel}/${d.name}` : d.name;
				out.push({ path: p, dir });
				if (dir) next.push(p);
			}
		}
		level = next;
	}
	return out;
}

const REMOTE_FIND =
	`find . -mindepth 1 -maxdepth ${MAX_DEPTH} \\( ${SKIP.map((n) => `-name ${shq(n)}`).join(" -o ")} \\) -prune -o -printf '%y %P\\n' 2>/dev/null | head -n ${MAX_ENTRIES}`;

/** 노트북 폴더 목록 (중계 서버로 find) */
async function listRemote(cwd: string): Promise<Entry[]> {
	const r = await nbRun(REMOTE_FIND, cwd);
	return r.out
		.split("\n")
		.filter((l) => l.length > 2)
		.map((l) => ({ dir: l[0] === "d", path: l.slice(2) }));
}

const cache = new Map<string, { at: number; list: Promise<Entry[]> }>();
function listing(wd: WorkDir): Promise<Entry[]> {
	const key = (wd.remote ? "nb:" : "pc:") + wd.cwd;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;
	const list = wd.remote ? listRemote(wd.cwd) : walkLocal(wd.cwd);
	cache.set(key, { at: Date.now(), list });
	list.catch(() => cache.delete(key));
	return list;
}

const subseq = (s: string, q: string) => {
	let i = 0;
	for (const c of s) if (c === q[i]) i++;
	return i === q.length;
};

/** 친 글자와 맞는 것 (이름 앞부분 > 이름 안 > 경로 앞부분 > 경로 안 > 글자 순서), 얕고 짧은 것 먼저 */
export function rank(entries: Entry[], query: string, limit = 20): Entry[] {
	const q = query.toLowerCase();
	const scored: { e: Entry; s: number; depth: number }[] = [];
	for (const e of entries) {
		const p = e.path.toLowerCase();
		const name = p.slice(p.lastIndexOf("/") + 1);
		const s = !q ? 1 : name.startsWith(q) ? 100 : name.includes(q) ? 80 : p.startsWith(q) ? 70 : p.includes(q) ? 60 : subseq(p, q) ? 20 : 0;
		if (s) scored.push({ e, s, depth: e.path.split("/").length });
	}
	scored.sort((a, b) => b.s - a.s || a.depth - b.depth || a.e.path.length - b.e.path.length || a.e.path.localeCompare(b.e.path));
	return scored.slice(0, limit).map((x) => x.e);
}

/** 커서 앞의 @글자 (따옴표로 시작한 @"공백 있는 경로 도 됨). 없으면 null */
export function atPrefix(before: string): string | null {
	const m = before.match(/(?:^|[\s(])(@(?:"[^"]*|[^\s"]*))$/);
	return m ? m[1] : null;
}

const item = (e: Entry, quoted: boolean) => {
	const p = e.dir ? `${e.path}/` : e.path;
	const value = quoted || /\s/.test(p) ? `@"${p}"` : `@${p}`;
	return { value, label: e.path.slice(e.path.lastIndexOf("/") + 1) + (e.dir ? "/" : ""), description: p };
};
const same = (a: string, b: string) => a.split("\\").join("/").replace(/\/+$/, "").toLowerCase() === b.split("\\").join("/").replace(/\/+$/, "").toLowerCase();

/** pi 의 자동완성에 덧씌움: @ 일 때 fd 없이도, jupyter 모드면 노트북 파일로 */
export function wrapProvider(base: any, list: (wd: WorkDir) => Promise<Entry[]> = listing, wdOf: () => WorkDir = workDir) {
	const w = Object.create(base);
	w.triggerCharacters = [...new Set([...(base.triggerCharacters || []), "@"])];
	w.getSuggestions = async (lines: string[], line: number, col: number, options: any) => {
		const prefix = atPrefix((lines[line] || "").slice(0, col));
		if (!prefix) return base.getSuggestions(lines, line, col, options);
		const wd = wdOf();
		if (!wd.remote && same(wd.cwd, process.cwd())) {
			const r = await base.getSuggestions(lines, line, col, options); // pi 기본 (fd 가 있으면 나옴)
			if (r?.items?.length) return r;
		}
		let entries: Entry[];
		try {
			entries = await list(wd);
		} catch {
			return null;
		}
		if (options?.signal?.aborted) return null;
		const quoted = prefix.startsWith('@"');
		const items = rank(entries, prefix.slice(quoted ? 2 : 1)).map((e) => item(e, quoted));
		return items.length ? { items, prefix } : null;
	};
	return w;
}

/** 요청 글의 @경로 들 (중복 없이, 앞에서부터) */
export function refsOf(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(/(?:^|[\s(])@(?:"([^"]+)"|([^\s"]+))/g)) {
		const r = (m[1] ?? m[2]).replace(/[.,;:!?)\]}'"]+$/, "");
		if (r && !out.includes(r)) out.push(r);
	}
	return out;
}

/** @경로 들의 내용 (붙일 수 있는 것만) -> <file> 덩어리들 */
export async function attachments(text: string, wd: WorkDir = workDir()): Promise<string[]> {
	const parts: string[] = [];
	let room = TOTAL;
	for (const ref of refsOf(text).slice(0, MAX_REFS)) {
		if (room < 200) break;
		// "@a.py의" 처럼 조사가 붙은 경우: 그대로 없으면 끝의 한글을 떼고 다시
		let found = null as Awaited<ReturnType<typeof readHead>>;
		let t = target(ref, wd);
		for (const cand of [...new Set([ref, ref.replace(/[\uAC00-\uD7A3]+$/, "")])]) {
			if (!cand || /\.ipynb$/i.test(cand)) continue;
			t = target(cand, wd);
			try {
				found = await readHead(t, PER_FILE * 3);
			} catch {
				found = null;
			}
			if (found) break;
		}
		if (!found || found.data.includes(0)) continue;
		let body = found.data.toString("utf8").replace(/\uFFFD$/, "");
		const limit = Math.min(PER_FILE, room);
		let more = found.size > found.data.length;
		if (body.length > limit) {
			body = body.slice(0, limit);
			more = true;
		}
		room -= body.length;
		const note = more ? `\n(… 앞부분 ${body.length}자만 붙임. 전체 ${found.size}바이트, 나머지는 read 로 읽으세요)` : "";
		parts.push(`<file name="${shown(t, wd)}">\n${body}${body.endsWith("\n") ? "" : "\n"}</file>${note}`);
	}
	return parts;
}

export default function (pi: ExtensionAPI) {
	let added = false;
	pi.on("session_start", async (_event: unknown, ctx: any) => {
		if (added || !ctx.hasUI || !ctx.ui.addAutocompleteProvider) return;
		added = true;
		ctx.ui.addAutocompleteProvider((base: any) => wrapProvider(base));
	});
	pi.on("agent_end", async () => cache.clear()); // 파일이 바뀌었을 수 있음

	pi.on("input", async (event: any) => {
		const text = String(event.text || "");
		if (!text.includes("@") || text.startsWith("/")) return;
		const parts = await attachments(text);
		if (!parts.length) return;
		return { action: "transform", text: `${parts.join("\n")}\n\n${text}` };
	});
}
