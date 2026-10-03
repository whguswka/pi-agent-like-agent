/**
 * 작업 방식 (/plan, /mode): 계획부터 세우고 승인받아 진행 / 바꿀 때마다 확인 / 자동
 *
 *  /plan            계획 모드 켜기·끄기. 켜면 파일을 바꾸거나 명령을 실행하지 않고 계획부터 세운다
 *  /plan <요청>     계획 모드로 바꾸고 바로 요청 (다른 작업 중이면 그 작업이 끝난 뒤)
 *  /mode            모드 고르기 (계획 / 확인 / 자동). /mode ask 처럼 바로 바꿀 수도 있음
 *
 *  - 계획: read 와 읽기 전용 명령(ls, cat, grep, git status·diff·log 등)만 실행한다. write·edit 와 그 밖의 명령은 막고
 *          LLM 에게 계획으로 적으라고 알린다. 요청마다 앞에 "[계획 모드] ..." 안내를 붙인다.
 *          번호 붙인 단계가 2개 이상인 답이 오면 "이 계획대로 진행할까요?" 를 묻고, 고른 모드(자동 또는 확인)로 바꿔
 *          진행을 요청한다. 고르지 않으면(Esc) 계획 모드 그대로 (고칠 점을 적어 보내면 됨)
 *  - 확인: 파일을 쓰거나 고치기 전, 읽기 전용이 아닌 명령을 실행하기 전에 바뀌는 내용을 보여 주고 묻는다
 *  - 자동: 묻지 않고 실행 (위험한 명령만 guard.ts 가 묻는다)
 *  - 처음 모드는 내 설정 파일 ~/.pi/agent/bridge.json 의 "default_mode": "plan" | "ask" | "auto" (기본 auto)
 *  - 진행한 계획은 단계 목록으로 입력창 위에 보여 주고, LLM 이 "[N단계 완료]" 라고 적으면 체크한다.
 *    목록은 새 계획을 진행하거나 /plan·/mode 를 쓰면 닫히고, 모두 끝난 뒤에는 다음 요청을 보낼 때 닫힌다
 *  - guard.ts 와 함께: 계획·확인 모드에서는 guard 가 직접 묻지 않고 이유만 넘겨(event.guardReason) 여기서 한 번에 막거나 묻는다
 *  - 지금 모드는 상태 줄에 보인다 (자동이면 표시 없음)
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readTarget, shown, target } from "./lib/relay.ts";
import { base, parseShell, strip } from "./lib/shell.ts";

export type Mode = "plan" | "ask" | "auto";
const NAMES: Record<string, Mode> = { plan: "plan", 계획: "plan", ask: "ask", 확인: "ask", auto: "auto", 자동: "auto" };
const LABEL: Record<Mode, string> = { plan: "계획", ask: "확인", auto: "자동" };
(globalThis as any).__piMode ||= "auto"; // guard.ts 가 읽음 (guard 가 먼저 불러와지므로 처음부터 둠)

// ── 읽기 전용 명령 판단 ──────────────────────────────────────────────

/** 읽기만 하는 명령 (출력 리다이렉트 > 가 없을 때). for·fi·done 같은 셸 문법 낱말 포함 */
const READ = new Set(
	("ls dir tree pwd cd pushd popd sort cat zcat bzcat xzcat head tail grep egrep fgrep rg ag ack wc du df stat file which whereis where " +
		"type realpath readlink basename dirname diff cmp comm cut tr nl column jq yq echo printf true false test [ [[ : seq expr sleep " +
		"date cal id whoami groups uname ps pgrep free uptime nproc lscpu lsblk md5sum sha1sum sha256sum sha512sum cksum od hexdump " +
		"strings findstr printenv locale tasklist systeminfo ver set shopt read exit for in case esac fi done sed awk gawk find fd uniq xxd hostname " +
		"tar unzip zipinfo").split(" "),
);
/** 이름은 읽기용이지만 쓰거나 다른 명령을 실행하는 옵션이 있는 것: 그 옵션이 있으면 읽기 전용이 아님.
 *  짧은 옵션은 붙여 쓸 수 있으므로(sort -uo 파일, fd -Hx rm) 값을 받지 않는 옵션 글자 뒤에 와도 찾는다. 긴 이름은 앞부분만 써도 됨(--o) */
const WRITE_FLAG: Record<string, RegExp> = {
	sort: /^-[bcCdfghiMmnRrsuVz]*o|^--(o|co)/, // -o 파일, --output, --compress-program(다른 프로그램 실행)
	date: /^-[uR]*s|^--s/,
	yq: /^-[CMNPenr0vVhyYcjaS]*[is]|^--(inplace|in-place|split-exp)/, // -i 파일 고치기, -s(--split-exp) 파일로 나눠 쓰기
	tree: /^-[a-zA-Z]*o/, // tree 는 값을 다음 낱말에서 받으므로 -ao 파일 도 -o
	rg: /^--pre/,
	fd: /^-[HIusigFalLp01qhV]*[xX]|^--exec/,
};
/** 버전만 볼 때 (--version 등) 읽기 전용인 명령 */
const VERSION_ONLY = new Set(
	"python python3 py node java javac go gcc g++ cc make cmake rustc cargo deno bun perl ruby php dotnet mvn gradle tsc uv poetry kubectl helm docker conda pip pip3 npm git".split(" "),
);
/** 낱말 version 은 진짜 하위 명령일 때만 (make version·python version 은 그 이름의 대상·파일을 실행. kubectl·helm·docker·git 은 SPECIAL 에서) */
const isVersion = (name: string, args: string[]) =>
	args.length === 1 && (/^(--?version|-V|-VV)$/.test(args[0]) || (args[0] === "version" && (name === "go" || name === "cargo")));
const GIT_READ = new Set(
	("status log diff show blame annotate grep ls-files ls-tree ls-remote rev-parse rev-list describe shortlog cat-file name-rev merge-base " +
		"cherry count-objects whatchanged show-ref for-each-ref diff-tree diff-index diff-files help version check-ignore check-attr var").split(" "),
);

/** 옵션을 건너뛰고 첫 하위 명령 (git -C dir status -> status). withValue: 값을 따로 받는 옵션 */
function sub(args: string[], withValue: Set<string>): { name: string; rest: string[] } {
	for (let k = 0; k < args.length; k++) {
		const a = args[k];
		if (!a.startsWith("-") || a === "-") return { name: a, rest: args.slice(k + 1) };
		if (!a.includes("=") && withValue.has(a)) k++;
	}
	return { name: "", rest: [] };
}

function gitRead(args: string[]): boolean {
	const { name, rest } = sub(args, new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"]));
	// 하위 명령 앞의 -c 설정·--config-env 는 diff.external·core.pager 처럼 다른 프로그램을 실행하게 할 수 있음 (보기만 바꾸는 설정만 허용)
	const globals = name ? args.slice(0, args.length - rest.length - 1) : args;
	if (globals.some((a, k) => a.startsWith("--config-env") || (a === "-c" && !/^(core\.quotepath|color\.[\w.-]+)(=|$)/i.test(globals[k + 1] || "")))) return false;
	if (!name) return args.some((a) => a === "--version" || a === "--help");
	if (rest.some((a) => /^--output(=|$)|^--ext-diff$|^-O|^--open-files-in-pager/.test(a))) return false; // 파일로 쓰기, 다른 프로그램 실행
	if (GIT_READ.has(name)) return true;
	const flags = rest.filter((a) => a.startsWith("-"));
	const pos = rest.filter((a) => !a.startsWith("-"));
	switch (name) {
		case "branch":
			return !flags.some((a) => /^-[a-zA-Z]*[dDmMcCfu]|^--(delete|move|copy|force|set-upstream|unset-upstream|edit-description|track|no-track|create-reflog)/.test(a))
				&& (pos.length === 0 || flags.some((a) => /^(-l|--list|--contains|--no-contains|--merged|--no-merged|--points-at)$/.test(a)));
		case "tag":
			return !flags.some((a) => /^-[a-zA-Z]*[dasfmFu]|^--(delete|annotate|sign|force|message|file|local-user)/.test(a))
				&& (pos.length === 0 || flags.some((a) => /^(-l|--list)$/.test(a)));
		case "stash":
			return pos[0] === "list" || pos[0] === "show";
		case "remote":
			return pos.length === 0 || pos[0] === "show" || pos[0] === "get-url";
		case "config":
			if (flags.some((a) => /^(--unset|--unset-all|--add|--replace-all|--rename-section|--remove-section|--edit|-e)$/.test(a))) return false;
			return pos[0] === "get" || pos[0] === "list" || flags.some((a) => /^(--get|--get-all|--get-regexp|--get-urlmatch|-l|--list)$/.test(a)) || pos.length === 1;
		case "reflog":
			return pos.length === 0 || pos[0] === "show";
		case "worktree":
			return pos[0] === "list";
		case "submodule":
			return pos.length === 0 || pos[0] === "status";
		case "notes":
			return pos.length === 0 || pos[0] === "list" || pos[0] === "show";
		case "symbolic-ref":
			return pos.length <= 1 && !flags.some((a) => /^(-d|--delete)$/.test(a));
	}
	return false;
}

/** 이름 다음 낱말(하위 명령)이 목록에 있으면 읽기 전용 */
const subIn = (list: string, withValue: string[] = []) => {
	const ok = new Set(list.split("|"));
	const wv = new Set(withValue);
	return (args: string[]) => {
		const { name, rest } = sub(args, wv);
		return !!name && (ok.has(name) || ok.has(`${name} ${rest[0] || ""}`) || ok.has(`${name} ${sub(rest, wv).name}`));
	};
};
const helmRead = subIn("list|ls|status|get|history|show|search|version|env|template|lint", ["-n", "--namespace", "--kube-context", "--kubeconfig"]);
const SPECIAL: Record<string, (args: string[]) => boolean> = {
	git: gitRead,
	pip: subIn("list|show|freeze|check|index|inspect"),
	pip3: subIn("list|show|freeze|check|index|inspect"),
	conda: subIn("list|info|search|env list|config --show", ["-n", "--name", "-p", "--prefix"]),
	npm: subIn("ls|list|la|ll|view|info|show|outdated|root|prefix|explain|why|help|config get|config list"),
	kubectl: subIn(
		"get|describe|logs|top|version|explain|api-resources|api-versions|cluster-info|events|diff|auth can-i|auth whoami|" +
			"config view|config get-contexts|config current-context|config get-clusters|config get-users",
		["-n", "--namespace", "--context", "--kubeconfig", "--cluster", "--user", "-s", "--server", "-l", "--selector", "-o", "--output", "-c", "--container"],
	),
	// helm template --output-dir 는 파일로 쓰고, --post-renderer 는 다른 프로그램 실행, --dependency-update 는 차트 폴더에 받아 씀
	helm: (a) => helmRead(a) && !a.some((x) => /^--(output-dir|post-renderer|dependency-update)(=|$)/.test(x)),
	docker: subIn(
		"ps|images|logs|inspect|version|info|top|port|history|diff|image ls|image list|image inspect|container ls|container list|" +
			"container inspect|container logs|network ls|volume ls|system df|compose ps|compose logs|compose config",
		["-H", "--host", "--context", "--config", "-f", "--file", "-p", "--project-name"],
	),
	jupyter: (a) => /^(--version|--paths|--runtime-dir|--data-dir|--config-dir)$/.test(a[0] || "") || a[1] === "list",
	"nvidia-smi": (a) =>
		!a.some((x) => /^-(pm|e|p|c|r|ac|rac|acp|pl|am|caa|lgc|rgc|lmc|rmc|mig|cgi|dgi|cci|dci)$|^--(persistence-mode|ecc-config|reset-ecc|compute-mode|gpu-reset|applications-clocks|reset-applications-clocks|power-limit|lock-|reset-)/.test(x)),
};
const PY = new Set(["python", "python3", "py"]);
/** tar 의 긴 옵션 중 다른 프로그램을 실행하거나 파일로 쓰는 것 */
const TAR_RUN = ["use-compress-program", "checkpoint-action", "info-script", "new-volume-script", "to-command", "rsh-command", "rmt-command", "index-file", "volno-file"];

/** sed 스크립트가 보기만 하는지 (GNU sed 4.9 와 같은 방식으로 읽음). 명령마다 [주소[,주소]][!] 다음에
 *  p P l = d D q Q n N g G h H x z F, s/../../(플래그는 g p i I m M 숫자만), y/../../, { }, 이름표(: b t T), # 주석만.
 *  w·W(파일로 쓰기), e·s///e(명령 실행), s///w, 그 밖의 명령(r a i c 등)이나 sed 와 다르게 읽을 수 있는 글은 아님
 *  (sed 는 문법 오류가 나도 그 앞의 w 파일은 이미 만들므로, 끝까지 sed 와 같게 읽은 것만 허용) */
export function sedScriptReadOnly(src: string): boolean {
	let i = 0;
	let depth = 0;
	const at = (re: RegExp) => i < src.length && re.test(src[i]);
	const blank = () => {
		while (at(/[ \t]/)) i++;
	};
	const num = () => {
		const s = i;
		while (at(/[0-9]/)) i++;
		return i > s;
	};
	/** 구분자 d 까지 (\ 는 다음 글자와 함께 건너뜀. 줄바꿈이 그대로 나오면 sed 도 오류) */
	const upTo = (d: string) => {
		for (; i < src.length && src[i] !== "\n"; i++) {
			if (src[i] === "\\") i++;
			else if (src[i] === d) {
				i++;
				return true;
			}
		}
		return false;
	};
	/** 주소: 줄 번호(1~2 포함), $, /정규식/ 또는 \c정규식c (뒤에 I·M). 둘째 주소는 +N·~N 도. 주소가 없으면 null, 틀리면 false */
	const addr = (second: boolean): boolean | null => {
		const c = src[i];
		if (c === "$") {
			i++;
			return true;
		}
		if (at(/[0-9]/)) {
			num();
			blank();
			if (src[i] !== "~") return true;
			i++;
			blank();
			return num();
		}
		if (second && (c === "+" || c === "~")) {
			i++;
			blank();
			return num();
		}
		if (c === "/" || c === "\\") {
			i++;
			const d = c === "/" ? "/" : src[i++];
			if (!d || d === "\n" || d === "\\" || !upTo(d)) return false;
			for (blank(); src[i] === "I" || src[i] === "M"; blank()) i++;
			return true;
		}
		return null;
	};
	while (i < src.length) {
		if (at(/[ \t\n\r\f\v;]/)) {
			i++;
			continue;
		}
		if (src[i] === "#") {
			while (i < src.length && src[i] !== "\n") i++;
			continue;
		}
		const a = addr(false);
		if (a === false) return false;
		if (a) {
			blank();
			if (src[i] === ",") {
				i++;
				blank();
				if (!addr(true)) return false;
			}
			blank();
		}
		if (src[i] === "!") {
			i++;
			blank();
		}
		const c = i < src.length ? src[i++] : "";
		if (!c) return false;
		if (c === "{") {
			depth++;
			continue;
		}
		if (c === "}") {
			if (a || !depth) return false;
			depth--;
		} else if (c === "s" || c === "y") {
			const d = i < src.length ? src[i++] : "\n";
			if (d === "\n" || d === "\\" || !upTo(d) || !upTo(d)) return false;
			if (c === "s") while (at(/[gpiImM0-9 \t]/)) i++; // e(명령 실행)·w(파일로 쓰기) 플래그는 안 됨
		} else if (":btT".includes(c)) {
			// 이름표: sed 는 빈칸·; (4.9 는 } 에서도) 에서 끊음. 그 사이에 다르게 읽을 수 있는 글자가 있으면 아님
			blank();
			const s = i;
			while (i < src.length && !/[\s;]/.test(src[i])) i++;
			if (!/^[\w.-]*$/.test(src.slice(s, i)) || (c === ":" && (a || i === s))) return false;
		} else if ("qQl".includes(c)) {
			blank();
			num(); // q5 (끝내는 코드), l 40 (줄 길이)
		} else if (!"=dDFgGhHnNpPxz".includes(c)) return false;
		blank();
		if (i < src.length && !";\n}#".includes(src[i])) return false; // 명령 끝
	}
	return depth === 0;
}

const SED_LONG = new Set(["--quiet", "--silent", "--regexp-extended", "--separate", "--unbuffered", "--null-data", "--zero-terminated", "--posix", "--debug", "--sandbox", "--follow-symlinks", "--binary", "--help", "--version"]);
/** sed: 아는 옵션만 (-i·--in-place 파일 고치기, -f 스크립트 파일, 줄인 이름 --i 등은 아님. 스크립트 뒤에 온 옵션도 봄)
 *  스크립트는 -e·--expression 들, 없으면 첫 낱말 (-e 마다 따로 읽지만 이어 붙여 봐도 같은 결과) */
function sedReadOnly(args: string[]): boolean {
	const scripts: string[] = [];
	const rest: string[] = [];
	let e = false;
	for (let k = 0; k < args.length; k++) {
		const a = args[k];
		if (a === "--") {
			rest.push(...args.slice(k + 1));
			break;
		}
		if (a.startsWith("--")) {
			const eq = a.indexOf("=");
			const name = eq < 0 ? a : a.slice(0, eq);
			if (name === "--expression" || name === "--line-length") {
				const v = eq < 0 ? (args[++k] ?? "") : a.slice(eq + 1);
				if (name === "--expression") {
					scripts.push(v);
					e = true;
				}
			} else if (eq >= 0 || !SED_LONG.has(name)) return false;
			continue;
		}
		if (a.length > 1 && a.startsWith("-")) {
			for (let j = 1; j < a.length; j++) {
				if (a[j] === "e" || a[j] === "l") {
					const v = j + 1 < a.length ? a.slice(j + 1) : (args[++k] ?? "");
					if (a[j] === "e") {
						scripts.push(v);
						e = true;
					}
					break;
				}
				if (!"nrEsuzb".includes(a[j])) return false; // -i 파일 고치기, -f 스크립트 파일, 모르는 옵션
			}
			continue;
		}
		rest.push(a);
	}
	if (!e && rest.length) scripts.push(rest[0]);
	return sedScriptReadOnly(scripts.join("\n"));
}

/** 셸 명령이 읽기만 하는지. 읽기만 하면 null, 아니면 문제가 된 부분 (계획 모드·확인 모드에서 씀) */
export function readOnlyProblem(command: string): string | null {
	const p = parseShell(String(command || ""));
	for (const inner of p.nested) {
		const r = readOnlyProblem(inner);
		if (r) return r;
	}
	for (const pipe of p.pipelines) {
		for (const s of pipe) {
			const out = s.redirects.filter((r) => !/^\/dev\/(null|stdout|stderr|tty)$/.test(r));
			if (out.length) return `파일로 출력 (> ${out[0]})`;
			const r = wordsProblem(s.words);
			if (r) return r;
		}
	}
	return null;
}

function wordsProblem(words: string[]): string | null {
	if (words[0] === "command" && /^-[vV]$/.test(words[1] || "")) return null; // command -v 이름
	const { rest, sudo } = strip(words);
	if (sudo) return "sudo";
	if (!rest.length) return null; // 변수 대입만
	const name = base(rest[0]);
	const args = rest.slice(1);
	const pos = args.filter((a) => !a.startsWith("-") && !a.startsWith("/dev/")); // 2>/dev/null 의 대상도 낱말로 들어옴
	const what = rest.join(" ").slice(0, 80);
	if (isVersion(name, args) && (VERSION_ONLY.has(name) || PY.has(name))) return null;
	if (PY.has(name) && args[0] === "-m" && /^pip3?$/.test(args[1] || "")) return SPECIAL.pip(args.slice(2)) ? null : what;
	const special = SPECIAL[name];
	if (special) return special(args) ? null : what;
	if (!READ.has(name)) return what;
	if (WRITE_FLAG[name] && args.some((a) => WRITE_FLAG[name].test(a))) return what;
	switch (name) {
		case "sed":
			if (!sedReadOnly(args)) return what;
			break;
		case "awk":
		case "gawk": {
			// 옵션은 -F 구분자·-v 변수만 (-f 프로그램 파일, -i·-l 불러오기, -o·-p·-d 파일로 쓰기 등은 아님)
			for (let k = 0; k < args.length && args[k].startsWith("-") && args[k] !== "-" && args[k] !== "--"; k++) {
				if (!/^(-[Fv]|--version$)/.test(args[k])) return what;
				if (args[k].length === 2) k++; // 값을 다음 낱말로 받음
			}
			// 프로그램: system(), print > 파일, "명령" | getline, print | "명령", @include·@load (gawk 의 inplace 등)
			if (args.some((a) => /system\s*\(|(?<!\|)\|(?!\|)\s*["\w$]|\|&|(print|printf)\b[^;}]*>|@(include|load)\b/.test(a))) return what;
			break;
		}
		case "find": {
			for (let k = 0; k < args.length; k++) {
				const a = args[k];
				if (/^-(delete|fprint0?|fprintf|fls)$/.test(a)) return what;
				if (/^-(exec|execdir|ok|okdir)$/.test(a)) {
					const cmd: string[] = [];
					for (k++; k < args.length && args[k] !== ";" && args[k] !== "+"; k++) cmd.push(args[k]);
					const r = cmd.length ? wordsProblem(cmd.filter((w) => w !== "{}")) : what;
					if (r) return r;
				}
			}
			break;
		}
		case "uniq":
		case "xxd":
			if (pos.length > 1) return what; // 두 번째 이름은 출력 파일
			break;
		case "hostname":
			if (pos.length) return what;
			break;
		case "tar": {
			const mode = args.find((a) => /^-?[a-zA-Z]+$/.test(a)) || "";
			if (!(/t/.test(mode) || args.includes("--list")) || /[xcruA]/.test(mode.replace(/^-/, "")) || args.some((a) => /^--(extract|get|create|append|update|delete)/.test(a))) return what;
			// 다른 프로그램 실행·파일 쓰기: -I(압축 프로그램)·-F(스크립트) 와 TAR_RUN (긴 이름은 앞부분만 써도 됨: --use=x)
			if (args.some((a, k) => (/^-[a-zA-Z]/.test(a) || (k === 0 && /^[a-zA-Z]+$/.test(a))) && /[IF]/.test(a))) return what;
			if (args.some((a) => a.startsWith("--") && a.length > 2 && TAR_RUN.some((o) => o.startsWith(a.slice(2).split("=")[0])))) return what;
			break;
		}
		case "unzip":
			if (!args.some((a) => /^-[lvZt]/.test(a))) return what;
			break;
	}
	return null;
}

// ── 확인 모드의 미리 보기 ──────────────────────────────────────────────

const lines = (s: string) => (s === "" ? [] : s.replace(/\n$/, "").split("\n"));
const cut = (s: string, n = 160) => (s.length > n ? s.slice(0, n) + "…" : s);

/** 앞뒤 같은 줄을 빼고 바뀐 부분만 (- 지운 줄, + 넣은 줄) */
export function lineDiff(before: string, after: string, max = 15): string {
	const a = lines(before);
	const b = lines(after);
	let p = 0;
	while (p < a.length && p < b.length && a[p] === b[p]) p++;
	let s = 0;
	while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
	const del = a.slice(p, a.length - s);
	const add = b.slice(p, b.length - s);
	if (!del.length && !add.length) return "(내용 같음)";
	const show = (xs: string[], mark: string) => [
		...xs.slice(0, max).map((x) => `${mark} ${cut(x)}`),
		...(xs.length > max ? [`${mark} (… ${xs.length - max}줄 더)`] : []),
	];
	return [`(${p + 1}번째 줄부터)`, ...show(del, "-"), ...show(add, "+")].join("\n");
}

async function preview(tool: string, input: any): Promise<{ title: string; body: string }> {
	if (tool === "bash") return { title: "명령 실행", body: cut(String(input.command || ""), 1500) };
	const t = target(String(input.path || ""));
	const name = shown(t);
	let old: string | null = null;
	try {
		const b = await readTarget(t);
		old = b === null ? null : b.toString("utf8");
	} catch {}
	if (tool === "write") {
		const neu = String(input.content ?? "");
		if (old === null) {
			const ls = lines(neu);
			return { title: `새 파일: ${name}`, body: [...ls.slice(0, 15).map((x) => `+ ${cut(x)}`), ...(ls.length > 15 ? [`+ (… ${ls.length - 15}줄 더)`] : []), `(모두 ${ls.length}줄)`].join("\n") };
		}
		return { title: `파일 덮어쓰기: ${name}`, body: lineDiff(old, neu) };
	}
	const edits: any[] = Array.isArray(input.edits) ? input.edits : input.oldText !== undefined ? [{ oldText: input.oldText, newText: input.newText }] : [];
	const parts = edits.slice(0, 4).map((e) => lineDiff(String(e.oldText ?? ""), String(e.newText ?? ""), 8).replace(/^\(\d+번째 줄부터\)\n/, ""));
	return { title: `파일 고치기: ${name}`, body: parts.join("\n  ⋯\n") + (edits.length > 4 ? `\n(외 ${edits.length - 4}곳)` : "") };
}

// ── 계획과 진행 목록 ──────────────────────────────────────────────

const PLAN_NOTE =
	"[계획 모드] 지금은 계획만 세웁니다. 파일을 바꾸는 도구는 쓰지 말고(write·edit 와 바꾸는 명령은 막혀 있음), " +
	"필요하면 read 와 읽기 전용 명령(ls, grep, git diff 등)으로 살펴본 뒤 번호를 붙인 단계로 계획을 적어 주세요 " +
	"(단계마다 할 일과 바꿀 파일). 정해야 할 점이 있으면 계획 끝에 질문으로 적어 주세요. 사용자가 승인하면 그때 진행합니다.";
const proceedText = (n: number, mode: Mode) =>
	`위 계획대로 진행해 주세요. 계획 모드는 끝났고 이제 파일을 바꾸고 명령을 실행할 수 있습니다` +
	`${mode === "ask" ? " (바꾸기 전에 사용자가 하나씩 확인합니다)" : ""}. ` +
	`단계 하나를 마칠 때마다 답에 "[N단계 완료]" 라고 적어 주세요 (N 은 단계 번호, 모두 ${n}단계).`;
const CHOICES: [string, Mode | null][] = [
	["진행 (자동: 묻지 않고 실행)", "auto"],
	["진행 (확인: 바꿀 때마다 확인)", "ask"],
	["계획 더 다듬기 (계획 모드 유지)", null],
];

/** 답에서 계획 단계 (1. 2. 3. 또는 1단계: 2단계: ... 처음부터 이어지는 번호만, 가장 바깥 목록) */
export function planSteps(text: string): string[] {
	const re = /^([ \t]*)(?:#{1,4}[ \t]*)?(?:\*\*)?(\d{1,2})(?:[.)]|[ \t]*단계[ \t]*[:.)]?)(?:\*\*)?[ \t]+(.+)$/gm;
	const found = [...String(text || "").matchAll(re)].map((m) => ({ indent: m[1].replace(/\t/g, "    ").length, n: Number(m[2]), text: m[3] }));
	if (!found.length) return [];
	const top = Math.min(...found.map((f) => f.indent));
	const steps: string[] = [];
	for (const f of found) {
		if (f.indent !== top) continue;
		if (f.n !== steps.length + 1) {
			if (steps.length >= 2) break; // 뒤에 다시 1. 로 시작하는 목록(질문 등)은 계획이 아님
			if (f.n === 1) steps.length = 0;
			else continue;
		}
		steps.push(cut(f.text.replace(/\*\*/g, "").replace(/[:：]\s*$/, "").trim(), 70));
	}
	return steps;
}

const userConfig = (): any => {
	const p = process.env.PI_COPILOT_USER_CONFIG || join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "bridge.json");
	try {
		return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) || {};
	} catch {
		return {};
	}
};
const textOf = (m: any) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n"));
const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);

export default function (pi: ExtensionAPI) {
	let mode: Mode = (globalThis as any).__piMode; // 확장을 다시 불러와도(/kit share 등) 모드 유지
	let before: Mode = "auto"; // /plan 으로 끌 때 돌아갈 모드
	let lastText = ""; // 이번 요청의 마지막 답 (계획인지 볼 때)
	let asking = false;
	let steps: { text: string; done: boolean }[] = [];

	const setMode = (ctx: any, m: Mode) => {
		mode = m;
		(globalThis as any).__piMode = m;
		if (!ctx?.hasUI) return;
		const fg = (c: string, s: string) => (ctx.ui.theme?.fg ? ctx.ui.theme.fg(c, s) : s);
		ctx.ui.setStatus("mode", m === "plan" ? fg("warning", "계획 모드 · 읽기만 (/plan 끄기)") : m === "ask" ? fg("accent", "확인 모드 (/mode 바꾸기)") : undefined);
	};
	const showSteps = (ctx: any) => {
		if (!ctx?.hasUI) return;
		if (!steps.length) return ctx.ui.setWidget("pi-kit-plan", undefined);
		const done = steps.filter((s) => s.done).length;
		const all = done === steps.length;
		const head = `── 계획 진행 ${done}/${steps.length}${all ? " · 모두 완료 (다음 요청 때 닫힘)" : ""} ──`;
		const shownSteps = steps.slice(0, 12).map((s, i) => ` [${s.done ? "x" : " "}] ${i + 1}. ${s.text}`);
		// 한 글로 넘김: pi 화면은 목록의 항목을 10개까지만 보여 주고 나머지는 "... (widget truncated)" 로 자름 (줄바꿈은 그대로 보임)
		ctx.ui.setWidget("pi-kit-plan", [[head, ...shownSteps, ...(steps.length > 12 ? [`     … 외 ${steps.length - 12}단계`] : [])].join("\n")]);
	};
	const clearSteps = (ctx: any) => {
		if (!steps.length) return;
		steps = [];
		showSteps(ctx);
	};

	pi.on("session_start", async (_event: unknown, ctx: any) => {
		if (!(globalThis as any).__piModeStarted) {
			(globalThis as any).__piModeStarted = true;
			const want = NAMES[String(userConfig().default_mode || "").trim().toLowerCase()];
			if (want && ctx.hasUI) return setMode(ctx, want); // pi -p 처럼 물을 수 없는 실행은 늘 자동
		}
		setMode(ctx, mode);
	});

	// 계획 모드: 요청 앞에 안내 (/ 로 시작하는 명령·템플릿은 그대로 두어야 펼쳐짐)
	pi.on("input", async (event: any, ctx: any) => {
		const text = String(event.text || "");
		if (text.startsWith("/")) return;
		if (event.source !== "extension" && steps.length && steps.every((s) => s.done)) clearSteps(ctx);
		if (mode !== "plan" || !text.trim()) return;
		return { action: "transform", text: `${PLAN_NOTE}\n\n${text}` };
	});

	pi.on("tool_call", async (event: any, ctx: any) => {
		if (mode === "auto") return;
		const tool = String(event.toolName || "");
		const input = event.input || {};
		const guardWhy: string | undefined = event.guardReason;
		const problem = tool === "bash" ? readOnlyProblem(String(input.command || "")) : null;
		if (mode === "plan") {
			if (READ_TOOLS.has(tool) && !guardWhy) return;
			if (tool === "bash" && !problem && !guardWhy) return;
			const why = tool === "bash" ? `읽기 전용 명령만 실행합니다 (막은 부분: ${problem || guardWhy})` : tool === "write" || tool === "edit" ? "파일을 바꾸지 않았습니다" : `${tool} 도구는 쓰지 않습니다`;
			return { block: true, reason: `계획 모드라서 ${why}. 바꾸거나 실행해야 하는 일은 계획의 단계로 적어 주세요. 사용자가 계획을 승인하면 그때 진행합니다.` };
		}
		// 확인 모드
		if (tool !== "write" && tool !== "edit" && tool !== "bash") return;
		if (tool === "bash" && !problem && !guardWhy) return; // 읽기만 하는 명령은 묻지 않음
		const { title, body } = await preview(tool, input);
		if (!ctx.hasUI) {
			return { block: true, reason: `확인 모드인데 물어볼 수 없는 실행 방식이라 실행하지 않았습니다 (${title}). 사용자에게 직접 하도록 부탁하세요.` };
		}
		const ok = await ctx.ui.confirm(title, `${body.slice(0, 2500)}\n\n${guardWhy ? `주의: ${guardWhy}\n` : ""}진행할까요? (확인 모드 · /mode 로 바꾸기)`);
		if (ok) return;
		return {
			block: true,
			terminate: true,
			reason: "사용자가 이 작업을 거절했습니다. 같은 작업을 다시 요청하지 말고, 다른 방법을 쓰거나 사용자에게 어떻게 할지 물어보세요.",
		};
	});

	pi.on("agent_start", async () => {
		lastText = "";
	});

	pi.on("message_end", async (event: any, ctx: any) => {
		const m = event.message;
		if (m?.role !== "assistant") return;
		const text = textOf(m);
		lastText = m.stopReason === "aborted" || m.stopReason === "error" ? "" : text;
		if (!steps.length || !text) return;
		let changed = false;
		for (const x of text.matchAll(/(\d{1,2})\s*단계\s*(?:완료|끝)/g)) {
			const s = steps[Number(x[1]) - 1];
			if (s && !s.done) changed = s.done = true;
		}
		if (changed) showSteps(ctx);
	});

	// 계획이 오면 진행할지 묻는다 (기다리지 않고 따로: 다른 확장의 '끝남' 알림이 늦어지지 않게)
	pi.on("agent_settled", async (_event: unknown, ctx: any) => {
		if (mode !== "plan" || asking || !ctx.hasUI) return;
		const found = planSteps(lastText);
		if (found.length < 2) return;
		asking = true;
		setTimeout(async () => {
			try {
				const pick = await ctx.ui.select(`이 계획대로 진행할까요? (${found.length}단계)`, CHOICES.map((c) => c[0]));
				const next = CHOICES.find((c) => c[0] === pick)?.[1];
				if (!next || mode !== "plan") {
					if (mode === "plan") ctx.ui.notify("계획 모드를 유지합니다. 고칠 점을 적어 보내세요 (/plan 으로 끄기)", "info");
					return;
				}
				setMode(ctx, next);
				steps = found.map((text) => ({ text, done: false }));
				showSteps(ctx);
				pi.sendUserMessage(proceedText(found.length, next));
			} finally {
				asking = false;
			}
		}, 0);
	});

	pi.registerCommand("plan", {
		description: "계획 모드 켜기·끄기 (켜면 파일을 바꾸지 않고 계획부터, 승인하면 진행). /plan <요청> 은 계획 모드로 바로 요청",
		handler: async (args, ctx) => {
			const req = String(args || "").trim();
			clearSteps(ctx);
			if (mode === "plan" && !req) {
				setMode(ctx, before === "plan" ? "auto" : before);
				return ctx.ui.notify(`계획 모드를 껐습니다 (지금: ${LABEL[mode]} 모드)`, "info");
			}
			if (mode !== "plan") {
				before = mode;
				setMode(ctx, "plan");
				if (!req) ctx.ui.notify("계획 모드: 파일을 바꾸지 않고 계획부터 세웁니다. 요청을 적어 보내세요 (/plan 으로 끄기)", "info");
			}
			if (!req) return;
			// / 로 시작하는 명령·템플릿은 대신 보내면 펼쳐지지 않고 계획 안내도 붙지 않음: 사용자가 직접 입력하게
			if (req.startsWith("/")) return ctx.ui.notify(`계획 모드입니다. / 로 시작하는 명령은 대신 보낼 수 없으니 지금 직접 입력해 주세요: ${req}`, "info");
			// 다른 작업 중이면 그 작업이 끝난 뒤 보내지도록 줄 세움 (그냥 보내면 "이미 처리 중" 오류로 요청이 사라짐. 쉬고 있으면 바로 보냄)
			if (!ctx.isIdle()) ctx.ui.notify("지금 작업이 끝나면 이 요청을 계획 모드로 이어서 보냅니다", "info");
			setTimeout(() => pi.sendUserMessage(req, { deliverAs: "followUp" }), 0);
		},
	});

	pi.registerCommand("mode", {
		description: "작업 모드: 계획(읽기만, 계획 후 승인) · 확인(바꿀 때마다 확인) · 자동(묻지 않음). /mode ask 처럼 바로 바꾸기",
		handler: async (args, ctx) => {
			const arg = String(args || "").trim().toLowerCase();
			let want: Mode | undefined = NAMES[arg];
			if (arg && !want) return ctx.ui.notify(`모드 이름: plan(계획) · ask(확인) · auto(자동)`, "warning");
			if (!want) {
				const opts: [string, Mode][] = [
					["계획: 읽기만 하고 계획부터 (승인하면 진행)", "plan"],
					["확인: 파일을 바꾸거나 명령을 실행할 때마다 확인", "ask"],
					["자동: 묻지 않고 실행 (위험한 명령만 확인)", "auto"],
				];
				const pick = await ctx.ui.select(`작업 모드 (지금: ${LABEL[mode]})`, opts.map((o) => o[0]));
				want = opts.find((o) => o[0] === pick)?.[1];
				if (!want) return;
			}
			clearSteps(ctx);
			if (want === "plan" && mode !== "plan") before = mode;
			setMode(ctx, want);
			ctx.ui.notify(`${LABEL[want]} 모드${want === "plan" ? ": 파일을 바꾸지 않고 계획부터 세웁니다" : want === "ask" ? ": 바꾸기 전에 내용을 보여 주고 묻습니다" : ": 묻지 않고 실행합니다 (위험한 명령만 확인)"}`, "info");
		},
	});
}
