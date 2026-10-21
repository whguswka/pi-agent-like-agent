// 문서 찾기 (profiles/common/agent-template/extensions/kit.ts 의 docs_lookup·/docs) 시험:
// 결과 읽기·글 만들기·문서 폴더 찾기, Python 고르기, 실제 Python 으로 표준 라이브러리(json, inspect) 찾기
// 사용법: node tests/test_docs.mjs   (실제 Python: PI_TEST_PYTHON, 없으면 PATH 에서 돌아가는 python3·python. 없으면 그 부분은 건너뜀)
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";

const jiti = createJiti(import.meta.url, { alias: { typebox: fileURLToPath(new URL("../runtime/node_modules/typebox/build/index.mjs", import.meta.url)) } });
const kit = await jiti.import("../profiles/common/agent-template/extensions/kit.ts");
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : `  -> ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 900)}`));
	if (!cond) fails++;
};
const tmp = mkdtempSync(join(tmpdir(), "docs-test-"));

// 결과 읽기: 패키지가 섞어 쓴 글은 빼고 마지막 '@@DOCS@@' 줄
check("결과 읽기: 앞뒤의 다른 글은 빼고, 없거나 깨졌으면 null",
	kit.parseDocs('경고: 무엇\n@@DOCS@@{"name":"x","path":"x"}\n끝')?.path === "x" && kit.parseDocs("아무것도 없음") === null && kit.parseDocs("@@DOCS@@{깨짐") === null);
check("문서 폴더에서 찾을 말: 이름의 끝 두 마디와 찾을 말 (소문자, 두 글자부터, 같은 말은 한 번)",
	JSON.stringify(kit.docWords("torch.utils.tensorboard.SummaryWriter.add_scalar", "Smoothing x add_scalar")) === JSON.stringify(["summarywriter", "add_scalar", "smoothing"]));
const cw = kit.pythonCandidates("C:/w/proj", { PI_PYTHON_EXE: "C:/py/python.exe", CONDA_PREFIX: "C:/conda/envs/tb" }, true).map((c) => c.join(" ").split("\\").join("/"));
check("Python 고르기(Windows): 작업 폴더의 .venv·venv, conda, pi 가 찾은 Python, python3, python, py -3 차례",
	cw[0] === "C:/w/proj/.venv/Scripts/python.exe" && cw.indexOf("C:/conda/envs/tb/Scripts/python.exe") > cw.indexOf("C:/w/proj/venv/python.exe") && cw.indexOf("C:/py/python.exe") > cw.indexOf("C:/conda/envs/tb/python.exe")
	&& JSON.stringify(cw.slice(-3)) === JSON.stringify(["python3", "python", "py -3"]), cw);
const cl = kit.pythonCandidates("/home/j/proj", {}, false).map((c) => c.join(" ").split("\\").join("/"));
check("Python 고르기(Linux): bin/python3, py 런처 없음", cl[0] === "/home/j/proj/.venv/bin/python3" && cl.at(-1) === "python" && !cl.includes("py -3"), cl);
const nb = kit.notebookDocsCommand("torch.utils'; rm -rf ~", "a b");
check("노트북 명령: 찾을 이름은 따옴표로 감싼 인자로만 (스크립트에 끼워 넣지 않음), 돌아가는 Python 을 골라 40초 안에",
	nb.includes(`- 'torch.utils'\\''; rm -rf ~' 'a b' <<'PIDOCSEOF'`) && nb.includes("timeout 40") && nb.trimEnd().endsWith("PIDOCSEOF") && nb.includes("-c 'import sys'")
	&& !kit.DOCS_PY.includes("PIDOCSEOF"), nb.split("\n").slice(0, 6).join("\n"));

// 문서 폴더: .md·.txt·.html (태그 뺌), CP949 도, 맞는 말이 많은 줄부터 파일마다
const dd = join(tmp, "pi-docs");
mkdirSync(join(dd, "tb", ".숨김"), { recursive: true });
writeFileSync(join(dd, "tb", "scalars.md"), "# 스칼라\n\n아무 줄\nSummaryWriter.add_scalar(tag, value, step) 로 남긴다\nsmoothing 은 화면의 슬라이더\n다른 줄\n");
writeFileSync(join(dd, "tb", "page.html"), "<html><head><style>.x{}</style></head><body><p>add_scalar &amp; smoothing 예시</p><script>var add_scalar=1</script></body></html>");
writeFileSync(join(dd, "tb", "ansi.txt"), Buffer.from([0xbd, 0xba, 0xc4, 0xae, 0xb6, 0xf3, 0x20, 0x61, 0x64, 0x64, 0x5f, 0x73, 0x63, 0x61, 0x6c, 0x61, 0x72])); // "스칼라 add_scalar" (CP949)
writeFileSync(join(dd, "tb", ".숨김", "x.md"), "add_scalar 숨김");
writeFileSync(join(dd, "그림.png"), "add_scalar");
const sd = kit.searchDocs(dd, ["add_scalar", "smoothing"]);
check("문서 폴더: 두 말이 다 맞는 줄부터, 앞뒤 한 줄, html 은 태그를 빼고, CP949 도 읽음, 숨김·그림은 뺌",
	sd.files === 3 && sd.text.indexOf("page.html") < sd.text.indexOf("scalars.md") && sd.text.includes("add_scalar & smoothing 예시") && !sd.text.includes("var add_scalar")
	&& sd.text.includes("4: SummaryWriter.add_scalar(tag, value, step) 로 남긴다") && sd.text.includes("5: smoothing 은") && sd.text.includes("3: 아무 줄") && sd.text.includes("스칼라 add_scalar") && !sd.text.includes("숨김"), sd);
check("문서 폴더: 찾을 말이 없거나 폴더가 없으면 빈 글", kit.searchDocs(dd, []).text === "" && kit.searchDocs(join(tmp, "없는 폴더"), ["x"]).files === 0);

// 글 만들기: 머리·시그니처 -> 설명 -> 맞는 하위 이름 -> 문서 폴더 -> 그 밖의 이름, 한도 안
const info = {
	name: "torch.utils.tensorboard.SummaryWriter", python: "3.11.9", exe: "/opt/conda/bin/python", path: "torch.utils.tensorboard.SummaryWriter", kind: "class", dist: "torch", version: "2.4.1",
	file: "/opt/conda/lib/python3.11/site-packages/torch/utils/tensorboard/writer.py", signature: "(log_dir=None, comment='')", doc: Array.from({ length: 200 }, (_, i) => `설명 ${i + 1}번째 줄`).join("\n"),
	count: 60, names: Array.from({ length: 60 }, (_, i) => `add_thing_${i}`), matched: true,
	members: [{ name: "add_scalar", kind: "function", sig: "(tag, scalar_value, global_step=None)", doc: "Add scalar data to summary." }],
};
const fd = kit.formatDocs(info, "scalar", { text: "=== tb/scalars.md\n4: add_scalar", files: 1, dir: dd });
check("글: 머리(종류·버전·Python), 파일, 시그니처, 설명(길면 줄임), 맞는 하위 이름, 문서 폴더, 그 밖의 이름, 더 보기 — 5500자 안",
	fd.startsWith("=== torch.utils.tensorboard.SummaryWriter (클래스) · torch 2.4.1 · Python 3.11.9 (/opt/conda/bin/python)") && fd.includes("시그니처: SummaryWriter(log_dir=None, comment='')")
	&& fd.includes("(… 설명") && fd.includes("'scalar' 에 맞는 하위 이름 1개 (모두 60개):\n- add_scalar(tag, scalar_value, global_step=None) — Add scalar data to summary.")
	&& fd.indexOf("문서 폴더(") > fd.indexOf("add_scalar(") && fd.includes("그 밖의 이름: add_thing_0") && fd.includes('더 보기: docs_lookup name="torch.utils.tensorboard.SummaryWriter.<이름>"') && fd.length <= kit.DOCS_MAX, fd);
const big = kit.formatDocs({ ...info, doc: "x".repeat(20000), members: Array.from({ length: 40 }, (_, i) => ({ name: `m${i}`, kind: "function", sig: `(${"a, ".repeat(70)})`, doc: "y".repeat(190) })) }, "m", { text: "z".repeat(3000), files: 9, dir: dd });
check("글: 무엇이 길어도 5500자 안, 시그니처는 남음", big.length <= kit.DOCS_MAX && big.includes("시그니처:"), big.length);
const fe = kit.formatDocs({ name: "tensorbord", error: "No module named 'tensorbord'", close: ["tensorboard"], python: "3.12.9" }, "", { text: "", files: 0, dir: dd });
check("글(찾지 못함): 까닭, 비슷한 이름, 설치 이름과 불러오는 이름이 다를 수 있다는 말", fe.includes("tensorbord: 찾지 못함") && fe.includes("비슷한 이름: tensorboard") && fe.includes("scikit-learn → sklearn"), fe);

// 실제 Python 으로 (PI_TEST_PYTHON 이나 PATH 에서 돌아가는 것)
const runs = (c) => spawnSync(c, ["-c", "import sys"], { windowsHide: true }).status === 0;
const real = [process.env.PI_TEST_PYTHON, "python3", "python"].find((c) => c && runs(c));
if (!real) console.log("건너뜀: 돌아가는 Python 이 없음 (PI_TEST_PYTHON 에 python 경로)");
else {
	delete process.env.VIRTUAL_ENV;
	delete process.env.CONDA_PREFIX;
	process.env.PI_PYTHON_EXE = real;
	process.env.PI_DOCS_DIR = dd;
	const proj = join(tmp, "proj");
	mkdirSync(proj);
	globalThis.__piWorkDir = { remote: false, cwd: proj };
	let t = await kit.lookupDocs("json.dumps", "");
	check("실제 Python: 함수의 시그니처·설명·파일·Python 버전", /^=== json\.dumps \(함수\) · Python 3\.\d+/.test(t) && t.includes("시그니처: dumps(obj, *, skipkeys=False") && t.includes("설명:\nSerialize") && /파일: .*json/.test(t), t.slice(0, 600));
	t = await kit.lookupDocs("json", "decode");
	check("실제 Python: 모듈의 하위 이름을 찾을 말로 (이름에 맞는 것), 하위 모듈", t.includes("'decode' 에 맞는 하위 이름") && t.includes("- JSONDecodeError") && t.includes("하위 모듈: decoder"), t.slice(0, 1500));
	t = await kit.lookupDocs("inspect.Signature.bind", "");
	check("실제 Python: 클래스 안의 이름까지", t.startsWith("=== inspect.Signature.bind (함수)") && t.includes("시그니처: bind("), t.slice(0, 400));
	t = await kit.lookupDocs("json.nope", "");
	check("실제 Python: 없는 이름은 그 위까지 찾고 알림", t.includes("'nope' 는 json 에 없습니다") && t.includes("하위 이름"), t.slice(0, 400));
	t = await kit.lookupDocs("jsno", "");
	check("실제 Python: 없는 모듈은 비슷한 이름", t.includes("jsno: 찾지 못함") && t.includes("비슷한 이름: json"), t.slice(0, 400));
	t = await kit.lookupDocs("os.path.join", "add_scalar");
	check("실제 Python + 문서 폴더: 찾을 말이 맞는 문서 줄도 함께", t.includes("문서 폴더(") && t.includes("scalars.md"), t.slice(-700));
	// 작업 폴더의 .venv 가 먼저 (가상 환경을 켜지 않고 pi 를 켜도 그 프로젝트의 패키지로)
	const vproj = join(tmp, "vproj");
	const r = spawnSync(real, ["-m", "venv", "--without-pip", join(vproj, ".venv")], { windowsHide: true });
	if (r.status !== 0) console.log("건너뜀: venv 를 만들지 못함", String(r.stderr).slice(0, 200));
	else {
		globalThis.__piWorkDir = { remote: false, cwd: vproj };
		t = await kit.lookupDocs("json", "");
		check("작업 폴더의 .venv Python 을 먼저 씀", t.split("\n")[0].replace(/\\/g, "/").includes(`${vproj.replace(/\\/g, "/")}/.venv/`), t.split("\n")[0]);
	}
	// 돌아가는 Python 이 없으면 (Windows 스토어 바로가기만 있으면 실패하므로 돌려 보고 고름)
	process.env.PI_PYTHON_EXE = join(tmp, "없는", "python.exe");
	const none = join(tmp, "none");
	mkdirSync(none);
	globalThis.__piWorkDir = { remote: false, cwd: none };
	if (!["python3", "python", "py"].some(runs)) {
		t = await kit.lookupDocs("json", "");
		check("돌아가는 Python 이 없으면 그렇다고 (스토어 바로가기는 고르지 않음)", t.includes("Python 을 찾지 못함"), t);
	} else console.log("건너뜀: PATH 에 돌아가는 Python 이 있어 '없을 때' 는 보지 않음");
}

rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `RESULT: FAIL (${fails})` : "RESULT: PASS");
process.exit(fails ? 1 : 0);
