// jupyter 모드 (profiles/pc/agent-template/extensions/jupyter.ts) 단위 테스트: 실행 중인 명령의 상태 묻기가 잠깐 실패해도 다시 묻기
// 사용법: node tests/test_jupyter_poll.mjs   (저장소의 runtime/node_modules/jiti 로 .ts 를, pi 는 tests/stubs 의 것으로)
// 2026-10-23 ML 시험: 파이프라인을 기다리던 명령이 '페이지 스크립트 오류: TypeError: Failed to fetch' 한 번으로 끝나, 같은 파이프라인이 두 번 제출됨
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(detail)));
	if (!cond) fails++;
};

// 가짜 중계 서버: 처음 bad 번은 오류, 그 뒤로는 끝난 상태
let bad = 0;
let asked = 0;
const server = createServer((req, res) => {
	asked++;
	const ok = bad <= 0;
	if (!ok) bad--;
	res.writeHead(ok ? 200 : 500, { "Content-Type": "application/json" });
	res.end(JSON.stringify(ok ? { ok: true, done: true, exitCode: 0, data: Buffer.from("SUCCEEDED\n").toString("base64") } : { ok: false, error: "페이지 스크립트 오류: TypeError: Failed to fetch" }));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
process.env.PI_COPILOT_URL = `http://127.0.0.1:${server.address().port}`;
const jiti = createJiti(import.meta.url, {
	alias: { "@earendil-works/pi-coding-agent": join(ROOT, "tests/stubs/pi-coding-agent.mjs"), "@earendil-works/pi-tui": join(ROOT, "tests/stubs/pi-tui.mjs") },
});
// 설치된 모습처럼 공통 lib/ 옆에 둠 (jupyter.ts 는 ./lib/paths.ts 를 씀)
const EXT = mkdtempSync(join(tmpdir(), "jpoll-"));
cpSync(join(ROOT, "profiles/common/agent-template/extensions/lib"), join(EXT, "lib"), { recursive: true });
cpSync(join(ROOT, "profiles/pc/agent-template/extensions/jupyter.ts"), join(EXT, "jupyter.ts"));
const j = await jiti.import(join(EXT, "jupyter.ts"));

bad = 2;
asked = 0;
const st = await j.pollExec("r1", 0, undefined, 5, 20);
check("잠깐 실패하면 다시 물어 끝난 상태를 받음 (명령을 실패로 끝내지 않음)", st.done === true && asked === 3 && Buffer.from(st.data, "base64").toString() === "SUCCEEDED\n", [st, asked]);

bad = 1000;
let err = null;
const t0 = Date.now();
try {
	await j.pollExec("r2", 0, undefined, 0.3, 50);
} catch (e) {
	err = e;
}
check("계속 실패하면 정한 시간 뒤에 실패 (원래 오류와 '노트북에서 계속 돌고 있을 수 있음')",
	err && err.message.includes("Failed to fetch") && err.message.includes("계속 돌고 있을 수") && Date.now() - t0 >= 300 && Date.now() - t0 < 5000, [err?.message, Date.now() - t0]);

bad = 1000;
const ac = new AbortController();
setTimeout(() => ac.abort(), 100);
err = null;
try {
	await j.pollExec("r3", 0, ac.signal, 30, 50);
} catch (e) {
	err = e;
}
check("다시 묻는 동안 Esc 로 멈추면 바로 aborted", err?.message === "aborted", err?.message);
check(`다시 묻는 시간: ${j.POLL_RETRY_SEC}초`, j.POLL_RETRY_SEC === 90);

server.close();
rmSync(EXT, { recursive: true, force: true });
console.log(fails ? `RESULT: FAIL (${fails})` : "RESULT: PASS");
process.exit(fails ? 1 : 0);
