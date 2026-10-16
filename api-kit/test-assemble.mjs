// assemble.mjs 시험: node api-kit/test-assemble.mjs
import { assemble, compareMarks, markLine, parseFragments } from "./assemble.mjs";

let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : `  -> ${JSON.stringify(detail)}`));
	if (!cond) fails++;
};
const throws = (fn, needle) => {
	try {
		fn();
		return false;
	} catch (e) {
		return e.message.includes(needle) ? true : e.message;
	}
};

const frags = parseFragments(["<!-- 조각: 준비물 -->", "| 항목 | API |", "|---|---|", "| Node | code-server |", "", "<!-- 조각: 키 -->", "### 3-3. 키", "- Ctrl+P", "", ""].join("\n"));
check("조각 나누기 (끝의 빈 줄은 뺌)", frags.get("준비물").length === 3 && frags.get("키").join("|") === "### 3-3. 키|- Ctrl+P", [...frags]);

const src = [
	"# 제목",
	"## 1. 준비물",
	"<!-- api:바꾸기 준비물 -->",
	"| 항목 | PC |",
	"|---|---|",
	"| Git Bash | 필요 |",
	"<!-- /api -->",
	"",
	"공통 문단",
	"",
	"<!-- api:빼기 -->",
	"Copilot 전용 문단",
	"```bash",
	"diag.py --report",
	"```",
	"",
	"<!-- /api -->",
	"| 키 | 뜻 |",
	"|---|---|",
	"| Enter | 보내기 |",
	"| Ctrl+P | 다음 모델 | <!-- api= \\| Ctrl+P \\| VS Code 가 가져감 \\| -->",
	"| 9222 오류 | 전용 창 | <!-- api= -->",
	"<!-- api:넣기 키 -->",
	"",
	"- PC 줄 <!-- api= - 노트북 줄\\n- 노트북 둘째 줄 -->",
	"- 지울 줄 <!-- api= -->",
	"````text",
	"<!-- 이 줄은 코드라 그대로 -->",
	"````",
].join("\n");
const out = assemble(src, frags, "t.md");
const want = [
	"# 제목",
	"## 1. 준비물",
	"| 항목 | API |",
	"|---|---|",
	"| Node | code-server |",
	"",
	"공통 문단",
	"",
	"| 키 | 뜻 |",
	"|---|---|",
	"| Enter | 보내기 |",
	"| Ctrl+P | VS Code 가 가져감 |",
	"### 3-3. 키",
	"- Ctrl+P",
	"",
	"- 노트북 줄",
	"- 노트북 둘째 줄",
	"````text",
	"<!-- 이 줄은 코드라 그대로 -->",
	"````",
].join("\n");
check("빼기·바꾸기·넣기·api= (표의 \\|, 여러 줄 \\n, 줄 빼기), 코드 블록은 그대로", out === want, out);

const one = (s, f = new Map()) => () => assemble(s, f, "x.md");
check("닫지 않은 표시는 멈춤", throws(one("<!-- api:빼기 -->\n글"), "닫지 않은 표시") === true);
check("여는 표시 없이 닫으면 멈춤", throws(one("글\n<!-- /api -->"), "여는 표시 없이") === true);
check("코드 블록 안의 표시는 멈춤", throws(one("```\n<!-- api:빼기 -->\n```"), "코드 블록 안의 표시") === true);
check("표 가운데의 한 줄 표시는 멈춤", throws(one("| a |\n|---|\n<!-- api:넣기 키 -->\n| b |", frags), "표 가운데") === true);
check("표 끝에 넣기는 됨 (원래 화면에서는 표가 끝나고 주석)", assemble("| a |\n|---|\n| b |\n<!-- api:넣기 키 -->\n\n끝", new Map([["키", ["| c |"]]]), "x") === "| a |\n|---|\n| b |\n| c |\n\n끝");
check("제목 줄의 api= 는 멈춤", throws(one("## 1. 준비물 <!-- api= ## 1. 다른 제목 -->"), "제목 줄") === true);
check("없는 조각은 멈춤", throws(one("<!-- api:넣기 없음 -->"), "없는 조각: 없음") === true);
check("쓰지 않은 조각은 멈춤", throws(one("글", frags), "쓰지 않은 조각") === true);
check("알 수 없는 표시는 멈춤", throws(one("<!-- api:지우기 -->"), "알 수 없는 표시") === true);
check("표시 안의 표시는 멈춤", throws(one("<!-- api:빼기 -->\n<!-- api:넣기 키 -->\n<!-- /api -->", frags), "표시 안") !== false);
check("목록 가운데의 표시 줄은 앞에 빈칸 두 개 (원래 화면에서 목록이 이어짐)", assemble("- a\n  <!-- api:빼기 -->\n- b\n  <!-- /api -->\n- c\n   <!-- api:넣기 키 -->", new Map([["키", ["- d"]]]), "x") === "- a\n- c\n- d");
check("표시가 없으면 그대로", assemble("가\n\n나\n", new Map(), "x") === "가\n\n나\n");

// 짝을 이룬 글 (marks): 바꾸기 블록 안 글, 비우지 않은 api= 줄의 원래 키트 쪽 글만
const marks = [];
assemble(src, frags, "t.md", marks);
check(
	"짝을 이룬 글 모으기 (바꾸기 블록, 비우지 않은 api= 줄)",
	marks.map((k) => `${k.kind}|${k.main}`).join("\n") === ["바꾸기 준비물|| 항목 | PC |\n|---|---|\n| Git Bash | 필요 |", "api=|| Ctrl+P | 다음 모델 |", "api=|- PC 줄"].join("\n"),
	marks,
);
const saved = marks.map(markLine);
const again = (s) => {
	const m = [];
	assemble(s, frags, "t.md", m);
	return compareMarks(m, saved);
};
let r = again(src);
check("그대로면 바뀐 짝 없음", r.changed.length === 0 && r.gone === 0, r);
r = again(src.replace("| Ctrl+P \\| VS Code 가 가져감 \\|", "| Ctrl+P \\| 바뀐 API 글 \\|").replace("- 노트북 줄", "- 바뀐 노트북 줄"));
check("API 키트 글만 고치면 걸리지 않음", r.changed.length === 0 && r.gone === 0, r);
r = again(src.replace("| Git Bash | 필요 |", "| Git Bash | 2.40 이상 |").replace("- PC 줄 <!--", "- 바뀐 PC 줄 <!--"));
check("원래 키트 쪽 글이 바뀌면 걸림 (블록과 api= 줄, 줄 번호와 함께)", r.changed.map((k) => `${k.kind}:${k.line}`).join(",") === "바꾸기 준비물:3,api=:25" && r.gone === 2, r);
console.log(fails ? `RESULT: FAIL (${fails})` : "RESULT: PASS");
process.exit(fails ? 1 : 0);
