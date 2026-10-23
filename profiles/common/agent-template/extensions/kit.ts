/**
 * pi 안에서 보는 도움말과 상태
 *
 *  /kit     한글 빠른 도움말 (키, 세션, 명령·스킬 목록, 설정 파일 위치). 명령·스킬은 ~/.pi/agent 에 있는 것을 그대로 보여 줌
 *  /doctor  상태 요약: pc 설정은 copilot/diag.py --report (버전 번호, Node, 중계 서버, 전용 창, 모델, 최근 요청, 최근 로그),
 *           jupyter 설정은 버전 번호와 Node 확인. 문제가 생기면 이 화면을 찍어 보내면 된다
 *  /kit share <폴더>    팀이 같이 쓰는 폴더(공유 드라이브 등)의 skills·prompts 를 settings.json 에 등록하고 바로 다시 읽음
 *  /kit unshare <폴더>  등록을 뺌.  /kit share (폴더 없이) 는 지금 등록된 폴더를 보여 줌
 *  /kit env   지금 실행 위치(jupyter 모드면 노트북, 아니면 이 컴퓨터)의 OS·Python·주요 패키지·GPU·CUDA·이미지 버전을 조사해
 *             보여 주고, 원하면 내 지침(~/.pi/agent/AGENTS.md)의 '실행 환경' 부분에 적는다 (다음 요청부터 그 버전에 맞춰 일함)
 *  /watch <로그>  오래 걸리는 작업(학습 등)의 로그를 30초마다 확인해 아래 상태 줄에 마지막 줄을 보여 주고, "[pi-done] exit=N" 줄이
 *             생기면 벨과 알림. /watch 지금 상태 · /watch 보내기 [요청] 로그 끝부분을 pi 에게 · /watch 끄기 (작업은 그대로 돎).
 *             bash 결과에 "[pi-watch] <로그>" 줄이 있으면 저절로 시작한다 (kubeflow-notebook 스킬의 실행 방식)
 * /kit·/doctor 는 편집기 위에 띄우고, 다음 요청을 보내거나 같은 명령을 다시 입력하면 닫는다. LLM 에게는 보내지 않는다.
 */

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, promises as fsp, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { call, decodeText, nbRun, type RelayError, shown as shownPath, shq, type Target, target, transformInput, workDir } from "./lib/relay.ts";

const agentDirRaw = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
const kitHome = process.env.PI_KIT_HOME || "";
/** 보여 줄 경로: 슬래시로, 사용자 폴더 아래면 ~ 로 줄여서 */
const tilde = (p: string) => {
	const s = p.split("\\").join("/");
	const h = homedir().split("\\").join("/");
	return s.toLowerCase().startsWith(h.toLowerCase() + "/") ? "~" + s.slice(h.length) : s;
};
const agentDir = agentDirRaw;
const A = tilde(agentDirRaw);
const read = (p: string) => {
	try {
		return readFileSync(p, "utf8");
	} catch {
		return "";
	}
};
const version = () => read(join(kitHome, "VERSION")).trim() || "?";
const isBridge = () => read(join(agentDir, "models.json")).includes("127.0.0.1:8765");
const names = (dir: string, pick: (n: string) => string | null) => {
	try {
		return readdirSync(dir).map(pick).filter((x): x is string => !!x).sort();
	} catch {
		return [];
	}
};

// ── /kit env: 실행 환경 조사 ─────────────────────────────────────────
// 읽기만 하는 명령. 결과는 "@@ 이름: 값" 줄로 (노트북 터미널에 섞여 나오는 다른 글과 가르려고). Linux 노트북과 Git Bash 둘 다에서 돈다
// 이미지 이름은 저장소 주소(사내 호스트)를 빼고 이름:태그만
export const ENV_PROBE = String.raw`p() { printf '@@ %s: %s\n' "$1" "$2"; }
PY="\${PI_PYTHON_EXE:-}"; [ -n "$PY" ] || PY=$(command -v python3 || command -v python || true)
if [ -r /etc/os-release ]; then . /etc/os-release; p OS "\${PRETTY_NAME:-$NAME}"; else p OS "$(uname -sr 2>/dev/null)"; fi
if [ -n "$PY" ]; then
  p Python "$(PYTHONIOENCODING=utf-8 "$PY" -c 'import sys; print(sys.version.split()[0])' 2>/dev/null)"
  PYTHONIOENCODING=utf-8 "$PY" - <<'PYEOF' 2>/dev/null
import importlib.metadata as m
names = ["kfp", "kfp-server-api", "kubernetes", "torch", "torchvision", "tensorflow", "keras", "jax", "scikit-learn",
         "xgboost", "lightgbm", "catboost", "pandas", "numpy", "polars", "pyarrow", "pyspark", "mlflow", "transformers",
         "datasets", "accelerate", "onnx", "onnxruntime", "tensorboard", "optuna", "papermill", "jupytext", "nbconvert", "jupyterlab"]
found = []
for n in names:
    try:
        found.append(n + " " + m.version(n))
    except Exception:
        pass
print("@@ 패키지: " + (", ".join(found) or "(목록의 패키지 없음)"))
PYEOF
fi
if command -v nvidia-smi >/dev/null 2>&1; then
  p GPU "$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | sort | uniq -c | sed 's/^ *//; s/ /× /' | paste -sd ';' -)"
  p "드라이버·CUDA" "$(nvidia-smi 2>/dev/null | grep -o 'Driver Version: [0-9.]*\|CUDA Version: [0-9.]*' | paste -sd ' ' -)"
else
  p GPU "없음 (nvidia-smi 없음)"
fi
command -v nvcc >/dev/null 2>&1 && p nvcc "$(nvcc --version 2>/dev/null | tail -1)"
p "CPU·메모리" "$(nproc 2>/dev/null || echo ?) 코어$(free -g 2>/dev/null | awk '/^Mem:/{print ", " $2 "GB"}')"
[ -n "\${JUPYTER_IMAGE:-}" ] && p "노트북 이미지" "\${JUPYTER_IMAGE##*/}"
command -v kubectl >/dev/null 2>&1 && p kubectl "$(kubectl version --client 2>/dev/null | head -1)"
command -v kfp >/dev/null 2>&1 && p "kfp CLI" "$(kfp --version 2>/dev/null | head -1)"
true`.replace(/\\\$/g, "$");

/** 조사 결과 -> [이름, 값] (값이 빈 줄은 뺌) */
export function parseEnv(out: string): [string, string][] {
	const items: [string, string][] = [];
	for (const line of out.split(/\r?\n/)) {
		const m = /^@@ ([^:]+): (.*)$/.exec(line.trim());
		if (m && m[2].trim()) items.push([m[1].trim(), m[2].trim()]);
	}
	return items;
}

/** 지침 글의 '실행 환경' 부분을 새로 적음 (place 마다 하나: 있으면 바꾸고, 없으면 끝에 더함) */
export function putEnv(text: string, place: string, where: string, items: [string, string][], date: string): string {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const start = `<!-- kit env: ${place} -->`;
	const end = `<!-- /kit env: ${place} -->`;
	const block = [
		start,
		`## 실행 환경: ${where} (/kit env 로 조사, ${date})`,
		...items.map(([k, v]) => `- ${k}: ${v}`),
		"코드와 명령은 위 버전에 맞춘다. 새 패키지가 필요하면 설치할 수 있는지 먼저 확인한다 (다시 조사: /kit env).",
		end,
	].join(eol);
	const a = text.indexOf(start);
	const b = a < 0 ? -1 : text.indexOf(end, a);
	if (a >= 0 && b > a) return text.slice(0, a) + block + text.slice(b + end.length);
	const body = text.replace(/(\r?\n)*$/, "");
	return (body ? body + eol + eol : "") + block + eol;
}

// ── /watch: 오래 걸리는 작업의 로그 지켜보기 ─────────────────────────────
// 지켜보는 것(WS.w)은 globalThis 에 두어 /new·다시 읽기 뒤에도 이어서 본다 (학습은 대화와 상관없이 돎).
// 타이머와 ctx 는 세션마다: 세션이 끝나면 멈추고 비운다. 끝난 세션의 ctx 를 쓰면 오류가 나고,
// 타이머 안의 오류는 pi 를 멈추게 하므로 타이머에서는 어떤 오류도 밖으로 내보내지 않는다.
// 노트북 로그는 Jupyter 파일 API 로 크기와 끝부분만 읽는다 (터미널은 명령을 하나씩 돌리므로 pi 의 명령을 막지 않게).
// 노트북 홈 밖·숨김 경로일 때만 터미널로
const WATCH_MS = Number(process.env.PI_WATCH_POLL_MS) || 30000;
const IDLE_MS = 20 * 60000;
const TAIL_BYTES = 8192;

/** 로그 끝부분 -> 화면에 보이는 줄 (색 코드를 빼고, 진행 막대처럼 \r 로 덮어쓴 줄은 마지막 것만). fromMiddle: 파일 중간부터 읽어 맨 앞 줄이 잘렸을 수 있음 */
export function tailLines(text: string, n: number, fromMiddle = false): string[] {
	let lines = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split("\n");
	if (fromMiddle && lines.length > 1) lines = lines.slice(1);
	return lines
		.map((l) => {
			const s = l.replace(/\r+$/, "");
			return s.slice(s.lastIndexOf("\r") + 1);
		})
		.filter((l) => l.trim())
		.slice(-n);
}
/** 작업이 끝났다는 줄 "[pi-done] exit=N" (스킬의 실행 방식이 마지막에 찍음) -> N. 없으면 null */
export function doneExit(lines: string[]): number | null {
	for (let i = lines.length - 1; i >= 0; i--) {
		const m = /^\[pi-done\] exit=(-?\d+)/.exec(lines[i].trim());
		if (m) return Number(m[1]);
	}
	return null;
}
/** bash 결과의 "[pi-watch] <로그 경로>" 줄 (줄 맨 앞. 여러 개면 마지막). 변수가 풀리지 않은 것 등은 null */
export function watchMarker(text: string): string | null {
	const all = [...text.matchAll(/^\[pi-watch\] (\S.*?)\s*$/gm)];
	const p = all.length ? all[all.length - 1][1] : "";
	return p && !/[$`<>|;&]/.test(p) ? p : null;
}
/** 걸린 시간 */
export const ago = (ms: number) => {
	const m = Math.floor(ms / 60000);
	return m < 1 ? "1분 안" : m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
};
const fileName = (t: Target) => t.abs.split("/").pop() || t.abs;
const sizeText = (n: number) => (n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(1)}KB` : `${(n / 1048576).toFixed(1)}MB`);
/** 아래 상태 줄: "지켜보기: train.log · 12분 · <마지막 줄>" */
export function watchStatus(name: string, parts: string[], last: string): string {
	const tail = last.length > 60 ? last.slice(0, 59) + "…" : last;
	return [`지켜보기: ${name}`, ...parts, tail].filter(Boolean).join(" · ");
}

type Watch = {
	t: Target;
	started: number;
	size: number; // 지난번 크기 (-1: 아직 모름)
	grew: number; // 마지막으로 늘어난 때
	last: string[]; // 끝부분 줄 (최근 40줄)
	exit: number | null; // "[pi-done] exit=N" 의 N (끝나지 않았으면 null)
	ended: number;
	idleNoted: boolean;
	miss: number; // 파일이 없던 횟수 (잇달아)
	shell: boolean; // 노트북 홈 밖·숨김 경로: 노트북 터미널로 읽음
	error: string;
};
type Tail = { size: number; text?: string; fromMiddle?: boolean } | null;
const WS: { w: Watch | null; ctx: any; timer: ReturnType<typeof setInterval> | null; busy: boolean } = ((globalThis as any).__piWatch ||= {
	w: null,
	ctx: null,
	timer: null,
	busy: false,
});

/** 로그의 크기와 (지난번과 크기가 다르면) 끝부분. 파일이 없으면 null */
async function readTail(w: Watch): Promise<Tail> {
	const t = w.t;
	if (!t.remote) {
		let fh: Awaited<ReturnType<typeof fsp.open>> | undefined;
		try {
			const st = await fsp.stat(t.abs);
			if (!st.isFile()) return null;
			if (st.size === w.size) return { size: st.size };
			const start = Math.max(0, st.size - TAIL_BYTES);
			fh = await fsp.open(t.abs, "r");
			const buf = Buffer.alloc(st.size - start);
			const { bytesRead } = await fh.read(buf, 0, buf.length, start);
			return { size: st.size, text: buf.subarray(0, bytesRead).toString("utf8"), fromMiddle: start > 0 };
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw e;
		} finally {
			await fh?.close();
		}
	}
	if (!w.shell) {
		let st: any;
		try {
			st = await call("/jupyter/fs", { op: "stat", path: t.abs });
		} catch (e) {
			if ((e as RelayError).code === "ENOENT") return null;
			throw e;
		}
		if (st.kind === "directory") return null;
		let size = typeof st.size === "number" ? st.size : Number.NaN;
		if (!Number.isFinite(size)) {
			// 크기를 알려 주지 않는 Jupyter: 첫 바이트를 나눠 받으면 전체 크기가 함께 옴 (터미널을 쓰지 않으려고)
			try {
				size = Number((await call("/jupyter/fs", { op: "read_range", path: t.abs, start: 0, end: 0 })).total);
			} catch (e) {
				if ((e as RelayError).code === "ENOENT") return null;
				if ((e as RelayError).code === "EINVAL") w.shell = true; // 나눠 읽을 수 없는 경로 (노트북 홈 밖·숨김)
			}
		}
		if (!w.shell && Number.isFinite(size) && size > 0) {
			if (size === w.size) return { size };
			const start = Math.max(0, size - TAIL_BYTES);
			try {
				const r = await call("/jupyter/fs", { op: "read_range", path: t.abs, start, end: size - 1 });
				return { size, text: Buffer.from(r.data || "", "base64").toString("utf8"), fromMiddle: start > 0 };
			} catch (e) {
				if ((e as RelayError).code === "ENOENT") return null;
				if ((e as RelayError).code !== "EINVAL") throw e;
				w.shell = true;
			}
		} else if (size === 0) return { size: 0, text: "" };
		// 여기까지 오면 이번에는 터미널로 (빈 파일이라 나눠 받기가 안 된 경우 등. 나눠 읽을 수 없는 경로면 다음에도)
	}
	const q = shq(t.abs);
	const r = await nbRun(
		`if [ -f ${q} ]; then echo "@@size $(stat -c %s -- ${q})"; echo "@@data $(tail -c ${TAIL_BYTES} -- ${q} | base64 -w0)"; else echo "@@none"; fi`,
		workDir().home || "/",
	);
	if (/^@@none/m.test(r.out)) return null;
	const size = Number(/^@@size (\d+)/m.exec(r.out)?.[1]);
	if (!Number.isFinite(size)) throw new Error(`로그 크기를 읽지 못했습니다: ${r.out.trim().slice(-200)}`);
	if (size === w.size) return { size };
	return { size, text: Buffer.from(/^@@data (\S*)/m.exec(r.out)?.[1] || "", "base64").toString("utf8"), fromMiddle: size > TAIL_BYTES };
}

function helpLines(): string[] {
	const prompts = names(join(agentDir, "prompts"), (n) => (n.endsWith(".md") ? "/" + n.slice(0, -3) : null));
	const skills = names(join(agentDir, "skills"), (n) => (existsSync(join(agentDir, "skills", n, "SKILL.md")) ? n : null));
	const bridge = isBridge();
	const lines = [
		`── pi 빠른 도움말 (버전 ${version()}) ── 닫기: /kit 다시 입력 또는 요청 보내기`,
		" 입력  Enter 보내기 · Shift+Enter 줄바꿈 · Esc 멈추기 · Ctrl+O 도구 출력 펼치기 · !명령 직접 실행 · @ 파일 고르기(내용이 함께 감)",
		" 모델  /model 또는 Ctrl+L 고르기 · Ctrl+P 다음 모델",
		" 세션  pi -c 이어서 · /resume 고르기 · /new 새로 · /name 이름 붙이기 · 끝내기 /quit(/exit) 또는 Ctrl+C 두 번",
		" 작업  /plan 계획부터 (승인하면 진행) · /mode 계획·확인·자동 · /undo pi 가 고친 파일 되돌리기",
		` 명령  ${prompts.join(" ") || "(없음)"}`,
		`       내 명령: ${A}/prompts/<이름>.md`,
		` 스킬  /skill:이름 → ${skills.join(", ") || "(없음)"}`,
		`       내 스킬: ${A}/skills/<이름>/SKILL.md (skill-creator 에게 "○○ 스킬 만들어줘")`,
		`       내 hook: ${A}/extensions/my-<이름>.ts (hook-creator 에게 "○○할 때 △△하는 hook 만들어줘")`,
		" 훅    /hooks 목록 · /hooks off mine 내 훅만 끄기 (위험 명령 확인은 그대로) · /hooks off docs 문서 규칙 끄기",
		` 지침  ${A}/AGENTS.md (공통), 프로젝트 폴더의 AGENTS.md (/init 으로 초안) · /remember <내용> 한 줄 더하기`,
		" 기억  /recall 지난 세션들의 작업 기록 (새 세션에 자동으로 알려 줌) · /recall save 다음 세션에 넘길 요약 · /recall off 끄기",
		" 설명  /docs <모듈[.이름]> [찾을 말] 설치된 버전의 시그니처·설명 (pi 도 docs_lookup 으로 찾음) · 받은 문서는 ~/pi-docs 에",
		" 위키  /wiki (상태) · /wiki init 으로 만들기 · ingest <raw/ 파일·폴더> · ask <질문> · save · lint (Obsidian 으로 보기)",
		" 환경  /kit env 지금 실행 위치의 Python·패키지·GPU·CUDA 버전을 조사해 지침에 적기 (그 버전에 맞춰 일함)",
		" 로그  /watch <로그> 긴 학습 지켜보기 (아래 줄에 진행, 끝나면 벨·알림) · /watch 상태 · /watch 보내기 끝부분을 pi 에게 · /watch 끄기",
	];
	if (bridge) {
		lines.push(
			" 노트북 /jupyter 폴더 · /local · /upload 파일·폴더 · /download 파일·폴더",
			` 설정  내 설정 ${A}/bridge.json · 사내AI ${A}/inhouse.json (고친 뒤 pi 를 다시 실행하면 중계 서버도 새 설정으로)`,
			` 문제  /doctor 상태 요약 (화면을 찍어 보내기) · 로그 ${A}/copilot-relay.log`,
		);
	} else {
		lines.push(` 설정  ${A}/models.json (LLM 주소) · ${A}/settings.json · 문제가 생기면 /doctor`);
	}
	if (kitHome) lines.push(` 문서  ${tilde(kitHome)}/README.md`);
	return lines;
}

function run(cmd: string, args: string[], ms: number): Promise<string> {
	return new Promise((ok) => {
		let out = "";
		let done = false;
		const ch = spawn(cmd, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
		const finish = (extra = "") => {
			if (done) return;
			done = true;
			ok(out + extra);
		};
		const t = setTimeout(() => {
			ch.kill();
			finish("\n(시간 초과로 멈춤)");
		}, ms);
		ch.stdout.on("data", (d) => (out += d));
		ch.stderr.on("data", (d) => (out += d));
		ch.on("error", (e) => {
			clearTimeout(t);
			finish(`\n(실행하지 못함: ${e.message})`);
		});
		ch.on("close", () => {
			clearTimeout(t);
			finish();
		});
	});
}

async function doctorLines(): Promise<string[]> {
	const head = `── 상태 요약 (버전 ${version()}) ── 닫기: /doctor 다시 입력 또는 요청 보내기`;
	let out: string;
	if (isBridge()) {
		const py = process.env.PI_PYTHON_EXE;
		if (!py || !kitHome) return [head, " Python 이나 pi 폴더를 찾지 못했습니다. 터미널에서 python ~/tools/pi/copilot/diag.py --report 를 실행하세요."];
		out = await run(py, [join(kitHome, "copilot", "diag.py"), "--report"], 120000);
	} else {
		out = `pi 폴더: ${kitHome}\n` + (await run("bash", [join(kitHome, "check-node.sh")], 60000));
	}
	const body = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
	return [head, ...body.map((l) => " " + l)];
}

// ── 문서 찾기 (docs_lookup 도구, /docs): 설치된 버전의 설명 ───────────────────────────────
// context7 처럼 모델이 라이브러리 사용법을 추측하지 않게. 사내망이라 인터넷 대신 지금 실행 위치(jupyter 모드면 노트북)에 설치된
// Python 패키지를 직접 불러와 버전·시그니처·설명·하위 이름을 보고, 문서 폴더(~/pi-docs: 받아 둔 문서 .md·.txt·.html 등)에서 맞는 줄을 더한다.
// Python 은 작업 폴더의 .venv·venv, 켜 둔 가상 환경·conda, pi 가 찾은 Python, PATH 의 python3·python 차례로 실제로 돌아가는 것
// (Windows 스토어 바로가기는 Python 이 없으면 안내만 하고 실패하므로 돌려 보고 고름). 찾을 이름은 인자로 넘김 (스크립트에 끼워 넣지 않음)
// ── 끝났다고 하기 전의 확인 (지침에 늘 더하는 줄) ───────────────────────────────────────────
// 2026-10 실사용 시험: 작업 표시줄에 가려 보이지 않는 창을 '항상 위 적용 완료' 라 하고 끝냄, 원인을 찾는다며 코드를 비운 채 세션이 끝남,
// 처음 요청의 항목(총 전송량)이 몇 세션 뒤 빠짐. 작업 모드와 관계없이 같은 글 (모드를 바꿀 때마다 지침이 바뀌면 Copilot 이 새 대화를 엶)
export const DONE_GUIDE =
	"끝났다고 답하기 전에 사용자의 요구사항을 하나씩 다시 보고, 바꾼 것을 실제로 실행·빌드·테스트한 결과로 확인한다 " +
	"(화면에 나오는 프로그램이면 실행해서 실제로 보이는지까지). 확인하지 못한 것은 확인하지 못했다고 적는다. " +
	"원인을 찾는다며 기존 코드를 지우거나 임시 코드로 바꾼 채 끝내지 않는다. " +
	"할 수 없다고 답하기 전에 이 대화에서 이미 써 본 방법(같은 명령·API)으로 되는지 해 본다.";
// 2026-10 ML 시험 (Kubeflow 노트북에서 분석 모델 만들기):
//  - 코드를 모두 python - <<EOF 로만 돌려, 'KFP 로 돌려 줘' 에 '파이프라인 파일이 없다' 며 멈춤. 그 뒤 파일을 '# placeholder' 로 먼저 씀
//  - 프로젝트 지침이 가리킨 환경 안내 문서를 읽지 않거나, 읽고도 그 규칙('단계에서 DB 를 쓰려면 먼저 사용자에게')을 어김
//  - 파이프라인 완료를 한도 1시간으로 출력 없이 기다리다(이미지를 못 받아 멈춘 단계) 45분이 지남
//  - '지금 도구로는 실행을 종료할 수 없다' 고 했지만 앞에서 같은 API 로 종료했었음 (DONE_GUIDE 끝 문장)
export const CODE_FILE_GUIDE =
	"다시 돌릴 만한 분석·학습·파이프라인 코드는 heredoc(python - <<EOF)으로만 돌리지 말고 .py 파일로 저장해 실행한다 (프로젝트에, 지침이 정한 곳이 있으면 그곳에). " +
	"새 파일은 자리 표시(placeholder) 없이 처음부터 실제 내용으로 쓴다.";
export const READ_DOCS_GUIDE =
	"프로젝트 지침(AGENTS.md)이 가리키는 문서가 지금 하는 일(데이터·DB·파이프라인 등)을 다루면 그 부분을 먼저 읽고, " +
	"그 문서의 규칙(사용자에게 먼저 물을 것, 하지 말 것)을 지킨다.";
export const WAIT_GUIDE =
	"오래 걸리는 외부 작업(파이프라인 실행, 배포, 긴 학습)을 기다릴 때는 끝날 때까지 아무것도 찍지 않는 대기(wait_for_run_completion 등)를 쓰지 말고, " +
	"한 명령 안에서 30초마다 상태를 찍으며 10분 안쪽으로 기다린다 (python 은 -u). 그래도 그대로면 막힌 원인을 살펴 사용자에게 알린다.";
/** 지침에 늘 더하는 줄 (작업 모드와 관계없이 같은 글) */
export const KIT_GUIDES = [DONE_GUIDE, CODE_FILE_GUIDE, READ_DOCS_GUIDE, WAIT_GUIDE];
/** 지침 목록(systemPromptOptions.promptGuidelines)에 KIT_GUIDES 를 한 번씩 더함 */
export function addKitGuides(g: unknown) {
	if (Array.isArray(g)) for (const line of KIT_GUIDES) if (!g.includes(line)) g.push(line);
}

export const DOCS_MAX = 5500; // 결과 글 길이 (wiki_read 와 같음. Copilot·사내AI 의 도구 결과 한도 안)
export const DOCS_GUIDE = "라이브러리의 함수·클래스 사용법(인자, 반환값, 버전 차이)이 확실하지 않으면 추측하지 말고 docs_lookup 으로 지금 설치된 버전의 설명을 먼저 본다";
export const docsDir = () => process.env.PI_DOCS_DIR || join(homedir(), "pi-docs");
export const DOCS_PY = String.raw`import sys, os, io, json, inspect, importlib, pkgutil, warnings, contextlib, difflib
warnings.filterwarnings("ignore")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
name = sys.argv[1] if len(sys.argv) > 1 else ""
query = sys.argv[2] if len(sys.argv) > 2 else ""
words = [w for w in query.lower().replace(",", " ").split() if w]
out = {"python": sys.version.split()[0], "exe": sys.executable, "name": name}
sink = io.StringIO()
def first_line(doc):
    for l in (doc or "").strip().splitlines():
        l = l.strip()
        if l:
            return l[:200]
    return ""
def sig(o):
    try:
        return str(inspect.signature(o))
    except Exception:
        return ""
def kind(o):
    if inspect.ismodule(o): return "module"
    if inspect.isclass(o): return "class"
    if isinstance(o, property): return "property"
    if inspect.isroutine(o): return "function"
    if callable(o): return "callable"
    return "value"
def doc_of(o):
    try:
        return (inspect.getdoc(o.fget) if isinstance(o, property) else inspect.getdoc(o)) or ""
    except Exception:
        return ""
def version_of(top):
    try:
        import importlib.metadata as md
    except Exception:
        return None, None
    names = []
    try:
        names = list(md.packages_distributions().get(top, []))
    except Exception:
        pass
    for d in names + [top, top.replace("_", "-")]:
        try:
            return d, md.version(d)
        except Exception:
            pass
    return None, None
parts = [p for p in name.replace("/", ".").replace(":", ".").split(".") if p]
obj = None
rest = []
err = ""
with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
    for i in range(len(parts), 0, -1):
        modname = ".".join(parts[:i])
        try:
            obj = importlib.import_module(modname)
            rest = parts[i:]
            break
        except ModuleNotFoundError as e:
            missing = getattr(e, "name", "") or ""
            if missing and missing != modname and not modname.startswith(missing + "."):
                err = "%s: 불러오다 오류 (%s)" % (modname, e)
                break
            err = str(e)
        except BaseException as e:
            err = "%s: 불러오다 오류 (%s: %s)" % (modname, type(e).__name__, e)
            break
    found = parts[: len(parts) - len(rest)]
    if obj is not None:
        for a in rest:
            try:
                obj = getattr(obj, a)
                found.append(a)
            except Exception:
                out["missing"] = a
                break
if obj is None:
    out["error"] = err or "없음"
    tops = set()
    try:
        import importlib.metadata as md
        tops |= set(md.packages_distributions().keys())
    except Exception:
        pass
    try:
        tops |= {m.name for m in pkgutil.iter_modules()}
    except Exception:
        pass
    out["close"] = difflib.get_close_matches(parts[0] if parts else name, sorted(tops), n=6, cutoff=0.6)
else:
    out["path"] = ".".join(found)
    out["kind"] = kind(obj)
    d, v = version_of(parts[0])
    if v:
        out["dist"], out["version"] = d, v
    f = None
    try:
        f = None if isinstance(obj, property) else inspect.getsourcefile(obj)
    except Exception:
        pass
    if not f:
        m = obj if inspect.ismodule(obj) else inspect.getmodule(obj)
        f = getattr(m, "__file__", None)
    out["file"] = f or ""
    if out["kind"] in ("class", "function", "callable"):
        out["signature"] = sig(obj)
    out["doc"] = doc_of(obj)[:8000]
    names = []
    try:
        al = getattr(obj, "__all__", None) if inspect.ismodule(obj) else None
        names = [str(n) for n in al] if isinstance(al, (list, tuple)) else [n for n in dir(obj) if not n.startswith("_")]
    except Exception:
        pass
    if out["kind"] == "value":
        names = []
    subs = []
    if inspect.ismodule(obj) and hasattr(obj, "__path__"):
        try:
            subs = sorted({m.name for m in pkgutil.iter_modules(obj.__path__) if not m.name.startswith("_")})
        except Exception:
            pass
    out["submodules"] = subs[:300]
    out["count"] = len(names)
    out["names"] = names[:600]
    members = []
    with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        if words:
            scored = []
            looked = 0
            for n in names[:3000]:
                s = sum(3 for w in words if w in n.lower())
                if not s and looked < 400:
                    looked += 1
                    try:
                        s = sum(1 for w in words if w in first_line(doc_of(getattr(obj, n))).lower())
                    except Exception:
                        s = 0
                if s:
                    scored.append((-s, n))
            picked = [n for _, n in sorted(scored)][:40]
        else:
            picked = names[:25]
        for n in picked:
            try:
                o = getattr(obj, n)
            except Exception:
                continue
            k = kind(o)
            members.append({"name": n, "kind": k, "sig": sig(o)[:240] if k in ("class", "function", "callable") else "", "doc": first_line(doc_of(o)) if k != "value" else ""})
    out["members"] = members
    out["matched"] = bool(words)
sys.__stdout__.write("\n@@DOCS@@" + json.dumps(out, ensure_ascii=True) + "\n")
sys.__stdout__.flush()
`;

export interface DocsInfo {
	name: string;
	python?: string;
	exe?: string;
	error?: string;
	close?: string[];
	path?: string;
	kind?: string;
	dist?: string;
	version?: string;
	file?: string;
	signature?: string;
	doc?: string;
	submodules?: string[];
	count?: number;
	names?: string[];
	members?: { name: string; kind: string; sig: string; doc: string }[];
	matched?: boolean;
	missing?: string;
}
const KIND_KO: Record<string, string> = { module: "모듈", class: "클래스", function: "함수", property: "속성", callable: "부를 수 있는 것", value: "값" };

/** 실행 결과에서 '@@DOCS@@{...}' 줄 (불러오는 패키지가 섞어 쓴 글은 뺌). 없으면 null */
export function parseDocs(out: string): DocsInfo | null {
	const i = out.lastIndexOf("@@DOCS@@");
	if (i < 0) return null;
	try {
		return JSON.parse(out.slice(i + 8).split(/\r?\n/)[0]);
	} catch {
		return null;
	}
}

/** 문서 폴더에서 찾을 말: 이름의 끝 두 마디(SummaryWriter, add_scalar)와 찾을 말 (두 글자 넘는 것) */
export function docWords(name: string, query: string): string[] {
	const ws = [...name.split(/[./:]/).filter(Boolean).slice(-2), ...query.split(/[\s,]+/)].map((w) => w.toLowerCase().trim()).filter((w) => w.length >= 2);
	return [...new Set(ws)];
}

const DOC_EXT = /\.(md|markdown|txt|rst|adoc|html?)$/i;
/** 문서 폴더에서 찾은 줄들: 맞는 말이 많은 줄부터, 파일마다 묶어 (앞뒤 한 줄씩). max 자까지 */
export function searchDocs(dir: string, words: string[], max = 1500): { text: string; files: number } {
	const files: string[] = [];
	const walk = (d: string, depth: number) => {
		if (depth > 6 || files.length >= 3000) return;
		let ents: any[] = [];
		try {
			ents = readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of ents) {
			if (e.name.startsWith(".") || e.name === "node_modules") continue;
			const p = join(d, e.name);
			if (e.isDirectory()) walk(p, depth + 1);
			else if (DOC_EXT.test(e.name)) files.push(p);
		}
	};
	walk(dir, 0);
	if (!words.length || !files.length) return { text: "", files: files.length };
	type Hit = { f: number; i: number; s: number };
	const hits: Hit[] = [];
	const texts: string[][] = [];
	let bytes = 0;
	for (const [f, p] of files.entries()) {
		texts.push([]);
		try {
			const st = statSync(p);
			if (st.size > 3_000_000 || bytes > 50_000_000) continue;
			bytes += st.size;
			let t = decodeText(readFileSync(p)).text;
			if (/\.html?$/i.test(p))
				t = t
					.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
					.replace(/<(br|p|div|li|h\d|tr|pre)[^>]*>/gi, "\n")
					.replace(/<[^>]+>/g, " ")
					.replace(/&lt;/g, "<")
					.replace(/&gt;/g, ">")
					.replace(/&quot;/g, '"')
					.replace(/&#39;/g, "'")
					.replace(/&nbsp;/g, " ")
					.replace(/&amp;/g, "&");
			const lines = t.split(/\r?\n/);
			texts[f] = lines;
			for (const [i, l] of lines.entries()) {
				const low = l.toLowerCase();
				const s = words.filter((w) => low.includes(w)).length;
				if (s) hits.push({ f, i, s });
			}
		} catch {}
	}
	hits.sort((a, b) => b.s - a.s || a.f - b.f || a.i - b.i);
	const byFile = new Map<number, number[]>();
	for (const h of hits.slice(0, 60)) byFile.set(h.f, [...(byFile.get(h.f) || []), h.i]);
	const out: string[] = [];
	let size = 0;
	const rel = (p: string) => p.slice(dir.length).replace(/^[\\/]+/, "").split("\\").join("/");
	for (const [f, is] of byFile) {
		const lines = texts[f];
		const show = new Set<number>();
		for (const i of is.sort((a, b) => a - b).slice(0, 6)) for (const k of [i - 1, i, i + 1]) if (k >= 0 && k < lines.length && lines[k].trim()) show.add(k);
		const block = [`=== ${rel(files[f])}`, ...[...show].sort((a, b) => a - b).map((k) => `${k + 1}: ${lines[k].trim().slice(0, 200)}`)].join("\n");
		if (size + block.length > max) break;
		out.push(block);
		size += block.length + 1;
	}
	return { text: out.join("\n"), files: files.length };
}

/** 찾은 설명 -> 모델·사람이 읽을 글 (max 자까지: 머리·시그니처 -> 설명 앞부분 -> 맞는 하위 이름 -> 문서 폴더 -> 그 밖의 이름 차례로 자리를 줌) */
export function formatDocs(d: DocsInfo, query: string, folder: { text: string; files: number; dir: string }, max = DOCS_MAX): string {
	const py = d.python ? `Python ${d.python}${d.exe ? ` (${d.exe})` : ""}` : "";
	const folderPart = folder.text ? `문서 폴더(${tilde(folder.dir)})에서 찾은 줄:\n${folder.text}` : "";
	const parts: string[] = [];
	let room = max;
	const put = (s: string, cap = room) => {
		if (!s || room <= 0) return;
		const t = s.length > Math.min(cap, room) ? `${s.slice(0, Math.max(0, Math.min(cap, room) - 1))}…` : s;
		parts.push(t);
		room -= t.length + 1;
	};
	if (d.error) {
		put(`=== ${d.name}: 찾지 못함 (${d.error})`);
		put(py);
		if (d.close?.length) put(`비슷한 이름: ${d.close.join(", ")}`);
		put("설치 이름(pip)과 불러오는 이름이 다를 수 있습니다 (예: scikit-learn → sklearn, opencv-python → cv2, pyyaml → yaml)");
		put(folderPart);
		return parts.join("\n");
	}
	const ver = d.version ? ` · ${d.dist} ${d.version}` : "";
	put(`=== ${d.path} (${KIND_KO[d.kind || ""] || d.kind})${ver}${py ? ` · ${py}` : ""}`);
	if (d.missing) put(`'${d.missing}' 는 ${d.path} 에 없습니다. 아래 하위 이름에서 고르세요`);
	if (d.file) put(`파일: ${d.file}`);
	if (d.signature) put(`시그니처: ${d.path?.split(".").pop()}${d.signature}`, 800);
	if (d.doc) {
		const lines = d.doc.split("\n");
		let s = "";
		let k = 0;
		for (; k < lines.length && s.length + lines[k].length < 2000; k++) s += `${lines[k]}\n`;
		put(`설명:\n${s.trimEnd()}${k < lines.length ? `\n(… 설명 ${lines.length - k}줄 더: 파일에서 읽기)` : ""}`, 2200);
	}
	const ms = d.members || [];
	if (ms.length) {
		const head = d.matched ? `'${query}' 에 맞는 하위 이름 ${ms.length}개 (모두 ${d.count}개):` : `하위 이름 (모두 ${d.count}개, 처음 ${ms.length}개):`;
		const rows = ms.map((x) => `- ${x.name}${x.sig || (x.kind === "class" ? " (클래스)" : x.kind === "module" ? " (모듈)" : "")}${x.doc ? ` — ${x.doc}` : ""}`.slice(0, 300));
		put([head, ...rows].join("\n"), 1600);
	} else if (d.matched && d.count) put(`'${query}' 에 맞는 하위 이름 없음 (모두 ${d.count}개)`);
	put(folderPart, 1500);
	const shownNames = new Set(ms.map((x) => x.name));
	const others = (d.names || []).filter((n) => !shownNames.has(n));
	if (others.length) {
		let s = "";
		let k = 0;
		for (; k < others.length && s.length + others[k].length < 500; k++) s += `${k ? ", " : ""}${others[k]}`;
		put(`그 밖의 이름: ${s}${k < others.length ? ` … (${(d.count || others.length) - shownNames.size - k}개 더)` : ""}`);
	}
	if (d.submodules?.length) put(`하위 모듈: ${d.submodules.slice(0, 40).join(", ")}${d.submodules.length > 40 ? ` … (${d.submodules.length - 40}개 더)` : ""}`);
	put(`더 보기: docs_lookup name="${d.path}.<이름>" (query 로 좁히기)`);
	return parts.join("\n");
}

type Proc = { code: number | null; out: string };
function runProc(cmd: string, args: string[], ms: number): Promise<Proc> {
	return new Promise((ok) => {
		let out = "";
		let done = false;
		const env = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONWARNINGS: "ignore", PYTHONDONTWRITEBYTECODE: "1", TF_CPP_MIN_LOG_LEVEL: "3" };
		let ch: ReturnType<typeof spawn>;
		try {
			ch = spawn(cmd, args, { windowsHide: true, env });
		} catch (e) {
			return ok({ code: null, out: `(실행하지 못함: ${(e as Error).message})` });
		}
		const finish = (code: number | null, extra = "") => {
			if (done) return;
			done = true;
			ok({ code, out: out + extra });
		};
		const t = setTimeout(() => {
			ch.kill();
			finish(null, "\n(시간 초과로 멈춤)");
		}, ms);
		ch.stdout?.on("data", (d) => (out += d));
		ch.stderr?.on("data", () => {}); // 불러오는 패키지의 경고는 버림
		ch.on("error", (e) => {
			clearTimeout(t);
			finish(null, `\n(실행하지 못함: ${e.message})`);
		});
		ch.on("close", (code) => {
			clearTimeout(t);
			finish(code);
		});
	});
}

/** 이 컴퓨터의 Python 후보 (차례대로): 작업 폴더의 가상 환경, 켜 둔 가상 환경·conda, pi 가 찾은 Python, PATH */
export function pythonCandidates(cwd: string, env = process.env, win = process.platform === "win32"): string[][] {
	const inEnv = win ? ["Scripts/python.exe", "python.exe"] : ["bin/python3", "bin/python"];
	const c: string[][] = [];
	for (const d of [".venv", "venv"]) for (const v of inEnv) c.push([join(cwd, d, v)]);
	for (const e of [env.VIRTUAL_ENV, env.CONDA_PREFIX]) if (e) for (const v of inEnv) c.push([join(e, v)]);
	if (env.PI_PYTHON_EXE) c.push([env.PI_PYTHON_EXE]);
	c.push(["python3"], ["python"]);
	if (win) c.push(["py", "-3"]);
	return c;
}
const pyCache = new Map<string, string[] | null>();
async function localPython(cwd: string): Promise<string[] | null> {
	if (pyCache.has(cwd)) return pyCache.get(cwd) ?? null;
	let found: string[] | null = null;
	for (const c of pythonCandidates(cwd)) {
		if (/[\\/]/.test(c[0]) && !existsSync(c[0])) continue;
		const r = await runProc(c[0], [...c.slice(1), "-c", "import sys; print(sys.executable)"], 15000);
		if (r.code === 0 && r.out.trim()) {
			found = c;
			break;
		}
	}
	pyCache.set(cwd, found);
	return found;
}
/** 노트북에서: 작업 폴더의 가상 환경, conda, pi 가 찾은 Python, python3, python 가운데 돌아가는 것으로 */
export function notebookDocsCommand(name: string, query: string): string {
	return [
		'PY=""',
		'for c in "$PWD/.venv/bin/python" "$PWD/venv/bin/python" "${CONDA_PREFIX:+$CONDA_PREFIX/bin/python}" "${PI_PYTHON_EXE:-}" python3 python; do',
		"  [ -n \"$c\" ] && \"$c\" -c 'import sys' >/dev/null 2>&1 && PY=\"$c\" && break",
		"done",
		"[ -n \"$PY\" ] || { echo '@@DOCS@@{\"name\":\"\",\"error\":\"python\"}'; exit 0; }",
		`PYTHONIOENCODING=utf-8 PYTHONWARNINGS=ignore PYTHONDONTWRITEBYTECODE=1 TF_CPP_MIN_LOG_LEVEL=3 timeout 40 "$PY" - ${shq(name)} ${shq(query)} <<'PIDOCSEOF' 2>/dev/null`,
		DOCS_PY.trimEnd(),
		"PIDOCSEOF",
	].join("\n");
}

/** 찾기: 설치된 Python 패키지(지금 실행 위치) + 문서 폴더 -> 글 */
export async function lookupDocs(name: string, query: string): Promise<string> {
	const n = name.trim();
	const q = query.trim();
	if (!n) throw new Error("name 에 Python 모듈·클래스·함수 경로를 주세요 (예: torch.utils.tensorboard.SummaryWriter)");
	const wd = workDir();
	let info: DocsInfo | null;
	let raw = "";
	if (wd.remote) {
		raw = (await nbRun(notebookDocsCommand(n, q), wd.cwd || wd.home || "/")).out;
	} else {
		const py = await localPython(wd.cwd);
		if (!py) raw = '@@DOCS@@{"name":"","error":"python"}';
		else raw = (await runProc(py[0], [...py.slice(1), "-c", DOCS_PY, n, q], 40000)).out;
	}
	info = parseDocs(raw);
	const dir = docsDir();
	const folder = { ...searchDocs(dir, docWords(n, q)), dir };
	if (info?.error === "python")
		info = { name: n, error: `${wd.remote ? "노트북" : "이 컴퓨터"}에서 돌아가는 Python 을 찾지 못함 (작업 폴더의 .venv, PATH 의 python3·python)` };
	if (!info) info = { name: n, error: `설명을 읽지 못함${/시간 초과/.test(raw) ? " (40초 안에 불러오지 못함)" : ""}: ${raw.replace(/\s+/g, " ").trim().slice(-200)}` };
	if (!info.name) info.name = n;
	return formatDocs(info, q, folder);
}

// ---------------------------------------------------------------------------------------------------------------
// 팀 공유 폴더: <폴더>/skills/<이름>/SKILL.md, <폴더>/prompts/<이름>.md 를 settings.json 의 skills·prompts 목록에 등록
// ---------------------------------------------------------------------------------------------------------------
const settingsFile = join(agentDir, "settings.json");
const norm = (p: string) => p.split("\\").join("/").replace(/\/+$/, "").toLowerCase();
/** 입력한 폴더 -> 절대 경로 (~, Git Bash 형식 /c/..., 역슬래시도 받음) */
function folder(arg: string, cwd: string): string {
	let s = arg.trim().replace(/^["']|["']$/g, "").split("\\").join("/");
	const m = s.match(/^\/([a-zA-Z])(\/.*)?$/);
	if (m && process.platform === "win32") s = `${m[1].toUpperCase()}:${m[2] || "/"}`;
	if (s === "~" || s.startsWith("~/")) s = homedir().split("\\").join("/") + s.slice(1);
	return (isAbsolute(s) || s.startsWith("//") ? s : resolve(cwd, s).split("\\").join("/")).replace(/\/+$/, "");
}
function readSettings(): any {
	const text = readFileSync(settingsFile, "utf8").replace(/^\uFEFF/, "");
	const v = JSON.parse(text);
	if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("settings.json 이 { } 형식이 아닙니다");
	return v;
}
function writeSettings(v: any) {
	copyFileSync(settingsFile, settingsFile + ".bak");
	writeFileSync(settingsFile, JSON.stringify(v, null, 2) + "\n");
}
const shared = (v: any) => [...(v.skills || []), ...(v.prompts || [])] as string[];

export default function (pi: ExtensionAPI) {
	let shown: string | null = null; // 지금 띄운 것 ("kit" | "doctor")
	const show = (ctx: any, what: string, lines: string[] | undefined) => {
		// 한 덩어리로 넘김: pi 화면은 줄 목록을 10줄까지만 보여 줌 (/doctor 요약이 잘림)
		ctx.ui.setWidget("pi-kit", lines && [lines.join("\n")]);
		shown = lines ? what : null;
	};
	// /exit: pi 의 끝내기 명령은 /quit 이다. 다른 도구 습관으로 /exit 을 치면 요청으로 보내지므로 같은 일을 하게 한다
	pi.registerCommand("exit", {
		description: "pi 끝내기 (/quit 과 같음)",
		handler: async (_args, ctx) => {
			ctx.shutdown();
		},
	});
	pi.registerCommand("kit", {
		description: "pi 빠른 도움말. /kit share <폴더> 로 팀 공유 폴더의 스킬·명령 등록, /kit unshare <폴더> 로 빼기, /kit env 로 실행 환경(버전) 조사",
		handler: async (args, ctx) => {
			const [sub, ...rest] = (args || "").trim().split(/\s+/);
			if (sub === "share" || sub === "unshare") return share(sub, rest.join(" "), ctx);
			if (sub === "env") return env(ctx);
			if (shown === "kit") return show(ctx, "kit", undefined);
			show(ctx, "kit", helpLines());
		},
	});

	pi.on("before_agent_start", async (event: any) => addKitGuides(event?.systemPromptOptions?.promptGuidelines));

	// /kit env 로 지침에 적은 실행 환경은 pi 를 시작할 때 읽으므로, 지금 대화에는 다음 요청 앞에 붙여 바로 알린다
	// (/reload 는 Copilot 새 대화를 열어 느리므로 쓰지 않음. /remember 와 같은 방식)
	const E: { note: string } = ((globalThis as any).__piKitEnv ||= { note: "" });
	pi.on("session_start", async (event: any) => {
		if (event?.reason !== "reload") E.note = "";
	});
	pi.on("input", async (event: any) => {
		if (!E.note || !event.text || event.text.startsWith("/")) return;
		const text = `${E.note}\n\n${event.text}`;
		E.note = "";
		return transformInput(event.text, text);
	});

	async function env(ctx: any) {
		const wd = workDir();
		const bridge = isBridge();
		const place = wd.remote || !bridge ? "notebook" : "pc";
		const where = wd.remote ? "Kubeflow 노트북 (jupyter 모드)" : bridge ? "이 PC (Git Bash)" : "이 노트북";
		ctx.ui.notify(`${where}의 실행 환경을 조사하는 중입니다 (읽기만 함)...`, "info");
		let out: string;
		try {
			out = wd.remote ? (await nbRun(ENV_PROBE, wd.home || wd.cwd)).out : await run("bash", ["-c", ENV_PROBE], 60000);
		} catch (e) {
			return ctx.ui.notify(`실행 환경을 조사하지 못했습니다: ${(e as Error).message}`, "error");
		}
		const items = parseEnv(out);
		if (!items.length) return ctx.ui.notify(`조사 결과를 읽지 못했습니다: ${out.trim().slice(0, 300) || "(출력 없음)"}`, "error");
		const list = items.map(([k, v]) => `- ${k}: ${v}`).join("\n");
		const ok = await ctx.ui.confirm(
			"실행 환경",
			`${where}\n${list}\n\n내 지침(${A}/AGENTS.md)의 '실행 환경' 부분에 적을까요? 다음 요청부터 pi 가 이 버전에 맞춰 일합니다.`,
		);
		if (!ok) return;
		const file = join(agentDir, "AGENTS.md");
		const d = new Date();
		const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		try {
			writeFileSync(file, putEnv(read(file), place, where, items, date));
		} catch (e) {
			return ctx.ui.notify(`${A}/AGENTS.md 에 적지 못했습니다: ${(e as Error).message}`, "error");
		}
		E.note = `(사용자가 /kit env 로 실행 환경을 조사해 지침에 적었습니다. 코드와 명령은 이 버전에 맞춰 주세요: ${where} / ${items
			.map(([k, v]) => `${k} ${v}`)
			.join(" / ")})`;
		ctx.ui.notify(`${A}/AGENTS.md 에 '실행 환경: ${where}' 을 적었습니다. 다음 요청부터 반영합니다 (다시 조사: /kit env).`, "info");
	}
	async function share(sub: string, arg: string, ctx: any) {
		let v: any;
		try {
			v = readSettings();
		} catch (e) {
			return ctx.ui.notify(`settings.json 을 읽지 못했습니다: ${(e as Error).message}`, "error");
		}
		if (!arg) {
			const list = shared(v);
			return ctx.ui.notify(list.length ? `등록된 공유 폴더: ${list.join(", ")}` : "등록된 공유 폴더가 없습니다. /kit share <폴더>", "info");
		}
		const dir = folder(arg, process.cwd());
		const subs = { skills: `${dir}/skills`, prompts: `${dir}/prompts` };
		if (sub === "unshare") {
			let n = 0;
			for (const key of ["skills", "prompts"] as const) {
				if (!Array.isArray(v[key])) continue;
				const keep = v[key].filter((x: string) => norm(x) !== norm(subs[key]) && norm(x) !== norm(dir));
				n += v[key].length - keep.length;
				if (keep.length) v[key] = keep;
				else delete v[key];
			}
			if (!n) return ctx.ui.notify(`등록되어 있지 않은 폴더입니다: ${dir}`, "warning");
			writeSettings(v);
			ctx.ui.notify(`공유 폴더 등록을 뺐습니다: ${dir}. 다시 읽는 중...`, "info");
			return ctx.reload();
		}
		let isDir = false;
		try {
			isDir = statSync(dir).isDirectory();
		} catch {}
		if (!isDir) return ctx.ui.notify(`그 폴더가 없거나 열 수 없습니다: ${dir}`, "error");
		const missing = (["skills", "prompts"] as const).filter((k) => !existsSync(subs[k]));
		if (missing.length === 2) {
			const ok = await ctx.ui.confirm(
				"공유 폴더 만들기",
				`${dir} 안에 skills·prompts 폴더가 없습니다. 새로 만들까요?\n(스킬: skills/<이름>/SKILL.md, 명령: prompts/<이름>.md)`,
			);
			if (!ok) return;
			for (const k of missing) mkdirSync(subs[k], { recursive: true });
		}
		const added: string[] = [];
		for (const key of ["skills", "prompts"] as const) {
			if (!existsSync(subs[key])) continue;
			const list: string[] = Array.isArray(v[key]) ? v[key] : [];
			if (list.some((x) => norm(x) === norm(subs[key]))) continue;
			v[key] = [...list, subs[key]];
			added.push(subs[key]);
		}
		if (!added.length) return ctx.ui.notify(`이미 등록된 폴더입니다: ${dir}`, "info");
		writeSettings(v);
		ctx.ui.notify(`공유 폴더를 등록했습니다: ${added.join(", ")}. 다시 읽는 중...`, "info");
		return ctx.reload();
	}
	// ── /watch ──────────────────────────────────────────────────────────────
	const note = (ctx: any, msg: string, level = "info") => {
		try {
			if (WS.ctx === ctx) ctx.ui.notify(msg, level);
		} catch {}
	};
	const paint = (ctx: any) => {
		try {
			const w = WS.w;
			if (!w) return ctx.ui.setStatus("watch", undefined);
			const fg = (c: string, s: string) => (ctx.ui.theme?.fg ? ctx.ui.theme.fg(c, s) : s);
			const name = fileName(w.t);
			if (w.exit !== null) {
				const s = watchStatus(name, [w.exit === 0 ? "끝남" : `오류로 끝남 exit=${w.exit}`, ago(w.ended - w.started), "/watch 보내기"], "");
				return ctx.ui.setStatus("watch", fg(w.exit === 0 ? "success" : "error", s));
			}
			const now = Date.now();
			const still = w.size >= 0 && now - w.grew >= IDLE_MS;
			const parts = [ago(now - w.started), w.error ? "읽지 못함" : still ? `${ago(now - w.grew)}째 그대로` : ""];
			ctx.ui.setStatus("watch", fg(w.error || still ? "warning" : "muted", watchStatus(name, parts, w.last[w.last.length - 1] || "")));
		} catch {}
	};
	const watchStop = () => {
		if (WS.timer) clearInterval(WS.timer);
		WS.timer = null;
	};
	const watchArm = () => {
		watchStop();
		if (!WS.ctx || !WS.w || WS.w.exit !== null) return;
		WS.timer = setInterval(() => void watchTick(), WATCH_MS);
		(WS.timer as any).unref?.();
	};
	/** 로그 끝부분을 pi 에게 요청으로 보냄. 끝난 작업이면 지켜보기도 끝 */
	const watchSend = (ctx: any, w: Watch, ask: string) => {
		let body = w.last.slice(-40).join("\n");
		if (body.length > 4000) body = "…" + body.slice(-4000);
		const where = shownPath(w.t);
		const head =
			w.exit === null
				? `지켜보는 로그 ${where} 의 끝부분입니다 (아직 진행 중, 지켜본 지 ${ago(Date.now() - w.started)}).`
				: `작업이 ${w.exit === 0 ? "끝났습니다" : `오류로 끝났습니다 (exit ${w.exit})`}. 로그 ${where} 의 끝부분입니다.`;
		const req = ask || (w.exit === null ? "진행 상황을 짧게 정리해 주세요." : w.exit === 0 ? "결과를 짧게 정리해 주세요." : "오류의 원인과 고칠 곳을 찾아 주세요.");
		const text = `${head}\n\`\`\`\n${body || "(빈 로그)"}\n\`\`\`\n${req}`;
		if (w.exit !== null && WS.w === w) {
			WS.w = null;
			paint(ctx);
		}
		try {
			if (ctx.isIdle()) return void pi.sendUserMessage(text);
			pi.sendUserMessage(text, { deliverAs: "followUp" });
			note(ctx, "지금 하는 작업이 끝나면 보냅니다", "info");
		} catch (e) {
			note(ctx, `보내지 못했습니다: ${(e as Error).message}`, "error");
		}
	};
	/** 끝남: 벨과 알림. ask: 쉬고 있으면 끝부분을 보낼지 물음 (/watch 보내기 로 부를 때는 묻지 않음) */
	const watchDone = async (ctx: any, w: Watch, code: number, ask: boolean) => {
		w.exit = code;
		w.ended = Date.now();
		watchStop();
		paint(ctx);
		if (!ask) return;
		try {
			if (ctx.mode === "tui") process.stdout.write("\x07"); // 터미널 벨
		} catch {}
		const where = shownPath(w.t);
		const took = ago(w.ended - w.started);
		const msg = code === 0 ? `작업이 끝났습니다: ${where} (exit 0, 지켜본 지 ${took})` : `작업이 오류로 끝났습니다: ${where} (exit ${code}, 지켜본 지 ${took})`;
		let asking = false;
		try {
			// 쉬고 있고 편집기가 비어 있을 때만 물음 (요청을 쓰는 중이면 그 입력을 가로채지 않게)
			asking = ctx.isIdle() && !(ctx.ui.getEditorText?.() || "").trim();
		} catch {}
		// 알림(info)은 잇달아 띄우면 앞의 것을 덮어쓰므로 한 번에
		note(ctx, asking ? msg : `${msg}. 결과를 pi 에게 보여 주려면 /watch 보내기`, code === 0 ? "info" : "warning");
		if (!asking) return;
		try {
			const ok = await ctx.ui.confirm("작업 끝", `${where} 의 끝부분 ${Math.min(40, w.last.length)}줄을 pi 에게 보내 결과를 정리할까요? (나중에: /watch 보내기)`);
			if (ok && WS.ctx === ctx && WS.w === w) watchSend(ctx, w, "");
		} catch {}
	};
	/** 로그를 한 번 읽어 상태를 고침. 끝났으면 알림 (ask: watchDone 참고). 어떤 오류도 밖으로 내보내지 않음 (타이머에서 부름) */
	const watchTick = async (ask = true) => {
		const ctx = WS.ctx;
		const w = WS.w;
		if (!ctx || !w || w.exit !== null || WS.busy) return;
		WS.busy = true;
		try {
			let r: Tail;
			try {
				// 중계 서버가 답하지 않아도 다음 확인은 하도록 (그 요청은 버림)
				let timer: ReturnType<typeof setTimeout> | undefined;
				const late = new Promise<never>((_, no) => (timer = setTimeout(() => no(new Error("90초 동안 답이 없음")), 90000)));
				r = await Promise.race([readTail(w), late]).finally(() => clearTimeout(timer));
				w.error = "";
			} catch (e) {
				w.error = (e as Error).message || String(e);
				return;
			}
			if (WS.w !== w || WS.ctx !== ctx) return; // 그 사이에 끄거나 바꾸거나 세션이 끝남
			const now = Date.now();
			if (!r) {
				if (++w.miss >= 3) {
					WS.w = null;
					watchStop();
					note(ctx, `지켜보던 로그가 없어져 지켜보기를 멈췄습니다: ${shownPath(w.t)}`, "warning");
				}
				return;
			}
			w.miss = 0;
			if (r.size !== w.size) {
				if (w.size >= 0) {
					w.grew = now;
					w.idleNoted = false;
				}
				w.size = r.size;
				if (r.text !== undefined) w.last = tailLines(r.text, 40, r.fromMiddle);
			}
			const code = doneExit(w.last);
			if (code !== null) return void watchDone(ctx, w, code, ask);
			if (!w.idleNoted && now - w.grew >= IDLE_MS) {
				w.idleNoted = true;
				note(ctx, `지켜보는 로그가 ${ago(now - w.grew)}째 그대로입니다: ${shownPath(w.t)}. 끝났거나 멈췄을 수 있습니다 (/watch 끝부분 보기 · /watch 보내기 · /watch 끄기)`, "warning");
			}
		} catch {
		} finally {
			WS.busy = false;
			if (WS.ctx === ctx) paint(ctx);
		}
	};
	/** 지켜보기 시작 (하나만: 앞의 것은 멈춤). 파일이 없으면 false */
	const watchStart = async (ctx: any, path: string, auto: boolean): Promise<boolean> => {
		const t = target(path);
		const prev = WS.w;
		const now = Date.now();
		const w: Watch = { t, started: now, size: -1, grew: now, last: [], exit: null, ended: 0, idleNoted: false, miss: 0, shell: false, error: "" };
		let r: Tail;
		try {
			r = await readTail(w);
		} catch (e) {
			note(ctx, `로그를 읽지 못했습니다: ${shownPath(t)} (${(e as Error).message})`, "error");
			return false;
		}
		if (!r) {
			note(ctx, `그 로그 파일이 없습니다: ${shownPath(t)}`, auto ? "warning" : "error");
			return false;
		}
		w.size = r.size;
		w.last = tailLines(r.text || "", 40, r.fromMiddle);
		WS.w = w;
		watchArm();
		const same = prev && prev.t.abs === t.abs && prev.t.remote === t.remote;
		const was = prev && prev.exit === null && !same ? ` (앞에서 지켜보던 ${fileName(prev.t)} 는 멈춤)` : "";
		const code = doneExit(w.last);
		if (code !== null) {
			note(ctx, `이미 끝난 로그입니다 (exit ${code}): ${shownPath(t)}${was}`, "info");
			w.exit = code;
			w.ended = now;
			watchStop();
		} else note(ctx, `로그를 지켜봅니다: ${shownPath(t)}${was}. ${WATCH_MS / 1000}초마다 확인, 끝나면 벨·알림 (/watch 상태 · /watch 끄기)`, "info");
		paint(ctx);
		return true;
	};
	const watchShow = (ctx: any) => {
		const w = WS.w;
		if (!w)
			return note(
				ctx,
				"지켜보는 로그가 없습니다. /watch <로그 파일> 로 시작합니다. 긴 학습은 nohup 으로 돌리고 로그를 지켜보세요 " +
					"(kubeflow-notebook 스킬의 '오래 걸리는 작업': 그 방식으로 돌리면 저절로 지켜봄)",
				"info",
			);
		const now = Date.now();
		const state =
			w.exit !== null
				? `${w.exit === 0 ? "끝남" : `오류로 끝남 (exit ${w.exit})`}, 지켜본 시간 ${ago(w.ended - w.started)}`
				: `지켜본 지 ${ago(now - w.started)}, 마지막으로 늘어난 지 ${ago(now - w.grew)}${w.error ? `, 읽지 못함: ${w.error}` : ""}`;
		const lines = w.last.slice(-8).map((l) => "  " + (l.length > 160 ? l.slice(0, 159) + "…" : l));
		note(
			ctx,
			[`지켜보는 로그: ${shownPath(w.t)} (${w.size >= 0 ? sizeText(w.size) : "?"}, ${state})`, ...lines, "/watch 보내기 [요청] 끝부분을 pi 에게 · /watch 끄기"].join("\n"),
			"info",
		);
	};
	pi.registerCommand("watch", {
		description: "긴 학습 지켜보기: /watch <로그> 시작 (끝나면 벨·알림) · /watch 상태 · /watch 보내기 [요청] 끝부분을 pi 에게 · /watch 끄기",
		handler: async (args, ctx) => {
			WS.ctx = ctx;
			const arg = (args || "").trim();
			const [sub, ...rest] = arg.split(/\s+/);
			if (!arg) return watchShow(ctx);
			if (sub === "끄기" || sub === "stop" || sub === "off") {
				const w = WS.w;
				WS.w = null;
				watchStop();
				paint(ctx);
				return note(ctx, w ? `지켜보기를 멈췄습니다: ${shownPath(w.t)} (작업은 그대로 돕니다)` : "지켜보는 로그가 없습니다", "info");
			}
			if (sub === "보내기" || sub === "send") {
				const w = WS.w;
				if (!w) return note(ctx, "지켜보는 로그가 없습니다. /watch <로그 파일> 로 시작합니다", "warning");
				if (w.exit === null) await watchTick(false); // 지금 끝부분으로
				if (WS.w !== w) return;
				return watchSend(ctx, w, rest.join(" "));
			}
			await watchStart(ctx, arg.replace(/^["']|["']$/g, ""), false);
		},
	});
	// 스킬의 실행 방식(nohup ... ; echo "[pi-watch] <로그>")으로 돌린 작업은 저절로 지켜봄
	pi.on("tool_result", async (event: any, ctx: any) => {
		try {
			if (event?.toolName !== "bash" || !ctx?.hasUI || !Array.isArray(event.content)) return;
			const text = event.content.map((c: any) => (c?.type === "text" ? c.text : "")).join("\n");
			const p = text.includes("[pi-watch] ") ? watchMarker(text) : null;
			if (!p) return;
			WS.ctx = ctx;
			await watchStart(ctx, p, true);
		} catch {}
	});
	pi.on("session_start", async (_event: unknown, ctx: any) => {
		watchStop();
		WS.busy = false;
		WS.ctx = ctx?.hasUI ? ctx : null;
		if (!WS.ctx || !WS.w) return;
		paint(ctx);
		watchArm();
		if (WS.w.exit === null) void watchTick();
	});
	pi.on("session_shutdown", async (_event: unknown, ctx: any) => {
		watchStop();
		try {
			if (ctx?.hasUI && WS.w) ctx.ui.setStatus("watch", undefined);
		} catch {}
		WS.ctx = null;
	});

	pi.registerTool({
		name: "docs_lookup",
		label: "문서 찾기",
		description:
			"설치된 라이브러리의 설명 찾기 (인터넷 대신 지금 실행 위치에 설치된 버전에서). name 에 Python 모듈·클래스·함수 경로 (예: torch.utils.tensorboard.SummaryWriter), " +
			"query 에 찾을 말 (하위 이름·설명에서). 버전·시그니처·설명·하위 이름과 문서 폴더(~/pi-docs)에서 맞는 줄을 돌려준다",
		promptSnippet: "설치된 라이브러리의 버전·시그니처·설명과 문서 폴더(~/pi-docs) 찾기",
		promptGuidelines: [DOCS_GUIDE],
		parameters: Type.Object({
			name: Type.String({ description: "Python 모듈·클래스·함수 경로 (예: tensorboard, torch.utils.tensorboard.SummaryWriter.add_scalar)" }),
			query: Type.Optional(Type.String({ description: "찾을 말 (예: scalar smoothing). 하위 이름·설명과 문서 폴더에서 찾음" })),
		}),
		async execute(_id: string, params: any) {
			const text = await lookupDocs(String(params.name || ""), String(params.query || ""));
			return { content: [{ type: "text" as const, text }], details: undefined };
		},
	});
	pi.registerCommand("docs", {
		description: "설치된 라이브러리의 설명 보기 (모델에게 묻지 않음): /docs <모듈[.이름]> [찾을 말]. 문서 폴더 ~/pi-docs 도 찾음",
		handler: async (args, ctx) => {
			const [name = "", ...rest] = String(args || "").trim().split(/\s+/);
			if (!name) {
				if (shown === "docs") return show(ctx, "docs", undefined);
				const dir = docsDir();
				const n = existsSync(dir) ? searchDocs(dir, []).files : -1;
				return show(ctx, "docs", [
					"── 문서 찾기 (닫기: /docs 다시 입력) ──",
					" 사용법  /docs <모듈[.이름]> [찾을 말]   예) /docs torch.utils.tensorboard.SummaryWriter scalar",
					`         지금 실행 위치(${workDir().remote ? "노트북" : "이 컴퓨터"})에 설치된 버전의 시그니처·설명·하위 이름을 봅니다. pi 도 필요할 때 docs_lookup 으로 찾습니다`,
					` 문서 폴더  ${tilde(dir)} ${n < 0 ? "(없음: 만들고 받아 둔 문서 .md·.txt·.html 를 넣으면 함께 찾음)" : `(문서 ${n}개)`}`,
				]);
			}
			ctx.ui.notify(`${name} 의 설명을 찾는 중입니다 (패키지를 불러오느라 몇 초 걸릴 수 있음)...`, "info");
			let text: string;
			try {
				text = await lookupDocs(name, rest.join(" "));
			} catch (e) {
				return ctx.ui.notify(`찾지 못했습니다: ${(e as Error).message}`, "error");
			}
			show(ctx, "docs", [`── /docs ${name}${rest.length ? ` ${rest.join(" ")}` : ""} (닫기: /docs) ──`, text]);
		},
	});

	pi.registerCommand("doctor", {
		description: isBridge()
			? "상태 요약 (버전 번호, Node, 중계 서버, 전용 창, 모델, 최근 요청, 최근 로그). 문제가 생기면 이 화면을 찍어 보내 주세요"
			: "상태 요약 (버전 번호, pi 폴더, Node). 문제가 생기면 이 화면을 찍어 보내 주세요",
		handler: async (_args, ctx) => {
			if (shown === "doctor") return show(ctx, "doctor", undefined);
			ctx.ui.notify("상태를 확인하는 중입니다 (몇 초 걸림)...", "info");
			show(ctx, "doctor", await doctorLines());
		},
	});
	pi.on("agent_start", async (_event: unknown, ctx: any) => {
		if (shown && ctx.hasUI) show(ctx, shown, undefined);
	});
}
