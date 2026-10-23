// jupyter 모드 (profiles/pc/agent-template/extensions/jupyter.ts) 단위 테스트: 실행 중인 명령의 상태 묻기가 잠깐 실패해도 다시 묻기,
//  노트북 프로젝트의 지침 파일 찾기 (AGENTS.md 가 없으면 CLAUDE.md, pi 가 PC 폴더에서 찾는 차례)
// 사용법: node tests/test_jupyter.mjs   (저장소의 runtime/node_modules/jiti 로 .ts 를, pi 는 tests/stubs 의 것으로)
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

// 가짜 중계 서버
//  /jupyter/exec/<id>: 처음 bad 번은 오류, 그 뒤로는 끝난 상태
//  /jupyter/fs (read): files 에 있으면 내용, 없으면 ENOENT. fsDown 이면 연결 오류처럼 (코드 없음)
let bad = 0;
let asked = 0;
const files = new Map();
const reads = [];
let fsDown = false;
const send = (res, status, body) => {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
};
const server = createServer((req, res) => {
	if (req.url === "/jupyter/fs") {
		let raw = "";
		req.on("data", (c) => (raw += c));
		req.on("end", () => {
			const { path } = JSON.parse(raw);
			reads.push(path);
			if (fsDown) return send(res, 500, { ok: false, error: "페이지 스크립트 오류: TypeError: Failed to fetch" });
			if (!files.has(path)) return send(res, 400, { ok: false, error: `ENOENT: no such file or directory, open '${path}'`, code: "ENOENT" });
			send(res, 200, { ok: true, data: Buffer.from(files.get(path)).toString("base64") });
		});
		return;
	}
	asked++;
	const ok = bad <= 0;
	if (!ok) bad--;
	send(res, ok ? 200 : 500, ok ? { ok: true, done: true, exitCode: 0, data: Buffer.from("SUCCEEDED\n").toString("base64") } : { ok: false, error: "페이지 스크립트 오류: TypeError: Failed to fetch" });
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

// 지침 파일: pi 가 PC 폴더에서 찾는 차례 (AGENTS.override.md, AGENTS.md, AGENTS.MD, CLAUDE.md, CLAUDE.MD 중 처음 있는 것 하나)
files.set("/nb/a/CLAUDE.md", "﻿# 프로젝트 규칙\n- 운영 소스는 읽기만\n");
files.set("/nb/b/AGENTS.md", "# pi 지침\n");
files.set("/nb/b/CLAUDE.md", "# 클로드 지침\n");
reads.length = 0;
let c = await j.remoteContext("/nb/a");
check("AGENTS.md 가 없고 CLAUDE.md 만 있으면 CLAUDE.md (앞의 BOM 은 뺌)",
	c?.path === "/nb/a/CLAUDE.md" && c.content === "# 프로젝트 규칙\n- 운영 소스는 읽기만\n" && JSON.stringify(reads) === JSON.stringify(["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md"].map((n) => `/nb/a/${n}`)), [c, reads]);
c = await j.remoteContext("/nb/b");
check("둘 다 있으면 AGENTS.md 하나만 (pi 와 같은 차례)", c?.path === "/nb/b/AGENTS.md" && c.content === "# pi 지침\n", c);
check("지침 파일이 없으면 null", (await j.remoteContext("/nb/empty")) === null);
fsDown = true;
reads.length = 0;
check("노트북에 닿지 않으면 첫 오류에서 멈추고 null (다음 이름을 더 묻지 않음)", (await j.remoteContext("/nb/a")) === null && reads.length === 1, reads);
fsDown = false;

server.close();
rmSync(EXT, { recursive: true, force: true });
console.log(fails ? `RESULT: FAIL (${fails})` : "RESULT: PASS");
process.exit(fails ? 1 : 0);
