// LLM 위키(profiles/common/agent-template/extensions/wiki.ts) 단위 테스트
// 사용법: node tests/test_wiki.mjs   (저장소의 runtime/node_modules/jiti 로 .ts 를, typebox 는 pi 처럼 runtime 의 것으로)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
const mj = join(tmp, "models.json");
writeFileSync(mj, '{"providers": {"vllm": {"baseUrl": "http://10.0.0.5:8000/v1"}}}');
const viaApi = w.isBridge(mj);
writeFileSync(mj, '{"providers": {"inhouse": {"baseUrl": "http://127.0.0.1:8766/v1"}}}');
check("중계 서버 설정일 때만 '@tool' 글 형식 안내 (API 모델·models.json 없음은 아님)", !viaApi && w.isBridge(mj) && !w.isBridge(join(tmp, "없음.json")));
check("/wiki init 의 폴더: ~ 는 홈, 상대 경로는 지금 폴더 기준, 전체 경로는 그대로, 비면 \"\"",
	w.wikiDir("~/위키/가") === join(homedir(), "위키/가") && w.wikiDir(" ~ ") === join(homedir(), "") && w.wikiDir("rel/나", tmp) === resolve(tmp, "rel/나")
	&& w.wikiDir(tmp) === tmp && w.wikiDir(`"${tmp}"`) === tmp && w.wikiDir("  ") === "",
	[w.wikiDir("~/위키/가"), w.wikiDir("rel/나", tmp)]);

// 원본 (raw/): 여러 단계 폴더, 같은 이름의 파일, 폴더째 반영
const fr = join(tmp, "폴더위키");
w.initWiki(fr, "폴더위키", "2026-10-15");
const put = (rel, text = `# ${rel}\n내용\n`) => {
	mkdirSync(dirname(join(fr, rel)), { recursive: true });
	writeFileSync(join(fr, rel), text);
};
for (const f of ["회의록/2025/1월.md", "회의록/2025/2월.md", "회의록/2025/10월.md", "회의록/2025/분기/1분기/정리.md", "회의록/2026/1월.md", "가/x/메모.md", "나/x/메모.md", "보고서.md", "보고서.txt"]) put(`raw/${f}`);
put("raw/회의록/계획.pdf", "%PDF-1.4");
writeFileSync(join(fr, "raw/회의록/깨진.dat"), Buffer.from([1, 2, 0, 3]));
put("raw/회의록/큰.txt", "가".repeat(80000));
put("raw/assets/그림.md", "x");
const rawAll = w.rawFilesOf(fr);
check("원본 목록: 모든 깊이, raw/assets/ 는 뺌", rawAll.includes("raw/회의록/2025/분기/1분기/정리.md") && !rawAll.some((x) => x.startsWith("raw/assets/")), rawAll);
check("경로 차례: 마디마다, 숫자는 크기 순",
	JSON.stringify(["raw/a/10월.md", "raw/a/분기/x.md", "raw/a/2월.md", "raw/a/1월.md"].sort(w.pathOrder)) === JSON.stringify(["raw/a/1월.md", "raw/a/2월.md", "raw/a/10월.md", "raw/a/분기/x.md"]));
check("글인지: 문서는 이름으로, 0 바이트가 있으면 글이 아님, 크기는 한도를 줄 때만",
	w.rawKind(fr, "raw/회의록/계획.pdf") === "binary" && w.rawKind(fr, "raw/회의록/깨진.dat") === "binary" && w.rawKind(fr, "raw/보고서.txt") === "text"
	&& w.rawKind(fr, "raw/회의록/큰.txt", 200000) === "big" && w.rawKind(fr, "raw/회의록/큰.txt") === "text" && w.rawKind(fr, "raw/없음.md") === "binary");
const tg = (a) => JSON.stringify(w.rawTarget(fr, a));
check("찾기: 폴더 (raw/ 를 빼고, 끝의 / 도)", tg("회의록") === JSON.stringify({ rel: "raw/회의록", dir: true }) && tg("raw/회의록/2025/") === JSON.stringify({ rel: "raw/회의록/2025", dir: true }), [tg("회의록"), tg("raw/회의록/2025/")]);
check("찾기: 파일 (.md 없이도), raw/ 전체", tg("회의록/2025/1월") === JSON.stringify({ rel: "raw/회의록/2025/1월.md", dir: false }) && tg("raw") === JSON.stringify({ rel: "raw", dir: true }), tg("회의록/2025/1월"));
check("찾기: 이름이나 경로 끝만 (하위 폴더 안에서 하나뿐인 파일·폴더)",
	tg("2월.md") === JSON.stringify({ rel: "raw/회의록/2025/2월.md", dir: false }) && tg("1분기") === JSON.stringify({ rel: "raw/회의록/2025/분기/1분기", dir: true }) && tg("2025/10월") === JSON.stringify({ rel: "raw/회의록/2025/10월.md", dir: false }),
	[tg("2월.md"), tg("1분기"), tg("2025/10월")]);
check("찾기: 같은 이름이 여러 개면 후보 (경로 차례)", tg("1월.md") === JSON.stringify({ many: ["raw/회의록/2025/1월.md", "raw/회의록/2026/1월.md"] }), tg("1월.md"));
check("찾기: 따옴표·역슬래시·전체 경로, 위키 밖·없는 것",
	tg('"회의록\\2026"') === JSON.stringify({ rel: "raw/회의록/2026", dir: true }) && tg(join(fr, "raw", "회의록", "2026")) === JSON.stringify({ rel: "raw/회의록/2026", dir: true }) && tg("../x") === "{}" && tg("없음") === "{}",
	[tg('"회의록\\2026"'), tg(join(fr, "raw", "회의록", "2026"))]);
const src = (title, sources) => `---\ntitle: ${title}\nsummary: ${title} 요약\ntype: source\nsources: [${sources}]\n---\n${title}\n`;
w.applyWrite(fr, "폴더위키", `=== pages/source/1월.md\n${src("1월", "raw/회의록/2025/1월.md")}`, "ingest", "", "2026-10-15");
w.applyWrite(fr, "폴더위키", `=== pages/source/2월.md\n${src("2월", "2월.md")}`, "ingest", "", "2026-10-15");
w.applyWrite(fr, "폴더위키", `=== pages/source/메모.md\n${src("메모", "메모.md")}`, "ingest", "", "2026-10-15");
let fp = w.loadPages(fr);
const refl = w.reflectedRaw(rawAll, fp);
check("반영 여부: 경로로 맞춤 (같은 이름의 다른 폴더 원본은 반영 안 됨)", refl.has("raw/회의록/2025/1월.md") && !refl.has("raw/회의록/2026/1월.md"), [...refl]);
check("반영 여부: 폴더를 빼고 이름만 적은 것은 그 이름이 하나뿐일 때만", refl.has("raw/회의록/2025/2월.md") && !refl.has("raw/가/x/메모.md") && !refl.has("raw/나/x/메모.md"), [...refl]);
const unused = w.lint(fr, "폴더위키").rawUnused;
check("점검: 같은 이름의 다른 폴더 원본은 '반영 안 된 원본'에 남음, 경로 차례", unused.includes("raw/회의록/2026/1월.md") && !unused.includes("raw/회의록/2025/1월.md") && JSON.stringify(unused) === JSON.stringify([...unused].sort(w.pathOrder)), unused);
const st = (x, all = rawAll) => w.sourceTitle(x, all, fp);
check("요약 페이지 이름: 그 원본의 요약 페이지가 있으면 그 이름", st("raw/회의록/2025/1월.md") === "1월" && st("raw/회의록/2025/2월.md") === "2월", [st("raw/회의록/2025/1월.md"), st("raw/회의록/2025/2월.md")]);
check("요약 페이지 이름: 하나뿐이면 파일 이름 (확장자 뺌)", st("raw/회의록/2025/10월.md") === "10월" && st("raw/회의록/2025/분기/1분기/정리.md") === "정리", [st("raw/회의록/2025/10월.md")]);
check("요약 페이지 이름: 같은 이름이 다른 폴더에도 있으면 위 폴더 이름을 붙임", st("raw/회의록/2026/1월.md") === "2026 1월", st("raw/회의록/2026/1월.md"));
check("요약 페이지 이름: 위 폴더 이름까지 같으면 한 단계 더", st("raw/가/x/메모.md") === "가 x 메모" && st("raw/나/x/메모.md") === "나 x 메모", [st("raw/가/x/메모.md"), st("raw/나/x/메모.md")]);
check("요약 페이지 이름: 같은 폴더에 확장자만 다른 원본이 있으면 확장자까지", st("raw/보고서.md") === "보고서.md" && st("raw/보고서.txt") === "보고서.txt", [st("raw/보고서.md"), st("raw/보고서.txt")]);
w.applyWrite(fr, "폴더위키", `=== pages/model/수요 예측 모델.md\n---\ntitle: 수요 예측 모델\nsummary: 모델\ntype: model\n---\n본문\n`, "note", "", "2026-10-15");
put("raw/수요 예측 모델.md");
fp = w.loadPages(fr);
check("요약 페이지 이름: 다른 페이지가 그 이름을 쓰는데 붙일 폴더가 없으면 '… 원본'", st("raw/수요 예측 모델.md", w.rawFilesOf(fr)) === "수요 예측 모델 원본", st("raw/수요 예측 모델.md", w.rawFilesOf(fr)));
let plan = w.planIngest(fr, "raw/회의록", fp, 3, 200000);
check("폴더째 계획: 반영한 것·글이 아닌 것·큰 것은 빼고, 경로 차례로",
	JSON.stringify(plan) === JSON.stringify({
		items: ["raw/회의록/2025/10월.md", "raw/회의록/2025/분기/1분기/정리.md", "raw/회의록/2026/1월.md"], later: [],
		done: ["raw/회의록/2025/1월.md", "raw/회의록/2025/2월.md"], binary: ["raw/회의록/계획.pdf", "raw/회의록/깨진.dat"], big: ["raw/회의록/큰.txt"],
	}), plan);
plan = w.planIngest(fr, "raw/회의록", fp, 2, 200000);
check("폴더째 계획: 한 번에 하는 수를 넘으면 다음에", plan.items.length === 2 && JSON.stringify(plan.later) === JSON.stringify(["raw/회의록/2026/1월.md"]), plan);
check("폴더째 계획: raw/ 전체", w.planIngest(fr, "raw", fp, 100).items.includes("raw/가/x/메모.md") && w.planIngest(fr, "raw", fp, 100).items.includes("raw/회의록/2026/1월.md"));
const ip = w.ingestPrompt("폴더위키", "raw/회의록/2026/1월.md", "2026 1월", { i: 2, n: 5 });
check("반영 부탁: 원본 경로, 요약 페이지 제목과 sources, 폴더, 폴더째면 몇 번째와 묻지 말라는 말",
	ip.includes("raw/회의록/2026/1월.md 을 llm-wiki 스킬의 ingest") && ip.includes("제목을 '2026 1월'") && ip.includes("sources 에 raw/회의록/2026/1월.md") && ip.includes("폴더: 회의록/2026")
	&& ip.includes("2/5 번째") && !w.ingestPrompt("a", "raw/x.md", "x").includes("번째") && !w.ingestPrompt("a", "raw/x.md", "x").includes("폴더:"), ip);

// 작업 방식 배우기: 위키를 쓸 때 함께 받은 '=== 작업 방식' 을 내 지침의 정해진 부분에, '=== 제안' 은 제안 모음에
const sl = w.splitLessons("=== pages/model/A.md\n---\ntitle: A\n---\n본문\n=== 작업 방식\n- 다음부터 노트북 명령 전에 conda 환경을 확인한다\n2) 긴 출력은 tail 로 끝부분만 본다\n\n=== 제안\n- kubeflow-notebook 스킬에 GPU 확인 절차를 더한다\n=== 제안\n두 번째 제안\n");
check("떼어 내기: 페이지는 그대로, 작업 방식은 한 줄씩(목록 표시 뺌), 제안은 부분마다 하나",
	sl.pages.includes("=== pages/model/A.md") && sl.pages.includes("본문") && !sl.pages.includes("작업 방식") && !sl.pages.includes("제안")
	&& JSON.stringify(sl.lessons) === JSON.stringify(["다음부터 노트북 명령 전에 conda 환경을 확인한다", "긴 출력은 tail 로 끝부분만 본다"])
	&& sl.proposals.length === 2 && sl.proposals[0].startsWith("- kubeflow") && sl.proposals[1] === "두 번째 제안", sl);
check("떼어 내기: 작업 방식 부분이 없으면 글 그대로", w.splitLessons("=== pages/a/B.md\nx\n").pages === "=== pages/a/B.md\nx\n" && !w.splitLessons("x").lessons.length);
check("모드: write -> auto, ask -> propose, search·off -> off, 설정의 lessons 가 먼저",
	w.lessonMode({ auto: "write" }) === "auto" && w.lessonMode({ auto: "ask" }) === "propose" && w.lessonMode({ auto: "search" }) === "off"
	&& w.lessonMode({ auto: "off" }) === "off" && w.lessonMode({ auto: "write", lessons: "propose" }) === "propose" && w.lessonMode({ auto: "write", lessons: "off" }) === "off");
const gl = w.guideLines("모델운영", root, "write", "모델 운영", "auto");
check("지침: 작업 방식 줄 (auto 면 '자동으로', propose 면 '제안으로', off 면 없음), 매번 같은 글",
	gl.length === 4 && gl[3].includes("'=== 작업 방식'") && gl[3].includes("자동으로") && gl[3].includes("'=== 제안'")
	&& w.guideLines("a", root, "ask", "t", "propose")[3].includes("제안으로 모임") && w.guideLines("a", root, "write", "t", "off").length === 3
	&& JSON.stringify(gl) === JSON.stringify(w.guideLines("모델운영", root, "write", "모델 운영", "auto")), gl);
let lr0 = w.putLessons("# 내 지침\n- 한국어로 답한다\n", ["다음부터 노트북 명령 전에 conda 환경을 확인한다"], "2026-10-20");
check("작업 방식: 없으면 지침 끝에 표시 부분을 만들고, 날짜 표시를 붙임 (원래 글은 그대로)",
	lr0.changed && lr0.text.startsWith("# 내 지침\n- 한국어로 답한다\n\n<!-- kit lessons -->\n## 작업 방식") && lr0.text.includes("- 다음부터 노트북 명령 전에 conda 환경을 확인한다 (2026-10-20)\n<!-- /kit lessons -->")
	&& JSON.stringify(lr0.added) === JSON.stringify(["다음부터 노트북 명령 전에 conda 환경을 확인한다"]), lr0.text);
let lr1 = w.putLessons(lr0.text.replace("conda 환경을 확인한다 (2026-10-20)", "conda 환경을 확인한다 (2026-10-20)\n- 사람이 직접 쓴 줄"), ["다음부터 노트북 명령 전에 conda 환경을 확인한다.", "사람이 직접 쓴 줄", "새 줄: 큰 파일은 head 로 먼저 본다"], "2026-10-21");
check("같은 줄은 횟수·날짜만 올림, 날짜 표시가 없는 줄(사람이 쓴 줄)은 그대로, 새 줄은 더함",
	lr1.text.includes("conda 환경을 확인한다 (2026-10-21, 2번)") && lr1.text.includes("\n- 사람이 직접 쓴 줄\n") && lr1.text.includes("- 새 줄: 큰 파일은 head 로 먼저 본다 (2026-10-21)")
	&& lr1.bumped.length === 2 && lr1.added.length === 1 && w.lessonLines(lr1.text).length === 3, lr1);
check("작업 방식: 이메일·전화번호·비밀·[이메일N] 이 든 줄은 남기지 않음, 한 번에 3줄까지",
	JSON.stringify(w.putLessons("", ["작성자는 hong.gd@example.com 로 적는다", "연락은 010-1234-5678", "token: abc", "[이메일1] 을 쓴다", "a 한다", "b 한다", "c 한다", "d 한다"], "2026-10-20").rejected) === JSON.stringify(["작성자는 hong.gd@example.com 로 적는다", "연락은 010-1234-5678", "token: abc"])
	&& w.putLessons("", ["a 한다", "b 한다", "c 한다", "d 한다"], "2026-10-20").skipped.length === 1 && w.secretish("[이메일2]") && !w.secretish("2026-10-20 에 배포"));
let full = "";
for (let i = 0; i < 12; i++) full = w.putLessons(full, [`규칙 ${i} 번: 이런 경우에는 이렇게 한다`], `2026-10-${String(i + 1).padStart(2, "0")}`).text;
full = w.putLessons(full, ["규칙 5 번: 이런 경우에는 이렇게 한다"], "2026-10-20").text;
const lrFull = w.putLessons(full, ["새 규칙: 마지막에 더한 줄"], "2026-10-21");
check(`한도(${w.LESSON_MAX_LINES}줄): 덜 쓰이고 오래된 줄부터 빼고(2번 쓰인 줄은 남음), 방금 더한 줄은 남김`,
	w.lessonLines(lrFull.text).length === w.LESSON_MAX_LINES && lrFull.full && lrFull.text.includes("새 규칙: 마지막에 더한 줄") && lrFull.text.includes("규칙 5 번")
	&& !lrFull.text.includes("규칙 0 번") && !lrFull.text.includes("규칙 2 번") && lrFull.text.includes("규칙 3 번")
	&& JSON.stringify(lrFull.dropped) === JSON.stringify(["규칙 2 번: 이런 경우에는 이렇게 한다"]), [w.lessonLines(lrFull.text), lrFull.dropped]);
check(`한도(${w.LESSON_MAX_CHARS}자): 긴 줄은 ${200}자로 줄이고 글자 수가 넘으면 뺌`,
	w.putLessons("", ["가".repeat(300)], "2026-10-20").added[0].length === 200
	&& w.lessonLines(w.putLessons(w.putLessons(w.putLessons("", ["가".repeat(300)], "2026-10-01").text, ["나".repeat(300)], "2026-10-02").text, ["다".repeat(300)], "2026-10-03").text).join("\n").length <= w.LESSON_MAX_CHARS + 10);

// 지침 파일에 적기·되돌리기 (임시 폴더)
const ad = join(tmp, "agent");
mkdirSync(ad, { recursive: true });
const af = join(ad, "AGENTS.md");
const ld = join(ad, "lessons");
writeFileSync(af, "# 내 지침\n- 한국어로 답한다\n");
let sv = w.saveLessons(["다음부터 노트북 명령 전에 conda 환경을 확인한다"], "2026-10-20", af, ld, new Date(2026, 9, 20, 14, 3, 5));
check("지침에 적기: 고치기 전 내용은 lessons/AGENTS.md.<때>, 되돌리기 기록 last.json",
	sv.changed && read(af).includes("<!-- kit lessons -->") && read(join(ld, "AGENTS.md.20261020-140305")) === "# 내 지침\n- 한국어로 답한다\n" && existsSync(join(ld, "last.json")), sv);
let un = w.undoLessons(af, ld);
check("되돌리기: 마지막 자동 고침 전으로", un.ok && read(af) === "# 내 지침\n- 한국어로 답한다\n" && !existsSync(join(ld, "last.json")), un);
w.saveLessons(["다음부터 노트북 명령 전에 conda 환경을 확인한다"], "2026-10-20", af, ld, new Date(2026, 9, 20, 14, 4, 0));
writeFileSync(af, read(af) + "- 그 뒤에 사람이 더한 줄\n");
un = w.undoLessons(af, ld);
check("되돌리기: 그 뒤에 지침이 바뀌었으면 덮어쓰지 않고 백업 위치를 알림", !un.ok && un.message.includes("바뀌어") && read(af).includes("그 뒤에 사람이 더한 줄"), un);
writeFileSync(af, Buffer.from([0x23, 0x20, 0xb3, 0xbb, 0x20, 0xc1, 0xf6, 0xc4, 0xa7, 0x0a])); // ANSI(EUC-KR) 로 저장한 지침
sv = w.saveLessons(["새 줄을 더한다"], "2026-10-20", af, ld);
check("지침 파일이 UTF-8 이 아니면 고치지 않음 (한글이 깨지지 않게)", !!sv.error && !sv.changed && read(af) !== "" && readFileSync(af).equals(Buffer.from([0x23, 0x20, 0xb3, 0xbb, 0x20, 0xc1, 0xf6, 0xc4, 0xa7, 0x0a])), sv);
rmSync(af);
sv = w.saveLessons(["지침 파일이 없으면 새로 만든다"], "2026-10-20", af, ld, new Date(2026, 9, 20, 15, 0, 0));
check("지침 파일이 없으면 만들고, 되돌리면 지움", sv.changed && read(af).startsWith("<!-- kit lessons -->") && w.undoLessons(af, ld).ok && !existsSync(af));
const sp1 = w.saveProposals(["- kubeflow-notebook 스킬에 GPU 확인 절차를 더한다", "담당자 메일 kim@corp.example.org 로 보낸다"], "모델운영", new Date(2026, 9, 20, 15, 1), ld);
check("제안 모으기: lessons/proposals.md, 개인정보로 보이는 것은 뺌", sp1.saved === 1 && sp1.rejected === 1 && w.proposalCount(ld) === 1
	&& read(join(ld, "proposals.md")).includes("## 2026-10-20 15:01 · 위키 '모델운영'") && !read(join(ld, "proposals.md")).includes("kim@"), read(join(ld, "proposals.md")));

// 확장: wiki_write 한 번에 페이지 + 작업 방식 (도구를 따로 부르지 않음: Copilot·사내AI 질문 1번)
const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
const ead = join(tmp, "ext-agent");
mkdirSync(ead, { recursive: true });
process.env.PI_CODING_AGENT_DIR = ead;
const lw = join(tmp, "배움위키");
w.initWiki(lw, "배움위키", "2026-10-20");
const setCfg = (extra = {}) => w.writeConfig({ wikis: { 배움위키: lw }, active: "배움위키", auto: "write", ...extra });
setCfg();
const tools = {};
const notes = [];
const cmds = {};
w.default({ registerTool: (t) => (tools[t.name] = t), registerCommand: (n, c) => (cmds[n] = c), on: () => {}, getActiveTools: () => [], setActiveTools: () => {}, sendUserMessage: () => {} });
const uiCtx = { hasUI: true, ui: { notify: (m, l) => notes.push([m, l]) } };
const call = (text, op = "note") => tools.wiki_write.execute("t1", { text, op }, undefined, undefined, uiCtx);
check("wiki_write 설명: 작업 방식·제안 부분 안내 (작업 방식이 켜져 있을 때)", tools.wiki_write.description.includes("'=== 작업 방식'"));
let res = await call(`=== pages/concept/학습 재시작.md\n${page("학습 재시작", "concept", "체크포인트에서 다시 시작")}=== 작업 방식\n- 다음부터 학습을 다시 시작하기 전에 체크포인트 경로를 먼저 확인한다\n`);
let txt = res.content[0].text;
check("페이지 + 작업 방식: 페이지를 쓰고 내 지침에 한 줄, 알림", txt.includes("썼습니다 1쪽") && txt.includes("내 지침에 1줄 더함")
	&& read(join(ead, "AGENTS.md")).includes("체크포인트 경로를 먼저 확인한다 (") && notes.length === 1 && notes[0][0].includes("/wiki lessons undo"), [txt, notes]);
res = await call("=== 작업 방식\n- 다음부터 긴 로그는 끝부분만 본다\n");
txt = res.content[0].text;
check("작업 방식만 (페이지 없이): 오류가 아니고 지침에 더함, 위키 기록은 그대로", !txt.includes("쓴 페이지 없음") && txt.includes("1줄 더함") && w.readLessons(join(ead, "AGENTS.md")).length === 2
	&& !read(join(lw, "log.md")).includes("긴 로그"), txt);
res = await call(`=== pages/source/회의록.md\n${page("회의록", "source", "요약", "sources: [raw/회의록.md]\n")}=== 작업 방식\n- 원본 반영 중의 줄\n`, "ingest");
check("원본 반영(ingest) 중에는 작업 방식을 남기지 않음", res.content[0].text.includes("원본 반영(ingest) 중에는") && !read(join(ead, "AGENTS.md")).includes("원본 반영 중의 줄"), res.content[0].text);
let thrown = "";
try {
	await call("=== pages/x.md\n제목 없음\n=== 작업 방식\n- 페이지가 틀린 때의 줄\n");
} catch (e) {
	thrown = e.message;
}
check("페이지가 틀리면 오류 (작업 방식은 남기고 그 결과도 알림)", thrown.includes("오류:") && thrown.includes("1줄 더함"), thrown);
setCfg({ auto: "ask" });
res = await call("=== 작업 방식\n- 제안 모드의 줄\n=== 제안\n- data-analysis 스킬에 그림 확인 순서를 더한다\n");
check("propose(auto=ask): 지침은 그대로, 작업 방식과 제안은 제안 모음에", !read(join(ead, "AGENTS.md")).includes("제안 모드의 줄") && w.proposalCount(join(ead, "lessons")) === 2
	&& read(join(ead, "lessons/proposals.md")).includes("- 제안 모드의 줄"), res.content[0].text);
setCfg({ lessons: "off" });
res = await call("=== pages/concept/끈 설정.md\n" + page("끈 설정", "concept", "x") + "=== 작업 방식\n- 꺼진 때의 줄\n");
check("lessons: off 면 남기지 않고 알림", res.content[0].text.includes("꺼져 있어") && !read(join(ead, "AGENTS.md")).includes("꺼진 때의 줄"), res.content[0].text);
// /wiki lessons on·propose·off: pi 안에서 바꾸기 (wiki.json 의 lessons)
const cmdNotes = [];
const cmdCtx = { hasUI: true, ui: { notify: (m, l) => cmdNotes.push([m, l]), setWidget: () => {}, setStatus: () => {}, confirm: async () => true, theme: { fg: (_c, s) => s } } };
const lessonsCmd = async (a) => {
	cmdNotes.length = 0;
	await cmds.wiki.handler(`lessons ${a}`, cmdCtx);
	return cmdNotes.map((n) => n[0]).join("\n");
};
let said = await lessonsCmd("on");
check("/wiki lessons on: 켜짐(auto)으로 저장하고 알림", w.readConfig().lessons === "auto" && said.includes("켜짐") && said.includes("다음 요청부터"), [w.readConfig(), said]);
said = await lessonsCmd("propose");
check("/wiki lessons propose: 제안만", w.readConfig().lessons === "propose" && said.includes("제안만"), [w.readConfig(), said]);
said = await lessonsCmd("off");
check("/wiki lessons off: 꺼짐, 다른 설정(위키·auto)은 그대로", w.readConfig().lessons === "off" && said.includes("꺼짐") && w.readConfig().active === "배움위키" && w.readConfig().wikis.배움위키 === lw, [w.readConfig(), said]);
said = await lessonsCmd("off");
check("/wiki lessons off 를 다시: 이미 꺼짐", said.includes("이미 꺼짐"), said);
said = await lessonsCmd("아무거나");
check("/wiki lessons 모르는 말: 사용법, 설정은 그대로", said.includes("사용법") && w.readConfig().lessons === "off", said);
check("말: on·auto·켜기 -> auto, propose·제안, off·끄기", w.LESSON_WORDS.on === "auto" && w.LESSON_WORDS["켜기"] === "auto" && w.LESSON_WORDS["제안"] === "propose" && w.LESSON_WORDS["끄기"] === "off");
if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
else process.env.PI_CODING_AGENT_DIR = oldAgentDir;

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
