/**
 * 되돌리기 (/undo): pi 가 write·edit 도구로 고친 파일을 요청 단위로 원래대로 돌린다.
 *
 *  /undo     마지막 요청에서 고친 파일을 되돌림
 *  /undo 2   마지막 두 요청
 *  - 요청이 시작될 때마다 기록을 새로 열고, 파일을 고치기 직전 내용과 고친 직후 내용을 함께 남긴다.
 *  - 되돌리기 전에 파일 목록(복원 / 지움: 새로 만든 파일)을 보여 주고 확인을 받는다.
 *  - 고친 뒤에 다른 곳에서 다시 바뀐 파일은 덮어쓰지 않고 알린다.
 *  - 셸 명령(bash)으로 바뀐 파일은 기록하지 않으므로 되돌리지 못한다. 5MB 넘는 파일도 기록하지 않는다.
 *  - jupyter 모드에서 노트북 파일을 고친 것도 되돌린다 (중계 서버를 거침).
 *  - 기록은 pi 를 끄면 사라진다. 되돌린 뒤 다음 요청에는 LLM 에게 되돌린 파일을 알려 준다.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readTarget, removeTarget, shown, type Target, target, writeTarget } from "./lib/relay.ts";

const MAX_FILE = 5 * 1024 * 1024;
type Snap = Target & { label: string; before?: Buffer | null; after?: Buffer | null; skip?: string };
type Checkpoint = { id: number; files: Map<string, Snap> };

const keyOf = (t: Target) => (t.remote ? "nb:" : "pc:") + t.abs.toLowerCase();
const same = (a: Buffer | null | undefined, b: Buffer | null | undefined) => (a === null || b === null ? a === b : !!a && !!b && a.equals(b));

export default function (pi: ExtensionAPI) {
	let history: Checkpoint[] = [];
	let current: Checkpoint | null = null;
	let seq = 0;
	let note = ""; // 다음 요청에 붙일 알림 (되돌린 파일)

	pi.on("agent_start", async () => {
		current = { id: ++seq, files: new Map() };
		history.push(current);
		if (history.length > 30) history.shift();
	});

	// 고치기 직전 내용 (요청마다 파일당 한 번)
	pi.on("tool_call", async (event: any) => {
		if (!current || (event.toolName !== "write" && event.toolName !== "edit") || !event.input?.path) return;
		const t = target(event.input.path);
		const key = keyOf(t);
		if (current.files.has(key)) return;
		const snap: Snap = { ...t, label: shown(t) };
		current.files.set(key, snap);
		try {
			const data = await readTarget(t);
			if (data && data.length > MAX_FILE) snap.skip = "5MB 가 넘어 기록하지 않음";
			else snap.before = data;
		} catch (e) {
			snap.skip = `처음 내용을 읽지 못함 (${(e as Error).message})`;
		}
	});

	// 고친 직후 내용 (같은 요청에서 여러 번 고치면 마지막 것)
	pi.on("tool_result", async (event: any) => {
		if (!current || (event.toolName !== "write" && event.toolName !== "edit") || !event.input?.path) return;
		const snap = current.files.get(keyOf(target(event.input.path)));
		if (!snap || snap.skip) return;
		try {
			snap.after = await readTarget(snap);
		} catch {
			snap.after = undefined;
		}
	});

	pi.on("input", async (event: any) => {
		if (!note || !event.text || event.text.startsWith("/")) return;
		const text = `${note}\n\n${event.text}`;
		note = "";
		return { action: "transform", text };
	});

	pi.registerCommand("undo", {
		description: "pi 가 고친 파일을 원래대로 (/undo: 마지막 요청, /undo 2: 마지막 두 요청). 셸 명령으로 바뀐 파일은 제외",
		handler: async (args, ctx) => {
			const n = Math.max(1, Number.parseInt(String(args || "1"), 10) || 1);
			const cps = history.filter((c) => c.files.size > 0).slice(-n).reverse(); // 최근 것부터
			if (!cps.length) return ctx.ui.notify("되돌릴 변경이 없습니다 (pi 가 이번 실행에서 write·edit 로 고친 파일만 기록합니다)", "info");
			const plan: string[] = [];
			for (const cp of cps)
				for (const s of cp.files.values())
					plan.push(s.skip ? `  되돌릴 수 없음: ${s.label} (${s.skip})` : `  ${s.before === null ? "지움 (새로 만든 파일)" : "복원"}: ${s.label}`);
			const ok = await ctx.ui.confirm(
				`되돌릴까요? (요청 ${cps.length}개)`,
				`${plan.join("\n")}\n\n셸 명령(bash)으로 바뀐 파일은 되돌리지 않습니다.`,
			);
			if (!ok) return;
			const done: string[] = [];
			const skipped: string[] = [];
			for (const cp of cps) {
				for (const s of cp.files.values()) {
					if (s.skip || s.before === undefined) {
						skipped.push(`${s.label} (${s.skip || "기록 없음"})`);
						continue;
					}
					try {
						const cur = await readTarget(s);
						if (same(cur, s.before)) continue; // 이미 원래 내용
						if (s.after === undefined || !same(cur, s.after)) {
							skipped.push(`${s.label} (그 뒤에 다른 변경이 있어 덮어쓰지 않음)`);
							continue;
						}
						if (s.before === null) await removeTarget(s);
						else await writeTarget(s, s.before);
						done.push(s.label);
					} catch (e) {
						skipped.push(`${s.label} (${(e as Error).message})`);
					}
				}
			}
			history = history.filter((c) => !cps.includes(c));
			if (done.length) note = `(사용자가 /undo 로 앞 요청에서 바꾼 파일을 원래대로 돌렸습니다: ${done.join(", ")}. 지금 파일 내용을 기준으로 이어 가세요.)`;
			const msg = [done.length ? `되돌렸습니다: ${done.join(", ")}` : "되돌린 파일이 없습니다", ...(skipped.length ? [`그대로 둠: ${skipped.join(", ")}`] : [])];
			ctx.ui.notify(msg.join(" / "), skipped.length ? "warning" : "info");
		},
	});
}
