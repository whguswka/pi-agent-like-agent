// bin/merge-config.mjs 시험: 새 템플릿 항목 넣기 + 저장소의 기본 명령·스킬 폴더 등록
// 사용법: node tests/test_merge_config.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "..", "bin", "merge-config.mjs");
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(detail)));
	if (!cond) fails++;
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merge-test-"));
const tpl = path.join(tmp, "tpl");
const agent = path.join(tmp, "agent");
const kit1 = path.join(tmp, "kit1");
const kit2 = path.join(tmp, "kit2");
for (const d of [tpl, agent, path.join(kit1, "prompts"), path.join(kit1, "skills"), path.join(kit2, "prompts"), path.join(kit2, "skills")])
	fs.mkdirSync(d, { recursive: true });
const write = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2));
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
write(path.join(tpl, "settings.json"), { defaultModel: "m1", retry: { provider: { timeoutMs: 1 } } });
write(path.join(agent, "settings.json"), { defaultModel: "내가 고른 모델", skills: ["D:/team/skills"] });
const run = (kit) => execFileSync(process.execPath, [script, tpl, agent, ...(kit ? [kit] : [])], { encoding: "utf8" });
const slash = (p) => p.replace(/\\/g, "/");

let out = run(kit1);
let s = read(path.join(agent, "settings.json"));
check("새 항목 추가, 고친 값 유지", s.retry && s.defaultModel === "내가 고른 모델", s);
check("기본 명령·스킬 폴더 등록 (사용자가 넣은 경로는 그대로)", JSON.stringify(s.prompts) === JSON.stringify([`${slash(kit1)}/prompts`])
	&& JSON.stringify(s.skills) === JSON.stringify(["D:/team/skills", `${slash(kit1)}/skills`]), s);
out = run(kit1);
check("다시 설치해도 바뀌지 않음", !out.includes("갱신"), out);
s.prompts = [];
write(path.join(agent, "settings.json"), s);
out = run(kit1);
check("사용자가 지운 등록은 다시 넣지 않음", read(path.join(agent, "settings.json")).prompts.length === 0, read(path.join(agent, "settings.json")));
out = run(kit2);
s = read(path.join(agent, "settings.json"));
check("다른 곳으로 옮겨 설치: 예전 경로는 빼고 새 경로", JSON.stringify(s.skills) === JSON.stringify(["D:/team/skills", `${slash(kit2)}/skills`])
	&& JSON.stringify(s.prompts) === JSON.stringify([`${slash(kit2)}/prompts`]), s);
fs.rmSync(path.join(kit2, "skills"), { recursive: true });
fs.rmSync(path.join(agent, "settings.json"));
write(path.join(agent, "settings.json"), {});
run(kit2);
s = read(path.join(agent, "settings.json"));
check("저장소에 없는 폴더는 등록하지 않음", !s.skills && s.prompts?.length === 1, s);
out = run(undefined);
check("저장소 폴더를 주지 않으면 예전처럼 템플릿 항목만", !out.includes("등록"), out);
fs.rmSync(tmp, { recursive: true, force: true });
console.log("RESULT:", fails ? `FAIL (${fails})` : "PASS");
process.exit(fails ? 1 : 0);
