# hook 예

모두 pi 설정 폴더의 `extensions/` 에 그 이름으로 두고 `/reload` 하면 동작한다. 필요한 부분만 고쳐 쓴다.

## 1. 명령 기록 (`my-bash-log.ts`, tool_call)
```ts
/**
 * pi 가 실행하는 bash 명령을 pi 설정 폴더의 my-bash.log 에 시각과 함께 남긴다.
 * 명령에 섞인 비밀번호·토큰도 그대로 남으니 기록 파일을 함부로 나누지 않는다.
 * 끄려면: 파일 이름 끝에 .off 를 붙이고 pi 에서 /reload
 */
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LOG = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "my-bash.log");

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event: any) => {
		if (event.toolName !== "bash") return;
		try {
			const cmd = String(event.input?.command || "").replace(/\s+/g, " ");
			appendFileSync(LOG, `${new Date().toISOString()}\t${cmd}\n`);
		} catch {
			// 기록하지 못해도 명령은 막지 않는다
		}
	});
}
```

## 2. 파일 보호 (`my-protect-files.ts`, tool_call 막기)
```ts
/**
 * 정해 둔 파일은 pi 가 고치기 전에 묻는다. 화면이 없거나(pi -p) 사용자가 거절하면 막고, 모델에게 이유를 알린다.
 * 끄려면: 파일 이름 끝에 .off 를 붙이고 pi 에서 /reload
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// 파일 이름이 이 정규식에 맞으면 보호
const PROTECTED = [/^\.env(\..*)?$/, /^prod[-_.].*\.(ya?ml|json)$/i];

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event: any, ctx: any) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return;
		const name = String(event.input?.path || "").split(/[\\/]/).pop() || "";
		if (!PROTECTED.some((re) => re.test(name))) return;
		if (ctx.hasUI && (await ctx.ui.confirm("보호 중인 파일", `${name} 을(를) 고칠까요?`))) return; // 허락하면 그대로 실행
		return {
			block: true,
			reason: `${name} 은(는) 보호 중인 파일이라 고치지 않았습니다. 고칠 내용을 사용자에게 알려 직접 고치게 하세요.`,
		};
	});
}
```

## 3. 결과에 안내 덧붙이기 (`my-hint-on-error.ts`, tool_result)
```ts
/**
 * bash 결과에 'command not found' 가 있으면, 설치를 시도하지 말고 있는 도구로 하라는 안내를 결과 끝에 붙인다.
 * 끄려면: 파일 이름 끝에 .off 를 붙이고 pi 에서 /reload
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const HINT =
	"\n[안내] 사내망 PC 라 이 명령이 설치되어 있지 않을 수 있습니다. 설치를 시도하지 말고 이미 있는 도구(python 등)로 같은 일을 하세요.";

export default function (pi: ExtensionAPI) {
	pi.on("tool_result", async (event: any) => {
		if (event.toolName !== "bash") return;
		const text = (event.content || []).map((c: any) => (c.type === "text" ? c.text : "")).join("");
		if (!/command not found/i.test(text)) return;
		return { content: [...(event.content || []), { type: "text", text: HINT }] };
	});
}
```

## 4. 팀 규칙 파일을 지침에 더하기 (`my-team-rules.ts`, session_start + before_agent_start)
늘 같은 규칙이면 hook 보다 AGENTS.md 에 적는 편이 쉽다. 이 예는 여러 사람이 같이 고치는 규칙 파일을 세션마다 한 번 읽어 지침에 더한다
(세션 도중에는 같은 글이므로 Copilot·사내AI 대화를 새로 열지 않는다. 파일을 고친 뒤에는 `/reload`).
```ts
/**
 * 팀 규칙 파일의 줄마다 하나씩 지침의 규칙으로 더한다 (세션을 시작할 때 한 번 읽음).
 * 끄려면: 파일 이름 끝에 .off 를 붙이고 pi 에서 /reload
 */
import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RULES_FILE = "Z:/팀/pi/rules.md"; // 한 줄에 규칙 하나 ('- ' 는 빼고 읽음). 없으면 아무것도 하지 않음

export default function (pi: ExtensionAPI) {
	let rules: string[] = [];
	pi.on("session_start", async () => {
		try {
			rules = readFileSync(RULES_FILE, "utf8")
				.split(/\r?\n/)
				.map((s) => s.replace(/^\s*[-*]\s*/, "").trim())
				.filter((s) => s && !s.startsWith("#"));
		} catch {
			rules = [];
		}
	});
	pi.on("before_agent_start", async (event: any) => {
		const g = event.systemPromptOptions.promptGuidelines;
		for (const r of rules) if (!g.includes(r)) g.push(r);
	});
}
```

## 5. 입력 바꾸기 (`my-shortcut.ts`, input)
자주 쓰는 부탁은 명령(`~/.pi/agent/prompts/<이름>.md` → `/이름`)으로 만드는 편이 쉽다. 이 예는 입력 앞부분만 보고 바꾼다.
```ts
/**
 * '요약:' 으로 시작하는 입력을 정해 둔 부탁 말로 바꿔 보낸다.
 * 끄려면: 파일 이름 끝에 .off 를 붙이고 pi 에서 /reload
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SHORTCUTS: [RegExp, string][] = [[/^요약:\s*/, "다음 글을 세 줄로 요약해 줘:\n"]];

export default function (pi: ExtensionAPI) {
	pi.on("input", async (event: any) => {
		const text = String(event.text || "");
		if (text.startsWith("/")) return; // 명령은 건드리지 않음
		for (const [re, head] of SHORTCUTS) if (re.test(text)) return { action: "transform", text: head + text.replace(re, "") };
	});
}
```

## 6. 끝날 때 기록 (`my-done-log.ts`, before_agent_start + agent_end)
```ts
/**
 * 요청마다 걸린 시간과 요청의 첫 줄을 pi 설정 폴더의 my-done.log 에 남긴다.
 * 끄려면: 파일 이름 끝에 .off 를 붙이고 pi 에서 /reload
 */
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LOG = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "my-done.log");

export default function (pi: ExtensionAPI) {
	let started = 0;
	let first = "";
	pi.on("before_agent_start", async (event: any) => {
		started = Date.now();
		first = String(event.prompt || "").split("\n")[0].slice(0, 80);
	});
	pi.on("agent_end", async () => {
		if (!started) return;
		try {
			appendFileSync(LOG, `${new Date().toISOString()}\t${Math.round((Date.now() - started) / 1000)}초\t${first}\n`);
		} catch {}
		started = 0;
	});
}
```
