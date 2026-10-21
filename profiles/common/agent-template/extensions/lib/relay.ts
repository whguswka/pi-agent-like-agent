/**
 * 확장끼리 함께 쓰는 도우미 (undo.ts, memory.ts, modes.ts, files.ts, kit.ts, wiki.ts): 지금 작업 폴더, 파일 읽기·쓰기·지우기,
 * 요청 앞에 알림을 붙일 때 사용자가 친 그대로를 남기기 (transformInput, rawInput).
 * jupyter 모드(PC 의 pi 가 명령·파일 작업을 노트북에서)면 중계 서버를 거쳐 노트북 파일을 다룬다.
 * 지금 작업 폴더는 jupyter.ts 가 globalThis.__piWorkDir 로 알려 준다 (없으면 pi 를 시작한 폴더).
 * 이 폴더(lib)에는 index.ts 가 없으므로 pi 가 확장으로 불러오지 않는다.
 */

import { promises as fsp } from "node:fs";
import { homedir } from "node:os";
import { dirname, posix, resolve } from "node:path";
import { cleanPath, isPcAbsolute, windowsDrivePath } from "./paths.ts";

export const SERVER = (process.env.PI_COPILOT_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");
export const SESSION: string = ((globalThis as any).__piSession ||=
	process.env.PI_COPILOT_SESSION || `${process.pid}-${Math.random().toString(36).slice(2, 8)}`);

export class RelayError extends Error {
	code?: string;
}

export async function call(path: string, body?: unknown): Promise<any> {
	let res: Response;
	try {
		res = await fetch(SERVER + path, {
			method: body === undefined ? "GET" : "POST",
			headers: { "Content-Type": "application/json", "X-Pi-Session": SESSION },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	} catch (e) {
		throw new RelayError(`PC 의 중계 서버(${SERVER})에 연결할 수 없습니다 (${(e as Error).message})`);
	}
	let data: any = {};
	try {
		data = await res.json();
	} catch {}
	if (!res.ok || data.ok === false) {
		const err = new RelayError(data.error || `중계 서버 오류 (HTTP ${res.status})`);
		if (data.code) err.code = data.code;
		throw err;
	}
	return data;
}

/** 노트북에서 명령 실행 (끝날 때까지) */
export async function nbRun(command: string, cwd: string): Promise<{ code: number | null; out: string }> {
	const { id } = await call("/jupyter/exec", { cwd, command, timeout: 600 });
	const chunks: Buffer[] = [];
	let offset = 0;
	while (true) {
		const st = await call(`/jupyter/exec/${id}?offset=${offset}&wait=2`);
		if (st.data) {
			const b = Buffer.from(st.data, "base64");
			chunks.push(b);
			offset += b.length;
		}
		if (st.done || st.aborted || st.timedOut) return { code: st.done ? st.exitCode : null, out: Buffer.concat(chunks).toString("utf8") };
	}
}

export const shq = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
export type WorkDir = { remote: boolean; cwd: string; home?: string };
export const workDir = (): WorkDir => (globalThis as any).__piWorkDir || { remote: false, cwd: process.cwd() };
export type Target = { abs: string; remote: boolean };
const slash = (p: string) => p.split("\\").join("/");
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || `${homedir()}/.pi/agent`;

/** 도구가 받은 경로 -> 실제 위치 (PC 또는 노트북). 상대 경로는 지금 작업 폴더 기준.
 *  pi 의 도구와 같게 정리한다 (lib/paths.ts: 맨 앞 @, /c/... 등). jupyter 모드라도 C:/... 나 //서버/... 는 PC 파일 */
export function target(path: string, wd: WorkDir = workDir()): Target {
	let s = slash(cleanPath(path).trim());
	if (wd.remote && !isPcAbsolute(s)) {
		const home = wd.home || "/home/jovyan";
		if (s === "~" || s.startsWith("~/")) s = home + s.slice(1);
		const abs = posix.resolve(wd.cwd, s);
		// 노트북 형식으로 쓴 pi 설정 폴더(~/.pi/agent/...)는 PC 의 것 (jupyter.ts 도 쓰기를 PC 로 보냄)
		const ra = `${home}/.pi/agent`;
		if (abs === ra || abs.startsWith(ra + "/")) return { abs: slash(AGENT_DIR) + abs.slice(ra.length), remote: false };
		return { abs, remote: true };
	}
	s = windowsDrivePath(s);
	if (s === "~" || s.startsWith("~/")) s = slash(homedir()) + s.slice(1);
	return { abs: slash(resolve(wd.remote ? homedir() : wd.cwd, s)), remote: false };
}

/** 파일 내용 (없으면 null) */
export async function readTarget(t: Target): Promise<Buffer | null> {
	if (t.remote) {
		try {
			return Buffer.from((await call("/jupyter/fs", { op: "read", path: t.abs })).data || "", "base64");
		} catch (e) {
			if ((e as RelayError).code === "ENOENT") return null;
			throw e;
		}
	}
	try {
		return await fsp.readFile(t.abs);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw e;
	}
}

/** 파일 앞부분(최대 n 바이트)과 전체 크기. 없거나 폴더면 null (큰 파일을 통째로 읽지 않으려고) */
export async function readHead(t: Target, n: number): Promise<{ data: Buffer; size: number } | null> {
	if (t.remote) {
		let st: any;
		try {
			st = await call("/jupyter/fs", { op: "stat", path: t.abs });
		} catch (e) {
			if ((e as RelayError).code === "ENOENT") return null;
			throw e;
		}
		if (st.kind === "directory") return null;
		// 노트북 홈 밖·숨김 경로는 크기를 알려 주지 않음 -> 노트북에서 직접 확인 (모르는 채로 통째로 읽으면 큰 파일에서 멈춤)
		let size = typeof st.size === "number" ? st.size : Number.NaN;
		if (!Number.isFinite(size)) {
			const r = await nbRun(`stat -c %s -- ${shq(t.abs)}`, workDir().home || "/");
			size = r.code === 0 ? Number.parseInt(r.out.trim(), 10) : Number.NaN;
			if (!Number.isFinite(size)) return null;
		}
		if (size > 256 * 1024) {
			// 큰 파일은 앞부분만: 나눠 받기(노트북 홈 안, 숨김이 아닌 경로), 안 되면 노트북에서 head 로
			try {
				const r = await call("/jupyter/fs", { op: "read_range", path: t.abs, start: 0, end: n - 1 });
				return { data: Buffer.from(r.data || "", "base64"), size: Number(r.total) || size };
			} catch {
				const r = await nbRun(`head -c ${Math.floor(n)} -- ${shq(t.abs)} | base64 -w0`, workDir().home || "/");
				if (r.code !== 0) return null;
				return { data: Buffer.from(r.out.trim(), "base64"), size };
			}
		}
		const all = await readTarget(t);
		return all && { data: all.subarray(0, n), size: all.length };
	}
	let fh: Awaited<ReturnType<typeof fsp.open>> | undefined;
	try {
		const st = await fsp.stat(t.abs);
		if (!st.isFile()) return null;
		fh = await fsp.open(t.abs, "r");
		const buf = Buffer.alloc(Math.min(n, st.size));
		const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
		return { data: buf.subarray(0, bytesRead), size: st.size };
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw e;
	} finally {
		await fh?.close();
	}
}

export async function writeTarget(t: Target, data: Buffer): Promise<void> {
	if (t.remote) return void (await call("/jupyter/fs", { op: "write", path: t.abs, data: data.toString("base64") }));
	await fsp.mkdir(dirname(t.abs), { recursive: true });
	await fsp.writeFile(t.abs, data);
}

export async function removeTarget(t: Target): Promise<void> {
	if (t.remote) {
		const r = await nbRun(`rm -f -- ${shq(t.abs)}`, workDir().home || "/");
		if (r.code !== 0) throw new Error(`노트북에서 지우지 못했습니다: ${r.out.slice(-200)}`);
		return;
	}
	await fsp.rm(t.abs, { force: true });
}

/** 보여 줄 경로: 작업 폴더 안이면 상대 경로, 사용자 폴더 아래면 ~ */
export function shown(t: Target, wd: WorkDir = workDir()): string {
	const cwd = slash(wd.cwd).replace(/\/+$/, "");
	if (t.abs.toLowerCase().startsWith(cwd.toLowerCase() + "/")) return t.abs.slice(cwd.length + 1);
	if (!t.remote) {
		const h = slash(homedir());
		if (t.abs.toLowerCase().startsWith(h.toLowerCase() + "/")) return "~" + t.abs.slice(h.length);
	}
	return (t.remote ? "노트북 " : "") + t.abs;
}

// ── 입력 고치기와 사용자가 친 그대로 ──────────────────────────────
// 여러 확장이 요청 앞에 알림을 붙인다 (input 이벤트의 transform: /remember·/kit env·/undo 알림, 계획 모드, @파일 내용).
// pi 는 확장을 폴더에서 읽은 차례로 부르고 그 차례는 정해져 있지 않아, 나중에 불리는 확장은 고친 글을 받는다.
// 고친 글 -> 사용자가 친 글을 남겨 두어 rawInput 으로 되찾는다 (/wiki save 의 질문, 작업 기록)
const RAW: Map<string, string> = ((globalThis as any).__piRawInput ||= new Map());

/** input 이벤트에서 돌려줄 transform. 고친 글이 사용자가 친 어떤 글에서 왔는지 남긴다 */
export function transformInput(from: string, to: string) {
	RAW.set(to, rawInput(from));
	while (RAW.size > 8) RAW.delete(RAW.keys().next().value as string);
	return { action: "transform" as const, text: to };
}

/** input 이벤트의 글 -> 사용자가 친 그대로 (다른 확장이 고치지 않았으면 그 글) */
export const rawInput = (text: string): string => RAW.get(text) ?? text;

// 확장이 사용자를 대신해 보내는 요청 (/plan <요청>, 계획대로 진행, /wiki ask, /handoff): 작업 기록(memory.ts)이 사용자의 요청으로 남기게 표시.
// 표시하지 않은 확장의 요청(폴더째 반영, /watch 의 로그 등)은 기록하지 않는다
const ASKS: Map<string, string> = ((globalThis as any).__piUserAsks ||= new Map());

/** 보낼 글을 사용자의 요청으로 표시하고 그 글을 그대로 돌려준다. label: 기록에 남길 글 (없으면 보낸 글) */
export function userAsk(text: string, label = text): string {
	ASKS.set(text, label);
	while (ASKS.size > 8) ASKS.delete(ASKS.keys().next().value as string);
	return text;
}

/** input 이벤트의 글이 확장이 대신 보낸 사용자의 요청이면 기록에 남길 글 */
export const userAskOf = (text: string): string | undefined => ASKS.get(rawInput(text));

// ── 개인정보·비밀로 보이는 글 (위키의 작업 방식, 작업 기록) ──────────────
// 중계 서버(relay.py)의 감추기와 같은 꼴: 이메일, 전화번호, 카드번호, 계좌번호 모양 번호
// (숫자 묶음을 - _ 로 이은 것이나 이어 쓴 숫자로 합쳐 10~14자리. 너무 길면 끝의 _ 묶음을 떼어 봄), [이메일N]·[번호N]
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_RE = /(?<!\d)0\d{1,2}[- .]?\d{3,4}[- .]?\d{4}(?!\d)/g;
const CARD_RE = /(?<![\d.])(?:\d{4}[- ]){3}\d{1,7}(?![\d.])|(?<![\d.])\d{15,19}(?![\d.])/g;
const TOKEN_RE = /\[(?:이메일|번호)\d+\]/g;
const SECRET_RE = /(?:password|passwd|비밀번호|암호|토큰|token|secret|api[_ -]?key)\s*[:=]/i;
const NB = "(?<![0-9A-Za-z.])(?<![0-9A-Fa-f]-)";
const NA = "(?![0-9A-Za-z-]|\\.\\d)";
const NUMBER_RE = new RegExp(`${NB}(?:\\d{2,8}[-_]){1,3}\\d{2,8}${NA}|${NB}\\d{10,14}${NA}`, "g");
const digitCount = (s: string) => (s.match(/\d/g) || []).length;
/** 계좌번호 모양인 부분: 10~14자리 (넘으면 끝의 _ 묶음을 떼어 봄) */
function accountPart(m: string): string | null {
	let s = m;
	while (digitCount(s) > 14 && s.includes("_")) s = s.slice(0, s.lastIndexOf("_"));
	const n = digitCount(s);
	return n >= 10 && n <= 14 ? s : null;
}
const has = (re: RegExp, s: string) => {
	re.lastIndex = 0;
	return re.test(s);
};

/** 이메일·전화번호·카드·계좌번호 모양 번호·[이메일N]·비밀로 보이는 글이 들었는지 */
export function secretish(s: string): boolean {
	return has(EMAIL_RE, s) || has(TOKEN_RE, s) || has(PHONE_RE, s) || has(CARD_RE, s) || SECRET_RE.test(s) || [...s.matchAll(NUMBER_RE)].some((m) => accountPart(m[0]) !== null);
}

/** 기록에 남길 글: 이메일·전화번호·카드·계좌번호 모양 번호·[이메일N] 은 '…' 로 빼고, 비밀로 보이는 글이면 "" */
export function scrubText(s: string): string {
	if (SECRET_RE.test(s)) return "";
	return s
		.replace(EMAIL_RE, "…")
		.replace(TOKEN_RE, "…")
		.replace(CARD_RE, "…")
		.replace(PHONE_RE, "…")
		.replace(NUMBER_RE, (m) => {
			const a = accountPart(m);
			return a === null ? m : `…${m.slice(a.length)}`;
		});
}
