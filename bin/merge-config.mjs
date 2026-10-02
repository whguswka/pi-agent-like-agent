// install.sh 가 부름: 설정 템플릿(profiles/<설정>/agent-template)에 새로 생긴 항목을 사용자 설정(~/.pi/agent)에 넣는다.
//  - 사용자가 고친 값은 그대로 둔다 (없는 항목만 추가)
//  - 사용자가 지운 항목은 다시 넣지 않는다: 지난번에 설치한 템플릿(.pi-agent-kit-template.json)과 비교해 새로 생긴 것만 추가
//  - 바꾸기 전 파일은 <이름>.bak 으로 남긴다
//  - 저장소의 기본 명령·스킬 폴더(<저장소>/prompts, <저장소>/skills)를 settings.json 의 prompts·skills 목록에 등록한다
//    (저장소 폴더를 그대로 쓰므로 업데이트하면 함께 바뀐다. 사용자가 목록에서 지우면 다시 넣지 않는다)
// 사용법: node merge-config.mjs <템플릿 폴더> <사용자 설정 폴더> [저장소 폴더]
import fs from "node:fs";
import path from "node:path";

const [tplDir, agentDir, kitHome] = process.argv.slice(2);
const FILES = ["settings.json", "models.json"];
const stateFile = path.join(agentDir, ".pi-agent-kit-template.json");

const readJson = (f) => {
	try {
		return { ok: true, value: JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")) };
	} catch (e) {
		return { ok: false, missing: e.code === "ENOENT", error: e.message };
	}
};
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** t(새 템플릿)에만 있는 키를 u(사용자)에 넣는다. p(지난 템플릿)에 있던 키가 u 에 없으면 사용자가 지운 것 -> 그대로 */
function mergeObj(u, t, p, changes, where) {
	for (const [k, tv] of Object.entries(t)) {
		const name = where ? `${where}.${k}` : k;
		if (!(k in u)) {
			if (isObj(p) && k in p) continue;
			u[k] = tv;
			changes.push(`${name} 추가`);
		} else if (isObj(u[k]) && isObj(tv)) {
			mergeObj(u[k], tv, isObj(p) ? p[k] : undefined, changes, name);
		}
	}
	return u;
}

/** models.json: provider 는 위와 같고, models 목록은 id 기준으로 새 모델만 끝에 추가 */
function mergeModels(u, t, p, changes) {
	u.providers = isObj(u.providers) ? u.providers : {};
	for (const [name, tp] of Object.entries(t.providers || {})) {
		const pp = isObj(p?.providers) ? p.providers[name] : undefined;
		const up = u.providers[name];
		if (!isObj(up)) {
			if (pp) continue;
			u.providers[name] = tp;
			changes.push(`provider ${name} 추가`);
			continue;
		}
		const { models: tModels = [], ...tRest } = tp;
		const { models: _pm, ...pRest } = isObj(pp) ? pp : {};
		mergeObj(up, tRest, isObj(pp) ? pRest : undefined, changes, name);
		up.models = Array.isArray(up.models) ? up.models : [];
		const have = new Set(up.models.map((m) => m?.id));
		const before = new Set((Array.isArray(pp?.models) ? pp.models : []).map((m) => m?.id));
		for (const m of tModels) {
			if (have.has(m.id) || before.has(m.id)) continue;
			up.models.push(m);
			changes.push(`모델 ${m.id} 추가`);
		}
	}
	return u;
}

const prevState = readJson(stateFile);
const prev = prevState.ok && isObj(prevState.value) ? prevState.value : {};
const state = {};
const norm = (x) => String(x).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** settings.json 에 저장소의 기본 명령·스킬 폴더 등록 (지난번에 넣었는데 지금 없으면 사용자가 지운 것 -> 그대로) */
function addKitPaths(u, changes) {
	if (!kitHome) return;
	state.kitPaths = {};
	for (const key of ["prompts", "skills"]) {
		const dir = `${kitHome.replace(/\\/g, "/").replace(/\/+$/, "")}/${key}`;
		if (!fs.existsSync(dir)) continue;
		state.kitPaths[key] = dir;
		const has = Array.isArray(u[key]);
		const list = has ? u[key] : [];
		if (list.some((x) => norm(x) === norm(dir))) continue;
		const old = prev.kitPaths?.[key];
		if (has && old && norm(old) === norm(dir)) continue; // 목록은 있는데 이 폴더만 없음 -> 사용자가 지움 (파일을 새로 만든 경우는 다시 넣음)
		u[key] = list.filter((x) => !old || norm(x) !== norm(old)).concat([dir]); // 다른 곳으로 옮겨 설치했으면 예전 위치는 뺌
		changes.push(`${key} 에 ${dir} 등록`);
	}
}
let failed = false;
for (const name of FILES) {
	const t = readJson(path.join(tplDir, name));
	if (!t.ok) continue;
	state[name] = t.value;
	const file = path.join(agentDir, name);
	const u = readJson(file);
	if (!u.ok) {
		if (!u.missing) {
			console.log(`확인 필요: ${file} 의 형식이 잘못되어 새 항목을 넣지 못했습니다 (${u.error})`);
			failed = true;
		}
		continue;
	}
	const changes = [];
	const merged =
		name === "models.json"
			? mergeModels(u.value, t.value, prev[name], changes)
			: mergeObj(u.value, t.value, prev[name], changes, "");
	if (name === "settings.json") addKitPaths(merged, changes);
	if (!changes.length) continue;
	fs.copyFileSync(file, `${file}.bak`);
	fs.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
	console.log(`갱신: ${file} (${changes.join(", ")}) - 이전 파일: ${name}.bak`);
}
fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
process.exit(failed ? 2 : 0);
