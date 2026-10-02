/**
 * 작업 끝 알림
 *
 * 요청 하나를 처리하는 데 notify_after_seconds(기본 30초) 넘게 걸렸으면, 끝날 때 터미널 벨을 울리고 알림을 띄운다.
 * 다른 창을 보고 있어도 끝난 것을 알 수 있게 한다. 벨이 어떻게 보이는지는 터미널 설정에 따라 다르다
 * (Git Bash 창: 소리 또는 작업 표시줄 표시, Windows Terminal: 소리와 작업 표시줄 표시).
 * 설정 (내 설정 파일 ~/.pi/agent/bridge.json, 고치면 바로 적용): "notify_after_seconds": 60   (0 이면 끔)
 * pi -p 처럼 화면이 없는 실행 방식에서는 아무것도 하지 않는다.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_SECONDS = 30;

function threshold(): number {
	const p = process.env.PI_COPILOT_USER_CONFIG || join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "bridge.json");
	try {
		const v = JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")).notify_after_seconds;
		if (v === undefined) return DEFAULT_SECONDS;
		const n = Number(v);
		return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SECONDS;
	} catch {
		return DEFAULT_SECONDS;
	}
}

export const duration = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}분 ${Math.round(s % 60)}초` : `${Math.round(s)}초`);

export default function (pi: ExtensionAPI) {
	let started = 0;
	pi.on("agent_start", async () => {
		started = Date.now();
	});
	pi.on("agent_settled", async (_event: unknown, ctx: any) => {
		if (!started) return;
		const secs = (Date.now() - started) / 1000;
		started = 0;
		const limit = threshold();
		if (!limit || secs < limit || !ctx.hasUI) return;
		if (ctx.mode === "tui") process.stdout.write("\x07"); // 터미널 벨
		ctx.ui.notify(`작업이 끝났습니다 (${duration(secs)})`, "info");
	});
}
