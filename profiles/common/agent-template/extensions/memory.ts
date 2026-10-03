/**
 * 기억하기 (/remember <내용>): 앞으로도 지킬 내용을 지침 파일(AGENTS.md)에 적어 둔다.
 *
 *  /remember 테스트는 pytest -q 로 돌린다
 *  - 어디에 적을지 고른다: 이 프로젝트(작업 폴더의 AGENTS.md) 또는 모든 프로젝트(~/.pi/agent/AGENTS.md).
 *    jupyter 모드에서 '이 프로젝트' 는 노트북 작업 폴더의 AGENTS.md (중계 서버를 거쳐 씀)
 *  - "## 기억할 것" 부분 끝에 "- 내용" 한 줄로 더한다 (없으면 파일 끝에 만든다). 같은 줄이 이미 있으면 더하지 않는다
 *  - 지침 파일은 pi 를 시작할 때 읽으므로, 지금 대화에는 다음 요청 앞에 붙여 바로 알려 준다
 *    (/reload 로 다시 읽으면 Copilot 새 대화가 열려 느리므로 쓰지 않는다)
 *  - 지우거나 고치려면 그 파일을 직접 고친다
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readTarget, type Target, target, workDir, writeTarget } from "./lib/relay.ts";

const HEAD = "## 기억할 것";

/** 지침 글에 항목 더하기: "## 기억할 것" 부분 끝에 (없으면 파일 끝에 새로). 이미 있으면 null */
export function addMemory(text: string, item: string): string | null {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const line = `- ${item}`;
	const lines = text.split(/\r?\n/);
	const h = lines.findIndex((l) => l.trim() === HEAD);
	if (h < 0) {
		const body = text.replace(/\s+$/, "");
		return (body ? body + eol + eol : "") + HEAD + eol + line + eol;
	}
	let end = lines.length;
	for (let k = h + 1; k < lines.length; k++) {
		if (/^#{1,2}\s/.test(lines[k])) {
			end = k;
			break;
		}
	}
	if (lines.slice(h + 1, end).some((l) => l.trim() === line)) return null;
	let at = end; // 부분 끝의 빈 줄 앞에
	while (at > h + 1 && lines[at - 1].trim() === "") at--;
	lines.splice(at, 0, line);
	return lines.join(eol).replace(/(\r?\n)*$/, "") + eol;
}

const home = homedir().split("\\").join("/");
const label = (t: Target) => (t.remote ? `노트북 ${t.abs}` : t.abs.toLowerCase().startsWith(home.toLowerCase() + "/") ? "~" + t.abs.slice(home.length) : t.abs);
const cut = (s: string, n = 60) => (s.length > n ? s.slice(0, n) + "…" : s);

export default function (pi: ExtensionAPI) {
	// 다음 요청에 붙여 알릴 것 (확장을 다시 불러와도(/kit share, /reload) 남김)
	const S: { notes: string[] } = ((globalThis as any).__piRemember ||= { notes: [] });
	pi.on("session_start", async (event: any) => {
		if (event?.reason !== "reload") S.notes = []; // 새 세션은 지침 파일을 새로 읽으므로 알릴 필요 없음
	});

	pi.on("input", async (event: any) => {
		if (!S.notes.length || !event.text || event.text.startsWith("/")) return;
		const text = `(사용자가 /remember 로 지침에 더한 내용입니다. 지금부터 지켜 주세요: ${S.notes.join(" / ")})\n\n${event.text}`;
		S.notes = [];
		return { action: "transform", text };
	});

	pi.registerCommand("remember", {
		description: "앞으로도 지킬 내용을 지침(AGENTS.md)에 적어 둠. 예: /remember 커밋 메시지는 한국어로",
		handler: async (args, ctx) => {
			const item = String(args || "").replace(/\s+/g, " ").trim();
			if (!item) return ctx.ui.notify("사용법: /remember <기억할 내용>   예) /remember 테스트는 pytest -q 로 돌린다", "info");
			const wd = workDir();
			const project = target("AGENTS.md", wd);
			const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
			const global = target(join(agentDir, "AGENTS.md"), { remote: false, cwd: process.cwd() });
			let t = project;
			if (ctx.hasUI) {
				const opts: [string, Target][] = [
					[`이 프로젝트만: ${label(project)}`, project],
					[`모든 프로젝트: ${label(global)}`, global],
				];
				const pick = await ctx.ui.select(`어디에 기억할까요? "${cut(item)}"`, opts.map((o) => o[0]));
				const found = opts.find((o) => o[0] === pick);
				if (!found) return;
				t = found[1];
			}
			try {
				const old = await readTarget(t);
				const text = old ? old.toString("utf8") : "";
				// UTF-8 이 아닌 파일(메모장의 ANSI·UTF-16 저장 등)은 다시 쓰면 한글이 깨지므로 고치지 않음
				if (old && (old.includes(0) || !Buffer.from(text, "utf8").equals(old)))
					return ctx.ui.notify(`${label(t)} 이 UTF-8 이 아니라 고치지 않았습니다. 편집기에서 UTF-8 로 저장한 뒤 다시 해 주세요`, "error");
				const next = addMemory(text, item);
				if (next === null) return ctx.ui.notify(`이미 적혀 있습니다 (${label(t)})`, "info");
				await writeTarget(t, Buffer.from(next, "utf8"));
			} catch (e) {
				return ctx.ui.notify(`적지 못했습니다 (${label(t)}): ${(e as Error).message}`, "error");
			}
			S.notes.push(item);
			ctx.ui.notify(`기억했습니다 → ${label(t)} 의 "${HEAD.slice(3)}". 지금 대화에는 다음 요청과 함께 알려 줍니다 (지우려면 그 파일에서 줄을 지우세요)`, "info");
		},
	});
}
