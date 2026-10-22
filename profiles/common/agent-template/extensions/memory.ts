/**
 * 기억하기
 *
 * 1) /remember <내용>: 앞으로도 지킬 내용을 지침 파일(AGENTS.md)에 적어 둔다.
 *  /remember 테스트는 pytest -q 로 돌린다
 *  - 어디에 적을지 고른다: 이 프로젝트(작업 폴더의 AGENTS.md) 또는 모든 프로젝트(~/.pi/agent/AGENTS.md).
 *    jupyter 모드에서 '이 프로젝트' 는 노트북 작업 폴더의 AGENTS.md (중계 서버를 거쳐 씀)
 *  - "## 기억할 것" 부분 끝에 "- 내용" 한 줄로 더한다 (없으면 파일 끝에 만든다). 같은 줄이 이미 있으면 더하지 않는다
 *  - 지침 파일은 pi 를 시작할 때 읽으므로, 지금 대화에는 다음 요청 앞에 붙여 바로 알려 준다
 *    (/reload 로 다시 읽으면 Copilot 새 대화가 열려 느리므로 쓰지 않는다)
 *  - 지우거나 고치려면 그 파일을 직접 고친다
 *
 * 2) 작업 기록 (/recall): 세션을 새로 시작해도 이 프로젝트에서 하던 일을 이어 가게
 *  - 요청이 끝날 때마다 질문 없이 남긴다: 사용자가 친 요청, 바꾼 파일, 돌린 명령, 위키에 쓴 페이지, 답의 앞부분.
 *    확장이 보낸 요청은 사용자를 대신한 것(/plan <요청>, 계획대로 진행, /wiki ask)만 (폴더째 반영·/watch 의 로그는 남기지 않음)
 *  - 같은 프로젝트(작업 폴더. jupyter 모드면 노트북 작업 폴더)에서 세션을 시작하면 지난 기록을 지침의 <recent_work> 부분으로 알린다.
 *    세션 안에서는 첫 요청 때 정한 같은 글 (지침이 바뀌면 Copilot·사내AI 는 새 대화를 열므로)
 *  - /recall save: 다음 세션에 넘길 요약을 모델에게 부탁해(질문 1번) 기록에 넣는다. /new·/resume 때 이 세션의 요청이 3개 이상이면 물어본다.
 *    기본 명령 /handoff(작업 폴더의 NOTES.md 에 정리)는 그대로이고, 그 파일이 있으면 새 세션에 있다고 알린다
 *  - 기록은 PC 의 ~/.pi/agent/work-log/<프로젝트>.jsonl (프로젝트마다 최근 200개).
 *    이메일·전화번호·카드·계좌번호 모양 번호는 '…' 로 빼고, 비밀로 보이는 글은 남기지 않는다
 *  - /recall (보기) · /recall save (요약 남기기) · /recall off·on (끄기·켜기) · /recall clear (이 프로젝트 기록 지우기)
 */

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	rawInput,
	readHead,
	readTarget,
	scrubText,
	shown,
	type Target,
	target,
	transformInput,
	userAsk,
	userAskOf,
	type WorkDir,
	workDir,
	writeTarget,
} from "./lib/relay.ts";

const HEAD = "## 기억할 것";

/** 지침 글에 항목 더하기: "## 기억할 것" 부분 끝에 (없으면 파일 끝에 새로). 이미 있으면 null.
 *  부분은 다음 제목(#·##)이나 키트가 고치는 부분의 표시(<!-- kit ... -->)에서 끝남 (그 안에 넣으면 키트가 다시 쓸 때 지워짐) */
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
		if (/^#{1,2}\s/.test(lines[k]) || /^<!--\s*\/?kit\b/.test(lines[k].trim())) {
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
const tildePath = (p: string) => {
	const s = p.split("\\").join("/");
	return s.toLowerCase() === home.toLowerCase() || s.toLowerCase().startsWith(home.toLowerCase() + "/") ? "~" + s.slice(home.length) : s;
};
const label = (t: Target) => (t.remote ? `노트북 ${t.abs}` : tildePath(t.abs));
const cut = (s: string, n = 60) => (s.length > n ? s.slice(0, n) + "…" : s);
const one = (s: string) => s.replace(/\s+/g, " ").trim();
const agentDirOf = () => process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");

// ── 작업 기록 ─────────────────────────────────────────────────

export type WorkRec = {
	t: string; // "2026-10-21 14:03" (이 PC 의 시각)
	req?: string; // 사용자의 요청
	files?: string[]; // 바꾼 파일 (write·edit, 작업 폴더 기준)
	cmds?: string[]; // 돌린 명령 (보기만 하는 명령은 뺌)
	wiki?: string[]; // 위키에 쓴 페이지
	ans?: string; // 답의 앞부분
	end?: string; // 끝까지 답하지 못했으면 aborted·error 등
	handoff?: string; // /recall save 로 남긴 요약
};
export const LOG_KEEP = 200; // 프로젝트마다 남기는 기록 수
export const DIGEST_MAX = 1600; // 지침에 알리는 글의 길이 (새 대화의 첫 메시지에만 들어감. 사내AI 는 입력 한 번에 만 자라 지침·도구 설명과 나눠 씀)
export const DIGEST_ITEMS = 6; // 알리는 최근 요청 수
export const DIGEST_DAYS = 30; // 이보다 오래된 기록은 알리지 않음
export const HANDOFF_MAX = 900; // 알리는 넘겨받은 요약의 길이 (줄 단위로 줄이고 '요구사항'·'정한 것' 줄은 남김)
export const HANDOFF_MIN = 3; // /new·/resume 때 요약을 남길지 묻는 요청 수
// 요구사항·정한 것을 맨 앞에: 예전에는 정한 것을 끝(주의할 점)에 적게 해서, 요약이 잘릴 때 먼저 빠졌다
//  (시험: 세션 1 에서 정한 'GPU 는 엔진 가운데 최대값' 이 잘려 세션 4 가 묻지 않고 합계로 바꿈).
//  요구사항(만들 것과 꼭 들어갈 내용·조건)도 따로 적게 한다: 세션 7 의 요약은 목표를 'CPU/메모리 사용량 낮추기' 로만 적고
//  정한 것 줄도 없어, 처음 요청의 GPU·네트워크 속도·총 전송량이 넘겨지지 않았다.
//  앞 세션에서 넘겨받은 것도 옮겨 적게 해서 세션을 몇 번 거쳐도 남게
export const HANDOFF_PROMPT =
	"다음 세션에서 이 작업을 이어 갈 수 있게 지금까지 한 일을 정리해 줘. 도구는 쓰지 말고 이 대화(지침의 지난 작업 기록 포함)만 보고 적어 줘. " +
	"맨 앞에 '요구사항:' 으로 시작하는 줄에 사용자가 요구한 결과물과 꼭 들어갈 내용·조건(보여 줄 항목, 지킬 제약 등)을, " +
	"그다음 '정한 것:' 으로 시작하는 줄에 사용자가 정한 결정·규칙을 적되, 둘 다 앞 세션에서 넘겨받은 것 중 아직 유효한 것도 빠짐없이 옮겨 적어 줘. " +
	"그다음 목표 / 한 일 / 바꾼 파일 / 남은 일·다음에 할 일 / 주의할 점(안 된 방법) 을 한두 줄씩, 모두 14줄 안에. 비밀번호·개인정보는 적지 마.";

/** 넘겨받은 요약을 max 자 안으로: 줄 단위로 줄이고, '요구사항'·'정한 것' 줄은 먼저 남긴다 (원래 차례는 그대로).
 *  그 줄이 너무 길어 통째로 들어가지 않으면 앞부분만이라도 남긴다 */
export function handoffCut(text: string, max = HANDOFF_MAX): string {
	if (text.length <= max) return text;
	const lines = text.split(/\r?\n/).filter((l) => l.trim());
	const decided = (l: string) => /^[\s\-*•]*(요구 ?사항|정한 ?것|결정|규칙)/.test(l);
	const keep = new Set<number>();
	let room = max - 12; // "(… n줄 줄임)" 자리
	// 차례: 통째로 들어가는 요구사항·정한 것 줄 -> 남은 자리에 긴 요구사항·정한 것 줄의 앞부분 -> 다른 줄
	for (const [want, cut] of [[true, false], [true, true], [false, false]]) {
		lines.forEach((l, i) => {
			if (decided(l) !== want || keep.has(i)) return;
			if (l.length + 1 > room) {
				if (!cut || room < 60) return;
				lines[i] = `${l.slice(0, room - 2)}…`;
			}
			keep.add(i);
			room -= lines[i].length + 1;
		});
	}
	if (!keep.size) return `${text.slice(0, max - 1)}…`; // 줄바꿈 없는 긴 글
	const out = lines.filter((_, i) => keep.has(i));
	const left = lines.length - out.length;
	return left ? `${out.join("\n")}\n(… ${left}줄 줄임)` : out.join("\n");
}

export const logDir = () => join(agentDirOf(), "work-log");
export const logFile = (key: string, dir = logDir()) => join(dir, `${key}.jsonl`);
const settingsFile = () => join(logDir(), "settings.json");

/** 작업 기록을 쓰는지 (/recall off 로 끔. 설정이 없으면 켜짐) */
export function recallOn(): boolean {
	try {
		return JSON.parse(readFileSync(settingsFile(), "utf8")).enabled !== false;
	} catch {
		return true;
	}
}
function setRecall(on: boolean) {
	mkdirSync(logDir(), { recursive: true });
	writeFileSync(settingsFile(), `${JSON.stringify({ enabled: on }, null, 2)}\n`);
}
const isBridge = () => {
	try {
		return /127\.0\.0\.1:876[56]/.test(readFileSync(join(agentDirOf(), "models.json"), "utf8"));
	} catch {
		return false;
	}
};

/** 프로젝트 = 작업 폴더 (jupyter 모드면 노트북 작업 폴더). key 는 기록 파일 이름, label 은 보여 줄 이름. 노트북에 아직 연결되지 않았으면 null */
export function projectOf(wd: WorkDir): { key: string; label: string } | null {
	const p = wd.cwd.split("\\").join("/").replace(/\/+$/, "");
	if (wd.remote && !p) return null; // jupyter.ts 는 연결 전에 '/' 로 알림
	// Windows PC 의 경로는 대소문자를 가리지 않음 (파일 이름도). 노트북(Linux)은 가림
	const ci = !wd.remote && process.platform === "win32";
	const id = wd.remote ? `nb:${p}` : `pc:${ci ? p.toLowerCase() : p}`;
	const base =
		(ci ? p.toLowerCase() : p)
			.split("/")
			.filter((s) => s && !/^[A-Za-z]:$/.test(s))
			.slice(-2)
			.join("-")
			.replace(/[^\p{L}\p{N}._-]+/gu, "_")
			.slice(0, 40) || "root";
	return { key: `${base}-${createHash("sha1").update(id).digest("hex").slice(0, 8)}`, label: wd.remote ? `노트북 ${p}` : tildePath(p || "/") };
}

export function readLog(file: string): WorkRec[] {
	let text = "";
	try {
		text = readFileSync(file, "utf8");
	} catch {
		return [];
	}
	const out: WorkRec[] = [];
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim()) continue;
		try {
			const r = JSON.parse(line);
			if (r && typeof r.t === "string") out.push(r);
		} catch {}
	}
	return out;
}

/** 기록 더하기 (keep 보다 50개 넘게 쌓이면 최근 keep 개만 남김) */
export function appendLog(file: string, rec: WorkRec, keep = LOG_KEEP) {
	mkdirSync(dirname(file), { recursive: true });
	appendFileSync(file, `${JSON.stringify(rec)}\n`);
	const all = readLog(file);
	if (all.length > keep + 50) writeFileSync(file, `${all.slice(-keep).map((r) => JSON.stringify(r)).join("\n")}\n`);
}

const p2 = (n: number) => String(n).padStart(2, "0");
export const stamp = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
const shortT = (t: string) => t.slice(5); // "10-21 14:03"
/** 경로는 끝이 중요하므로 앞을 줄임 */
const tailCut = (s: string, n = 40) => (s.length > n ? `…${s.slice(s.length - n + 1)}` : s);

/** 기록 한 줄: - 10-21 14:03 "요청" → 바꾼 파일 a.py · 명령 python a.py · 답: ... */
export function turnLine(r: WorkRec): string {
	const more: string[] = [];
	if (r.files?.length) more.push(`바꾼 파일 ${r.files.slice(0, 4).map((f) => tailCut(f)).join(", ")}${r.files.length > 4 ? ` 외 ${r.files.length - 4}개` : ""}`);
	if (r.wiki?.length) more.push(`위키 ${r.wiki.slice(0, 2).map((n) => `[[${n}]]`).join(", ")}`);
	if (r.cmds?.length) more.push(`명령 ${cut(r.cmds[r.cmds.length - 1], 50)}`);
	if (r.end === "aborted") more.push("Esc 로 멈춤");
	else if (r.end) more.push("끝까지 답하지 못함");
	if (r.ans) more.push(`답: ${cut(r.ans, 70)}`);
	return `- ${shortT(r.t)} "${cut(r.req || "", 70)}"${more.length ? ` → ${more.join(" · ")}` : ""}`;
}

/** 새 세션에 알릴 글: 마지막 요약(/recall save)과 최근 요청들 (오래된 것부터). notes: 작업 폴더에 NOTES.md(/handoff 로 정리한 메모)가 있음.
 *  알릴 것이 없으면 "" */
export function digestOf(recs: WorkRec[], where: string, now = new Date(), max = DIGEST_MAX, notes = false): string {
	const since = now.getTime() - DIGEST_DAYS * 86_400_000;
	const recent = recs.filter((r) => {
		const d = Date.parse(r.t.replace(" ", "T"));
		return Number.isFinite(d) && d >= since;
	});
	const parts = [
		`이 프로젝트(${where})에서 지난 세션들에 한 일입니다 (pi 가 자동으로 남긴 기록). 오래되었거나 틀릴 수 있으니 파일은 지금 내용을 다시 확인하고, 사용자가 이어서 하자고 하면 이것을 참고한다.`,
	];
	if (notes) parts.push("작업 폴더의 NOTES.md 에 /handoff 로 정리한 작업 메모가 있다 (이어서 할 때 먼저 읽어 본다).");
	const ho = [...recent].reverse().find((r) => r.handoff);
	if (ho?.handoff) {
		parts.push(`넘겨받은 요약 (${shortT(ho.t)}):\n${handoffCut(ho.handoff)}`);
	}
	const title = "최근 요청 (오래된 것부터):";
	let room = max - parts.join("\n").length - title.length - 2;
	const lines: string[] = [];
	for (const r of [...recent].reverse()) {
		if (r.handoff || !r.req) continue;
		const l = turnLine(r);
		if (lines.length >= DIGEST_ITEMS || l.length + 1 > room) break;
		lines.unshift(l);
		room -= l.length + 1;
	}
	if (lines.length) parts.push(`${title}\n${lines.join("\n")}`);
	return parts.length > 1 ? parts.join("\n") : "";
}

// 기록하지 않는 명령: 보기만 하는 것 (앞의 'cd 폴더 &&' 는 떼고 봄)
const LOOK_ONLY =
	/^(?:ls|ll|cat|head|tail|less|more|grep|egrep|rg|find|fd|pwd|cd|echo|printf|wc|which|type|command|tree|du|df|stat|file|sort|uniq|diff|cmp|date|whoami|hostname|env|printenv|ps|top|free|nproc|nvidia-smi|sed -n|awk|jq|yq|true|git (?:status|log|diff|show|branch|remote|config|rev-parse|ls-files)|pip3? (?:list|show|freeze)|conda (?:list|env list|info)|python3? (?:-V|--version)|kubectl (?:get|describe|logs|top))(?:\s|$)/;
export function doing(command: string): string {
	const c = one(command.split("\n")[0]).replace(/^(?:cd\s+[^;&|]+?\s*(?:&&|;)\s*)+/, "");
	return c && !LOOK_ONLY.test(c) ? c : "";
}
/** 답의 앞부분 (코드 블록·마크다운 표시는 빼고) */
const ansHead = (s: string) =>
	one(
		s
			.replace(/```[\s\S]*?(```|$)/g, " ")
			.replace(/^#{1,6}\s+/gm, "")
			.replace(/[*_`>|]/g, ""),
	).slice(0, 200);
const textOf = (m: any): string =>
	typeof m?.content === "string" ? m.content : (m?.content || []).filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n");

type Turn = { t: string; req: string; files: string[]; cmds: string[]; wiki: string[]; ans: string; end: string; handoff: boolean };

export default function (pi: ExtensionAPI) {
	// 다음 요청에 붙여 알릴 것 (확장을 다시 불러와도(/kit share, /reload) 남김)
	const S: { notes: string[] } = ((globalThis as any).__piRemember ||= { notes: [] });
	// 작업 기록: 이번 세션에 알린 글(첫 요청 때 정함, null 은 아직), 지금 요청, 이번 세션에 남긴 요청 수, 요약 단계 (다시 불러와도 남김)
	const W: { digest: string | null; cur: Turn | null; turns: number; handoff: "" | "asked" | "pending" | "done"; again: string } = ((globalThis as any).__piWorkLog ||= {
		digest: null,
		cur: null,
		turns: 0,
		handoff: "",
		again: "",
	});
	let widget = false;
	const say = (ctx: any, text: string, level = "info") => {
		try {
			ctx?.ui?.notify(text, level);
		} catch {}
	};
	const startHandoff = () => {
		W.handoff = "pending";
		pi.sendUserMessage(userAsk(HANDOFF_PROMPT, "(다음 세션에 넘길 요약)"));
	};

	pi.on("session_start", async (event: any) => {
		if (event?.reason === "reload") return;
		S.notes = []; // 새 세션은 지침 파일을 새로 읽으므로 알릴 필요 없음
		W.digest = null;
		W.cur = null;
		W.turns = 0;
		W.handoff = "";
		W.again = "";
	});

	pi.on("input", async (event: any) => {
		if (!S.notes.length || !event.text || event.text.startsWith("/")) return;
		const text = `(사용자가 /remember 로 지침에 더한 내용입니다. 지금부터 지켜 주세요: ${S.notes.join(" / ")})\n\n${event.text}`;
		S.notes = [];
		return transformInput(event.text, text);
	});

	// 작업 기록: 요청 (요청 중에 더 친 글은 같은 요청에 이어 붙임)
	pi.on("input", async (event: any) => {
		if (!recallOn()) return;
		const text = String(event.text || "");
		const handoff = rawInput(text) === HANDOFF_PROMPT;
		const ask = event.source === "extension" ? userAskOf(text) : rawInput(text);
		if (!ask?.trim()) return;
		if (W.cur && !handoff) W.cur.req = cut(`${W.cur.req} / ${one(scrubText(ask))}`, 300); // 자르기 전에 빼기 (잘린 이메일은 알아보지 못함)
		else W.cur = { t: stamp(), req: cut(one(scrubText(ask)), 300), files: [], cmds: [], wiki: [], ans: "", end: "", handoff };
	});

	pi.on("tool_result", async (event: any) => {
		const c = W.cur;
		if (!c || event.isError) return;
		const input = event.input || {};
		if ((event.toolName === "write" || event.toolName === "edit") && typeof input.path === "string") {
			let f = input.path;
			try {
				f = shown(target(input.path));
			} catch {}
			if (!c.files.includes(f) && c.files.length < 12) c.files.push(f);
		} else if (event.toolName === "bash" && typeof input.command === "string") {
			const d = cut(doing(input.command), 100);
			if (d && !c.cmds.includes(d) && c.cmds.length < 3) c.cmds.push(d);
		} else if (event.toolName === "wiki_write") {
			const text = (event.content || []).map((x: any) => x?.text || "").join("\n");
			for (const m of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) if (!c.wiki.includes(m[1]) && c.wiki.length < 5) c.wiki.push(m[1]);
		}
	});

	pi.on("message_end", async (event: any) => {
		const m = event.message;
		if (!W.cur || m?.role !== "assistant" || m.stopReason === "error" || m.stopReason === "aborted") return;
		const t = textOf(m);
		if (t.trim()) W.cur.ans = t;
	});

	// 끝난 모습: 오류 뒤에는 pi 가 알아서 다시 할 수 있어 끝날 때마다 덮어쓰고, 다 끝난 뒤(agent_settled)에 남김
	pi.on("agent_end", async (event: any) => {
		if (!W.cur) return;
		const msgs: any[] = event.messages || [];
		const last = msgs[msgs.length - 1];
		W.cur.end = last?.role === "assistant" ? String(last.stopReason || "") : "unfinished";
	});

	pi.on("agent_settled", async (_event: unknown, ctx: any) => {
		const c = W.cur;
		W.cur = null;
		if (!c || !recallOn()) return;
		const p = projectOf(workDir());
		if (!p) return;
		const file = logFile(p.key);
		try {
			if (c.handoff) {
				const text = c.end === "stop" ? c.ans.split(/\r?\n/).map(scrubText).filter((l) => l.trim()).join("\n").trim() : "";
				if (!text) {
					W.handoff = "";
					return say(ctx, "다음 세션에 넘길 요약을 남기지 못했습니다 (답이 끝나지 않음). 다시: /recall save", "warning");
				}
				appendLog(file, { t: c.t, handoff: cut(text, 1500) });
				W.handoff = "done";
				const again = W.again ? `. 이제 /${W.again} 을 다시 입력하세요` : "";
				W.again = "";
				return say(ctx, `다음 세션에 넘길 요약을 남겼습니다 → ${tildePath(file)} (보기 /recall)${again}`);
			}
			const files = c.files.map(scrubText).filter(Boolean);
			const cmds = c.cmds.map(scrubText).filter(Boolean);
			const wiki = c.wiki.map(scrubText).filter(Boolean);
			const ans = scrubText(ansHead(c.ans));
			if (!files.length && !cmds.length && !wiki.length && !ans) return; // 아무것도 하지 못하고 끝남 (오류 등)
			appendLog(file, {
				t: c.t,
				req: scrubText(c.req) || "(비밀로 보여 뺀 요청)",
				...(files.length ? { files } : {}),
				...(cmds.length ? { cmds } : {}),
				...(wiki.length ? { wiki } : {}),
				...(ans ? { ans } : {}),
				...(c.end && c.end !== "stop" ? { end: c.end } : {}),
			});
			W.turns++;
		} catch {}
	});

	// 새 세션의 첫 요청 때 지난 기록을 정하고, 세션 안에서는 같은 글을 지침에 (바뀌면 Copilot·사내AI 가 새 대화를 열므로)
	pi.on("before_agent_start", async (event: any) => {
		if (!recallOn()) return;
		if (W.digest === null) {
			const wd = workDir();
			const p = projectOf(wd);
			if (!p) return;
			// 작업 폴더의 NOTES.md (jupyter 모드면 노트북의 것). 노트북 연결이 멈춰 있어도 첫 요청이 기다리지 않게 3초까지만
			let notes = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				notes = await Promise.race([
					readHead(target("NOTES.md", wd), 1).then((h) => !!h),
					new Promise<boolean>((ok) => {
						timer = setTimeout(() => ok(false), 3000);
					}),
				]);
			} catch {
			} finally {
				if (timer) clearTimeout(timer);
			}
			W.digest = digestOf(readLog(logFile(p.key)), p.label, new Date(), DIGEST_MAX, notes);
		}
		const sections = event.systemPromptOptions?.sections;
		if (W.digest && sections && typeof sections === "object") sections.recent_work = W.digest;
	});

	// /new·/resume: 이 세션에 요청이 여럿이면 다음 세션에 넘길 요약을 남길지 한 번 묻는다 (모델에게 한 번 묻는 것이라)
	pi.on("session_before_switch", async (event: any, ctx: any) => {
		if (!recallOn() || W.handoff || W.turns < HANDOFF_MIN || (globalThis as any).__piMode === "plan") return;
		try {
			if (!ctx?.hasUI || !ctx.isIdle()) return;
		} catch {
			return;
		}
		W.handoff = "asked";
		const again = event?.reason === "resume" ? "resume" : "new";
		const ok = await ctx.ui.confirm(
			"다음 세션에 넘길 요약",
			`이 세션에서 요청 ${W.turns}개를 했습니다. 새 세션이 이어 갈 수 있게 지금까지의 요약을 남길까요?\n` +
				`모델에게 한 번 묻습니다${isBridge() ? " (사내AI 는 하루 질문 수에 들어감)" : ""}. 요약이 끝나면 /${again} 을 다시 입력하세요.\n` +
				"아니요: 바로 넘어갑니다 (요청마다 남긴 기록은 요약 없이도 다음 세션에 알려 줌)",
		);
		if (!ok) return;
		W.again = again;
		setTimeout(() => {
			try {
				startHandoff();
			} catch {
				W.handoff = "";
			}
		}, 0);
		return { cancel: true };
	});

	pi.on("agent_start", async (_event: unknown, ctx: any) => {
		if (!widget) return;
		widget = false;
		try {
			ctx.ui.setWidget("pi-recall", undefined);
		} catch {}
	});

	pi.registerCommand("recall", {
		description: "작업 기록: 지난 세션들에서 한 일 보기 (새 세션에 지침으로 알려 줌). save (다음 세션에 넘길 요약), off·on (끄기·켜기), clear (이 프로젝트 기록 지우기)",
		handler: async (args, ctx) => {
			const sub = String(args || "").trim().toLowerCase();
			const notify = (m: string, level = "info") => ctx.ui.notify(m, level);
			const p = projectOf(workDir());
			const fresh = W.digest && isBridge() ? " (지침이 바뀌어 Copilot·사내AI 는 다음 요청부터 새 대화)" : "";
			if (sub === "off" || sub === "끄기") {
				setRecall(false);
				return notify(`작업 기록을 껐습니다: 남기지도 알리지도 않습니다${fresh}. 켜기: /recall on`);
			}
			if (sub === "on" || sub === "켜기") {
				setRecall(true);
				return notify("작업 기록을 켰습니다: 요청이 끝날 때마다 남기고, 새 세션을 시작하면 알려 줍니다");
			}
			if (!p) return notify("작업 폴더를 아직 모릅니다 (노트북에 연결된 뒤 다시)", "warning");
			const file = logFile(p.key);
			if (sub === "save" || sub === "요약") {
				// 다음 세션에 넘길 요약 (모델에게 한 번). 기본 명령 /handoff 는 NOTES.md 에 정리 (파일로 남김)
				if (!recallOn()) return notify("작업 기록이 꺼져 있습니다 (켜기: /recall on)", "warning");
				if ((globalThis as any).__piMode === "plan") return notify("계획 모드에서는 요약을 남기지 않습니다 (/plan 으로 끈 뒤 다시)", "warning");
				if (!ctx.isIdle()) return notify("지금 하는 작업이 끝난 뒤 다시 입력해 주세요", "warning");
				W.again = "";
				return startHandoff();
			}
			if (sub === "clear" || sub === "지우기") {
				const n = readLog(file).length;
				if (!n) return notify(`이 프로젝트(${p.label})의 작업 기록이 없습니다`);
				if (ctx.hasUI && !(await ctx.ui.confirm("작업 기록 지우기", `${p.label} 의 작업 기록 ${n}개를 지울까요? 되돌릴 수 없습니다.`))) return;
				try {
					unlinkSync(file);
				} catch (e) {
					return notify(`지우지 못했습니다: ${(e as Error).message}`, "error");
				}
				W.digest = ""; // 이번 세션에도 더 알리지 않음
				return notify(`작업 기록 ${n}개를 지웠습니다 (${tildePath(file)})${fresh}`);
			}
			if (sub) return notify("사용법: /recall (보기) · save (다음 세션에 넘길 요약) · off · on · clear (이 프로젝트 기록 지우기)", "warning");
			if (widget) {
				widget = false;
				return ctx.ui.setWidget("pi-recall", undefined);
			}
			const recs = readLog(file);
			const on = recallOn();
			const shownNow = W.digest !== null;
			const digest = shownNow ? W.digest || "" : digestOf(recs, p.label);
			const body = digest
				? digest
						.split("\n")
						.slice(1)
						.map((l) => `   ${l}`)
				: ["   (알릴 기록 없음)"];
			const lines = [
				`── 작업 기록: ${p.label} (${on ? "켜짐" : "꺼짐"} · 닫기: /recall) ──`,
				` 기록 ${recs.length}개 · ${tildePath(file)}`,
				shownNow ? " 이번 세션에 알린 것:" : " 다음 요청 때 알릴 것:",
				...body,
				" 명령  /recall save (다음 세션에 넘길 요약) · off·on · clear (이 프로젝트 기록 지우기) · /handoff 는 NOTES.md 에 정리",
			];
			if (!ctx.hasUI) return notify(lines.join("\n"));
			ctx.ui.setWidget("pi-recall", [lines.join("\n")]);
			widget = true;
		},
	});

	pi.registerCommand("remember", {
		description: "앞으로도 지킬 내용을 지침(AGENTS.md)에 적어 둠. 예: /remember 커밋 메시지는 한국어로",
		handler: async (args, ctx) => {
			const item = String(args || "").replace(/\s+/g, " ").trim();
			if (!item) return ctx.ui.notify("사용법: /remember <기억할 내용>   예) /remember 테스트는 pytest -q 로 돌린다", "info");
			const wd = workDir();
			const project = target("AGENTS.md", wd);
			const global = target(join(agentDirOf(), "AGENTS.md"), { remote: false, cwd: process.cwd() });
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
