// 기억하기(profiles/common/agent-template/extensions/memory.ts) 단위 테스트: 지침 파일에 "## 기억할 것" 항목 더하기,
// 작업 기록 (요청마다 남기고 새 세션에 지침으로 알리기, /handoff, /recall), 개인정보 빼기 (lib/relay.ts)
// 사용법: node tests/test_memory.mjs   (Node 20.15 이상. 저장소의 runtime/node_modules/jiti 로 .ts 를 불러옴)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";

const jiti = createJiti(import.meta.url);
const m = await jiti.import("../profiles/common/agent-template/extensions/memory.ts");
const lib = await jiti.import("../profiles/common/agent-template/extensions/lib/relay.ts");
const { addMemory } = m;
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(detail).slice(0, 800)));
	if (!cond) fails++;
};

let s = addMemory("", "커밋 메시지는 한국어로");
check("빈 파일 -> 제목과 항목", s === "## 기억할 것\n- 커밋 메시지는 한국어로\n", s);
s = addMemory("# 프로젝트\n\n규칙 A\n", "B");
check("제목이 없으면 끝에 새로 (기존 내용 그대로)", s === "# 프로젝트\n\n규칙 A\n\n## 기억할 것\n- B\n", s);
s = addMemory("# 프로젝트\n\n## 기억할 것\n- A\n", "B");
check("이미 있는 부분 끝에 더함", s === "# 프로젝트\n\n## 기억할 것\n- A\n- B\n", s);
s = addMemory("## 기억할 것\n- A\n\n## 다른 부분\n내용\n", "B");
check("뒤에 다른 부분이 있으면 그 앞(빈 줄 앞)에", s === "## 기억할 것\n- A\n- B\n\n## 다른 부분\n내용\n", s);
check("같은 항목이 있으면 null", addMemory("## 기억할 것\n- A\n", "A") === null);
s = addMemory("# 제목\r\n\r\n## 기억할 것\r\n- A\r\n", "B");
check("CRLF 파일은 CRLF 그대로", s === "# 제목\r\n\r\n## 기억할 것\r\n- A\r\n- B\r\n", s);
s = addMemory("## 기억할 것\n### 세부\n- A\n", "B");
check("### 세부 제목은 같은 부분으로 봄", s === "## 기억할 것\n### 세부\n- A\n- B\n", s);
s = addMemory("규칙\n\n\n", "B");
check("끝의 빈 줄은 정리", s === "규칙\n\n## 기억할 것\n- B\n", s);
s = addMemory("## 기억할 것\n- A\n<!-- kit lessons -->\n## 작업 방식\n- x (2026-10-20)\n<!-- /kit lessons -->\n", "B");
check("키트가 고치는 부분(<!-- kit ... -->) 안에는 넣지 않음 (그 앞에)", s === "## 기억할 것\n- A\n- B\n<!-- kit lessons -->\n## 작업 방식\n- x (2026-10-20)\n<!-- /kit lessons -->\n", s);
s = addMemory("## 기억할 것\n- A\n\n<!-- kit env: pc -->\n## 실행 환경: PC\n<!-- /kit env: pc -->\n", "B");
check("실행 환경 부분(<!-- kit env -->) 앞, 빈 줄 앞에", s === "## 기억할 것\n- A\n- B\n\n<!-- kit env: pc -->\n## 실행 환경: PC\n<!-- /kit env: pc -->\n", s);

// 개인정보·비밀로 보이는 글 (lib/relay.ts): 중계 서버의 감추기와 같은 꼴
check("빼기: 이메일·전화번호·계좌번호 모양 번호·[이메일N] 은 '…', 날짜·버전·짧은 번호는 그대로",
	lib.scrubText("hong.gd@example.com 에게 010-1234-5678 로, 계좌 110-123-456789, [이메일1]") === "… 에게 … 로, 계좌 …, …"
	&& lib.scrubText("logs/run_20261021_143055/events 는 2026-10-21 의 v2026-10-20.2 버전, 20261021 실행") === "logs/run_…/events 는 2026-10-21 의 v2026-10-20.2 버전, 20261021 실행"
	&& lib.scrubText("카드 1234-5678-9012-3456 끝") === "카드 … 끝", [lib.scrubText("logs/run_20261021_143055/events 는 2026-10-21 의 v2026-10-20.2 버전, 20261021 실행")]);
check("빼기: 너무 긴 숫자는 끝의 _ 묶음을 떼어 봄 (중계 서버와 같게), 비밀로 보이면 통째로 뺌",
	lib.scrubText("backup_20260727_075536_123.tar") === "backup_…_123.tar" && lib.scrubText("token: abc123") === "" && lib.scrubText("password=1") === "",
	[lib.scrubText("backup_20260727_075536_123.tar")]);
check("비밀로 보이는지: 이메일·번호·[번호N]·비밀번호 말은 예, 날짜·버전·폴더 이름은 아니오",
	lib.secretish("a@b.co") && lib.secretish("[번호3]") && lib.secretish("110-123-456789") && lib.secretish("api_key = x")
	&& !lib.secretish("20260930 에 배포한 2026-10-20.1 버전") && !lib.secretish("pi-reorganization-20261002 폴더"));

// 작업 기록: 프로젝트, 한 줄, 새 세션에 알릴 글
const pa = m.projectOf({ remote: false, cwd: "C:\\Work\\TB Tools\\" });
const pb = m.projectOf({ remote: false, cwd: "c:/work/tb tools" });
check("프로젝트: Windows PC 폴더는 대소문자·\\ 를 가리지 않음, 이름은 폴더 끝 둘",
	process.platform !== "win32" || (pa.key === pb.key && /^work-tb_tools-[0-9a-f]{8}$/.test(pa.key) && pa.label === "C:/Work/TB Tools"), pa);
check("프로젝트: 노트북 폴더는 따로, 아직 연결되지 않았으면(/) 없음",
	m.projectOf({ remote: true, cwd: "/home/jovyan/tb" }).label === "노트북 /home/jovyan/tb" && m.projectOf({ remote: true, cwd: "/" }) === null
	&& m.projectOf({ remote: true, cwd: "/home/jovyan/tb" }).key !== m.projectOf({ remote: false, cwd: "/home/jovyan/tb" }).key);
check("기록하는 명령: 보기만 하는 명령은 빼고, 앞의 cd 는 뗌",
	m.doing("cd src && python train.py --epochs 1") === "python train.py --epochs 1" && m.doing("ls -la") === "" && m.doing("git status") === ""
	&& m.doing("git commit -m x") === "git commit -m x" && m.doing("tensorboard --logdir runs\nsleep 1") === "tensorboard --logdir runs");
const now = new Date(2026, 9, 21, 9, 0);
const recs = [
	{ t: "2026-08-01 10:00", req: "아주 오래된 요청" },
	{ t: "2026-10-20 10:00", req: "텐서보드 로그 폴더 정리", files: ["runs/README.md"], ans: "runs/ 아래를 날짜별로 나눴습니다" },
	{ t: "2026-10-20 17:40", handoff: "목표: 학습 손실을 텐서보드로 본다 / 남은 일: 검증 손실 추가" },
	{ t: "2026-10-20 18:00", req: "검증 손실도 남겨 줘", files: ["train.py", "utils/tb.py"], cmds: ["python train.py --epochs 1"], end: "aborted" },
];
const dg = m.digestOf(recs, "~/tb", now);
check("알릴 글: 30일 넘은 기록은 빼고, 마지막 요약, 최근 요청은 오래된 것부터 (바꾼 파일·명령·멈춤·답)",
	dg.startsWith("이 프로젝트(~/tb)에서 지난 세션들에 한 일입니다") && !dg.includes("아주 오래된") && dg.includes("넘겨받은 요약 (10-20 17:40):\n목표: 학습 손실")
	&& dg.indexOf("텐서보드 로그 폴더 정리") < dg.indexOf("검증 손실도") && dg.includes("→ 바꾼 파일 train.py, utils/tb.py · 명령 python train.py --epochs 1 · Esc 로 멈춤"), dg);
const many = Array.from({ length: 30 }, (_, i) => ({ t: `2026-10-20 ${String(i % 24).padStart(2, "0")}:00`, req: `요청 ${i} ${"가".repeat(60)}`, ans: "나".repeat(100), files: [`f${i}.py`] }));
const dm = m.digestOf(many, "~/tb", now);
check(`알릴 글: ${m.DIGEST_MAX}자·요청 ${m.DIGEST_ITEMS}개 안 (가장 최근 것들), 알릴 것이 없으면 빈 글`,
	dm.length <= m.DIGEST_MAX && dm.includes("요청 29") && !dm.includes("요청 20 ") && (dm.match(/^- /gm) || []).length <= m.DIGEST_ITEMS && m.digestOf([], "x", now) === "" && m.digestOf(recs.slice(0, 1), "x", now) === "", [dm.length, dm]);
// 넘겨받은 요약은 줄 단위로 줄이고 '정한 것' 줄은 남긴다. 실사용 시험(2026-10-21)의 세션 1 요약 그대로:
//  예전에는 500자에서 잘라 맨 끝의 정한 것(GPU 는 최대)이 빠졌고, 세션 4 가 묻지 않고 합계로 바꿈
const H1 = [
	"목표: Windows 11 ARM64에서 관리자 권한·추가 설치 없이 작업 표시줄 우측에 겹쳐 보이는 리소스 모니터(EXE) 만들기.",
	"한 일: C# WinForms 기반 `resmon.exe` 구현, CPU/RAM/GPU/네트워크 속도·누적량 표시, 1초 갱신, TopMost·Borderless 오버레이 구현.",
	"한 일: .NET Framework ARM64 `csc.exe`로 빌드 가능하도록 `build.ps1` 작성 및 빌드 성공 확인.",
	"바꾼 파일: `resmon.cs`",
	"바꾼 파일: `build.ps1`",
	"생성 파일: `resmon.exe` (빌드 성공, 실행 시작 확인)",
	"남은 일: 실제 화면에서 위치가 알림 영역 옆에 정확히 오는지 확인 후 좌표 계산 보정.",
	"남은 일: GPU 사용률이 작업 관리자와 비슷하게 나오는지 실제 부하를 걸어 검증.",
	"남은 일: 작업 표시줄 자동 숨김, 다중 모니터, DPI 스케일링 환경 테스트.",
	"주의: .NET Framework csc는 C# 5까지만 지원해 문자열 보간($\"\")·튜플 반환을 제거하고 `string.Format`, `NetworkResult` 클래스로 변경함.",
	"주의: `Get-Command csc.exe`는 실패했고 `C:\\Windows\\Microsoft.NET\\FrameworkArm64\\v4.0.30319\\csc.exe` 경로를 직접 사용하도록 수정함.",
	"정한 것: GPU는 여러 GPU Engine 중 최대 사용률 표시, 누적 전송량은 프로그램 시작 이후 업로드/다운로드를 각각 누적 표시.",
].join("\n");
const c500 = m.handoffCut(H1, 500);
check("넘겨받은 요약 줄이기: 줄 단위, 정한 것은 맨 끝에 있어도 남기고 원래 차례 그대로, 줄인 줄 수 표시",
	c500.length <= 500 && c500.startsWith("목표: Windows 11") && c500.includes("정한 것: GPU는 여러 GPU Engine 중 최대") && /\n\(… \d+줄 줄임\)$/.test(c500)
	&& c500.split("\n").every((l) => H1.includes(l) || /^\(… \d+줄 줄임\)$/.test(l)), c500);
check("넘겨받은 요약 줄이기: 한도 안이면 그대로, 줄바꿈 없는 긴 글은 끝을 자름",
	m.handoffCut(H1) === H1 && m.handoffCut("가".repeat(1000), 100) === `${"가".repeat(99)}…`, H1.length);
const dh = m.digestOf([{ t: "2026-10-21 20:45", handoff: H1 }, { t: "2026-10-21 20:46", req: "위치 고쳐 줘" }], "~/work/resmon", now);
check("알릴 글: 세션 1 요약이 통째로 들어가 정한 것이 남음 (한도 안)", dh.includes(H1) && dh.length <= m.DIGEST_MAX, dh.length);
check("요약 부탁 글: 요구사항·정한 것을 맨 앞에, 넘겨받은 것도 옮겨 적게",
	m.HANDOFF_PROMPT.includes("맨 앞에 '요구사항:'") && m.HANDOFF_PROMPT.indexOf("'요구사항:'") < m.HANDOFF_PROMPT.indexOf("'정한 것:'")
	&& m.HANDOFF_PROMPT.includes("둘 다 앞 세션에서 넘겨받은 것 중 아직 유효한 것도 빠짐없이 옮겨"), m.HANDOFF_PROMPT);
// 실사용 시험의 세션 7 요약(1002자, 정한 것 줄 없음): 목표가 'CPU/메모리 사용량 낮추기' 로만 남아 처음 요청의 항목이 빠졌다.
// 요구사항 줄이 있으면 (모델이 끝에 적어도) 900자로 줄일 때 남는다
const H7 = [
	"목표: 작업표시줄 AI 위젯과 비슷한 WinForms 리소스 모니터 오버레이를 만들고 CPU/메모리 사용량을 낮추기.",
	"한 일: `resmon.cs` UI를 Label 중심에서 직접 그리기(OnPaint) 방식으로 변경, 둥근 반투명 배경·상태색·CPU/RAM/GPU/RX/TX 표시 추가.",
	"한 일: DPI 인식(`SetProcessDPIAware`) 추가, 글자 크기/폭/높이 조정, 위치를 트레이 영역 기준으로 정렬.",
	"한 일: RX/TX 누적량을 헤더 줄(`RX 3.9 KB` 형태)로 이동, 속도는 아래 줄에 유지.",
	"한 일: RAM 수집을 WMI → `GlobalMemoryStatusEx(dwMemoryLoad)` 로 변경.",
	"한 일: 네트워크 속도를 단순 1초 가정이 아니라 실제 경과 시간(`elapsed`) 기준으로 계산하도록 변경.",
	"바꾼 파일: `resmon.cs` 만 수정. 빌드는 `build.ps1` 사용.",
	"커밋: `b458bbe`, `6ad8e50`, `7f05eb1`, `6778737` 까지는 정상 완료.",
	"커밋 전 미완료 최적화: GPU 측정을 줄이려다 코드가 여러 번 바뀜. 현재는 `gpuCounters` 캐시 버전이 들어가 있으나 사용자가 원한 `PerformanceCounterCategory.ReadCategory()` 기반 최적화는 아직 안 끝남.",
	"측정 결과(최적화 전후 검증용으로 확보): 10초 대기 후 20초 측정 시 `CpuSecondsIncrease=7.969`, `WorkingSetMB=83.6`. 원래 관측치는 대략 \"한 코어 35%, 97MB\".",
	"남은 일: GPU 코드를 `ReadCategory()` 기반으로 다시 작성 → 빌드 → 10초 대기 + 20초 측정 1회 → 최초값(35%, 97MB)과 비교 → 개선되면 최종 커밋.",
	"주의: 매초마다 `new PerformanceCounter(...)` 생성하는 방식은 오히려 CPU가 높았고 실패. 사용자는 \"나중에 뜬 GPU 프로세스/네트워크 어댑터도 자동 반영\"을 반드시 유지하라고 명시함.",
	"요구사항: 작업 표시줄 오른쪽에 CPU %, RAM %, GPU %(엔진 가운데 최대), 네트워크 업·다운 속도와 시작 이후 총 전송량을 1초마다, 관리자 권한·추가 설치 없이.",
].join("\n");
const c7 = m.handoffCut(H7);
check("넘겨받은 요약 줄이기: 요구사항 줄은 맨 끝에 있어도 남김 (세션 7 요약)",
	c7.length <= m.HANDOFF_MAX && c7.includes("요구사항: 작업 표시줄 오른쪽에 CPU %") && c7.includes("총 전송량") && /\n\(… \d+줄 줄임\)$/.test(c7), [c7.length, c7]);
const long = m.handoffCut(`요구사항: ${"항목, ".repeat(200)}\n정한 것: GPU 는 최대\n한 일: 이것저것`, 300);
check("넘겨받은 요약 줄이기: 너무 긴 요구사항 줄은 다른 정한 것 줄을 남긴 자리에 앞부분만",
	long.length <= 300 && long.startsWith("요구사항: 항목, ") && long.includes("…\n정한 것: GPU 는 최대\n(… 1줄 줄임)") && !long.includes("한 일"), [long.length, long]);

// 가짜 pi 로: 요청 -> 기록 -> 새 세션에 알림 (세션 안에서는 같은 글), 확장이 보낸 요청, /handoff, /recall
const tmp = mkdtempSync(join(tmpdir(), "memory-test-"));
const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(tmp, "agent");
const proj = join(tmp, "proj").split("\\").join("/");
mkdirSync(proj, { recursive: true });
globalThis.__piWorkDir = { remote: false, cwd: proj };
const on = {};
const cmds = {};
const sent = [];
m.default({ on: (e, f) => (on[e] ||= []).push(f), registerCommand: (n, def) => (cmds[n] = def), sendUserMessage: (text, opts) => sent.push({ text, opts }) });
const notes = [];
const widgets = [];
let answer = true;
const ctx = {
	hasUI: true,
	isIdle: () => true,
	ui: { notify: (t, l) => notes.push([t, l]), setWidget: (k, v) => widgets.push({ k, v }), confirm: async () => answer, select: async (_t, o) => o[0] },
};
const emit = async (e, ev = {}) => {
	let r;
	for (const f of on[e] || []) r = (await f(ev, ctx)) ?? r;
	return r;
};
const prompt = async () => {
	const ev = { systemPromptOptions: { sections: {}, promptGuidelines: [] } };
	await emit("before_agent_start", ev);
	return ev.systemPromptOptions.sections.recent_work;
};
const turn = async (text, { source = "interactive", tools = [], answer: ans = "끝났습니다", stop = "stop" } = {}) => {
	await emit("input", { text, source });
	await prompt();
	for (const [toolName, input, content] of tools) await emit("tool_result", { toolName, input, isError: false, content: content ? [{ type: "text", text: content }] : [] });
	const msg = { role: "assistant", content: [{ type: "text", text: ans }], stopReason: stop };
	await emit("message_end", { message: msg });
	await emit("agent_end", { messages: [{ role: "user", content: text }, msg] });
	await emit("agent_settled", {});
};
const log = () => m.readLog(m.logFile(m.projectOf(globalThis.__piWorkDir).key));

await emit("session_start", { reason: "startup" });
check("처음: 기록이 없으면 지침에 알리지 않음", (await prompt()) === undefined);
await turn("텐서보드에 학습 손실을 남기는 코드 추가 (담당 hong@example.com)", {
	tools: [["write", { path: `${proj}/train.py` }], ["edit", { path: "utils/tb.py" }], ["bash", { command: "ls runs" }], ["bash", { command: "cd src && python train.py --epochs 1" }]],
	answer: "## 결과\nSummaryWriter 로 `loss` 를 남기게 했습니다.\n```python\nwriter.add_scalar('loss', l)\n```",
});
let lg = log();
check("요청이 끝나면 남김: 요청(이메일은 뺌), 바꾼 파일(작업 폴더 기준), 보기만 한 명령은 뺌, 답 앞부분(코드·표시 뺌)",
	lg.length === 1 && lg[0].req === "텐서보드에 학습 손실을 남기는 코드 추가 (담당 …)" && JSON.stringify(lg[0].files) === JSON.stringify(["train.py", "utils/tb.py"])
	&& JSON.stringify(lg[0].cmds) === JSON.stringify(["python train.py --epochs 1"]) && lg[0].ans.startsWith("결과 SummaryWriter 로 loss 를 남기게 했습니다") && !lg[0].ans.includes("add_scalar") && !lg[0].end, lg);
check("같은 세션에서는 지침이 그대로 (기록이 늘어도: Copilot·사내AI 대화를 새로 열지 않게)", (await prompt()) === undefined);
await turn("폴더째 반영의 다음 원본", { source: "extension", tools: [["wiki_write", { text: "x" }, "썼습니다 1쪽: 새로 [[원본]]"]] });
await turn(lib.userAsk("계획 모드 안내…\n\n검증 손실도 남겨 줘", "검증 손실도 남겨 줘"), { source: "extension", tools: [["edit", { path: "train.py" }]], answer: "검증 손실을 더했습니다", stop: "aborted" });
lg = log();
check("확장이 보낸 요청은 사용자를 대신한 것만 (userAsk 표시, 기록에는 그 글), Esc 로 멈춘 것도 바꾼 파일과 함께",
	lg.length === 2 && lg[1].req === "검증 손실도 남겨 줘" && lg[1].end === "aborted" && lg[1].files[0] === "train.py", lg);
await turn("아무것도 하지 못한 요청", { answer: "", stop: "error" });
check("아무것도 하지 못하고 끝난 요청은 남기지 않음", log().length === 2);

await emit("session_start", { reason: "new" });
const d1 = await prompt();
check("새 세션: 지난 기록을 지침의 recent_work 부분으로", typeof d1 === "string" && d1.includes(`이 프로젝트(${m.projectOf(globalThis.__piWorkDir).label})`) && d1.includes("텐서보드에 학습 손실") && d1.includes('"검증 손실도 남겨 줘"') && d1.includes("Esc 로 멈춤"), d1);
await turn("세 번째 요청", { tools: [["edit", { path: "a.py" }]] });
await turn("네 번째 요청", { tools: [["edit", { path: "b.py" }]] });
check("새 세션 안에서도 첫 요청 때 정한 글 그대로 (그 뒤 기록은 다음 세션에)", (await prompt()) === d1 && !d1.includes("세 번째"), await prompt());
await emit("session_start", { reason: "reload" });
check("/reload 뒤에도 같은 글 (확장을 다시 불러와도)", (await prompt()) === d1);

// /new: 요청이 여럿이면 다음 세션에 넘길 요약을 남길지 묻고, '예' 면 새 세션으로 가지 않고 요약을 부탁
answer = false;
check("요청이 3개 아래면 묻지 않음", (await emit("session_before_switch", { reason: "new" })) === undefined && !sent.length);
await turn("다섯 번째 요청", { tools: [["edit", { path: "c.py" }]] });
answer = true;
const sw = await emit("session_before_switch", { reason: "new" });
await new Promise((r) => setTimeout(r, 20));
check("/new: '예' 면 넘어가지 않고 요약을 부탁 (모델에게 한 번)", sw?.cancel === true && sent.length === 1 && sent[0].text === m.HANDOFF_PROMPT, [sw, sent]);
await turn(m.HANDOFF_PROMPT, { source: "extension", answer: "목표: 검증 손실까지 텐서보드로\n남은 일: 학습률 그래프\n연락: a@b.co" });
lg = log();
check("요약은 기록에 (이메일은 뺌), 끝나면 /new 를 다시 입력하라고, 같은 세션에서 다시 묻지 않음",
	lg.at(-1).handoff === "목표: 검증 손실까지 텐서보드로\n남은 일: 학습률 그래프\n연락: …" && notes.at(-1)[0].includes("/new 을 다시 입력") && (await emit("session_before_switch", { reason: "new" })) === undefined, [lg.at(-1), notes.at(-1)]);
await emit("session_start", { reason: "new" });
const d2 = await prompt();
check("다음 세션: 넘겨받은 요약과 최근 요청", d2.includes("넘겨받은 요약") && d2.includes("남은 일: 학습률 그래프") && d2.includes("다섯 번째 요청") && !d2.includes("HANDOFF") && !d2.includes(m.HANDOFF_PROMPT.slice(0, 20)) && !d2.includes("NOTES.md"), d2);
writeFileSync(join(proj, "NOTES.md"), "# 메모\n");
await emit("session_start", { reason: "new" });
const d3 = await prompt();
check("작업 폴더에 NOTES.md(기본 명령 /handoff 로 정리)가 있으면 있다고 알림", d3.includes("작업 폴더의 NOTES.md 에 /handoff 로 정리한 작업 메모가 있다") && d3.includes("다섯 번째 요청"), d3);
check("기록이 없어도 NOTES.md 가 있으면 알림", m.digestOf([], "x", now, m.DIGEST_MAX, true).includes("NOTES.md"));
await emit("session_start", { reason: "new" });
const d4 = await prompt();

// /recall: 보기, 끄기·켜기, 지우기
await cmds.recall.handler("", ctx);
const w = widgets.at(-1);
check("/recall: 이번 세션에 알린 것과 기록 수·파일", w?.k === "pi-recall" && w.v[0].includes("── 작업 기록:") && w.v[0].includes("이번 세션에 알린 것") && w.v[0].includes("다섯 번째 요청") && w.v[0].includes("work-log"), w);
await cmds.recall.handler("off", ctx);
const nLog = log().length;
await turn("끈 뒤의 요청", { tools: [["edit", { path: "d.py" }]] });
check("/recall off: 지침에 알리지 않고 남기지도 않음", (await prompt()) === undefined && log().length === nLog && m.recallOn() === false);
await cmds.recall.handler("on", ctx);
check("/recall on: 다시 알림 (이번 세션의 같은 글)", (await prompt()) === d4 && d4.includes("다섯 번째 요청"));
await cmds.recall.handler("clear", ctx);
check("/recall clear: 이 프로젝트 기록을 지우고 이번 세션에도 더 알리지 않음", !existsSync(m.logFile(m.projectOf(globalThis.__piWorkDir).key)) && (await prompt()) === undefined && notes.at(-1)[0].includes("지웠습니다"));
globalThis.__piMode = "plan";
await cmds.recall.handler("save", ctx);
check("/recall save: 계획 모드에서는 하지 않음, /handoff 는 기본 명령(NOTES.md)으로 남겨 둠 (확장 명령으로 가리지 않음)", notes.at(-1)[0].includes("계획 모드") && !cmds.handoff);
globalThis.__piMode = "auto";

// 노트북에 아직 연결되지 않았으면 남기지도 알리지도 않음 (연결된 뒤 첫 요청에)
globalThis.__piWorkDir = { remote: true, cwd: "/" };
await emit("session_start", { reason: "new" });
await turn("연결 전 요청", { tools: [["edit", { path: "x.py" }]] });
check("jupyter 모드 연결 전: 기록·알림 없음", (await prompt()) === undefined);

if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n실패 ${fails}개` : "\n모두 통과");
process.exit(fails ? 1 : 0);
