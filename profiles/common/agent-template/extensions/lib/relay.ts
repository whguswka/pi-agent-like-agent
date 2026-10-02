/**
 * 확장끼리 함께 쓰는 도우미 (undo.ts, memory.ts, modes.ts, files.ts): 지금 작업 폴더, 파일 읽기·쓰기·지우기.
 * jupyter 모드(PC 의 pi 가 명령·파일 작업을 노트북에서)면 중계 서버를 거쳐 노트북 파일을 다룬다.
 * 지금 작업 폴더는 jupyter.ts 가 globalThis.__piWorkDir 로 알려 준다 (없으면 pi 를 시작한 폴더).
 * 이 폴더(lib)에는 index.ts 가 없으므로 pi 가 확장으로 불러오지 않는다.
 */

import { promises as fsp } from "node:fs";
import { homedir } from "node:os";
import { dirname, posix, resolve } from "node:path";

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

/** 도구가 받은 경로 -> 실제 위치 (PC 또는 노트북). 상대 경로는 지금 작업 폴더 기준 */
export function target(path: string, wd: WorkDir = workDir()): Target {
	let s = slash(String(path || "").trim());
	if (wd.remote) {
		const home = wd.home || "/home/jovyan";
		if (s === "~" || s.startsWith("~/")) s = home + s.slice(1);
		return { abs: posix.resolve(wd.cwd, s), remote: true };
	}
	if (s === "~" || s.startsWith("~/")) s = slash(homedir()) + s.slice(1);
	const m = s.match(/^\/([a-zA-Z])(\/.*)?$/); // Git Bash 형식 /c/...
	if (m && process.platform === "win32") s = `${m[1].toUpperCase()}:${m[2] || "/"}`;
	return { abs: slash(resolve(wd.cwd, s)), remote: false };
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
		const size = Number(st.size) || 0;
		if (size > 256 * 1024) {
			// 큰 파일은 앞부분만 (노트북 홈 안, 숨김이 아닌 경로만 됨)
			const r = await call("/jupyter/fs", { op: "read_range", path: t.abs, start: 0, end: n - 1 });
			return { data: Buffer.from(r.data || "", "base64"), size: Number(r.total) || size };
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
