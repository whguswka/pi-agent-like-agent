// edits.json 의 글 바꾸기: node apply-edits.mjs <폴더> <edits.json>
//  [{ "file": "폴더 안 경로", "from": "바꿀 글", "to": "새 글", "count": 1 }]  (count 를 빼면 1)
//  바꿀 글이 정확히 count 번 있어야 바꾼다. 하나라도 맞지 않으면 아무 파일도 쓰지 않고 멈춤 (원래 키트의 글이 바뀐 것)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, file] = process.argv.slice(2);
if (!dir || !file) {
	console.error("사용법: node apply-edits.mjs <폴더> <edits.json>");
	process.exit(2);
}
const edits = JSON.parse(readFileSync(file, "utf8"));
const texts = new Map();
const errors = [];
const count = (s, sub) => s.split(sub).length - 1;
edits.forEach((e, i) => {
	const where = `${i + 1}번 (${e.file})`;
	if (!e.file || typeof e.from !== "string" || !e.from || typeof e.to !== "string") return errors.push(`${where}: file·from·to 가 필요합니다`);
	const p = join(dir, e.file);
	if (!texts.has(p)) {
		if (!existsSync(p)) return errors.push(`${where}: 파일이 없습니다`);
		texts.set(p, readFileSync(p, "utf8"));
	}
	const want = e.count ?? 1;
	const got = count(texts.get(p), e.from);
	if (got !== want) return errors.push(`${where}: 바꿀 글이 ${want}번이어야 하는데 ${got}번 있습니다: ${JSON.stringify(e.from.slice(0, 80))}`);
	texts.set(p, texts.get(p).split(e.from).join(e.to));
});
if (errors.length) {
	console.error("[api-kit] 글 바꾸기 실패 (원래 키트의 글이 바뀌었으면 edits.json 을 고치기):\n  " + errors.join("\n  "));
	process.exit(1);
}
for (const [p, s] of texts) writeFileSync(p, s);
console.log(`[api-kit] 글 바꾸기 ${edits.length}건 (${texts.size}개 파일)`);
