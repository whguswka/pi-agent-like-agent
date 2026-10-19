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
 * 4) 메모리: 30초마다 중계 서버의 /memory (전용 창 전체·중계 서버)를 물어 pi 자신의 메모리와 합쳐 상태 줄에 보여 준다 ("메모리 1.4GB").
 *    합계가 bridge.json 의 memory_warn_mb 를 넘으면 '/new 로 정리' 를 붙이고 한 번 알린다. 전용 창의 웹 앱은 페이지를 새로 읽기
 *    전에는 메모리를 거의 돌려주지 않으므로, 세션이 끝나면(/new) 중계 서버가 큰 탭을 새로 읽는다 (tab_reload_mb).
 * 5) 오늘 보낸 질문 수: 같은 /memory 의 questions_today 를 상태 줄에 ("사내AI 오늘 152/~200", 한도를 모르면 "Copilot 오늘 87번").
 *    요청이 끝날 때마다 고친다. 한도는 중계 서버가 한도에 닿은 때의 질문 수로 어림한 값(~). 그 90% 를 넘으면 경고 색과 하루에 한 번 알림.
 * 사내AI 모델(provider inhouse)은 두 번째 중계 서버(8766)를 쓰므로, 상태는 지금 모델의 중계 서버에 묻고 세션 끝은 둘 다에 알린다.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SERVER = (process.env.PI_COPILOT_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");
const INHOUSE_SERVER = (process.env.PI_INHOUSE_URL || "http://127.0.0.1:8766").replace(/\/+$/, "");
// 지금 모델의 중계 서버 (models.json 의 baseUrl 이 이 PC 의 중계 서버면 그 주소, 아니면 Copilot 중계 서버)와 화면 이름
const serverOf = (ctx: any): string => {
	const m = String(ctx?.model?.baseUrl || "").match(/^(https?:\/\/(?:127\.0\.0\.1|localhost):\d+)\/v1\/?$/);
	return m ? m[1] : SERVER;
};
const nameOf = (ctx: any): string => (ctx?.model?.provider === "inhouse" ? "사내AI" : "Copilot");
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
		const server = serverOf(ctx);
		const name = nameOf(ctx);
		let asking = false;
		timer = setInterval(async () => {
			if (asking) return;
			asking = true;
			try {
				const st: any = await (await fetch(`${server}/status?session=${encodeURIComponent(SESSION)}`, { signal: AbortSignal.timeout(800) })).json();
				if (timer && st.busy && st.phase) {
					ctx.ui.setStatus("copilot", fg(`${name}: ${st.phase} ${Math.floor(st.seconds)}초`));
					shown = true;
				} else if (shown) {
					ctx.ui.setStatus("copilot", undefined);
					shown = false;
				}
			} catch {
				// 중계 서버가 꺼져 있거나 /status 가 없는 예전 버전: 표시하지 않음
			} finally {
				asking = false;
			}
		}, 1000);
	};
	const sync = (ctx: any) => (running || compacting ? start(ctx) : stop(ctx));

	// 메모리 (4): 지금 모델의 중계 서버에 묻는다. 중계 서버가 꺼져 있거나 Windows 가 아니면(값 없음) 보이지 않음
	// memCtx 는 지금 세션의 ctx. 세션이 끝나면(/new, /kit share 의 다시 읽기 등) 바로 비운다: 끝난 세션의 ctx 를 쓰면 오류가 나고,
	// 타이머 안의 오류는 pi 를 멈추게 하므로 타이머에서는 어떤 오류도 밖으로 내보내지 않는다
	let memCtx: any = null;
	let memTimer: ReturnType<typeof setInterval> | null = null;
	let memFirst: ReturnType<typeof setTimeout> | null = null;
	let warned = false;
	const memStop = () => {
		if (memTimer) clearInterval(memTimer);
		if (memFirst) clearTimeout(memFirst);
		memTimer = memFirst = null;
		memCtx = null;
		warned = false;
	};
	const memTick = async () => {
		const ctx = memCtx;
		if (!ctx) return;
		const show = (text?: string, key = "memory") => {
			try {
				if (memCtx === ctx) ctx.ui.setStatus(key, text);
			} catch {}
		};
		try {
			const m: any = await (await fetch(`${serverOf(ctx)}/memory`, { signal: AbortSignal.timeout(3000) })).json();
			if (memCtx !== ctx) return; // 묻는 사이에 세션이 끝남
			const fg = (c: string, s: string) => (ctx.ui.theme?.fg ? ctx.ui.theme.fg(c, s) : s);
			// 오늘 보낸 질문 수 (중계 서버가 센 것: 나눠 보낸 조각·다시 부탁 포함). 하루 한도가 있으면(사내AI 200) n/한도,
			// 90% 를 넘으면 경고 색과 하루에 한 번 알림. 날짜는 이 PC 기준이라 서비스의 기준과 다를 수 있음
			if (typeof m.questions_today === "number") {
				const lim = Number(m.question_limit) || 0;
				const name = m.service || "Copilot";
				const near = lim > 0 && m.questions_today >= lim * 0.9;
				// 한도는 운영 쪽에서 알림 없이 바뀌어 중계 서버가 기록에서 어림한 값 (그래서 ~)
				show(fg(near ? "warning" : "muted", `${name} 오늘 ${m.questions_today}${lim ? `/~${lim}` : "번"}`), "usage");
				const key = `${new Date().toDateString()} ${name}`;
				const G = globalThis as any;
				if (near && G.__piUsageWarned !== key) {
					G.__piUsageWarned = key;
					ctx.ui.notify(
						`${name} 질문을 오늘 ${m.questions_today}번 썼습니다 (하루 약 ${lim}번까지, 지난번 한도에 닿은 때로 어림). ` +
							"파일 여러 개를 읽거나 쓰는 일은 한 번에 묶어 부탁하면 질문이 덜 듭니다.",
						"warning",
					);
				}
			} else show(undefined, "usage");
			if (typeof m.browser_mb !== "number") return show(undefined);
			const total = m.browser_mb + (m.relay_mb || 0) + Math.round(process.memoryUsage().rss / 1048576);
			const gb = (mb: number) => `${(mb / 1024).toFixed(1)}GB`;
			const over = m.warn_mb > 0 && total >= m.warn_mb;
			show(over ? fg("warning", `메모리 ${gb(total)} · /new 로 정리`) : fg("muted", `메모리 ${gb(total)}`));
			if (over && !warned)
				ctx.ui.notify(
					`pi 와 전용 창이 메모리를 ${gb(total)} 쓰고 있습니다 (전용 창 ${gb(m.browser_mb)}). ` +
						`하던 일이 끝나면 /new 로 새 세션을 여세요. 그때 ${m.service || "Copilot"} 탭을 새로 읽어 줄어듭니다.`,
					"warning",
				);
			warned = over;
		} catch {
			show(undefined);
			show(undefined, "usage");
		}
	};
	pi.on("session_start", async (_event: unknown, ctx: any) => {
		memStop();
		if (!ctx?.hasUI) return;
		memCtx = ctx;
		memTimer = setInterval(memTick, 30000);
		memFirst = setTimeout(memTick, 3000);
	});
	pi.on("model_select", async (_event: unknown, ctx: any) => {
		if (memCtx) memCtx = ctx; // 사내AI 모델로 바꾸면 그쪽 중계 서버에 물음
	});

	pi.on("agent_start", async (_event: unknown, ctx: any) => {
		running = true;
		sync(ctx);
	});
	pi.on("agent_end", async (_event: unknown, ctx: any) => {
		running = false;
		sync(ctx);
		if (memCtx) void memTick(); // 요청이 끝나면 오늘 질문 수를 바로 고침
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
		memStop();
		try {
			if (ctx?.hasUI) ctx.ui.setStatus("memory", undefined);
			if (ctx?.hasUI) ctx.ui.setStatus("usage", undefined);
		} catch {}
		if (event?.reason === "reload") return;
		// 두 중계 서버(Copilot, 사내AI)에 모두 알린다. 꺼져 있으면 다음에 새 대화를 열 때 정리된다
		await Promise.allSettled(
			[SERVER, INHOUSE_SERVER].map((s) =>
				fetch(s + "/v1/session/end", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ reason: event?.reason || "", session: SESSION }),
					signal: AbortSignal.timeout(1500),
				}),
			),
		);
	});
}
