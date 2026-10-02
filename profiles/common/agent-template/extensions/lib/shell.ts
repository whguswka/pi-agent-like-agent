/**
 * 셸 명령 분석 (pi 확장끼리 함께 씀: guard.ts 위험 명령 확인, modes.ts 계획 모드의 읽기 전용 판단)
 * 이 폴더(lib)에는 index.ts 가 없으므로 pi 가 확장으로 불러오지 않는다.
 *
 * 따옴표·이스케이프·주석·연산자(; && || | 괄호)·$(...)·`...`·heredoc 을 나눠
 * 파이프라인(단순 명령 목록), 안에서 실행되는 글, heredoc 본문, 출력 리다이렉트를 돌려준다.
 */

/** 단순 명령: 낱말들과 출력 리다이렉트 대상(> 파일, >> 파일, &> 파일. /dev/null 은 뺌) */
export type Simple = { words: string[]; redirects: string[] };
export type Parsed = { pipelines: Simple[][]; nested: string[]; heredocs: { words: string[]; body: string; pipe: number }[] };

/** 셸 글 -> 파이프라인(단순 명령 목록)들, 안에서 실행되는 글($(...), `...`), heredoc 본문 */
export function parseShell(src: string): Parsed {
	const out: Parsed = { pipelines: [], nested: [], heredocs: [] };
	let pipeline: Simple[] = [];
	let words: string[] = [];
	let cur = "";
	let has = false; // 지금 낱말이 시작됐는지 (빈 따옴표 "" 도 낱말)
	let redirects: string[] = [];
	let redirNext = false; // 다음 낱말이 출력 리다이렉트 대상
	const pending: { delim: string; strip: boolean; words: string[] }[] = [];
	const endWord = () => {
		if (has) {
			words.push(cur);
			if (redirNext && cur !== "/dev/null") redirects.push(cur);
			redirNext = false;
		}
		cur = "";
		has = false;
	};
	const endCmd = () => {
		endWord();
		if (words.length) pipeline.push({ words, redirects });
		words = [];
		redirects = [];
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
		if (c === ">") {
			endWord();
			if (src[i + 1] === "&") {
				i += 2; // >&2 : 다른 출력으로 보내기 (파일 아님)
				continue;
			}
			i += src[i + 1] === ">" || src[i + 1] === "|" ? 2 : 1;
			redirNext = true;
			continue;
		}
		if (c === "<") {
			endWord();
			i += src[i + 1] === "&" ? 2 : 1;
			continue;
		}
		if (c === ";" || c === "(" || c === ")") {
			endPipe();
			i++;
			continue;
		}
		if (c === "&") {
			if (src[i + 1] === ">") {
				endWord(); // &> 파일, &>> 파일
				i += src[i + 2] === ">" ? 3 : 2;
				redirNext = true;
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

export const base = (w: string) => w.replace(/\\/g, "/").split("/").pop()!.replace(/\.exe$/i, "").toLowerCase();
export const SKIP = new Set(["then", "do", "else", "elif", "if", "while", "until", "!", "{", "}", "time", "nohup", "exec", "command", "builtin", "stdbuf"]);
/** 명령 앞에 붙는 것(변수 대입, then·do, env·nice·timeout·xargs 등)을 넘기고 실제 명령부터. sudo 는 따로 알림 */
export function strip(words: string[]): { rest: string[]; sudo: boolean } {
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


export const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "busybox"]);
export const INTERP: Record<string, RegExp> = {
	python: /^-c$/,
	python3: /^-c$/,
	py: /^-c$/,
	node: /^(-e|--eval|-p|--print)$/,
	perl: /^-[eE]$/,
	ruby: /^-e$/,
};

