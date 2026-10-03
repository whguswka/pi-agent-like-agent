/**
 * Copilot 대화 정리 + 진행 상태 표시 (브리지 pi 용)
 *
 * 1) pi 세션이 끝나면(종료, /new 로 새 세션 등) PC 의 중계 서버(copilot/relay.py)에 알린다.
 *    중계 서버는 그 세션에서 쓴 Copilot 대화를 지운다 (bridge.json 의 delete_finished_chats).
 *    맥락은 pi 가 따로 저장하므로 Copilot 쪽 대화는 남길 필요가 없다.
 *    설정을 다시 읽는 reload 는 같은 대화를 이어 가므로 알리지 않는다.
 *    중계 서버가 꺼져 있거나 창을 닫아 알림이 못 가면, 중계 서버가 다음 새 대화를 열 때 정리한다.
 * 2) 요청을 처리하는 동안 1초마다 중계 서버의 /status 를 물어, Copilot 쪽에서 지금 하는 일을 상태 줄에 보여 준다
 *    (예: "Copilot: 새 대화 여는 중 12초", "Copilot: 답 기다리는 중 (2/3) 5초"). /status 는 잠금 없이 바로 답한다.
 *    앞 대화를 요약하는 동안(/compact, 자동 요약)에도 보여 준다. 요약 요청도 Copilot 새 대화로 가서 몇 분 걸릴 수 있다.
 * 3) 요청마다 이 pi 의 세션 값(X-Pi-Session)을 실어 보낸다. 중계 서버에서 max_tabs 를 2 이상으로 두면
 *    pi 를 여러 개 동시에 쓸 때 세션마다 Copilot 창을 따로 쓴다 (1 이면 무시).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SERVER = (process.env.PI_COPILOT_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");
// 이 pi 의 세션 값 (jupyter.ts 와 같은 값을 쓰도록 globalThis 에 한 번만 만듦)
const SESSION: string = ((globalThis as any).__piSession ||=
	process.env.PI_COPILOT_SESSION || `${process.pid}-${Math.random().toString(36).slice(2, 8)}`);

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_headers", async (event: any) => {
		if (event?.headers) event.headers["X-Pi-Session"] = SESSION;
	});

	let timer: ReturnType<typeof setInterval> | null = null;
	let shown = false;
	// 상태를 보여 주는 때: 요청을 처리하는 동안(agent_start ~ agent_end), 앞 대화를 요약하는 동안
	// (session_before_compact ~ session_compact 또는 session_compact_failed). 둘이 겹쳐도 한 번만 묻는다
	let running = false;
	let compacting = false;
	const stop = (ctx?: any) => {
		if (timer) clearInterval(timer);
		timer = null;
		if (shown && ctx?.hasUI) ctx.ui.setStatus("copilot", undefined);
		shown = false;
	};
	const start = (ctx: any) => {
		if (timer || !ctx?.hasUI) return;
		const fg = (t: string) => (ctx.ui.theme?.fg ? ctx.ui.theme.fg("muted", t) : t);
		let asking = false;
		timer = setInterval(async () => {
			if (asking) return;
			asking = true;
			try {
				const st: any = await (await fetch(`${SERVER}/status?session=${encodeURIComponent(SESSION)}`, { signal: AbortSignal.timeout(800) })).json();
				if (timer && st.busy && st.phase) {
					ctx.ui.setStatus("copilot", fg(`Copilot: ${st.phase} ${Math.floor(st.seconds)}초`));
					shown = true;
				} else if (shown) {
					ctx.ui.setStatus("copilot", undefined);
					shown = false;
				}
			} catch {
				// 중계 서버가 꺼져 있거나 /status 가 없는 예전 판: 표시하지 않음
			} finally {
				asking = false;
			}
		}, 1000);
	};
	const sync = (ctx: any) => (running || compacting ? start(ctx) : stop(ctx));

	pi.on("agent_start", async (_event: unknown, ctx: any) => {
		running = true;
		sync(ctx);
	});
	pi.on("agent_end", async (_event: unknown, ctx: any) => {
		running = false;
		sync(ctx);
	});
	// 요약이 끝나면(성공·실패·Esc 로 멈춤) 멈춘다. '요약할 것이 없음' 처럼 시작 전에 끝나면 failed 만 온다
	pi.on("session_before_compact", async (_event: unknown, ctx: any) => {
		compacting = true;
		sync(ctx);
	});
	const compactDone = async (_event: unknown, ctx: any) => {
		compacting = false;
		sync(ctx);
	};
	pi.on("session_compact", compactDone);
	pi.on("session_compact_failed", compactDone);

	pi.on("session_shutdown", async (event: { reason?: string }, ctx: any) => {
		running = compacting = false;
		stop(ctx);
		if (event?.reason === "reload") return;
		try {
			await fetch(SERVER + "/v1/session/end", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ reason: event?.reason || "", session: SESSION }),
				signal: AbortSignal.timeout(1500),
			});
		} catch {
			// 중계 서버가 꺼져 있음: 다음에 새 대화를 열 때 정리된다
		}
	});
}
