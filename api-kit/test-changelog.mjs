// changelog-draft.mjs 시험: node api-kit/test-changelog.mjs
import { draft, sections } from "./changelog-draft.mjs";

let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : `  -> ${JSON.stringify(detail)}`));
	if (!cond) fails++;
};

const text = [
	"# 바뀐 점",
	"",
	"버전마다 바뀐 점을 새 것부터 적습니다.",
	"- **버전 번호**는 `날짜.순번` 입니다 (머리말의 목록, 버전 항목 아님)",
	"",
	"## 2026-10-20.1 (중계 서버 2026-10-20.1)",
	"- [공통] **위키**: 고침",
	"  - 하위 줄",
	"- [Copilot] **중계 서버**: 고침",
	"  Copilot 쪽 이어지는 줄",
	"- 할 일: 없음",
	"",
	"## 2026-10-16.1",
	"- [공통] **guard**: 더 물음",
	"",
	"## 2026-10-14.2 (중계 서버 2026-10-14.2)",
	"- **예전 항목**",
	"",
].join("\n");

const s = sections(text);
check("버전 항목만 읽음 (머리말 목록은 뺌)", s.map((x) => x.ver).join(",") === "2026-10-20.1,2026-10-16.1,2026-10-14.2", s);
const d = draft(text, "2026-10-14.2");
check("바탕 버전 뒤의 버전", d.versions.join(",") === "2026-10-20.1,2026-10-16.1" && d.newest === "2026-10-20.1", d);
check("[공통] 항목을 하위 줄과 함께, 표시는 떼고", JSON.stringify(d.common.map((i) => i.lines)) === JSON.stringify([["- **위키**: 고침", "  - 하위 줄"], ["- **guard**: 더 물음"]]), d.common);
check("[Copilot] 은 세기만, 표시 없는 항목은 따로", d.copilot === 1 && d.unlabeled.length === 1 && d.unlabeled[0].lines[0] === "- 할 일: 없음", d);
check("바탕 버전이 바로 맨 위면 새 버전 없음", draft(text, "2026-10-20.1").versions.length === 0);
let msg = "";
try {
	draft(text, "2026-01-01.1");
} catch (e) {
	msg = e.message;
}
check("없는 바탕 버전은 멈춤", msg.includes("2026-01-01.1"), msg);
console.log(fails ? `RESULT: FAIL (${fails})` : "RESULT: PASS");
process.exit(fails ? 1 : 0);
