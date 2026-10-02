/**
 * pi 안에서 보는 도움말과 상태
 *
 *  /kit     한글 빠른 도움말 (키, 세션, 명령·스킬 목록, 설정 파일 위치). 명령·스킬은 ~/.pi/agent 에 있는 것을 그대로 보여 줌
 *  /doctor  상태 요약: pc 설정은 copilot/diag.py --report (판 번호, Node, 중계 서버, 전용 창, 모델, 최근 요청, 최근 로그),
 *           jupyter 설정은 판 번호와 Node 확인. 문제가 생기면 이 화면을 찍어 보내면 된다
 * 편집기 위에 띄우고, 다음 요청을 보내거나 같은 명령을 다시 입력하면 닫는다. LLM 에게는 보내지 않는다.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

export default function (pi: ExtensionAPI) {
	let shown: string | null = null; // 지금 띄운 것 ("kit" | "doctor")
	const show = (ctx: any, what: string, lines: string[] | undefined) => {
		ctx.ui.setWidget("pi-kit", lines);
		shown = lines ? what : null;
	};
	pi.registerCommand("kit", {
		description: "pi 빠른 도움말 (키, 세션, 명령·스킬, 설정 파일 위치)",
		handler: async (_args, ctx) => {
			if (shown === "kit") return show(ctx, "kit", undefined);
			show(ctx, "kit", helpLines());
		},
	});
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
