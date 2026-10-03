// bin/merge-config.mjs 시험: 새 템플릿 항목 넣기 + 기본 명령·스킬 복사 (고친 것·지운 것은 그대로)
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
const kit = path.join(tmp, "kit");
const put = (f, text) => {
	fs.mkdirSync(path.dirname(f), { recursive: true });
	fs.writeFileSync(f, text);
};
const writeJson = (f, o) => put(f, JSON.stringify(o, null, 2));
const read = (f) => fs.readFileSync(f, "utf8");
const readJson = (f) => JSON.parse(read(f));
writeJson(path.join(tpl, "settings.json"), { defaultModel: "m1", retry: { provider: { timeoutMs: 1 } } });
writeJson(path.join(agent, "settings.json"), { defaultModel: "내가 고른 모델", skills: ["D:/team/skills"] });
put(path.join(kit, "prompts", "review.md"), "review v1");
put(path.join(kit, "prompts", "test.md"), "test v1");
put(path.join(kit, "skills", "debugging", "SKILL.md"), "debugging v1");
put(path.join(kit, "skills", "korean-report", "SKILL.md"), "report v1");
put(path.join(kit, "skills", "korean-report", "weekly.md"), "weekly v1");
put(path.join(kit, "skills", "not-a-skill", "notes.txt"), "x");
const run = (k = kit) => execFileSync(process.execPath, [script, tpl, agent, ...(k ? [k] : [])], { encoding: "utf8" });
const A = (rel) => path.join(agent, rel);

let out = run();
check("새 항목 추가, 고친 값 유지", readJson(A("settings.json")).retry && readJson(A("settings.json")).defaultModel === "내가 고른 모델");
check("기본 명령·스킬 복사 (스킬은 폴더째)", read(A("prompts/review.md")) === "review v1" && read(A("skills/korean-report/weekly.md")) === "weekly v1"
	&& !fs.existsSync(A("skills/not-a-skill")), out);
check("settings.json 의 skills 목록은 건드리지 않음", JSON.stringify(readJson(A("settings.json")).skills) === JSON.stringify(["D:/team/skills"]));
out = run();
check("다시 설치해도 바뀌지 않음", !/추가|새 판|그대로/.test(out), out);

// 새 판: review·test·debugging·weekly 가 바뀜. 사용자는 review 를 고쳤고 debugging 은 지웠음
put(A("prompts/review.md"), "내가 고친 review");
fs.rmSync(A("skills/debugging"), { recursive: true });
put(path.join(kit, "prompts", "review.md"), "review v2");
put(path.join(kit, "prompts", "test.md"), "test v2");
put(path.join(kit, "skills", "debugging", "SKILL.md"), "debugging v2");
put(path.join(kit, "skills", "korean-report", "weekly.md"), "weekly v2");
put(path.join(kit, "skills", "new-skill", "SKILL.md"), "new v1");
out = run();
check("고치지 않은 것은 새 판으로 (명령, 스킬 폴더 안 파일)", read(A("prompts/test.md")) === "test v2" && read(A("skills/korean-report/weekly.md")) === "weekly v2", out);
check("고친 것은 그대로 두고 알림", read(A("prompts/review.md")) === "내가 고친 review" && out.includes("직접 고친 것은 그대로 둠") && out.includes("/review"), out);
check("지운 것은 다시 넣지 않음", !fs.existsSync(A("skills/debugging")), out);
check("새 판에 생긴 스킬은 추가", read(A("skills/new-skill/SKILL.md")) === "new v1" && out.includes("new-skill"), out);
out = run();
check("고친 것은 다음에도 그대로 (알림만)", read(A("prompts/review.md")) === "내가 고친 review" && !/추가|새 판으로/.test(out), out);

// 원래 사용자가 만든 같은 이름의 명령은 덮어쓰지 않음
const agent2 = path.join(tmp, "agent2");
writeJson(path.join(agent2, "settings.json"), {});
put(path.join(agent2, "prompts", "test.md"), "내 test 명령");
execFileSync(process.execPath, [script, tpl, agent2, kit], { encoding: "utf8" });
check("원래 있던 같은 이름의 내 명령은 덮어쓰지 않음", read(path.join(agent2, "prompts", "test.md")) === "내 test 명령");

// 예전 판(설정에 저장소 폴더를 등록하던 방식)에서 넣은 경로는 뺌
const state = readJson(A(".pi-agent-kit-template.json"));
state.kitPaths = { prompts: "C:/old/kit/prompts", skills: "C:/old/kit/skills" };
put(A(".pi-agent-kit-template.json"), JSON.stringify(state));
const st = readJson(A("settings.json"));
st.prompts = ["C:/old/kit/prompts"];
st.skills = ["D:/team/skills", "C:/old/kit/skills"];
writeJson(A("settings.json"), st);
out = run();
const s2 = readJson(A("settings.json"));
check("예전 판의 등록 경로는 빼고, 사용자가 넣은 경로는 남김", !("prompts" in s2) && JSON.stringify(s2.skills) === JSON.stringify(["D:/team/skills"]), s2);
out = run(null);
check("저장소 폴더를 주지 않으면 복사하지 않음", !/추가|새 판/.test(out), out);

// models.json: pi 처럼 주석과 끝의 쉼표를 받아들이고 새 모델을 넣음
writeJson(path.join(tpl, "models.json"), { providers: { copilot: { baseUrl: "u", models: [{ id: "m1" }] } } });
put(A("models.json"), '{\n  // 내 메모\n  "providers": { "copilot": { "baseUrl": "u", "models": [ { "id": "m1", "name": "a,b // 문자열" }, ] } },\n}\n');
out = run(null);
writeJson(path.join(tpl, "models.json"), { providers: { copilot: { baseUrl: "u", models: [{ id: "m1" }, { id: "m2" }] } } });
out = run(null);
let mj = readJson(A("models.json"));
check("models.json 의 주석·끝 쉼표: 읽고 새 모델 추가 (문자열 안은 그대로)", mj.providers.copilot.models.map((m) => m.id).join() === "m1,m2"
	&& mj.providers.copilot.models[0].name === "a,b // 문자열" && fs.existsSync(A("models.json.bak")), out);
// 형식이 틀린 settings.json: 이번 새 항목은 고친 뒤 다시 실행할 때 넣음 ('지운 것'으로 보지 않음)
writeJson(path.join(tpl, "settings.json"), { defaultModel: "m1", retry: { provider: { timeoutMs: 1 } }, newKey: 1 });
put(A("settings.json"), '{ "defaultModel": "x", }');
let failedRc = 0;
try {
	run(null);
} catch (e) {
	failedRc = e.status;
	out = String(e.stdout);
}
check("형식이 틀리면 알리고 종료 코드 2", failedRc === 2 && out.includes("확인 필요"), out);
writeJson(A("settings.json"), { defaultModel: "x" });
out = run(null);
check("고친 뒤 다시 실행하면 그때 새 항목 추가", readJson(A("settings.json")).newKey === 1, out);
fs.rmSync(tmp, { recursive: true, force: true });
console.log("RESULT:", fails ? `FAIL (${fails})` : "PASS");
process.exit(fails ? 1 : 0);
