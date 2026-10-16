// 원래 키트의 문서 한 벌에서 API 키트 문서 만들기
//   node assemble.mjs <폴더> <조각 폴더>                              표시를 처리해 API 키트 글로 바꿔 씀
//   node assemble.mjs --marks <폴더> <조각 폴더> <marks.sha256>       짝을 이룬 글이 적어 둔 것과 같은지만 봄 (같으면 0, 다르면 1)
//   node assemble.mjs --write-marks <폴더> <조각 폴더> <marks.sha256> <커밋>   짝을 이룬 글의 sha256 을 적음
//  원래 키트 문서의 표시(HTML 주석이라 GitHub 화면에는 안 보임):
//   <!-- api:빼기 -->          (한 줄)  ...  <!-- /api -->   사이를 API 키트에서 뺌 (Copilot·PC 전용 글)
//   <!-- api:바꾸기 이름 -->   (한 줄)  ...  <!-- /api -->   사이를 API 키트에서는 조각 '이름' 으로 바꿈
//   <!-- api:넣기 이름 -->     (한 줄)                         API 키트에서만 그 자리에 조각 '이름' 을 넣음
//   어떤 줄 <!-- api= 대신 쓸 글 -->   (줄 끝)                    API 키트에서는 그 줄을 '대신 쓸 글' 로 (비우면 그 줄을 뺌.
//                                                              표의 칸 나눔은 \| 로 적음, 여러 줄은 \n)
//  한 줄 표시 앞에는 빈칸을 3개까지 둘 수 있음. 목록 가운데의 표시 줄은 빈칸 두 개를 두면 원래 키트 화면에서 목록이 끊기지 않음
//  조각: <조각 폴더>/<문서 경로> 한 파일에 '<!-- 조각: 이름 -->' 줄로 나눠 적음 (끝의 빈 줄은 뺌)
//  원래 키트 문서가 GitHub 에서 그대로 보이도록 점검 (어기면 멈춤):
//   짝이 맞지 않는 표시, 코드 블록 안의 표시, 표 가운데의 한 줄 표시(표가 둘로 나뉨), 제목 줄의 api=,
//   없는 조각, 쓰지 않은 조각
//  짝을 이룬 글: 'api:바꾸기' 블록 안과 'api=' 줄(비우지 않은 것)의 원래 키트 쪽 글. 이 글이 바뀌면 API 키트 글(조각, api= 뒤)도
//   고쳐야 하는지 사람이 봐야 하므로 marks.sha256 에 적어 두고 make-api-kit.sh 가 비교함 (API 키트 글만 고친 것은 걸리지 않음)
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const TABLE = /^\s*\|/;
export function parseFragments(text) {
	const out = new Map();
	let name = null;
	let buf = [];
	const flush = () => {
		if (name === null) return;
		while (buf.length && buf[buf.length - 1].trim() === "") buf.pop();
		out.set(name, buf);
	};
	for (const line of text.split("\n")) {
		const m = line.match(/^<!-- 조각: (.+?) -->\s*$/);
		if (m) {
			flush();
			if (out.has(m[1])) throw new Error(`같은 이름의 조각이 둘: ${m[1]}`);
			name = m[1];
			buf = [];
		} else if (name !== null) buf.push(line);
	}
	flush();
	return out;
}

/** 표시가 든 문서 -> API 키트 문서. 오류는 모아서 던짐. marks 배열을 주면 짝을 이룬 글을 담음 */
export function assemble(text, fragments = new Map(), where = "", marks = null) {
	const lines = text.split("\n");
	const out = [];
	const errors = [];
	const used = new Set();
	const err = (i, msg) => errors.push(`${where}:${i + 1}: ${msg}`);
	const frag = (i, name) => {
		if (!fragments.has(name)) return err(i, `없는 조각: ${name}`), [];
		used.add(name);
		return fragments.get(name);
	};
	let fence = null; // 지금 열린 코드 블록의 울타리 (``` 또는 ````)
	let block = null; // { kind, name, at, body }
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const f = line.match(/^\s*(`{3,}|~{3,})/);
		if (f) {
			if (!fence) fence = f[1];
			else if (f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null;
			if (block) block.body.push(line);
			else out.push(line);
			continue;
		}
		const has = line.includes("<!-- api") || line.includes("<!-- /api");
		if (fence) {
			if (has) err(i, "코드 블록 안의 표시 (원래 키트 화면에 글자로 보임)");
			if (block) block.body.push(line);
			else out.push(line);
			continue;
		}
		const mid = () => i > 0 && i + 1 < lines.length && TABLE.test(lines[i - 1]) && TABLE.test(lines[i + 1]);
		let m;
		if ((m = line.match(/^ {0,3}<!-- api:(빼기|바꾸기 (.+?)) -->\s*$/))) {
			if (block) err(i, `표시 안에 또 표시 (${block.at + 1}째 줄에서 연 것을 닫지 않음)`);
			if (mid()) err(i, "표 가운데의 표시 (원래 키트 화면에서 표가 둘로 나뉨)");
			block = { kind: m[2] ? "바꾸기" : "빼기", name: m[2], at: i, body: [] };
			continue;
		}
		if (/^ {0,3}<!-- \/api -->\s*$/.test(line)) {
			if (!block) err(i, "여는 표시 없이 닫음");
			else if (block.kind === "바꾸기") {
				out.push(...frag(i, block.name));
				if (marks) marks.push({ where, line: block.at + 1, kind: `바꾸기 ${block.name}`, main: block.body.join("\n"), api: `조각 '${block.name}'` });
			}
			if (mid()) err(i, "표 가운데의 표시 (원래 키트 화면에서 표가 둘로 나뉨)");
			block = null;
			continue;
		}
		if (block) {
			if (has) err(i, "표시 안의 표시");
			block.body.push(line);
			continue;
		}
		if ((m = line.match(/^ {0,3}<!-- api:넣기 (.+?) -->\s*$/))) {
			if (mid()) err(i, "표 가운데의 표시 (원래 키트 화면에서 표가 둘로 나뉨)");
			out.push(...frag(i, m[1]));
			continue;
		}
		if ((m = line.match(/<!-- api=(.*?)-->\s*$/))) {
			if (/^#{1,6}\s/.test(line)) err(i, "제목 줄의 api= (제목은 api:바꾸기 로)");
			const repl = m[1].replace(/^ /, "").replace(/ $/, "");
			if (repl !== "") {
				out.push(...repl.split("\\n").map((s) => s.split("\\|").join("|")));
				if (marks) marks.push({ where, line: i + 1, kind: "api=", main: line.slice(0, m.index).replace(/\s+$/, ""), api: repl });
			}
			continue;
		}
		if (has) {
			err(i, "알 수 없는 표시");
			continue;
		}
		out.push(line);
	}
	if (block) err(block.at, "닫지 않은 표시");
	for (const name of fragments.keys()) if (!used.has(name)) errors.push(`${where}: 쓰지 않은 조각: ${name}`);
	if (errors.length) throw new Error(errors.join("\n"));
	return out.join("\n");
}

const sha12 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
/** 짝을 이룬 글 -> marks.sha256 의 줄 ('sha \t 문서 \t 종류') */
export const markLine = (k) => `${sha12(k.main)}\t${k.where}\t${k.kind}`;

/** 적어 둔 줄과 비교: 새로 생겼거나 바뀐 것(지금 글과 함께), 없어진 것의 수 */
export function compareMarks(marks, saved) {
	const left = new Map();
	for (const l of saved) left.set(l, (left.get(l) || 0) + 1);
	const changed = [];
	for (const k of marks) {
		const l = markLine(k);
		if (left.get(l)) left.set(l, left.get(l) - 1);
		else changed.push(k);
	}
	let gone = 0;
	for (const n of left.values()) gone += n;
	return { changed, gone };
}

function walk(dir, base = dir, acc = []) {
	for (const d of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, d.name);
		if (d.isDirectory()) walk(p, base, acc);
		else acc.push(relative(base, p).split("\\").join("/"));
	}
	return acc;
}

/** 폴더의 표시 든 문서를 모두 처리: [경로, API 키트 글] 목록, 짝을 이룬 글, 오류 */
function load(dir, fragDir) {
	const fragFiles = fragDir && existsSync(fragDir) ? walk(fragDir) : [];
	const docs = walk(dir).filter((p) => p.endsWith(".md") && !p.startsWith("runtime/") && !p.startsWith(".git/"));
	const out = [];
	const marks = [];
	const errors = [];
	for (const p of docs) {
		const text = readFileSync(join(dir, p), "utf8");
		const hasFrag = fragFiles.includes(p);
		if (!hasFrag && !/<!-- (api|\/api)/.test(text)) continue;
		try {
			const frags = hasFrag ? parseFragments(readFileSync(join(fragDir, p), "utf8")) : new Map();
			out.push([p, assemble(text, frags, p, marks)]);
		} catch (e) {
			errors.push(e.message);
		}
	}
	for (const p of fragFiles) if (!existsSync(join(dir, p))) errors.push(`조각 파일의 문서가 없음: ${p}`);
	return { out, marks, errors };
}

const short = (s, n = 70) => {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length > n ? t.slice(0, n) + "…" : t;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const args = process.argv.slice(2);
	const mode = args[0] === "--marks" || args[0] === "--write-marks" ? args.shift() : "";
	const [dir, fragDir, marksFile, rev] = args;
	if (!dir || (mode && !marksFile) || (mode === "--write-marks" && !rev)) {
		console.error("사용법: node assemble.mjs [--marks | --write-marks] <폴더> [조각 폴더] [marks.sha256] [커밋]");
		process.exit(2);
	}
	const { out, marks, errors } = load(dir, fragDir);
	if (errors.length) {
		console.error("[api-kit] 문서 표시 오류:\n  " + errors.join("\n").split("\n").join("\n  "));
		process.exit(2);
	}
	if (mode === "--write-marks") {
		const head = [
			`# 원래 키트 문서에서 API 키트와 짝을 이룬 글의 sha256 앞 12자리 (커밋 ${rev}). api-kit/make-api-kit.sh --update-sha 가 적음`,
			"#  'api:바꾸기' 블록 안 글과 'api=' 줄의 원래 키트 쪽 글. 바뀌면 API 키트 만들기가 멈춤: API 키트 글(조각, api= 뒤)도 고쳐야 하는지 보고 --update-sha",
		];
		writeFileSync(marksFile, [...head, ...marks.map(markLine), ""].join("\n"));
		console.log(`[api-kit] marks.sha256 을 다시 적었습니다 (짝 ${marks.length}개)`);
	} else if (mode === "--marks") {
		const saved = existsSync(marksFile) ? readFileSync(marksFile, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")) : [];
		const { changed, gone } = compareMarks(marks, saved);
		for (const k of changed)
			console.error(`[api-kit] 바뀜: ${k.where}:${k.line} ${k.kind === "api=" ? "api= 줄" : `'${k.kind}' 블록`} 원래: "${short(k.main)}" / API 키트: ${k.kind === "api=" ? `"${short(k.api)}"` : `api-kit/fragments/${k.where} 의 ${k.api}`}`);
		if (gone > changed.length) console.error(`[api-kit] 없어진 짝 ${gone - changed.length}개 (원래 키트에서 표시를 지웠거나 합친 것)`);
		process.exit(changed.length || gone ? 1 : 0);
	} else {
		for (const [p, text] of out) writeFileSync(join(dir, p), text);
		console.log(`[api-kit] 표시를 처리한 문서 ${out.length}개`);
	}
}
