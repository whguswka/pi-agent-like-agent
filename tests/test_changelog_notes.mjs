// 업데이트를 마친 뒤 보여 줄 바뀐 점(bin/changelog-notes.sh) 시험: 새 버전 항목 전체 + 건너뛴 버전들의 '할 일'
// 사용법: node tests/test_changelog_notes.mjs   (bash 가 있어야 함: Windows 는 Git Bash)
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : `  -> ${String(detail).slice(0, 600)}`));
	if (!cond) fails++;
};
const tmp = mkdtempSync(join(tmpdir(), "notes-test-"));
const cl = join(tmp, "CHANGELOG.md");
writeFileSync(
	cl,
	[
		"# 바뀐 점",
		"",
		"## 3.1",
		"- 새 기능 A",
		"- 할 일: 없음",
		"",
		"## 2.2 (중계 서버 2.2)",
		"- 고친 것 B",
		"- 할 일:",
		"  - 설정 X 를 확인하세요",
		"  - 사진을 보내 주세요",
		"",
		"## 2.1",
		"- 고친 것 C",
		"- 할 일: 없음",
		"",
		"## 1.1",
		"- 처음",
		"- 할 일: 옛 할 일",
		"",
	].join("\n"),
);
const run = (oldV, newV) =>
	spawnSync("bash", [join(ROOT, "bin/changelog-notes.sh").replace(/\\/g, "/"), cl.replace(/\\/g, "/"), oldV, newV], { encoding: "utf8" }).stdout;

let out = run("1.1", "3.1");
check("새 버전 항목 전체", out.includes("이 버전(3.1)에서 바뀐 점") && out.includes("- 새 기능 A") && !out.includes("고친 것 B"), out);
check("건너뛴 버전 목록과 그 할 일(여러 줄 포함), 이전 버전의 할 일은 아님",
	out.includes("건너뛴 버전: 2.2, 2.1") && out.includes("(2.2) - 할 일:") && out.includes("  - 설정 X 를 확인하세요") && out.includes("(2.1) - 할 일: 없음")
		&& !out.includes("옛 할 일"), out);
out = run("2.2", "3.1");
check("바로 앞 버전에서 오면 건너뛴 버전 없음", out.includes("이 버전(3.1)") && !out.includes("건너뛴"), out);
out = run("3.1", "2.2");
check("되돌리기(이전 버전이 더 새 것)면 그 버전 항목만", out.includes("이 버전(2.2)") && out.includes("설정 X") && !out.includes("건너뛴"), out);
out = run("0.9", "3.1");
check("CHANGELOG 에 없는 이전 버전이면 새 버전 항목만", out.includes("이 버전(3.1)") && !out.includes("건너뛴"), out);
out = run("", "3.1");
check("이전 버전을 모르면 새 버전 항목만", out.includes("이 버전(3.1)") && !out.includes("건너뛴"), out);
check("새 버전이 CHANGELOG 에 없으면 아무것도 쓰지 않음", run("1.1", "9.9") === "");

rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `RESULT: FAIL (${fails})` : "RESULT: PASS");
process.exit(fails ? 1 : 0);
