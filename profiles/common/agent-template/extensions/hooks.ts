/**
 * 키트 훅: 문서 규칙, /hooks (훅 목록·켜고 끄기), 위험 명령 확인이 꺼져 있을 때의 경고
 *
 * 문서 규칙 (2026-10: Copilot 이 작업 하나에 계획·이력 문서를 단계마다 새로 만들어 50개가 되었고, 목록 문서에 링크도 달지 않았음)
 *  - 작업 폴더에 새 Markdown 문서가 생기면 목록 문서(docs/INDEX.md)에 링크를 이 코드가 더한다 (모델에게 맡기지 않음).
 *    목록 문서가 없으면 프로젝트마다 한 번 만들지 묻는다 (답은 ~/.pi/agent/doc-rules.json)
 *  - 한 요청에서 새 문서가 doc_new_limit(2)개를 넘으면 한 번 묻고, 그 요청 동안 같은 답을 쓴다
 *  - 이력 문서로 보이는 새 문서는 HISTORY.md 하나에 이어 쓰게 할지, 같은 세션의 두 번째 계획 문서는 만들지 묻는다
 *  - bash 로 만드는 문서(cat > x.md, tee x.md)도 같게 본다 (write 를 막아도 bash 로 돌아가지 않게)
 *  지키는 것 (사용자가 만든 훅이 계획 문서가 없으면 조회까지 막아, 결국 모든 훅을 꺼야 했던 일 때문):
 *  - 읽기·조회는 보지 않는다. 막는 것은 새 문서 쓰기뿐이고, 사용자가 '아니요' 라고 답했을 때만
 *  - 화면이 없는 실행(pi -p 등)에서는 묻지도 막지도 않고 도구 결과에 안내만 붙인다
 *  - 계획 모드에서는 하지 않는다 (쓰기가 막혀 있음). 확인 모드에서는 쓰기마다 확인 모드가 물으므로 묻지 않고 안내·목록 링크만
 *  - 한 답의 도구 호출은 동시에 돌 수 있으므로 판단과 목록 고치기는 한 번에 하나씩
 * 설정 (내 설정 파일 bridge.json): "doc_rules": false (끔), "doc_index": "docs/INDEX.md", "doc_new_limit": 2
 *
 * /hooks: 키트 훅(위험 명령 확인, 문서 규칙)과 내 훅(extensions 폴더의 키트 밖 파일)을 보여 주고 켜고 끈다.
 *   '/hooks off mine' 은 내 훅만 끈다 (훅을 모두 끄면서 guard.ts 까지 꺼져 git push 가 묻지 않고 실행된 일 때문).
 *   위험 명령 확인이 꺼져 있으면(guard.ts 가 없거나 "guard": false) 상태 줄에 늘 알린다
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { cleanPath, isPcAbsolute, windowsDrivePath } from "./lib/paths.ts";
import { base, parseShell, strip } from "./lib/shell.ts";

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------

/** 키트가 설치하는 확장 (install.sh·update.sh 의 KIT_EXT 와 같게. tests/test_hooks.mjs 가 확인). 이 밖의 파일이 '내 훅' */
export const KIT_EXT = ["copilot-session.ts", "jupyter.ts", "guard.ts", "notify.ts", "kit.ts", "undo.ts", "modes.ts", "memory.ts", "files.ts", "wiki.ts", "hooks.ts"];

const agentDir = () => process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
const userConfigFile = () => process.env.PI_COPILOT_USER_CONFIG || join(agentDir(), "bridge.json");
const stateFile = () => join(agentDir(), "doc-rules.json");
export const extDir = () => join(agentDir(), "extensions");

function readJson(p: string): any {
	try {
		const v = JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
		return v && typeof v === "object" && !Array.isArray(v) ? v : {};
	} catch {
		return {};
	}
}

/** 내 설정 파일에 값 하나를 쓴다 (다른 값은 그대로, undefined 면 지움). 형식이 틀린 파일은 고치지 않고 오류 */
export function saveSetting(key: string, value: unknown, file = userConfigFile()) {
	let raw = "";
	try {
		raw = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
	} catch (e: any) {
		if (e?.code !== "ENOENT") throw e;
	}
	const v = raw.trim() ? JSON.parse(raw) : {};
	if (value === undefined) delete v[key];
	else v[key] = value;
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(v, null, 2)}\n`);
}

export type DocCfg = { on: boolean; index: string; limit: number };
/** 설정의 상대 경로 정리 (앞의 ./, 끝의 /). 절대 경로·.. 이 든 경로는 null */
function relSetting(s: unknown): string | null {
	if (typeof s !== "string") return null;
	const t = s.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
	if (!t || t.startsWith("/") || /^[a-zA-Z]:/.test(t) || t.split("/").includes("..")) return null;
	return t;
}
export function docCfg(v: any = readJson(userConfigFile())): DocCfg {
	const lim = Number(v.doc_new_limit);
	return { on: v.doc_rules !== false, index: relSetting(v.doc_index) || "docs/INDEX.md", limit: Number.isInteger(lim) && lim >= 0 ? lim : 2 };
}

/** 지침에 더하는 문서 규칙 (늘 같은 글: 바뀌면 Copilot·사내AI 가 새 대화를 엶) */
export const DOC_GUIDE =
	"문서 규칙: 한 일·바뀐 점(이력)은 새 문서로 만들지 말고 프로젝트의 HISTORY.md 하나에 '## 날짜 제목' 절로 이어 쓴다. " +
	"계획 문서는 작업마다 하나만 두고 다음 단계는 그 문서를 고친다. 새 문서는 꼭 필요할 때만 만든다 (문서 목록에는 pi 가 링크를 더한다).";

// ---------------------------------------------------------------------------
// 문서 가리기 (시험할 수 있게 순수 함수로)
// ---------------------------------------------------------------------------

const NO_RULES = new Set(["index.md", "readme.md", "agents.md", "claude.md", "notes.md", "skill.md", "changelog.md", "license.md", "contributing.md"]);
const NO_LINK = new Set(["agents.md", "claude.md", "notes.md", "skill.md"]);
const nameOf = (rel: string) => rel.split("/").pop() || rel;

/** 문서 규칙이 보는 파일: Markdown, 숨김 폴더·node_modules 밖 (경로는 작업 폴더 기준) */
export function isDoc(rel: string): boolean {
	return /\.(md|markdown)$/i.test(rel) && !rel.split("/").some((s) => s.startsWith(".") || s === "node_modules");
}

export type DocKind = "history" | "plan" | "doc";
/** 파일 이름으로 본 문서 종류: 이력(이력·작업 기록·진행 상황·worklog 등), 계획(계획·plan·todo·할 일), 그 밖 */
export function docKind(rel: string): DocKind {
	const n = nameOf(rel).replace(/\.(md|markdown)$/i, "").toLowerCase();
	if (/(이력|히스토리|history|작업[\s_-]*(기록|내역)|변경[\s_-]*(내역|이력)|진행[\s_-]*(기록|상황)|work-?log|dev-?log)/.test(n)) return "history";
	if (/(계획|플랜|todo|할[\s_-]*일)/.test(n) || /(^|[^a-z])plans?([^a-z]|$)/.test(n)) return "plan";
	return "doc";
}
/** 개수·이력·계획 규칙을 보지 않는 문서: 목록 문서, README 같은 정해진 이름 (이력 파일 자신은 tool_call 에서 따로) */
export const ruleFree = (rel: string, index: string) => rel.toLowerCase() === index.toLowerCase() || NO_RULES.has(nameOf(rel).toLowerCase());
/** 목록에 링크하지 않는 문서: 목록 문서 자신, 맨 위 README, 지침·메모·스킬 파일 */
export const linkFree = (rel: string, index: string) =>
	rel.toLowerCase() === index.toLowerCase() || rel.toLowerCase() === "readme.md" || NO_LINK.has(nameOf(rel).toLowerCase());

/** 목록에 적을 제목: 문서의 첫 '# 제목', 없으면 파일 이름 */
export function docTitle(content: unknown, rel: string): string {
	const m = typeof content === "string" ? content.match(/^#\s+(.+?)\s*#*\s*$/m) : null;
	const t = (m ? m[1] : nameOf(rel).replace(/\.(md|markdown)$/i, "")).replace(/[[\]]/g, "").trim();
	return t.length > 80 ? `${t.slice(0, 79)}…` : t;
}
/** 목록 문서에서 본 링크 대상 (빈칸은 %20) */
export const linkTarget = (index: string, rel: string) => posix.relative(posix.dirname(index), rel).replace(/ /g, "%20");

export const NEW_INDEX = "# 문서 목록\n\n이 프로젝트의 문서입니다. pi 가 새 문서를 만들면 아래에 링크를 더합니다 (문서 규칙: pi 의 /hooks).\n\n## 문서\n";
/** 목록 글에 링크 줄을 더한 글 ('## 문서' 절 끝에, 없으면 절을 만듦). 그 대상의 링크가 이미 있으면 null */
export function addLink(text: string, line: string, target: string): string | null {
	if (text.includes(`](${target})`)) return null;
	const nl = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	const h = lines.findIndex((l) => /^##\s+문서\s*$/.test(l));
	if (h < 0) return `${text.replace(/\s+$/, "")}${nl}${nl}## 문서${nl}${line}${nl}`;
	let end = lines.length;
	for (let i = h + 1; i < lines.length; i++)
		if (/^#{1,2}\s/.test(lines[i])) {
			end = i;
			break;
		}
	let at = end;
	while (at > h + 1 && !lines[at - 1].trim()) at--;
	lines.splice(at, 0, line);
	return lines.join(nl);
}

export type WorkDir = { remote: boolean; cwd: string; home?: string };
/** 도구에 준 경로 -> 작업 폴더 기준 상대 경로 (/ 로). 작업 폴더 밖이면 null (그쪽은 위험 명령 확인이 봄).
 *  jupyter 모드는 노트북 경로 (~ 는 노트북 홈, C:/... 는 PC 파일이라 null) */
export function projectRel(p: unknown, wd: WorkDir): string | null {
	let s = cleanPath(p).trim().replace(/\\/g, "/");
	if (!s) return null;
	if (wd.remote) {
		if (isPcAbsolute(s)) return null;
		if (s === "~" || s.startsWith("~/")) s = (wd.home || "/home/jovyan") + s.slice(1);
		const r = posix.relative(wd.cwd, posix.resolve(wd.cwd, s));
		return r && !r.startsWith("..") && !posix.isAbsolute(r) ? r : null;
	}
	s = windowsDrivePath(s);
	if (s === "~" || s.startsWith("~/")) s = homedir().replace(/\\/g, "/") + s.slice(1);
	const r = relative(wd.cwd, resolve(wd.cwd, s)).replace(/\\/g, "/");
	return r && !r.startsWith("..") && !isAbsolute(r) ? r : null;
}

/** 이 도구 호출이 만들 수 있는 Markdown 파일: write 의 path, bash 의 > 파일·>> 파일·tee 파일 (content 는 write 만) */
export function docTargets(toolName: string, input: any): { path: string; content?: string }[] {
	const out: { path: string; content?: string }[] = [];
	if (toolName === "write" && typeof input?.path === "string") out.push({ path: input.path, content: input.content });
	else if (toolName === "bash" && typeof input?.command === "string") {
		try {
			for (const pl of parseShell(input.command).pipelines)
				for (const cmd of pl) {
					for (const r of cmd.redirects) out.push({ path: r });
					const { rest } = strip(cmd.words);
					if (rest.length && base(rest[0]) === "tee") for (const a of rest.slice(1)) if (!a.startsWith("-")) out.push({ path: a });
				}
		} catch {}
	}
	return out.filter((t, i) => /\.(md|markdown)$/i.test(t.path) && out.findIndex((u) => u.path === t.path) === i);
}

// ---------------------------------------------------------------------------
// 파일 (PC 는 Node fs, jupyter 모드는 jupyter.ts 가 여는 노트북 파일 기능)
// ---------------------------------------------------------------------------

export type Fs = { abs(rel: string): string; exists(p: string): Promise<boolean>; read(p: string): Promise<string | null>; write(p: string, text: string): Promise<void> };
export function fsFor(wd: WorkDir): Fs | null {
	if (wd.remote) {
		const r = (globalThis as any).__piRemoteFs;
		if (!r) return null;
		return {
			abs: (rel) => posix.join(wd.cwd, rel),
			exists: async (p) => {
				try {
					await r.stat(p);
					return true;
				} catch (e: any) {
					if (e?.code === "ENOENT") return false;
					throw e;
				}
			},
			read: async (p) => {
				try {
					return await r.read(p);
				} catch {
					return null;
				}
			},
			write: (p, t) => r.write(p, t),
		};
	}
	return {
		abs: (rel) => join(wd.cwd, rel),
		exists: async (p) => existsSync(p),
		read: async (p) => {
			try {
				return readFileSync(p, "utf8");
			} catch {
				return null;
			}
		},
		write: async (p, t) => {
			mkdirSync(dirname(p), { recursive: true });
			writeFileSync(p, t);
		},
	};
}

// ---------------------------------------------------------------------------
// 훅 상태 (/hooks)
// ---------------------------------------------------------------------------

/** 위험 명령 확인이 켜져 있는지: guard.ts 가 있고 "guard": false 가 아님 */
export function guardState(dir = extDir(), cfg: any = readJson(userConfigFile())): { on: boolean; why?: string } {
	if (!existsSync(join(dir, "guard.ts"))) return { on: false, why: existsSync(join(dir, "guard.ts.off")) ? "guard.ts.off" : "guard.ts 없음" };
	if (cfg.guard === false) return { on: false, why: '"guard": false' };
	return { on: true };
}

export type MyHook = { name: string; on: boolean; path: string; folder: boolean };
/** 내 훅: extensions 폴더의 키트 밖 확장 (파일 .ts·.js, index 가 든 폴더). 끈 것은 이름 끝이 .off (폴더는 index.ts.off) */
export function myHooks(dir = extDir()): MyHook[] {
	let names: string[] = [];
	try {
		names = readdirSync(dir);
	} catch {
		return [];
	}
	const out: MyHook[] = [];
	for (const n of names.sort()) {
		if (n === "lib") continue;
		const p = join(dir, n);
		let folder = false;
		try {
			folder = statSync(p).isDirectory();
		} catch {
			continue;
		}
		if (folder) {
			const on = ["index.ts", "index.js"].some((f) => existsSync(join(p, f)));
			if (on || ["index.ts.off", "index.js.off"].some((f) => existsSync(join(p, f)))) out.push({ name: n, on, path: p, folder: true });
			continue;
		}
		const m = n.match(/^(.+\.(?:ts|js))(\.off)?$/);
		if (m && !KIT_EXT.includes(m[1])) out.push({ name: m[1], on: !m[2], path: p, folder: false });
	}
	return out;
}
/** 내 훅 하나 켜기·끄기 (이름 바꾸기). 바꿨으면 true */
export function switchHook(h: MyHook, on: boolean): boolean {
	if (h.on === on) return false;
	if (h.folder) {
		for (const f of ["index.ts", "index.js"]) {
			const a = join(h.path, f);
			if (on && existsSync(`${a}.off`)) renameSync(`${a}.off`, a);
			if (!on && existsSync(a)) renameSync(a, `${a}.off`);
		}
	} else renameSync(h.path, on ? h.path.replace(/\.off$/, "") : `${h.path}.off`);
	return true;
}

// ---------------------------------------------------------------------------
// 확장
// ---------------------------------------------------------------------------

const ENTRY = "pi-docs";
const today = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
type Doc = { rel: string; title: string; kind: DocKind; counted: boolean };
type Pending = { docs: Doc[]; notes: string[] };

export default function (pi: ExtensionAPI) {
	// 요청마다: 새로 만든 문서, '새 문서를 더 만들까요?'·'이력은 HISTORY 로?'·'계획 문서를 또?' 의 답. 세션마다: 만든 계획 문서
	const S: { newDocs: string[]; more?: boolean; history?: boolean; plan?: boolean; plans: string[]; warned: boolean } = ((globalThis as any).__piDocRules ||= {
		newDocs: [],
		plans: [],
		warned: false,
	});
	const pending = new Map<string, Pending>();
	let queue: Promise<unknown> = Promise.resolve();
	/** 한 번에 하나씩 (한 답의 도구 호출이 동시에 돌 때 개수 세기·묻기·목록 고치기가 섞이지 않게) */
	const serial = <T>(fn: () => Promise<T>): Promise<T> => {
		const p = queue.then(fn, fn);
		queue = p.catch(() => {});
		return p;
	};
	const workDir = (ctx: any): WorkDir => (globalThis as any).__piWorkDir || { remote: false, cwd: ctx?.cwd || process.cwd() };
	/** 묻는지: 화면이 있고 확인 모드가 아닐 때 (확인 모드는 쓰기마다 그쪽이 물음) */
	const canAsk = (ctx: any) => !!ctx?.hasUI && (globalThis as any).__piMode !== "ask";
	const post = (ctx: any, lines: string[]) => {
		if (!lines.length || ctx?.mode !== "tui" || typeof pi.appendEntry !== "function") return;
		try {
			pi.appendEntry(ENTRY, { lines });
		} catch {}
	};
	pi.registerEntryRenderer?.(ENTRY, (entry: any, _opts: unknown, theme: any) => {
		const lines = entry?.data?.lines;
		if (!Array.isArray(lines)) return undefined;
		const box = new Box(1, 0, (t: string) => theme.bg("customMessageBg", t));
		box.addChild(new Text([theme.fg("customMessageLabel", theme.bold("[문서]")), ...lines.map((l: string) => theme.fg("customMessageText", String(l)))].join("\n"), 0, 0));
		return box;
	});

	/** 이력 파일: 있는 것 (맨 위 HISTORY.md, 목록 문서 옆 HISTORY.md 차례). 둘 다 없으면 지금 만들려는 것이 그 둘 중 하나면 그것
	 *  (지침대로 맨 위 HISTORY.md 를 처음 만들 때 묻지 않게), 아니면 목록 문서 옆 (기본 docs/HISTORY.md) */
	const historyFile = async (fs: Fs, cfg: DocCfg, rel = "") => {
		const near = posix.join(posix.dirname(cfg.index), "HISTORY.md");
		for (const c of ["HISTORY.md", near]) if (await fs.exists(fs.abs(c)).catch(() => false)) return c;
		return ["history.md", near.toLowerCase()].includes(rel.toLowerCase()) ? rel : near;
	};

	/** 새 문서 하나에 대한 규칙: 막을 이유(모델에게), 결과에 붙일 안내, 대화창 항목 */
	async function rules(rel: string, kind: DocKind, cfg: DocCfg, ctx: any, hist: string): Promise<{ block?: string; note?: string; view?: string }> {
		const ask = canAsk(ctx);
		let allowed = false; // 이 문서로 이미 물었고 '만들어도 됨' (같은 문서로 두 번 묻지 않음)
		if (kind === "history") {
			if (!ask) return { note: `(문서 규칙: 이력은 새 문서 대신 ${hist} 하나에 '## 날짜 제목' 절로 이어 쓰기로 했습니다. 다음부터는 그렇게 하세요)` };
			if (S.history === undefined)
				S.history = await ctx.ui.confirm(
					"이력 문서",
					`새 문서 ${rel} 은(는) 이력 문서로 보입니다. 이력은 ${hist} 하나에 날짜 절로 이어 쓰기로 했습니다.\n\n새로 만들지 않고 ${hist} 에 이어 쓰게 할까요?\n(아니요: ${rel} 을(를) 그대로 만듦)`,
				);
			if (S.history)
				return {
					block:
						`사용자 문서 규칙: 이력(한 일·바뀐 점)은 새 문서(${rel})로 만들지 않고 ${hist} 하나에 '## 날짜 제목' 절로 이어 씁니다. ` +
						`같은 내용을 ${hist} 끝에 덧붙이세요 (없으면 만들고, 있으면 edit 로 끝에 더함). 다른 작업은 그대로 계속하세요.`,
					view: `이력 문서 ${rel} 대신 ${hist} 에 이어 쓰게 함`,
				};
			allowed = true;
		}
		if (kind === "plan" && S.plans.length && !allowed) {
			const last = S.plans[S.plans.length - 1];
			if (!ask) return { note: `(문서 규칙: 계획 문서는 작업마다 하나입니다. 같은 작업이면 새 계획 문서 대신 ${last} 를 고치세요)` };
			if (S.plan === undefined)
				S.plan = await ctx.ui.confirm(
					"계획 문서",
					`이번 세션에서 계획 문서 ${S.plans.join(", ")} 을(를) 이미 만들었습니다.\n새 계획 문서 ${rel} 을(를) 만들까요?\n\n아니요: 만들지 않고, 같은 작업이면 있는 계획 문서를 고치게 합니다.`,
				);
			if (!S.plan)
				return {
					block: `사용자 문서 규칙: 계획 문서는 작업마다 하나입니다. 새 계획 문서(${rel})를 만들지 말고 ${last} 를 고치세요. 다른 작업의 계획이라면 사용자에게 먼저 물어보세요.`,
					view: `두 번째 계획 문서 ${rel}: 만들지 않고 ${last} 를 고치게 함`,
				};
			allowed = true;
		}
		if (S.newDocs.length >= cfg.limit) {
			const list = S.newDocs.join(", ");
			if (!ask) return { note: `(문서 규칙: 이번 요청에서 새 문서가 ${S.newDocs.length + 1}개째입니다 (${list}). 새 문서보다 있는 문서에 이어 쓰세요)` };
			if (S.more === undefined && !allowed)
				S.more = await ctx.ui.confirm(
					"새 문서가 많습니다",
					`이번 요청의 새 문서가 벌써 ${S.newDocs.length}개입니다: ${list}\n또 만들 문서: ${rel}\n\n새 문서를 더 만들까요? (이 요청 동안 같은 답을 씁니다)\n아니요: 만들지 않고 이미 있는 문서에 이어 쓰게 합니다.`,
				);
			if (S.more === false && !allowed)
				return {
					block: `사용자 문서 규칙: 이번 요청에서는 새 문서를 더 만들지 않습니다 (이번 요청의 새 문서: ${list}). ${rel} 에 쓰려던 내용은 그 문서들이나 관련된 기존 문서에 이어 쓰세요.`,
					view: `새 문서 ${rel}: 이번 요청에서 ${S.newDocs.length}개를 넘어 만들지 않게 함`,
				};
		}
		return {};
	}

	/** 새 문서를 목록 문서에 링크 (목록이 없으면 프로젝트마다 한 번 묻고 만듦. 화면이 없으면 만들지 않음) */
	async function linkDoc(d: Doc, cfg: DocCfg, ctx: any, fs: Fs, wd: WorkDir): Promise<{ note: string; view: string } | null> {
		const indexPath = fs.abs(cfg.index);
		let text = await fs.read(indexPath);
		if (text === null) {
			const key = `${wd.remote ? "nb:" : ""}${wd.cwd}`;
			const st = readJson(stateFile());
			const known = st.index && typeof st.index === "object" ? st.index : {};
			let dec = known[key];
			if (dec !== "yes" && dec !== "no") {
				if (!ctx?.hasUI) return { note: `(문서 목록 ${cfg.index} 이 없어 링크를 달지 않았습니다)`, view: "" };
				const yes = await ctx.ui.confirm(
					"문서 목록",
					`새 문서 ${d.rel} 을(를) 만들었습니다.\n이 프로젝트 문서의 링크를 모아 둘 ${cfg.index} 를 만들까요?\n\n` +
						`(프로젝트마다 한 번만 묻습니다. 아니요면 이 프로젝트에서는 만들지 않고, 나중에 ${cfg.index} 를 직접 만들어 두면 그때부터 링크를 더합니다)`,
				);
				dec = yes ? "yes" : "no";
				try {
					writeFileSync(stateFile(), `${JSON.stringify({ ...st, index: { ...known, [key]: dec } }, null, 2)}\n`);
				} catch {}
			}
			if (dec !== "yes") return null;
			text = NEW_INDEX;
		}
		let title = d.title;
		if (title === docTitle(undefined, d.rel)) title = docTitle(await fs.read(fs.abs(d.rel)), d.rel); // bash 로 만든 문서: 파일의 첫 제목
		const target = linkTarget(cfg.index, d.rel);
		const out = addLink(text, `- [${title}](${target}) — ${today()}`, target);
		if (out === null) return null;
		await fs.write(indexPath, out);
		return { note: `(문서 목록 ${cfg.index} 에 링크를 더했습니다: ${d.rel})`, view: `새 문서 ${d.rel} → ${cfg.index} 에 링크` };
	}

	pi.on("agent_start", async () => {
		S.newDocs = [];
		S.more = S.history = S.plan = undefined;
		pending.clear();
	});
	pi.on("session_start", async (event: any, ctx: any) => {
		if (event?.reason !== "reload") {
			S.plans = [];
			S.warned = false;
		}
		showGuard(ctx);
	});

	pi.on("before_agent_start", async (event: any) => {
		if (!docCfg().on) return;
		const g = event?.systemPromptOptions?.promptGuidelines;
		if (Array.isArray(g) && !g.includes(DOC_GUIDE)) g.push(DOC_GUIDE);
	});

	pi.on("tool_call", async (event: any, ctx: any) => {
		if (event.toolName !== "write" && event.toolName !== "bash") return;
		const cfg = docCfg();
		if (!cfg.on || (globalThis as any).__piMode === "plan") return;
		const targets = docTargets(event.toolName, event.input);
		if (!targets.length) return;
		return serial(async () => {
			const wd = workDir(ctx);
			const fs = fsFor(wd);
			if (!fs) return;
			const got: Pending = { docs: [], notes: [] };
			const views: string[] = [];
			for (const t of targets) {
				const rel = projectRel(t.path, wd);
				if (!rel || !isDoc(rel) || S.newDocs.includes(rel) || got.docs.some((d) => d.rel === rel)) continue;
				let exists: boolean;
				try {
					exists = await fs.exists(fs.abs(rel));
				} catch {
					continue; // 노트북 연결 문제 등: 보지 않음
				}
				if (exists) continue;
				const kind = docKind(rel);
				const hist = kind === "history" ? await historyFile(fs, cfg, rel) : "";
				// 이력 파일 자신(HISTORY.md 를 처음 만듦)은 규칙 밖. 다른 곳의 HISTORY.md 는 이력 문서로 봄 (이력 파일이 둘이 되지 않게)
				const counted = !ruleFree(rel, cfg.index) && !(kind === "history" && rel.toLowerCase() === hist.toLowerCase());
				if (counted) {
					let v: { block?: string; note?: string; view?: string };
					try {
						v = await rules(rel, kind, cfg, ctx, hist);
					} catch {
						v = {};
					}
					if (v.block) {
						S.newDocs = S.newDocs.filter((x) => !got.docs.some((d) => d.rel === x)); // 같은 명령으로 셌던 것도 되돌림
						post(ctx, [...views, v.view || ""].filter(Boolean));
						return { block: true, reason: v.block };
					}
					if (v.note) got.notes.push(v.note);
					S.newDocs.push(rel);
				}
				got.docs.push({ rel, title: docTitle(t.content, rel), kind, counted });
			}
			if (got.docs.length) pending.set(event.toolCallId, got);
			post(ctx, views);
		});
	});

	pi.on("tool_result", async (event: any, ctx: any) => {
		const got = pending.get(event.toolCallId);
		if (!got) return;
		pending.delete(event.toolCallId);
		const cfg = docCfg();
		const wd = workDir(ctx);
		const fs = fsFor(wd);
		if (!fs) return;
		const notes = [...got.notes];
		const views: string[] = [];
		await serial(async () => {
			for (const d of got.docs) {
				let made = false;
				try {
					made = await fs.exists(fs.abs(d.rel));
				} catch {}
				if (!made) {
					if (d.counted) S.newDocs = S.newDocs.filter((x) => x !== d.rel);
					continue;
				}
				if (d.kind === "plan" && d.counted && !S.plans.includes(d.rel)) S.plans.push(d.rel);
				if (linkFree(d.rel, cfg.index)) continue;
				try {
					const r = await linkDoc(d, cfg, ctx, fs, wd);
					if (r) {
						notes.push(r.note);
						if (r.view) views.push(r.view);
					}
				} catch (e) {
					notes.push(`(문서 목록 ${cfg.index} 을 고치지 못했습니다: ${(e as Error).message})`);
				}
			}
		});
		post(ctx, views);
		if (!notes.length) return;
		return { content: [...(Array.isArray(event.content) ? event.content : []), { type: "text", text: notes.join("\n") }] };
	});

	// ── /hooks, 위험 명령 확인 경고 ───────────────────────────────────────────
	const fg = (ctx: any, c: string, s: string) => (ctx?.ui?.theme?.fg ? ctx.ui.theme.fg(c, s) : s);
	function showGuard(ctx: any) {
		if (!ctx?.hasUI) return;
		const g = guardState();
		try {
			ctx.ui.setStatus("hooks", g.on ? undefined : fg(ctx, "warning", "위험 명령 확인 꺼짐 (/hooks)"));
		} catch {}
		if (!g.on && !S.warned) {
			S.warned = true;
			ctx.ui.notify(`위험 명령 확인이 꺼져 있습니다 (${g.why}). git push, 폴더 지우기 같은 작업도 묻지 않고 실행됩니다.\n켜기: /hooks on guard`, "warning");
		}
	}
	const listText = () => {
		const g = guardState();
		const d = docCfg();
		const mine = myHooks();
		return [
			"키트 훅 (켜기·끄기: /hooks on|off <이름>)",
			`  guard  ${g.on ? "켜짐" : `꺼짐 (${g.why})`}  위험 명령 확인: git push·폴더 지우기·kubectl delete 등을 실행 전에 묻기. 끄면 GitLab 반영도 묻지 않음`,
			`  docs   ${d.on ? "켜짐" : "꺼짐"}  문서 규칙: 새 문서는 ${d.index} 에 링크, 한 요청에 ${d.limit}개를 넘으면 묻기, 이력은 HISTORY.md 하나에`,
			`내 훅 (${extDir().replace(/\\/g, "/")}): ${mine.length ? mine.map((h) => `${h.name} ${h.on ? "켜짐" : "꺼짐"}`).join(", ") : "없음"}`,
			"  /hooks off mine: 내 훅만 모두 끄기 (키트 훅은 그대로)  ·  /hooks on mine: 다시 켜기",
		].join("\n");
	};
	pi.registerCommand("hooks", {
		description: "훅 목록과 켜고 끄기: /hooks, /hooks off|on <guard|docs|내 훅 이름|mine> (mine: 내 훅만 모두, 위험 명령 확인은 그대로)",
		handler: async (args: string, ctx: any) => {
			const [verb, ...rest] = (args || "").trim().split(/\s+/).filter(Boolean);
			const name = rest.join(" ");
			if (!verb) return ctx.ui.notify(listText(), "info");
			if ((verb !== "on" && verb !== "off") || !name) return ctx.ui.notify("사용법: /hooks, /hooks off <guard|docs|이름|mine>, /hooks on <…>", "warning");
			const on = verb === "on";
			if (name === "guard") {
				if (!on) {
					const ok = ctx.hasUI && (await ctx.ui.confirm("위험 명령 확인을 끌까요?", "끄면 git push(GitLab 반영), 폴더 지우기, kubectl delete 같은 작업도 묻지 않고 실행됩니다.\n내 훅만 끄려면 /hooks off mine 을 쓰세요."));
					if (!ok) return;
					saveSetting("guard", false);
					showGuard(ctx);
					return ctx.ui.notify("위험 명령 확인을 껐습니다. 켜기: /hooks on guard", "warning");
				}
				saveSetting("guard", undefined);
				const off = join(extDir(), "guard.ts.off");
				if (!existsSync(join(extDir(), "guard.ts")) && existsSync(off)) {
					renameSync(off, join(extDir(), "guard.ts"));
					ctx.ui.notify("위험 명령 확인을 켭니다 (guard.ts.off -> guard.ts, 다시 불러옴)", "info");
					return ctx.reload();
				}
				S.warned = false;
				showGuard(ctx);
				return ctx.ui.notify(guardState().on ? "위험 명령 확인이 켜져 있습니다" : `위험 명령 확인을 켜지 못했습니다 (${guardState().why}). 키트를 다시 설치하거나 업데이트하세요`, "info");
			}
			if (name === "docs") {
				saveSetting("doc_rules", on ? undefined : false);
				return ctx.ui.notify(`문서 규칙을 ${on ? "켰습니다" : "껐습니다"} (다음 요청부터)`, "info");
			}
			const mine = myHooks();
			const pick = name === "mine" ? mine : mine.filter((h) => [h.name, h.name.replace(/\.(ts|js)$/, "")].includes(name));
			if (!pick.length) {
				const kit = KIT_EXT.find((k) => [k, k.replace(/\.ts$/, "")].includes(name));
				return ctx.ui.notify(
					kit
						? `${kit} 은(는) 키트 확장이라 여기서 끄지 않습니다 (위키는 /wiki off, 작업 기록은 /recall off, 작업 모드는 /mode)`
						: `'${name}' 훅이 없습니다. /hooks 로 목록을 보세요`,
					"warning",
				);
			}
			const changed = pick.filter((h) => switchHook(h, on)).map((h) => h.name);
			if (!changed.length) return ctx.ui.notify(`이미 ${on ? "켜져" : "꺼져"} 있습니다`, "info");
			ctx.ui.notify(`내 훅 ${on ? "켬" : "끔"}: ${changed.join(", ")} (다시 불러옴. 위험 명령 확인·문서 규칙은 그대로)`, "info");
			return ctx.reload();
		},
	});
}
