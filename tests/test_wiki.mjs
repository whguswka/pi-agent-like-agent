// LLM 위키(profiles/common/agent-template/extensions/wiki.ts) 단위 테스트
// 사용법: node tests/test_wiki.mjs   (저장소의 runtime/node_modules/jiti 로 .ts 를, typebox 는 pi 처럼 runtime 의 것으로)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { typebox: join(ROOT, "runtime/node_modules/typebox/build/index.mjs") } });
const w = await jiti.import("../profiles/common/agent-template/extensions/wiki.ts");
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : `  -> ${typeof detail === "string" ? detail : JSON.stringify(detail)}`.slice(0, 600)));
	if (!cond) fails++;
};
const read = (p) => readFileSync(p, "utf8");

// 머리말·이름·링크
let fm = w.parseFrontmatter("---\ntitle: \"메모리 지표\"\nsummary: 학습 단계별 메모리\ntype: metric\nsources: [raw/a.md, 'raw/b.md']\ntags:\n  - x\n  - y\n---\n본문\n");
check("머리말: 따옴표, [목록], '- 목록'", fm.ok && fm.meta.title === "메모리 지표" && fm.meta.sources.join("|") === "raw/a.md|raw/b.md" && fm.meta.tags.join("|") === "x|y" && fm.body === "본문\n", fm);
check("머리말이 없으면 ok=false, 본문 그대로", !w.parseFrontmatter("# 제목\n").ok && w.parseFrontmatter("# 제목\n").body === "# 제목\n");
check("파일 이름: 못 쓰는 문자는 띄어쓰기로", w.pageName('A/B: "C" #1 [x]?') === "A B C 1 x");
check("링크: [[이름]], [[이름|글]], [[이름#제목]], ![[그림]]",
	JSON.stringify(w.wikilinks("[[가]] [[나|보일 글]] [[다#절]] ![[그림.png]] `x`")) === JSON.stringify(["가", "나", "다", "그림.png"]), w.wikilinks("[[가]] [[나|보일 글]] [[다#절]] ![[그림.png]]"));
const q = w.quoteMeta("---\ntitle: 메모리 지표\nsummary: 지표: 정의와 기준값 #1\ntype: metric\nsources: [raw/a.md]\n---\n본문 summary: x\n");
check("Obsidian 용 따옴표: ': '·' #' 이 든 summary 만, 목록·본문은 그대로",
	q === "---\ntitle: 메모리 지표\nsummary: '지표: 정의와 기준값 #1'\ntype: metric\nsources: [raw/a.md]\n---\n본문 summary: x\n", q);
check("따옴표: ' 가 들어 있으면 \"...\" 로, 이미 따옴표면 그대로, 풀면 원래 글",
	w.parseFrontmatter(w.quoteMeta("---\ntitle: 운영: 'A' 모델\nsummary: \"이미: 따옴표\"\n---\n")).meta.title === "운영: 'A' 모델"
	&& w.quoteMeta("---\nsummary: \"이미: 따옴표\"\n---\n").includes("summary: \"이미: 따옴표\"")
	&& w.parseFrontmatter("---\nsummary: '지표: 기준 ''A'''\n---\n").meta.summary === "지표: 기준 'A'");
const b = w.splitBundle("=== pages/model/A.md\n---\ntitle: A\n---\n본문 A\n\n=== pages/data/B.md\n---\ntitle: B\n---\nB\n");
check("여러 페이지 나누기: '=== 경로' 줄", b.length === 2 && b[0].path === "pages/model/A.md" && b[0].content.startsWith("---\ntitle: A") && b[1].content.endsWith("B\n"), b);
check("쓸 수 있는 곳: pages/ 아래 .md 만",
	w.checkWritePath("pages/model/A.md") === null && w.checkWritePath("raw/a.md") && w.checkWritePath("WIKI.md") && w.checkWritePath("pages/../x.md")
	&& w.checkWritePath("pages/.history/x.md") && w.checkWritePath("pages/a.txt") && w.checkWritePath("pages/a?.md"));
check("updated: 있으면 바꾸고 없으면 넣음",
	w.stampUpdated("---\ntitle: A\nupdated: 2020-01-01\n---\nx", "2026-10-14") === "---\ntitle: A\nupdated: 2026-10-14\n---\nx"
	&& w.stampUpdated("---\ntitle: A\n---\nx", "2026-10-14") === "---\ntitle: A\nupdated: 2026-10-14\n---\nx");
check("검색 조각: 한글은 두 글자, 영문은 단어", JSON.stringify(w.tokens("메모리지표 GPU 사용률")) === JSON.stringify(["메모", "모리", "리지", "지표", "gpu", "사용", "용률"]), w.tokens("메모리지표 GPU 사용률"));

// 새 위키
const tmp = mkdtempSync(join(tmpdir(), "wiki-test-"));
const root = join(tmp, "모델운영");
const made = w.initWiki(root, "모델운영", "2026-10-14");
check("새 위키: WIKI.md·개요·기록·목록", ["WIKI.md", "pages/overview/모델운영 개요.md", "log.md", "index.md"].every((f) => existsSync(join(root, f))) && made.includes("WIKI.md"), made);
const types = w.readTypes(read(join(root, "WIKI.md")));
check("WIKI.md 의 분류 11개 (모델 운영)", types.length === 11 && types[1].id === "model" && types[1].label === "모델" && types[6].id === "incident", types);
check("WIKI.md 의 주제", w.readTopic(read(join(root, "WIKI.md")), "x") === "모델 운영");
check("다시 init 해도 있는 파일은 그대로", w.initWiki(root, "모델운영", "2026-10-15").length <= 1 && read(join(root, "log.md")).includes("[2026-10-14] init"));

// 쓰기: 여러 페이지 한 번에, 목록·기록 자동, 파일 이름 = 제목, 같은 이름 막기
const page = (title, type, body, extra = "") => `---\ntitle: ${title}\nsummary: ${title} 요약\ntype: ${type}\n${extra}---\n${body}\n`;
let r = w.applyWrite(root, "모델운영", [
	`=== pages/model/수요 예측 모델.md\n${page("수요 예측 모델", "model", "주간 학습. 지표는 [[메모리 지표]], 작업은 [[주간 학습 작업]].", "sources: [raw/회의록.md]\n")}`,
	`=== pages/metric/memory.md\n${page("메모리 지표", "metric", "memory_pct 는 학습 단계별 메모리 사용률(%). GPU 메모리 사용률이 90% 를 넘으면 [[수요 예측 모델]] 학습이 느려짐.")}`,
].join("\n"), "ingest", "회의록 반영", "2026-10-14");
check("여러 페이지를 한 번에 씀", r.written.length === 2 && existsSync(join(root, "pages/model/수요 예측 모델.md")), r);
check("새 페이지는 파일 이름을 제목과 같게", existsSync(join(root, "pages/metric/메모리 지표.md")) && !existsSync(join(root, "pages/metric/memory.md")) && r.warnings.some((x) => x.includes("제목과 같게")), r);
check("updated 를 적음", read(join(root, "pages/metric/메모리 지표.md")).includes("updated: 2026-10-14"));
const rq = w.applyWrite(root, "모델운영", `=== pages/metric/오차 지표.md\n---\ntitle: 오차 지표\nsummary: 지표: MAPE 기준 10% #주간\ntype: metric\n---\n본문\n`, "note", "", "2026-10-14");
check("쓸 때 summary 를 따옴표로 (Obsidian 이 머리말을 버리지 않게), 목록에는 원래 글",
	read(join(root, "pages/metric/오차 지표.md")).includes("summary: '지표: MAPE 기준 10% #주간'") && read(join(root, "index.md")).includes("- [[오차 지표]] — 지표: MAPE 기준 10% #주간"), rq);
let index = read(join(root, "index.md"));
check("목록: 분류 순서와 이름표, [[링크]] — 요약", index.indexOf("## 개요") < index.indexOf("## 모델") && index.indexOf("## 모델") < index.indexOf("## 지표")
	&& index.includes("- [[수요 예측 모델]] — 수요 예측 모델 요약") && index.includes("- [[메모리 지표]] — 메모리 지표 요약"), index);
check("기록: '## [날짜] ingest | 제목' + 쓴 페이지", read(join(root, "log.md")).includes("## [2026-10-14] ingest | 회의록 반영\n- [[수요 예측 모델]] · [[메모리 지표]]"));
check("아직 없는 페이지 링크는 참고로 알림", r.warnings.some((x) => x.includes("[[주간 학습 작업]]")), r.warnings);
r = w.applyWrite(root, "모델운영", `=== pages/concept/메모리 지표.md\n${page("메모리 지표", "concept", "중복")}`, "note", "", "2026-10-14");
check("같은 이름이 다른 폴더에 있으면 쓰지 않음 (링크가 어디로 갈지 모름)", !r.written.length && r.errors[0].includes("같은 이름"), r);
r = w.applyWrite(root, "모델운영", `=== pages/model/수요 예측 모델.md\n${page("수요 예측 모델", "model", "주간 학습 (고침). [[메모리 지표]]", "sources: [raw/회의록.md]\n")}`, "note", "고침", "2026-10-15");
check("고치기 전 페이지는 .history/<날짜>/ 에", r.written.length === 1 && read(join(root, ".history/2026-10-15/pages/model/수요 예측 모델.md")).includes("주간 학습. 지표는"), r);
r = w.applyWrite(root, "모델운영", "=== pages/model/x.md\n제목 없음\n=== raw/x.md\n---\ntitle: x\n---\n", "note", "", "2026-10-15");
check("머리말 없는 페이지, pages/ 밖은 쓰지 않음", !r.written.length && r.errors.length === 2 && r.errors.some((e) => e.includes("머리말")) && r.errors.some((e) => e.includes("pages/ 아래만")), r);
check("'=== 경로' 줄이 없으면 안내", w.applyWrite(root, "모델운영", "---\ntitle: a\n---\n", "note").errors[0].includes("=== pages/"));

// 검색·읽기
let pages = w.loadPages(root);
let hits = w.search(pages, "GPU 메모리 사용률");
check("검색: 맞는 페이지가 앞, 맞은 줄", hits[0]?.page.name === "메모리 지표" && hits[0].lines.some((l) => l.includes("GPU")), hits.map((h) => [h.page.name, h.score]));
check("검색: 조사가 붙어도 (메모리가 → 메모리)", w.search(pages, "메모리가")[0]?.page.name === "메모리 지표");
const fs1 = w.formatSearch("GPU", w.search(pages, "GPU"), pages.length);
check("검색 결과: [[제목]] (경로) — 요약, 짧게", fs1.includes("[[메모리 지표]] (pages/metric/메모리 지표.md) — 메모리 지표 요약") && fs1.length < 2500, fs1);
check("검색: 없으면 안내", w.formatSearch("zzz", [], 3).includes("맞는 페이지 없음"));
let rd = w.readTargets(root, pages, ["메모리 지표", "index.md", "없는 페이지"]);
check("읽기: 제목·경로 여러 개를 한 번에, 없는 것은 안내", rd.includes("=== pages/metric/메모리 지표.md") && rd.includes("=== index.md") && rd.includes("(없음: wiki_search"), rd);
writeFileSync(join(root, "raw/긴 원본.md"), Array.from({ length: 400 }, (_, i) => `${i + 1}번째 줄: 모델 운영 회의 내용`).join("\n"));
rd = w.readTargets(root, pages, ["raw/긴 원본.md"]);
check("읽기: 길면 5500자 안에서 자르고 이어 읽을 offset", rd.length < 5700 && /offset=\d+\)$/.test(rd), rd.slice(-120));
const next = Number(/offset=(\d+)\)$/.exec(rd)[1]);
check("읽기: offset 부터 이어서", w.readTargets(root, pages, ["raw/긴 원본.md"], next, 3).includes(`${next}번째 줄`));
check("읽기: 위키 밖(..)은 못 읽음", w.resolveTarget(root, pages, "../x") === null && w.resolveTarget(root, pages, "pages/../../x") === null);

// 점검
writeFileSync(join(root, "pages/model/고아.md"), page("고아", "model", "아무도 링크 안 함"));
writeFileSync(join(root, "pages/model/머리말 없음.md"), "그냥 글 [[없는 곳]]\n");
writeFileSync(join(root, "pages/model/분류 틀림.md"), page("분류 틀림", "modle", "[[수요 예측 모델]]"));
let lr = w.lint(root, "모델운영");
check("점검: 깨진 링크 (있는 페이지 링크는 빼고)", lr.broken.some((x) => x.includes("[[없는 곳]]")) && !lr.broken.some((x) => x.includes("[[메모리 지표]]") || x.includes("[[수요 예측 모델]]")), lr.broken);
check("점검: 고아 페이지 (개요는 빼고)", lr.orphans.includes("고아") && !lr.orphans.includes("모델운영 개요"), lr.orphans);
check("점검: 머리말 없음, 모르는 분류", lr.noMeta.includes("pages/model/머리말 없음.md") && lr.unknownType.some((x) => x.includes("modle")), lr);
check("점검: 반영 안 된 원본 (sources 에 없는 raw 파일)", lr.rawUnused.includes("raw/긴 원본.md") && !lr.rawUnused.some((x) => x.includes("회의록")), lr.rawUnused);
check("점검: 손으로 만든 페이지 때문에 목록이 다름", lr.indexStale === true);
const fl = w.formatLint(lr);
check("점검 보고: 항목별 개수와 고칠 방법, 짧게", fl.includes("깨진 링크") && fl.includes("/wiki ingest") && fl.includes("/wiki reindex") && fl.length <= 3002, fl);
check("다시 만들기 뒤 목록이 맞음", w.reindex(root, "모델운영") === true && w.lint(root, "모델운영").indexStale === false && w.reindex(root, "모델운영") === false);
check("Obsidian 설정 폴더(.obsidian)는 페이지로 보지 않음", (() => {
	mkdirSync(join(root, "pages/.obsidian"), { recursive: true });
	writeFileSync(join(root, "pages/.obsidian/x.md"), "x");
	return !w.loadPages(root).some((p) => p.rel.includes(".obsidian"));
})());

// 지침
const g = w.guideLines("모델운영", root, "write", "모델 운영");
check("지침(write): 찾기 + 남기기, 매번 같은 글", g.length === 3 && g[1].startsWith("모델 운영에 관한") && g[2].includes("wiki_write") && JSON.stringify(g) === JSON.stringify(w.guideLines("모델운영", root, "write", "모델 운영")), g);
check("지침(ask/search/off)", w.guideLines("a", root, "ask", "t")[2].includes("제안") && w.guideLines("a", root, "search", "t").length === 2 && w.guideLines("a", root, "off", "t").length === 0);

// 설정
const cf = join(tmp, "wiki.json");
w.writeConfig({ wikis: { 모델운영: root }, active: "모델운영", auto: "ask" }, cf);
check("설정 읽고 쓰기", JSON.stringify(w.readConfig(cf)) === JSON.stringify({ wikis: { 모델운영: root }, active: "모델운영", auto: "ask" }));
writeFileSync(cf, "{ 틀린 JSON");
check("설정 파일이 틀리면 꺼진 상태로", w.readConfig(cf).active === "" && w.readConfig(cf).auto === "write");

// 규모: 500쪽
const big = join(tmp, "큰위키");
w.initWiki(big, "큰위키", "2026-10-14");
for (let i = 0; i < 500; i++) {
	const d = join(big, "pages/concept");
	mkdirSync(d, { recursive: true });
	writeFileSync(join(d, `개념 ${i}.md`), page(`개념 ${i}`, "concept", `개념 ${i} 설명. 관련 [[개념 ${(i + 1) % 500}]]. 배치 작업 ${i % 7} 번과 GPU ${i % 13} 번.`));
}
let t0 = Date.now();
const bp = w.loadPages(big);
hits = w.search(bp, "배치 작업 GPU");
const tSearch = Date.now() - t0;
t0 = Date.now();
lr = w.lint(big, "큰위키", bp);
const tLint = Date.now() - t0;
check(`500쪽: 읽기+검색 ${tSearch}ms, 점검 ${tLint}ms (각 2초 안)`, bp.length === 501 && hits.length === 8 && tSearch < 2000 && tLint < 2000);

rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `RESULT: FAIL (${fails})` : "RESULT: PASS");
process.exit(fails ? 1 : 0);
