/**
 * pi 안에서 보는 도움말과 상태
 *
 *  /kit     한글 빠른 도움말 (키, 세션, 명령·스킬 목록, 설정 파일 위치). 명령·스킬은 ~/.pi/agent 에 있는 것을 그대로 보여 줌
 *  /doctor  상태 요약: pc 설정은 copilot/diag.py --report (판 번호, Node, 중계 서버, 전용 창, 모델, 최근 요청, 최근 로그),
 *           jupyter 설정은 판 번호와 Node 확인. 문제가 생기면 이 화면을 찍어 보내면 된다
 *  /kit share <폴더>    팀이 같이 쓰는 폴더(공유 드라이브 등)의 skills·prompts 를 settings.json 에 등록하고 바로 다시 읽음
 *  /kit unshare <폴더>  등록을 뺌.  /kit share (폴더 없이) 는 지금 등록된 폴더를 보여 줌
 * 편집기 위에 띄우고, 다음 요청을 보내거나 같은 명령을 다시 입력하면 닫는다. LLM 에게는 보내지 않는다.
 */

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const agentDirRaw = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
const kitHome = process.env.PI_KIT_HOME || "";
/** 보여 줄 경로: 슬래시로, 사용자 폴더 아래면 ~ 로 줄여서 */
const tilde = (p: string) => {
	const s = p.split("\\").join("/");
	const h = homedir().split("\\").join("/");
	return s.toLowerCase().startsWith(h.toLowerCase() + "/") ? "~" + s.slice(h.length) : s;
};
const agentDir = agentDirRaw;
const A = tilde(agentDirRaw);
const read = (p: string) => {
	try {
		return readFileSync(p, "utf8");
	} catch {
		return "";
	}
};
const version = () => read(join(kitHome, "VERSION")).trim() || "?";
const isBridge = () => read(join(agentDir, "models.json")).includes("127.0.0.1:8765");
const names = (dir: string, pick: (n: string) => string | null) => {
	try {
		return readdirSync(dir).map(pick).filter((x): x is string => !!x).sort();
	} catch {
		return [];
	}
};

function helpLines(): string[] {
	const prompts = names(join(agentDir, "prompts"), (n) => (n.endsWith(".md") ? "/" + n.slice(0, -3) : null));
	const skills = names(join(agentDir, "skills"), (n) => (existsSync(join(agentDir, "skills", n, "SKILL.md")) ? n : null));
	const bridge = isBridge();
	const lines = [
		`── pi 빠른 도움말 (판 ${version()}) ── 닫기: /kit 다시 입력 또는 요청 보내기`,
		" 입력  Enter 보내기 · Shift+Enter 줄바꿈 · Esc 멈추기 · Ctrl+O 도구 출력 펼치기 · !명령 직접 실행",
		" 모델  /model 또는 Ctrl+L 고르기 · Ctrl+P 다음 모델",
		" 세션  pi -c 이어서 · /resume 고르기 · /new 새로 · /name 이름 붙이기 · 끝내기 /quit 또는 Ctrl+C 두 번",
		" 작업  /plan 계획부터 (승인하면 진행) · /mode 계획·확인·자동 · /undo pi 가 고친 파일 되돌리기",
		` 명령  ${prompts.join(" ") || "(없음)"}`,
		`       내 명령: ${A}/prompts/<이름>.md`,
		` 스킬  /skill:이름 → ${skills.join(", ") || "(없음)"}`,
		`       내 스킬: ${A}/skills/<이름>/SKILL.md (skill-creator 에게 "○○ 스킬 만들어줘")`,
		` 지침  ${A}/AGENTS.md (공통), 프로젝트 폴더의 AGENTS.md (/init 으로 초안)`,
	];
	if (bridge) {
		lines.push(
			" 노트북 /jupyter 폴더 · /local · /upload 파일·폴더 · /download 파일·폴더",
			` 설정  내 설정 ${A}/bridge.json (고친 뒤 중계 서버 다시 켜기: curl -s -X POST http://127.0.0.1:8765/shutdown)`,
			` 문제  /doctor 상태 요약 (화면을 찍어 보내기) · 로그 ${A}/copilot-relay.log`,
		);
	} else {
		lines.push(` 설정  ${A}/models.json (LLM 주소) · ${A}/settings.json · 문제가 생기면 /doctor`);
	}
	if (kitHome) lines.push(` 문서  ${tilde(kitHome)}/README.md`);
	return lines;
}

function run(cmd: string, args: string[], ms: number): Promise<string> {
	return new Promise((ok) => {
		let out = "";
		let done = false;
		const ch = spawn(cmd, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
		const finish = (extra = "") => {
			if (done) return;
			done = true;
			ok(out + extra);
		};
		const t = setTimeout(() => {
			ch.kill();
			finish("\n(시간 초과로 멈춤)");
		}, ms);
		ch.stdout.on("data", (d) => (out += d));
		ch.stderr.on("data", (d) => (out += d));
		ch.on("error", (e) => {
			clearTimeout(t);
			finish(`\n(실행하지 못함: ${e.message})`);
		});
		ch.on("close", () => {
			clearTimeout(t);
			finish();
		});
	});
}

async function doctorLines(): Promise<string[]> {
	const head = `── 상태 요약 (판 ${version()}) ── 닫기: /doctor 다시 입력 또는 요청 보내기`;
	let out: string;
	if (isBridge()) {
		const py = process.env.PI_PYTHON_EXE;
		if (!py || !kitHome) return [head, " Python 이나 pi 폴더를 찾지 못했습니다. 터미널에서 python ~/tools/pi/copilot/diag.py --report 를 실행하세요."];
		out = await run(py, [join(kitHome, "copilot", "diag.py"), "--report"], 120000);
	} else {
		out = `pi 폴더: ${kitHome}\n` + (await run("bash", [join(kitHome, "check-node.sh")], 60000));
	}
	const body = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
	return [head, ...body.map((l) => " " + l)];
}

// ---------------------------------------------------------------------------------------------------------------
// 팀 공유 폴더: <폴더>/skills/<이름>/SKILL.md, <폴더>/prompts/<이름>.md 를 settings.json 의 skills·prompts 목록에 등록
// ---------------------------------------------------------------------------------------------------------------
const settingsFile = join(agentDir, "settings.json");
const norm = (p: string) => p.split("\\").join("/").replace(/\/+$/, "").toLowerCase();
/** 입력한 폴더 -> 절대 경로 (~, Git Bash 형식 /c/..., 역슬래시도 받음) */
function folder(arg: string, cwd: string): string {
	let s = arg.trim().replace(/^["']|["']$/g, "").split("\\").join("/");
	const m = s.match(/^\/([a-zA-Z])(\/.*)?$/);
	if (m && process.platform === "win32") s = `${m[1].toUpperCase()}:${m[2] || "/"}`;
	if (s === "~" || s.startsWith("~/")) s = homedir().split("\\").join("/") + s.slice(1);
	return (isAbsolute(s) || s.startsWith("//") ? s : resolve(cwd, s).split("\\").join("/")).replace(/\/+$/, "");
}
function readSettings(): any {
	const text = readFileSync(settingsFile, "utf8").replace(/^\uFEFF/, "");
	const v = JSON.parse(text);
	if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("settings.json 이 { } 형식이 아닙니다");
	return v;
}
function writeSettings(v: any) {
	copyFileSync(settingsFile, settingsFile + ".bak");
	writeFileSync(settingsFile, JSON.stringify(v, null, 2) + "\n");
}
const shared = (v: any) => [...(v.skills || []), ...(v.prompts || [])] as string[];

export default function (pi: ExtensionAPI) {
	let shown: string | null = null; // 지금 띄운 것 ("kit" | "doctor")
	const show = (ctx: any, what: string, lines: string[] | undefined) => {
		ctx.ui.setWidget("pi-kit", lines);
		shown = lines ? what : null;
	};
	pi.registerCommand("kit", {
		description: "pi 빠른 도움말. /kit share <폴더> 로 팀 공유 폴더의 스킬·명령 등록, /kit unshare <폴더> 로 빼기",
		handler: async (args, ctx) => {
			const [sub, ...rest] = (args || "").trim().split(/\s+/);
			if (sub === "share" || sub === "unshare") return share(sub, rest.join(" "), ctx);
			if (shown === "kit") return show(ctx, "kit", undefined);
			show(ctx, "kit", helpLines());
		},
	});
	async function share(sub: string, arg: string, ctx: any) {
		let v: any;
		try {
			v = readSettings();
		} catch (e) {
			return ctx.ui.notify(`settings.json 을 읽지 못했습니다: ${(e as Error).message}`, "error");
		}
		if (!arg) {
			const list = shared(v);
			return ctx.ui.notify(list.length ? `등록된 공유 폴더: ${list.join(", ")}` : "등록된 공유 폴더가 없습니다. /kit share <폴더>", "info");
		}
		const dir = folder(arg, process.cwd());
		const subs = { skills: `${dir}/skills`, prompts: `${dir}/prompts` };
		if (sub === "unshare") {
			let n = 0;
			for (const key of ["skills", "prompts"] as const) {
				if (!Array.isArray(v[key])) continue;
				const keep = v[key].filter((x: string) => norm(x) !== norm(subs[key]) && norm(x) !== norm(dir));
				n += v[key].length - keep.length;
				if (keep.length) v[key] = keep;
				else delete v[key];
			}
			if (!n) return ctx.ui.notify(`등록되어 있지 않은 폴더입니다: ${dir}`, "warning");
			writeSettings(v);
			ctx.ui.notify(`공유 폴더 등록을 뺐습니다: ${dir}. 다시 읽는 중...`, "info");
			return ctx.reload();
		}
		let isDir = false;
		try {
			isDir = statSync(dir).isDirectory();
		} catch {}
		if (!isDir) return ctx.ui.notify(`그 폴더가 없거나 열 수 없습니다: ${dir}`, "error");
		const missing = (["skills", "prompts"] as const).filter((k) => !existsSync(subs[k]));
		if (missing.length === 2) {
			const ok = await ctx.ui.confirm(
				"공유 폴더 만들기",
				`${dir} 안에 skills·prompts 폴더가 없습니다. 새로 만들까요?\n(스킬: skills/<이름>/SKILL.md, 명령: prompts/<이름>.md)`,
			);
			if (!ok) return;
			for (const k of missing) mkdirSync(subs[k], { recursive: true });
		}
		const added: string[] = [];
		for (const key of ["skills", "prompts"] as const) {
			if (!existsSync(subs[key])) continue;
			const list: string[] = Array.isArray(v[key]) ? v[key] : [];
			if (list.some((x) => norm(x) === norm(subs[key]))) continue;
			v[key] = [...list, subs[key]];
			added.push(subs[key]);
		}
		if (!added.length) return ctx.ui.notify(`이미 등록된 폴더입니다: ${dir}`, "info");
		writeSettings(v);
		ctx.ui.notify(`공유 폴더를 등록했습니다: ${added.join(", ")}. 다시 읽는 중...`, "info");
		return ctx.reload();
	}
	pi.registerCommand("doctor", {
		description: "상태 요약 (판 번호, Node, 중계 서버, 전용 창, 모델, 최근 요청, 최근 로그). 문제가 생기면 이 화면을 찍어 보내 주세요",
		handler: async (_args, ctx) => {
			if (shown === "doctor") return show(ctx, "doctor", undefined);
			ctx.ui.notify("상태를 확인하는 중입니다 (몇 초 걸림)...", "info");
			show(ctx, "doctor", await doctorLines());
		},
	});
	pi.on("agent_start", async (_event: unknown, ctx: any) => {
		if (shown && ctx.hasUI) show(ctx, shown, undefined);
	});
}
