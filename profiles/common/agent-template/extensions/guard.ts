/**
 * 위험할 수 있는 명령 확인
 *
 * pi 는 LLM 이 정한 명령을 묻지 않고 실행한다. 되돌리기 어려운 작업만 실행 전에 사용자에게 묻는다.
 *  - bash: 폴더 지우기(rm -r 등), git push·reset --hard·clean·branch -D, 권한 일괄 변경, 디스크·시스템 명령,
 *          쿠버네티스 리소스 삭제(kubectl delete), 받은 스크립트 바로 실행(curl | sh), 패키지 제거, sudo, 데이터베이스 삭제
 *  - write/edit: 작업 폴더 밖의 파일 (임시 폴더는 제외). jupyter 모드에서는 노트북의 작업 폴더 기준
 *  - 사용자가 직접 치는 !명령은 묻지 않는다 (이 확인은 LLM 이 요청한 도구 실행에만 걸림)
 *  - 거부하면 실행하지 않고 작업을 멈춘다. 물을 수 없는 실행 방식(pi -p)이면 막고 LLM 에게 이유를 알린다
 *
 * 설정 (내 설정 파일 ~/.pi/agent/bridge.json, 고치면 바로 적용):
 *   "guard": false                          이 확인을 끔
 *   "guard_patterns": ["정규식", ...]        더 물어볼 명령
 *   "guard_allow": ["정규식", ...]           묻지 않을 명령 (예: "^git push origin feature/")
 *   "guard_outside_writes": false           작업 폴더 밖 파일 쓰기는 묻지 않음
 */

import { readFileSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Rule = { label: string; re: RegExp };

const RULES: Rule[] = [
	{ label: "폴더·파일 지우기 (rm -r)", re: /\brm\s+(?:-\S+\s+)*(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)(?:\s|$)/ },
	{ label: "폴더·파일 지우기 (find -delete)", re: /\bfind\b[^;&|\n]*\s-delete\b/ },
	{ label: "폴더·파일 지우기 (Windows)", re: /\b(?:rmdir|rd)\s+\/s\b|\bdel\s+(?:\/\w\s+)*\/s\b|\bRemove-Item\b[^;\n]*-Recurse/i },
	{ label: "폴더 지우기 (rmtree)", re: /\brmtree\s*\(/ },
	{ label: "원격 저장소에 올리기 (git push)", re: /\bgit\s+(?:-[Cc]\s+\S+\s+)*push\b/ },
	{ label: "git 변경 내용 버리기", re: /\bgit\s+(?:-[Cc]\s+\S+\s+)*(?:reset\s+(?:\S+\s+)*--hard|clean\s+(?:\S+\s+)*-[a-zA-Z]*f|checkout\s+(?:-f\s+|--\s+)?\.(?:\s|$)|restore\s+(?:--\S+\s+)*\.(?:\s|$)|stash\s+(?:drop|clear))/ },
	{ label: "git 브랜치 지우기", re: /\bgit\s+(?:-[Cc]\s+\S+\s+)*branch\s+(?:\S+\s+)*-D\b/ },
	{ label: "권한·소유자 일괄 변경", re: /\b(?:chmod|chown)\s+(?:\S+\s+)*(?:-[a-zA-Z]*R|--recursive)\b/ },
	{ label: "디스크·시스템 명령", re: /\bmkfs(?:\.\w+)?\b|\bdd\s+[^;\n]*\bof=\/dev\/|(?:^|[;&|(]|\s)(?:shutdown|reboot|poweroff|halt)(?:\s|$)|\bformat\s+[a-zA-Z]:|\bdiskpart\b/i },
	{ label: "쿠버네티스 리소스 삭제", re: /\bkubectl\s+(?:\S+\s+)*delete\b|\bhelm\s+(?:uninstall|delete)\b/ },
	{ label: "받은 스크립트 바로 실행", re: /\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/ },
	{ label: "패키지 제거", re: /\bpip3?\s+uninstall\b|\bpython3?\s+-m\s+pip\s+uninstall\b|\bconda\s+(?:remove|uninstall|env\s+remove)\b|\bnpm\s+(?:uninstall|rm)\s+-g\b/ },
	{ label: "관리자 권한 (sudo)", re: /(?:^|[;&|(\s])sudo\s/ },
	{ label: "데이터베이스 삭제", re: /\bdrop\s+(?:table|database|schema)\b|\btruncate\s+table\b/i },
];

const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
let cache: { path: string; mtime: number; cfg: any } | null = null;

/** 내 설정 파일 (형식이 틀리면 기본값: 확인 켬) */
function settings(): any {
	const p = process.env.PI_COPILOT_USER_CONFIG || join(agentDir, "bridge.json");
	try {
		const mtime = statSync(p).mtimeMs;
		if (cache && cache.path === p && cache.mtime === mtime) return cache.cfg;
		const cfg = JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
		cache = { path: p, mtime, cfg: cfg && typeof cfg === "object" ? cfg : {} };
		return cache.cfg;
	} catch {
		return {};
	}
}

function regexps(list: unknown): RegExp[] {
	if (!Array.isArray(list)) return [];
	const out: RegExp[] = [];
	for (const s of list) {
		try {
			out.push(new RegExp(String(s), "i"));
		} catch {}
	}
	return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 셸 명령 분석: 따옴표 안의 글(echo "rm -rf ..." 등)이나 heredoc 본문(cat <<'EOF' 로 파일 쓰기)은 실행되는 명령이 아니므로
// 명령 자리(줄 맨 앞, ; && || | 뒤 등)의 낱말만 본다. 실제로 실행되는 글은 안까지 본다:
// bash -c "...", eval, ssh 호스트 '...', su -c, cmd /c, $(...), `...`, bash <<EOF 본문.
// python -c, node -e 같은 인라인 코드와 powershell 명령은 위의 RULES(글자 패턴)로 본다.
// 분석 중 오류가 나면 전체 글을 RULES 로 본다 (놓치는 것보다 한 번 더 묻는 쪽).
// ---------------------------------------------------------------------------------------------------------------

/** 데이터베이스 삭제·rmtree 는 SQL·코드 문자열 안에 있으므로 따옴표와 관계없이 전체 글에서 본다 */
const CONTENT_RULES = RULES.filter((r) => /데이터베이스|rmtree/.test(r.label));
const LABEL = {
	rm: RULES[0].label,
	find: RULES[1].label,
	win: RULES[2].label,
	push: RULES[4].label,
	discard: RULES[5].label,
	branch: RULES[6].label,
	perm: RULES[7].label,
	system: RULES[8].label,
	kube: RULES[9].label,
	pipe: RULES[10].label,
	pkg: RULES[11].label,
	sudo: RULES[12].label,
};

type Simple = { words: string[] };
type Parsed = { pipelines: Simple[][]; nested: string[]; heredocs: { words: string[]; body: string; pipe: number }[] };

/** 셸 글 -> 파이프라인(단순 명령 목록)들, 안에서 실행되는 글($(...), `...`), heredoc 본문 */
function parseShell(src: string): Parsed {
	const out: Parsed = { pipelines: [], nested: [], heredocs: [] };
	let pipeline: Simple[] = [];
	let words: string[] = [];
	let cur = "";
	let has = false; // 지금 낱말이 시작됐는지 (빈 따옴표 "" 도 낱말)
	const pending: { delim: string; strip: boolean; words: string[] }[] = [];
	const endWord = () => {
		if (has) words.push(cur);
		cur = "";
		has = false;
	};
	const endCmd = () => {
		endWord();
		if (words.length) pipeline.push({ words });
		words = [];
	};
	const endPipe = () => {
		endCmd();
		if (pipeline.length) out.pipelines.push(pipeline);
		pipeline = [];
	};
	/** $( 다음부터 짝이 맞는 ) 까지 (따옴표 안의 괄호는 셈하지 않음) */
	const balanced = (i: number): [string, number] => {
		let depth = 1;
		let j = i;
		let q = "";
		for (; j < src.length; j++) {
			const c = src[j];
			if (q) {
				if (c === "\\" && q === '"') j++;
				else if (c === q) q = "";
				continue;
			}
			if (c === "'" || c === '"') q = c;
			else if (c === "\\") j++;
			else if (c === "(") depth++;
			else if (c === ")" && --depth === 0) break;
		}
		return [src.slice(i, j), j];
	};
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (c === "\\") {
			if (src[i + 1] === "\n") i += 2; // 줄 이음
			else {
				cur += src[i + 1] ?? "";
				has = true;
				i += 2;
			}
			continue;
		}
		if (c === "'") {
			const j = src.indexOf("'", i + 1);
			const end = j < 0 ? src.length : j;
			cur += src.slice(i + 1, end);
			has = true;
			i = end + 1;
			continue;
		}
		if (c === '"') {
			let j = i + 1;
			for (; j < src.length && src[j] !== '"'; j++) {
				if (src[j] === "\\") {
					cur += src[j + 1] ?? "";
					j++;
				} else if (src[j] === "$" && src[j + 1] === "(") {
					const [inner, end] = balanced(j + 2);
					out.nested.push(inner);
					cur += "$(...)";
					j = end;
				} else if (src[j] === "`") {
					const end = src.indexOf("`", j + 1);
					out.nested.push(src.slice(j + 1, end < 0 ? src.length : end));
					cur += "`...`";
					j = end < 0 ? src.length : end;
				} else cur += src[j];
			}
			has = true;
			i = j + 1;
			continue;
		}
		if (c === "$" && src[i + 1] === "(") {
			const [inner, end] = balanced(i + 2);
			out.nested.push(inner);
			cur += "$(...)";
			has = true;
			i = end + 1;
			continue;
		}
		if (c === "`") {
			const end = src.indexOf("`", i + 1);
			out.nested.push(src.slice(i + 1, end < 0 ? src.length : end));
			cur += "`...`";
			has = true;
			i = end < 0 ? src.length : end + 1;
			continue;
		}
		if (c === "#" && !has) {
			const nl = src.indexOf("\n", i);
			i = nl < 0 ? src.length : nl;
			continue;
		}
		if (c === "\n") {
			endPipe();
			const pipe = out.pipelines.length - 1; // heredoc 이 붙은 파이프라인 (cat <<EOF | bash 처럼 본문을 셸에 넘기는지 보려고)
			i++;
			// heredoc 본문: 끝 표시 줄까지 건너뜀 (본문은 따로 모아 둠)
			for (const h of pending.splice(0)) {
				const lines: string[] = [];
				while (i < src.length) {
					const nl = src.indexOf("\n", i);
					const line = src.slice(i, nl < 0 ? src.length : nl);
					i = nl < 0 ? src.length : nl + 1;
					if ((h.strip ? line.replace(/^\t+/, "") : line) === h.delim) break;
					lines.push(line);
				}
				out.heredocs.push({ words: h.words, body: lines.join("\n"), pipe });
			}
			continue;
		}
		if (c === " " || c === "\t" || c === "\r") {
			endWord();
			i++;
			continue;
		}
		if (c === "<" && src.startsWith("<<<", i)) {
			endWord();
			i += 3;
			continue;
		}
		if (c === "<" && src[i + 1] === "<") {
			endWord();
			const strip = src[i + 2] === "-";
			i += strip ? 3 : 2;
			while (src[i] === " " || src[i] === "\t") i++;
			let d = "";
			while (i < src.length && !/[\s;&|<>()]/.test(src[i])) {
				if (src[i] !== "'" && src[i] !== '"' && src[i] !== "\\") d += src[i];
				i++;
			}
			pending.push({ delim: d, strip, words: [...words] });
			continue;
		}
		if (c === "<" || c === ">") {
			endWord();
			i += src[i + 1] === ">" || src[i + 1] === "&" ? 2 : 1;
			continue;
		}
		if (c === ";" || c === "(" || c === ")") {
			endPipe();
			i++;
			continue;
		}
		if (c === "&") {
			if (src[i + 1] === ">") {
				endWord();
				i += 2;
				continue;
			}
			endPipe();
			i += src[i + 1] === "&" ? 2 : 1;
			continue;
		}
		if (c === "|") {
			if (src[i + 1] === "|") {
				endPipe();
				i += 2;
			} else {
				endCmd();
				i += src[i + 1] === "&" ? 2 : 1;
			}
			continue;
		}
		cur += c;
		has = true;
		i++;
	}
	endPipe();
	return out;
}

const base = (w: string) => w.replace(/\\/g, "/").split("/").pop()!.replace(/\.exe$/i, "").toLowerCase();
const SKIP = new Set(["then", "do", "else", "elif", "if", "while", "until", "!", "{", "}", "time", "nohup", "exec", "command", "builtin", "stdbuf"]);
/** 명령 앞에 붙는 것(변수 대입, then·do, env·nice·timeout·xargs 등)을 넘기고 실제 명령부터. sudo 는 따로 알림 */
function strip(words: string[]): { rest: string[]; sudo: boolean } {
	let k = 0;
	let sudo = false;
	while (k < words.length) {
		const w = words[k];
		const b = base(w);
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || SKIP.has(w)) k++;
		else if (b === "env") {
			k++;
			while (k < words.length && (words[k].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[k]))) k++;
		} else if (b === "nice" || b === "ionice") {
			k++;
			while (k < words.length && words[k].startsWith("-")) k += /^-(n|c|p)$/.test(words[k]) ? 2 : 1;
		} else if (b === "timeout") {
			k++;
			while (k < words.length && words[k].startsWith("-")) k += /^-(s|k)$/.test(words[k]) ? 2 : 1;
			k++; // 시간
		} else if (b === "xargs") {
			k++;
			while (k < words.length && words[k].startsWith("-")) k += /^-(n|I|P|d|L|s|E|a)$/.test(words[k]) ? 2 : 1;
		} else if (b === "sudo" || b === "doas") {
			sudo = true;
			k++;
			while (k < words.length && words[k].startsWith("-")) k += /^-(u|g|h|p|C|U|r|t)$/.test(words[k]) ? 2 : 1;
		} else break;
	}
	return { rest: words.slice(k), sudo };
}

/** 인라인 코드(python -c 등)·powershell 명령: 글자 패턴으로 */
const legacy = (code: string): string | null => {
	for (const r of RULES) if (r.re.test(code)) return r.label;
	return null;
};

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "busybox"]);
const INTERP: Record<string, RegExp> = {
	python: /^-c$/,
	python3: /^-c$/,
	py: /^-c$/,
	node: /^(-e|--eval|-p|--print)$/,
	perl: /^-[eE]$/,
	ruby: /^-e$/,
};

function checkSimple(words: string[], depth: number): string | null {
	const { rest, sudo } = strip(words);
	if (!rest.length) return sudo ? LABEL.sudo : null;
	const name = base(rest[0]).replace(/[0-9.]+$/, (m) => (/^(python|pip)/.test(base(rest[0])) ? "" : m));
	const args = rest.slice(1);
	const flag = (re: RegExp) => args.some((a) => re.test(a));
	let why: string | null = null;
	if (name === "rm" && flag(/^-[a-zA-Z]*[rR][a-zA-Z]*$|^--recursive$/)) why = LABEL.rm;
	else if ((name === "rmdir" || name === "rd") && flag(/^\/s$/i)) why = LABEL.win;
	else if ((name === "del" || name === "erase") && flag(/^\/s$/i)) why = LABEL.win;
	else if (name === "remove-item" && flag(/^-recurse$/i)) why = LABEL.win;
	else if (name === "find") {
		const ex = args.findIndex((a) => /^-(exec|execdir|ok|okdir)$/.test(a));
		if (flag(/^-delete$/) || (ex >= 0 && ex + 1 < args.length && base(args[ex + 1]) === "rm")) why = LABEL.find;
	} else if (name === "git") {
		let k = 0;
		while (k < args.length && args[k].startsWith("-")) k += /^-(C|c)$|^--(git-dir|work-tree|namespace)$/.test(args[k]) ? 2 : 1;
		const sub = args[k];
		const a = args.slice(k + 1);
		const has = (re: RegExp) => a.some((x) => re.test(x));
		if (sub === "push") why = LABEL.push;
		else if (sub === "reset" && has(/^--hard$/)) why = LABEL.discard;
		else if (sub === "clean" && has(/^-[a-zA-Z]*f|^--force$/)) why = LABEL.discard;
		else if (sub === "checkout" && (has(/^\.$/) || has(/^(-f|--force)$/))) why = LABEL.discard;
		else if (sub === "restore" && has(/^\.$/) && !(has(/^(--staged|-S)$/) && !has(/^(--worktree|-W)$/))) why = LABEL.discard;
		else if (sub === "stash" && (a[0] === "drop" || a[0] === "clear")) why = LABEL.discard;
		else if (sub === "branch" && (has(/^-[a-zA-Z]*D/) || (has(/^(-d|--delete)$/) && has(/^(-f|--force)$/)))) why = LABEL.branch;
	} else if ((name === "chmod" || name === "chown" || name === "chgrp") && flag(/^-[a-zA-Z]*R|^--recursive$/)) why = LABEL.perm;
	else if (/^mkfs/.test(name) || name === "diskpart") why = LABEL.system;
	else if (name === "dd" && flag(/^of=\/dev\//)) why = LABEL.system;
	else if (["shutdown", "reboot", "poweroff", "halt"].includes(name)) why = LABEL.system;
	else if (name === "format" && flag(/^[a-zA-Z]:$/)) why = LABEL.system;
	else if (name === "kubectl" && flag(/^delete$/)) why = LABEL.kube;
	else if (name === "helm" && flag(/^(uninstall|delete|del|un)$/)) why = LABEL.kube;
	else if ((name === "pip" || name === "pip3") && flag(/^uninstall$/)) why = LABEL.pkg;
	else if ((name === "python" || name === "py") && args[0] === "-m" && /^pip/.test(args[1] || "") && args.includes("uninstall")) why = LABEL.pkg;
	else if (["conda", "mamba", "micromamba"].includes(name) && (flag(/^(remove|uninstall)$/) || (args.includes("env") && args.includes("remove")))) why = LABEL.pkg;
	else if (name === "npm" && flag(/^(uninstall|un|rm|remove|r)$/) && flag(/^(-g|--global)$/)) why = LABEL.pkg;
	if (why) return why;
	// 안에서 실행되는 글
	if (SHELLS.has(name)) {
		const c = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
		if (c >= 0 && c + 1 < args.length) return analyze(args[c + 1], depth + 1) || (sudo ? LABEL.sudo : null);
	}
	if (name === "eval") return analyze(args.join(" "), depth + 1) || (sudo ? LABEL.sudo : null);
	if (name === "su") {
		const c = args.findIndex((a) => a === "-c" || a === "--command");
		if (c >= 0 && c + 1 < args.length) return analyze(args[c + 1], depth + 1) || LABEL.sudo;
	}
	if (name === "ssh") {
		let k = 0;
		while (k < args.length && args[k].startsWith("-")) k += /^-[bcDEeFIiJLlmOopQRSWw]$/.test(args[k]) ? 2 : 1;
		const remote = args.slice(k + 1).join(" ");
		if (remote) {
			const r = analyze(remote, depth + 1);
			if (r) return r;
		}
	}
	if (name === "cmd") {
		const c = args.findIndex((a) => /^\/[ckCK]$/.test(a));
		if (c >= 0) {
			const r = analyze(args.slice(c + 1).join(" "), depth + 1) || legacy(args.slice(c + 1).join(" "));
			if (r) return r;
		}
	}
	if (name === "powershell" || name === "pwsh") {
		const r = legacy(args.join(" "));
		if (r) return r;
	}
	const ip = INTERP[name];
	if (ip) {
		const c = args.findIndex((a) => ip.test(a));
		if (c >= 0 && c + 1 < args.length) {
			const r = legacy(args[c + 1]);
			if (r) return r;
		}
	}
	return sudo ? LABEL.sudo : null;
}

function analyze(src: string, depth = 0): string | null {
	if (depth > 5) return legacy(src);
	const p = parseShell(src);
	for (const s of p.nested) {
		const r = analyze(s, depth + 1);
		if (r) return r;
	}
	for (const pl of p.pipelines) {
		for (const cmd of pl) {
			const r = checkSimple(cmd.words, depth);
			if (r) return r;
		}
		// 받은 것을 바로 셸로: curl ... | sh
		const names = pl.map((cmd) => {
			const s = strip(cmd.words).rest;
			return s.length ? base(s[0]) : "";
		});
		const f = names.findIndex((n) => n === "curl" || n === "wget");
		if (f >= 0 && names.slice(f + 1).some((n) => SHELLS.has(n))) return LABEL.pipe;
	}
	// heredoc 본문: 셸에 넘기면(bash <<EOF, cat <<EOF | bash) 명령으로, 인터프리터에 넘기면 코드로 본다
	// (cat <<EOF > 파일 처럼 파일로 쓰는 것은 보지 않음)
	for (const h of p.heredocs) {
		const s = strip(h.words).rest;
		const names = [s.length ? base(s[0]) : ""];
		for (const cmd of p.pipelines[h.pipe] || []) {
			const r = strip(cmd.words).rest;
			if (r.length) names.push(base(r[0]));
		}
		if (names.some((n) => SHELLS.has(n) || n === "ssh")) {
			const r = analyze(h.body, depth + 1);
			if (r) return r;
		} else if (names.some((n) => INTERP[n.replace(/[0-9.]+$/, "")] || ["psql", "mysql", "sqlite3"].includes(n))) {
			const r = legacy(h.body);
			if (r) return r;
		}
	}
	return null;
}

/** 확인이 필요한 bash 명령이면 그 이유, 아니면 null */
export function checkCommand(command: string, cfg: any = {}): string | null {
	if (regexps(cfg.guard_allow).some((re) => re.test(command))) return null;
	let why: string | null;
	try {
		why = analyze(command);
	} catch {
		why = legacy(command); // 분석 실패: 전체 글을 글자 패턴으로
	}
	if (!why) for (const r of CONTENT_RULES) if (r.re.test(command)) return r.label;
	if (why) return why;
	if (regexps(cfg.guard_patterns).some((re) => re.test(command))) return "직접 지정한 명령 (guard_patterns)";
	return null;
}

const slash = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
const inside = (p: string, base: string) => {
	const a = p.toLowerCase();
	const b = slash(base).toLowerCase();
	return a === b || a.startsWith(b === "/" ? "/" : b + "/");
};

type WorkDir = { remote: boolean; cwd: string; home?: string };

/** 작업 폴더 밖의 파일이면 그 절대 경로, 아니면 null. jupyter 모드는 jupyter.ts 가 알려 주는 노트북 작업 폴더 기준 */
export function outsidePath(path: string, wd: WorkDir): string | null {
	let s = String(path || "").trim().replace(/\\/g, "/");
	if (!s) return null;
	if (wd.remote) {
		const home = wd.home || "/home/jovyan";
		if (s === "~" || s.startsWith("~/")) s = home + s.slice(1);
		const abs = posix.resolve(wd.cwd, s);
		return inside(abs, wd.cwd) || inside(abs, "/tmp") ? null : abs;
	}
	if (s === "~" || s.startsWith("~/")) s = slash(homedir()) + s.slice(1);
	const m = s.match(/^\/([a-zA-Z])(\/.*)?$/); // Git Bash 형식 /c/...
	if (m && process.platform === "win32") s = `${m[1].toUpperCase()}:${m[2] || "/"}`;
	const abs = slash(resolve(wd.cwd, s));
	const temps = [tmpdir(), "/tmp", process.env.TEMP || "", process.env.TMP || ""].filter(Boolean);
	return inside(abs, wd.cwd) || temps.some((t) => inside(abs, t)) ? null : abs;
}

const workDir = (): WorkDir => (globalThis as any).__piWorkDir || { remote: false, cwd: process.cwd() };

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event: any, ctx: any) => {
		const cfg = settings();
		if (cfg.guard === false) return;
		const input = event.input || {};
		let what = "";
		let why: string | null = null;
		if (event.toolName === "bash") {
			what = String(input.command || "");
			why = checkCommand(what, cfg);
		} else if ((event.toolName === "write" || event.toolName === "edit") && cfg.guard_outside_writes !== false) {
			const abs = outsidePath(input.path, workDir());
			if (abs) {
				what = `${event.toolName === "write" ? "파일 쓰기" : "파일 고치기"}: ${abs}`;
				why = `작업 폴더(${workDir().cwd}) 밖의 파일`;
			}
		}
		if (!why) return;
		if (!ctx.hasUI) {
			return {
				block: true,
				reason:
					`이 작업은 사용자 확인이 필요한데(${why}), 물어볼 수 없는 실행 방식이라 실행하지 않았습니다: ${what.slice(0, 300)}\n` +
					"사용자에게 직접 실행을 부탁하거나 다른 방법을 쓰세요. (끄려면 내 설정 파일 ~/.pi/agent/bridge.json 에 \"guard\": false)",
			};
		}
		const ok = await ctx.ui.confirm("확인이 필요한 작업", `${what.slice(0, 1200)}\n\n이유: ${why}\n실행할까요?`);
		if (ok) return;
		return {
			block: true,
			terminate: true,
			reason:
				`사용자가 이 작업의 실행을 거부했습니다 (${why}). 같은 작업을 다시 요청하지 말고, ` +
				"다른 방법을 쓰거나 사용자에게 어떻게 할지 물어보세요.",
		};
	});
}
