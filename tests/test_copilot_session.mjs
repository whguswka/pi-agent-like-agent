// Copilot 대화 정리·상태 표시(profiles/pc/agent-template/extensions/copilot-session.ts) 단위 테스트:
// 사용량 제한(429)으로 끝난 요청을 시간을 두고 다시 시도하기
// 사용법: node tests/test_copilot_session.mjs   (Node 20.15 이상. 저장소의 runtime/node_modules/jiti 로 .ts 를 불러옴)
// 실제 중계 서버(8765·8766)에 닿지 않게 쓰지 않는 포트로 돌린다
process.env.PI_COPILOT_URL = "http://127.0.0.1:9";
process.env.PI_INHOUSE_URL = "http://127.0.0.1:9";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const { createJiti } = await import("../runtime/node_modules/jiti/lib/jiti.mjs");
const jiti = createJiti(import.meta.url);
// 설치하면 pc 확장과 공통 확장의 lib/ 가 한 폴더(~/.pi/agent/extensions)에 놓이므로, 그 모양으로 복사해 불러온다
const repo = join(fileURLToPath(import.meta.url), "..", "..");
const extDir = mkdtempSync(join(tmpdir(), "copilot-session-test-"));
cpSync(join(repo, "profiles/pc/agent-template/extensions/copilot-session.ts"), join(extDir, "copilot-session.ts"));
cpSync(join(repo, "profiles/common/agent-template/extensions/lib"), join(extDir, "lib"), { recursive: true });
const c = await jiti.import(join(extDir, "copilot-session.ts"));
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(detail).slice(0, 800)));
	if (!cond) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 실사용 시험(2026-10-21)에서 pi 가 받은 오류 그대로
const THR = '429: {"message":"Copilot 사용량 제한에 걸렸습니다: 현재 요청이 너무 많아 일시적으로 응답할 수 없습니다. 나중에 다시 시도하세요. (Throttled). 몇 분~수십 분 뒤 다시 시도하세요 (같은 Copilot 대화에 이어서 보냅니다).","type":"copilot_relay_error"}';
const DAILY = '429: {"message":"Copilot 하루 질문 한도에 닿았습니다: x. 오늘 이 PC 에서 보낸 질문 200개 ...","type":"copilot_relay_error"}';
const end = (stopReason, errorMessage) => ({ messages: [{ role: "user", content: "요청" }, { role: "assistant", content: [], stopReason, errorMessage }] });
check("사용량 제한으로 끝난 요청을 알아봄 (하루 한도·보통 끝·다른 오류는 아님)",
	c.throttled(end("error", THR).messages) && !c.throttled(end("error", DAILY).messages) && !c.throttled(end("stop").messages)
	&& !c.throttled(end("error", "503: Copilot 탭을 찾지 못했습니다").messages) && !c.throttled([]));

for (let i = 0; i < c.RETRY_MINUTES.length; i++) c.RETRY_MINUTES[i] = 0.001; // 60ms
const on = {};
const sent = [];
c.default({ on: (e, f) => (on[e] ||= []).push(f), registerCommand: () => {}, sendUserMessage: (text) => sent.push(text) });
const status = {};
const notes = [];
let idle = true;
const ctx = {
	hasUI: true,
	isIdle: () => idle,
	model: { baseUrl: "http://127.0.0.1:9/v1", provider: "copilot" },
	ui: { setStatus: (k, v) => (status[k] = v), notify: (t, l) => notes.push([t, l]) },
};
const emit = async (e, ev = {}) => {
	for (const f of on[e] || []) await f(ev, ctx);
};

await emit("session_start", { reason: "startup" });
await emit("agent_start");
await emit("agent_end", end("error", THR));
check("제한으로 끝나면 다음 시도 시각을 상태 줄과 알림으로", /^Copilot 사용량 제한: \d\d:\d\d 에 다시 시도 \(1\/8번째/.test(status["copilot-wait"] || "")
	&& notes.some(([t]) => t.includes("자동으로 이어서 다시 시도")), [status, notes]);
await sleep(150);
check("시간이 되면 같은 대화로 '이어서' 를 보냄 (상태 줄은 지움)", sent.length === 1 && sent[0] === c.RETRY_TEXT && !status["copilot-wait"], [sent, status]);
await emit("agent_start"); // 다시 시도가 시작됨 (기다림을 취소하지 않음)
await emit("agent_end", end("error", THR));
check("또 제한이면 다음 차례(2번째)로 기다림", /\(2\/8번째/.test(status["copilot-wait"] || ""), status);
await sleep(150);
check("두 번째 다시 시도", sent.length === 2, sent.length);
await emit("agent_start");
await emit("agent_end", end("stop"));
check("풀려서 끝까지 답하면 기다림도 없음", !status["copilot-wait"], status);

await emit("agent_start");
await emit("agent_end", end("error", THR));
await emit("agent_start"); // 사용자가 그 사이에 다른 요청을 보냄
await sleep(150);
check("기다리는 동안 사용자가 요청을 보내면 다시 시도는 취소", sent.length === 2 && !status["copilot-wait"], [sent.length, status]);
await emit("agent_end", end("stop"));

idle = false;
await emit("agent_start");
await emit("agent_end", end("error", THR));
await sleep(150);
check("시간이 됐을 때 다른 일을 하는 중이면 보내지 않음", sent.length === 2, sent.length);
idle = true;

await emit("agent_start");
await emit("agent_end", end("error", DAILY));
await sleep(150);
check("하루 한도 문구면 다시 시도하지 않음", sent.length === 2 && !status["copilot-wait"], [sent.length, status]);

// 8번까지: 9번째 제한이면 멈추고 알림
let n0 = sent.length;
for (let i = 0; i < 8; i++) {
	await emit("agent_start");
	await emit("agent_end", end("error", THR));
	await sleep(120);
}
await emit("agent_start");
await emit("agent_end", end("error", THR));
await sleep(120);
check("모두 8번 다시 시도한 뒤에도 제한이면 멈추고 알림", sent.length - n0 === 8 && notes.some(([t]) => t.includes("다시 시도하기를 멈췄습니다")) && !status["copilot-wait"],
	[sent.length - n0, notes.slice(-2)]);

await emit("agent_start");
await emit("agent_end", end("error", THR));
await emit("session_shutdown", { reason: "new" });
await sleep(150);
check("세션이 끝나면(/new 등) 기다림을 지움", sent.length - n0 === 8, sent.length - n0);

try {
	rmSync(extDir, { recursive: true, force: true });
} catch {}
console.log(fails ? `실패 ${fails}` : "모두 통과");
process.exit(fails ? 1 : 0);
