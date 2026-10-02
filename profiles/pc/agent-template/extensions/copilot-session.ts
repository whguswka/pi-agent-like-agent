/**
 * Copilot 대화 정리 (브리지 pi 용)
 *
 * pi 세션이 끝나면(종료, /new 로 새 세션 등) PC 의 중계 서버(copilot/relay.py)에 알린다.
 * 중계 서버는 그 세션에서 쓴 Copilot 대화를 지운다 (bridge.json 의 delete_finished_chats).
 * 맥락은 pi 가 따로 저장하므로 Copilot 쪽 대화는 남길 필요가 없다.
 * 설정을 다시 읽는 reload 는 같은 대화를 이어 가므로 알리지 않는다.
 * 중계 서버가 꺼져 있거나 창을 닫아 알림이 못 가면, 중계 서버가 다음 새 대화를 열 때 정리한다.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SERVER = (process.env.PI_COPILOT_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");

export default function (pi: ExtensionAPI) {
	pi.on("session_shutdown", async (event: { reason?: string }) => {
		if (event?.reason === "reload") return;
		try {
			await fetch(SERVER + "/v1/session/end", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ reason: event?.reason || "" }),
				signal: AbortSignal.timeout(1500),
			});
		} catch {
			// 중계 서버가 꺼져 있음: 다음에 새 대화를 열 때 정리된다
		}
	});
}
