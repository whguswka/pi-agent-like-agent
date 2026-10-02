/**
 * jupyter 실행 환경 (브리지 pi 용)
 *
 * `pi --jupyter <노트북 안 폴더>` 로 실행하면 bash / read / write / edit 도구가 이 PC 가 아니라
 * Kubeflow JupyterLab 노트북 안에서 실행된다. 통로는 PC 의 중계 서버(copilot/relay.py)이고,
 * 중계 서버가 브라우저의 JupyterLab 탭을 통해 Jupyter 터미널('pibridge')과 파일 기능을 쓴다.
 * 플래그가 없으면 아무것도 바꾸지 않는다 (로컬 Git Bash 에서 실행).
 *
 * 예) pi --jupyter work/myproject      (노트북 홈 기준 상대 경로)
 *     pi --jupyter '~/work/myproject'
 */

import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type BashOperations,
	createBashTool,
	createEditTool,
	createReadTool,
	createWriteTool,
	type EditOperations,
	type ReadOperations,
	type WriteOperations,
} from "@earendil-works/pi-coding-agent";

const SERVER = (process.env.PI_COPILOT_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");

type Remote = { arg: string; cwd: string; home: string; root: string };

class RemoteError extends Error {
	code?: string;
}

async function call(path: string, body?: unknown): Promise<any> {
	let res: Response;
	try {
		res = await fetch(SERVER + path, {
			method: body === undefined ? "GET" : "POST",
			headers: { "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	} catch (e) {
		throw new RemoteError(
			`PC 의 중계 서버(${SERVER})에 연결할 수 없습니다. 중계 서버가 실행 중인지 확인하세요. (${(e as Error).message})`,
		);
	}
	let data: any = {};
	try {
		data = await res.json();
	} catch {}
	if (!res.ok || data.ok === false) {
		const err = new RemoteError(data.error || `중계 서버 오류 (HTTP ${res.status})`);
		if (data.code) err.code = data.code;
		throw err;
	}
	return data;
}

const fsOp = (op: string, path: string, data?: string) => call("/jupyter/fs", { op, path, data });

const slash = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
const under = (p: string, base: string) => {
	const a = p.toLowerCase();
	const b = base.toLowerCase();
	return a === b || a.startsWith(b + "/");
};

/** --jupyter 값 -> 노트북 안 절대 경로. Git Bash 가 ~ 나 /home/... 를 PC 경로로 바꿔 넘긴 경우도 되돌린다 */
function remoteDir(arg: string, home: string): string {
	let s = arg.trim().replace(/\\/g, "/");
	const lh = slash(homedir());
	const msysHome = "/" + lh[0].toLowerCase() + lh.slice(2);
	if (under(s, lh)) s = "~" + s.slice(lh.length);
	else if (under(s, msysHome)) s = "~" + s.slice(msysHome.length);
	const git = s.match(/^[A-Za-z]:\/.*?\/Git(\/.*)$/i);
	if (git) s = git[1];
	if (s === "~" || s === "") s = home;
	else if (s.startsWith("~/")) s = home + s.slice(1);
	else if (!s.startsWith("/")) s = home + "/" + s;
	return s.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
}

/** pi 가 PC 기준으로 풀어 놓은 경로 -> 노트북 안 경로 */
function makeMapper(localCwd: string, r: Remote) {
	const lc = slash(localCwd);
	const lh = slash(homedir());
	return (p: string): string => {
		const s = p.replace(/\\/g, "/");
		if (under(s, lc)) return r.cwd + s.slice(lc.length);
		if (under(s, lh)) return r.home + s.slice(lh.length);
		const m = s.match(/^[A-Za-z]:(\/.*)?$/); // 모델이 쓴 /home/... 를 Windows 가 C:\home\... 로 바꾼 경우
		if (m) return m[1] || "/";
		return s;
	};
}

const IMAGE_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
};

function readOps(map: (p: string) => string): ReadOperations {
	return {
		readFile: async (p) => Buffer.from((await fsOp("read", map(p))).data || "", "base64"),
		access: async (p) => {
			await fsOp("stat", map(p));
		},
		detectImageMimeType: async (p) => IMAGE_TYPES[(p.match(/\.[^./\\]+$/)?.[0] || "").toLowerCase()] ?? null,
	};
}

function writeOps(map: (p: string) => string): WriteOperations {
	return {
		writeFile: async (p, content) => {
			await fsOp("write", map(p), Buffer.from(content, "utf8").toString("base64"));
		},
		mkdir: async (dir) => {
			await fsOp("mkdir", map(dir));
		},
	};
}

function editOps(map: (p: string) => string): EditOperations {
	const r = readOps(map);
	const w = writeOps(map);
	return { readFile: r.readFile, access: r.access, writeFile: w.writeFile };
}

function bashOps(map: (p: string) => string): BashOperations {
	return {
		exec: async (command, cwd, { onData, signal, timeout }) => {
			if (signal?.aborted) throw new Error("aborted");
			const { id } = await call("/jupyter/exec", { cwd: map(cwd), command, timeout: timeout ?? 0 });
			let offset = 0;
			const onAbort = () => {
				call(`/jupyter/exec/${id}/abort`, {}).catch(() => {});
			};
			signal?.addEventListener("abort", onAbort, { once: true });
			try {
				while (true) {
					const st = await call(`/jupyter/exec/${id}?offset=${offset}&wait=2`);
					if (st.data) {
						const buf = Buffer.from(st.data, "base64");
						if (buf.length) {
							onData(buf);
							offset += buf.length;
						}
					}
					if (signal?.aborted || st.aborted) throw new Error("aborted");
					if (st.timedOut) throw new Error(`timeout:${timeout}`);
					if (st.done) return { exitCode: typeof st.exitCode === "number" ? st.exitCode : null };
				}
			} finally {
				signal?.removeEventListener("abort", onAbort);
			}
		},
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerFlag("jupyter", {
		description: "명령·파일 작업을 Kubeflow JupyterLab 노트북 안에서 실행 (값: 노트북 안 작업 폴더, 예: work/myproject)",
		type: "string",
	});

	const localCwd = process.cwd();
	const localRead = createReadTool(localCwd);
	const localWrite = createWriteTool(localCwd);
	const localEdit = createEditTool(localCwd);
	const localBash = createBashTool(localCwd);

	let remote: Remote | null = null; // --jupyter 를 줬으면 연결 실패여도 null 이 아님 (PC 에서 대신 실행하지 않도록)
	let remoteAgents = ""; // 노트북 작업 폴더의 AGENTS.md

	async function ready(): Promise<Remote> {
		if (!remote) throw new RemoteError("jupyter 모드가 아닙니다");
		if (!remote.home) {
			const info = await call("/jupyter/info");
			remote.home = info.home;
			remote.root = info.root;
			remote.cwd = remoteDir(remote.arg, info.home);
		}
		return remote;
	}

	const mapper = async () => makeMapper(localCwd, await ready());

	pi.registerTool({
		...localRead,
		async execute(id, params, signal, onUpdate, _ctx) {
			if (!remote) return localRead.execute(id, params, signal, onUpdate);
			const tool = createReadTool(localCwd, { operations: readOps(await mapper()) });
			return tool.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localWrite,
		async execute(id, params, signal, onUpdate, _ctx) {
			if (!remote) return localWrite.execute(id, params, signal, onUpdate);
			const tool = createWriteTool(localCwd, { operations: writeOps(await mapper()) });
			return tool.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localEdit,
		async execute(id, params, signal, onUpdate, _ctx) {
			if (!remote) return localEdit.execute(id, params, signal, onUpdate);
			const tool = createEditTool(localCwd, { operations: editOps(await mapper()) });
			return tool.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localBash,
		async execute(id, params, signal, onUpdate, _ctx) {
			if (!remote) return localBash.execute(id, params, signal, onUpdate);
			const tool = createBashTool(localCwd, { operations: bashOps(await mapper()) });
			return tool.execute(id, params, signal, onUpdate);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const arg = (pi.getFlag("jupyter") as string | undefined) || process.env.PI_JUPYTER_DIR;
		if (!arg) return;
		remote = { arg, cwd: "", home: "", root: "" };
		try {
			const r = await ready();
			try {
				await fsOp("stat", r.cwd);
			} catch (e) {
				if ((e as RemoteError).code !== "ENOENT") throw e;
				await fsOp("mkdir", r.cwd);
				ctx.ui.notify(`노트북에 작업 폴더를 만들었습니다: ${r.cwd}`, "info");
			}
			try {
				remoteAgents = Buffer.from((await fsOp("read", `${r.cwd}/AGENTS.md`)).data || "", "base64").toString("utf8");
			} catch {}
			ctx.ui.setStatus("jupyter", ctx.ui.theme.fg("accent", `Jupyter: ${r.cwd}`));
			ctx.ui.notify(`jupyter 모드: 명령과 파일 작업을 노트북의 ${r.cwd} 에서 실행합니다`, "info");
		} catch (e) {
			ctx.ui.setStatus("jupyter", ctx.ui.theme.fg("error", "Jupyter: 연결 안 됨"));
			ctx.ui.notify(`jupyter 모드 연결 실패: ${(e as Error).message}`, "error");
		}
	});

	// 사용자가 직접 치는 ! 명령도 노트북에서
	pi.on("user_bash", async () => {
		if (!remote) return;
		return { operations: bashOps(await mapper()) };
	});

	// 모델에게 작업 폴더와 실행 환경을 노트북 기준으로 알려 준다
	pi.on("before_agent_start", async (event) => {
		if (!remote) return;
		let r: Remote;
		try {
			r = await ready();
		} catch {
			return;
		}
		const o = event.systemPromptOptions;
		o.cwd = r.cwd;
		o.sections.environment = [
			"명령과 파일 작업은 Kubeflow JupyterLab 노트북(리눅스, bash) 안에서 실행됩니다.",
			`- 작업 폴더: ${r.cwd}`,
			`- 홈 폴더: ${r.home}`,
			"- 상대 경로는 작업 폴더 기준입니다. 경로는 리눅스 형식(/home/...)으로 쓰고, Windows 경로(C:\\...)는 쓰지 마세요.",
			"- 명령은 입력 없이 실행되므로 입력을 기다리는 대화형 명령(vi, less, 인자 없는 python 등)은 쓰지 마세요.",
		].join("\n");
		if (remoteAgents && !o.contextFiles.some((f) => f.path === `${r.cwd}/AGENTS.md`)) {
			o.contextFiles.push({ path: `${r.cwd}/AGENTS.md`, content: remoteAgents });
		}
	});
}
