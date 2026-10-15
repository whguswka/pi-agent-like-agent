// API 판 CHANGELOG 초안: 원래 키트 CHANGELOG 에서 API 판의 바탕 판 뒤에 나온 '[공통]' 항목을 모아 보여 줌 (파일은 고치지 않음)
//   node api-kit/changelog-draft.mjs [바탕 판]     바탕 판을 주지 않으면 overlay/CHANGELOG.md 맨 위 항목의 'pi-agent-like-agent <판>'
//  원래 키트 CHANGELOG 의 판 항목은 '- [공통] ...'(API 판에도 들어감), '- [Copilot] ...'(원래 키트만) 으로 시작함.
//  표시가 없는 항목(예전 판, 할 일 줄)은 따로 보여 주니 직접 보고 고름. 초안은 API 판 글로 다듬어 overlay/CHANGELOG.md 맨 위에 넣음
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VER = /\d{4}-\d\d-\d\d\.\d+/;

/** 원래 키트 CHANGELOG -> [{ ver, items: [{ label, lines }] }] (새 판부터) */
export function sections(text) {
	const out = [];
	let cur = null;
	let item = null;
	for (const line of text.split(/\r?\n/)) {
		const h = line.match(/^## (\S+)/);
		if (h) {
			cur = VER.test(h[1]) ? { ver: h[1], items: [] } : null;
			if (cur) out.push(cur);
			item = null;
			continue;
		}
		if (!cur) continue;
		const m = line.match(/^- (?:\[(공통|Copilot)\] )?(.*)$/);
		if (m) {
			item = { label: m[1] || "", lines: [`- ${m[2]}`] };
			cur.items.push(item);
		} else if (item && /^\s+\S/.test(line)) item.lines.push(line);
		else if (line.trim()) item = null; // 항목 밖의 글 (머리 문단 등)
	}
	return out;
}

/** 바탕 판(base) 뒤의 판들에서 모은 초안 */
export function draft(mainText, base) {
	const all = sections(mainText);
	const k = all.findIndex((s) => s.ver === base);
	if (k < 0) throw new Error(`원래 키트 CHANGELOG 에 바탕 판 '${base}' 항목이 없습니다`);
	const newer = all.slice(0, k);
	const pick = (label) => newer.flatMap((s) => s.items.filter((i) => i.label === label).map((i) => ({ ver: s.ver, lines: i.lines })));
	return { newest: newer[0]?.ver || base, versions: newer.map((s) => s.ver), common: pick("공통"), unlabeled: pick(""), copilot: pick("Copilot").length };
}

const WORDS = /copilot|사내\s?AI|중계|전용 창|Git Bash|jupyter 모드|PC/i;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const KIT = dirname(fileURLToPath(import.meta.url));
	const main = readFileSync(join(KIT, "..", "CHANGELOG.md"), "utf8");
	let base = process.argv[2];
	if (!base) {
		const api = readFileSync(join(KIT, "overlay", "CHANGELOG.md"), "utf8");
		const top = api.split(/^## /m)[1] || "";
		base = (top.match(new RegExp(`pi-agent-like-agent (${VER.source})`)) || [])[1];
		if (!base) {
			console.error("overlay/CHANGELOG.md 맨 위 항목에서 바탕 판(pi-agent-like-agent <판>)을 찾지 못했습니다. 바탕 판을 인자로 주세요");
			process.exit(2);
		}
	}
	const d = draft(main, base);
	if (!d.versions.length) {
		console.log(`[api-kit] 바탕 판 ${base} 뒤로 원래 키트에 새 판이 없습니다`);
		process.exit(0);
	}
	console.log(`# API 판 CHANGELOG 초안 (원래 키트 ${d.versions.slice().reverse().join(", ")} 의 [공통] ${d.common.length}개. [Copilot] ${d.copilot}개는 뺌)\n`);
	console.log("## <새 판 번호>");
	console.log(`바탕: pi-agent-like-agent ${d.newest}.`);
	for (const i of d.common) console.log(i.lines.join("\n"));
	if (d.unlabeled.length) {
		console.log(`\n# 표시가 없는 항목 ${d.unlabeled.length}개 (직접 보고 고르기)`);
		for (const i of d.unlabeled) console.log(`#  (${i.ver}) ${i.lines[0].slice(2, 120)}`);
	}
	const warn = d.common.flatMap((i) => i.lines).filter((l) => WORDS.test(l));
	if (warn.length) console.log(`\n# API 판 글로 다듬을 줄 (Copilot·PC 말) ${warn.length}개:\n` + warn.map((l) => `#  ${l.trim().slice(0, 120)}`).join("\n"));
}
