// install.sh 가 부름: 설정 템플릿(profiles/<설정>/agent-template)에 새로 생긴 항목을 사용자 설정(~/.pi/agent)에 넣는다.
//  - 사용자가 고친 값은 그대로 둔다 (없는 항목만 추가)
//  - 사용자가 지운 항목은 다시 넣지 않는다: 지난번에 설치한 템플릿(.pi-agent-kit-template.json)과 비교해 새로 생긴 것만 추가
//  - 바꾸기 전 파일은 <이름>.bak 으로 남긴다
//  - 기본 명령·스킬(<저장소>/prompts/*.md, <저장소>/skills/<이름>/)을 사용자 설정 폴더의 prompts·skills 에 복사한다
//    처음이면 복사, 고치지 않았으면 새 판으로 바꿈, 고쳤으면 그대로 둠(알림), 지웠으면 다시 넣지 않음
//    (고쳤는지는 지난번에 설치한 내용의 해시와 비교. 상태 파일의 kitFiles)
// 사용법: node merge-config.mjs <템플릿 폴더> <사용자 설정 폴더> [저장소 폴더]
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [tplDir, agentDir, kitHome] = process.argv.slice(2);
const FILES = ["settings.json", "models.json"];
const stateFile = path.join(agentDir, ".pi-agent-kit-template.json");

/** 주석(//, /* *\/)과 끝의 쉼표 빼기 (pi 가 models.json 을 이렇게 읽으므로 같은 파일을 받아들여야 함). 문자열 안은 그대로 */
function stripJsonc(s) {
	let out = "";
	let inStr = false;
	let esc = false;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (inStr) {
			out += c;
			if (esc) esc = false;
			else if (c === "\\") esc = true;
			else if (c === '"') inStr = false;
		} else if (c === '"') {
			inStr = true;
			out += c;
		} else if (c === "/" && s[i + 1] === "/") {
			while (i < s.length && s[i] !== "\n") i++;
			out += "\n";
		} else if (c === "/" && s[i + 1] === "*") {
			i += 2;
			while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
			i++;
		} else if (c === ",") {
			let j = i + 1;
			while (j < s.length && /\s/.test(s[j])) j++;
			if (s[j] !== "}" && s[j] !== "]") out += c;
		} else out += c;
	}
	return out;
}
const readJson = (f, lenient = false) => {
	try {
		const text = fs.readFileSync(f, "utf8").replace(/^﻿/, "");
		return { ok: true, value: JSON.parse(lenient ? stripJsonc(text) : text) };
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

/** 예전 판(설정에 저장소 폴더를 등록하던 방식)에서 넣은 prompts·skills 경로를 뺀다 (지금은 복사하므로 이름이 겹치지 않게) */
function dropOldKitPaths(u, changes) {
	for (const [key, dir] of Object.entries(prev.kitPaths || {})) {
		if (!Array.isArray(u[key])) continue;
		const rest = u[key].filter((x) => norm(x) !== norm(dir));
		if (rest.length === u[key].length) continue;
		if (rest.length) u[key] = rest;
		else delete u[key];
		changes.push(`${key} 에서 ${dir} 뺌 (기본 ${key === "skills" ? "스킬" : "명령"}은 이제 복사해서 씀)`);
	}
}

/** 파일 또는 폴더 내용의 해시 (폴더는 안의 파일 이름과 내용 전부) */
function hashOf(p) {
	const h = crypto.createHash("sha256");
	const walk = (q, rel) => {
		if (fs.statSync(q).isDirectory()) {
			for (const n of fs.readdirSync(q).sort()) walk(path.join(q, n), rel ? `${rel}/${n}` : n);
		} else {
			h.update(`${rel}\0`);
			h.update(fs.readFileSync(q));
			h.update("\0");
		}
	};
	walk(p, "");
	return h.digest("hex");
}

/** 기본 명령·스킬을 사용자 설정 폴더에 복사 (고친 것·지운 것은 그대로) */
function syncKitFiles() {
	if (!kitHome) return;
	const prevFiles = isObj(prev.kitFiles) ? prev.kitFiles : {};
	state.kitFiles = {};
	const items = [];
	const pdir = path.join(kitHome, "prompts");
	if (fs.existsSync(pdir)) for (const n of fs.readdirSync(pdir).sort()) if (n.endsWith(".md")) items.push([`prompts/${n}`, path.join(pdir, n), "명령", `/${n.slice(0, -3)}`]);
	const sdir = path.join(kitHome, "skills");
	if (fs.existsSync(sdir))
		for (const n of fs.readdirSync(sdir).sort()) if (fs.existsSync(path.join(sdir, n, "SKILL.md"))) items.push([`skills/${n}`, path.join(sdir, n), "스킬", n]);
	const added = [];
	const updated = [];
	const kept = [];
	for (const [rel, src, kind, label] of items) {
		const dst = path.join(agentDir, rel);
		const want = hashOf(src);
		const old = prevFiles[rel];
		if (!fs.existsSync(dst)) {
			if (old) {
				state.kitFiles[rel] = old; // 사용자가 지움 -> 다시 넣지 않음
				continue;
			}
			fs.mkdirSync(path.dirname(dst), { recursive: true });
			fs.cpSync(src, dst, { recursive: true });
			state.kitFiles[rel] = want;
			added.push(label);
			continue;
		}
		const cur = hashOf(dst);
		if (cur === want) {
			state.kitFiles[rel] = want;
		} else if (old && cur === old) {
			fs.rmSync(dst, { recursive: true, force: true });
			fs.cpSync(src, dst, { recursive: true });
			state.kitFiles[rel] = want;
			updated.push(label);
		} else {
			if (old) state.kitFiles[rel] = old; // 사용자가 고친 기본 명령·스킬 (원래 사용자 것이면 기록하지 않음)
			kept.push(`${kind} ${label}`);
		}
	}
	if (added.length) console.log(`기본 명령·스킬 추가: ${added.join(", ")}`);
	if (updated.length) console.log(`기본 명령·스킬 새 판으로: ${updated.join(", ")}`);
	if (kept.length) console.log(`직접 고친 것은 그대로 둠: ${kept.join(", ")} (새 판은 ${kitHome} 의 prompts·skills 에 있음)`);
}
let failed = false;
for (const name of FILES) {
	const t = readJson(path.join(tplDir, name));
	if (!t.ok) continue;
	const file = path.join(agentDir, name);
	const u = readJson(file, name === "models.json");
	if (!u.ok) {
		if (!u.missing) {
			console.log(`확인 필요: ${file} 의 형식이 잘못되어 새 항목을 넣지 못했습니다 (${u.error}). 고친 뒤 install.sh 를 다시 실행하세요`);
			failed = true;
			// 지난 템플릿 기록은 그대로: 고친 뒤 다시 실행하면 이번 새 항목도 넣도록 (새 템플릿으로 바꾸면 '지운 것'으로 보게 됨)
			if (prev[name] !== undefined) state[name] = prev[name];
			else delete state[name];
		} else state[name] = t.value;
		continue;
	}
	state[name] = t.value;
	const changes = [];
	const merged =
		name === "models.json"
			? mergeModels(u.value, t.value, prev[name], changes)
			: mergeObj(u.value, t.value, prev[name], changes, "");
	if (name === "settings.json") dropOldKitPaths(merged, changes);
	if (!changes.length) continue;
	fs.copyFileSync(file, `${file}.bak`);
	fs.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
	console.log(`갱신: ${file} (${changes.join(", ")}) - 이전 파일: ${name}.bak`);
}
syncKitFiles();
fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
process.exit(failed ? 2 : 0);
