---
name: hook-creator
description: pi 의 hook(확장 파일의 이벤트 처리기)을 만들거나 고칠 때 사용 ("명령 실행 전에 ○○ 막아줘", "작업이 끝나면 ○○ 기록해줘", "○○할 때 △△하는 hook 만들어줘"). 확장 파일(.ts)을 만들고 /reload 로 적용하게 안내한다.
---
# hook 만들기

pi 에는 hook 설정 파일이 따로 없다. hook 은 확장(TypeScript 파일) 안에서 `pi.on("이벤트", 처리기)` 로 만든다.
확장은 pi 안에서 pi 와 같은 권한으로 돈다 (파일·명령·대화 내용에 모두 접근).

## 순서
1. 무엇을(막기·바꾸기·기록·알림), 언제 할지 확인하고 아래 '이벤트' 표에서 이벤트를 고른다.
2. 키트에 이미 있는 기능이면 설정만 알려 주고 만들지 않는다 (설정은 내 설정 파일 `bridge.json`, 고치면 바로 적용).
   - 위험한 명령을 실행 전에 묻기: `"guard_patterns": ["정규식"]` (더 물을 명령), `"guard_allow": ["정규식"]` (묻지 않을 명령)
   - 오래 걸린 작업이 끝나면 알림: `"notify_after_seconds": 60`
   - 계획을 먼저 세우고 확인받기: `/plan`, `/mode`
   - 문서 정리(새 문서는 `docs/INDEX.md` 에 링크, 한 요청에 새 문서 2개를 넘으면 묻기, 이력은 HISTORY.md 하나에): 키트 훅 `docs` 로 이미 켜져 있음 (`/hooks`, 설정 `doc_index`, `doc_new_limit`)
3. 파일 위치를 정한다: pi 설정 폴더의 `extensions/my-<이름>.ts`
   - pi 설정 폴더는 이 SKILL.md 의 위치(스킬 목록의 location)에서 `skills/hook-creator/SKILL.md` 를 뺀 곳이다 (예: `C:/Users/<사용자>/.pi/agent/`).
     그 절대 경로로 쓴다 (jupyter 모드에서도 PC 경로는 PC 에 쓴다. `~` 는 노트북 홈을 뜻하므로 다른 파일을 읽을 때 헷갈리지 않게).
   - 이름은 `my-` 로 시작한다. 키트 확장(copilot-session, jupyter, guard, notify, kit, undo, modes, memory, files, wiki, hooks, `lib/`)은 고치지 않는다: 업데이트 때 새 버전으로 덮어쓴다. `my-` 확장은 업데이트해도 그대로 남는다.
   - 작업 폴더 밖이라 쓰기 전에 확인 창이 뜬다.
4. 아래 '형식'과 '규칙'대로 쓴다. 비슷한 예가 같은 폴더의 `examples.md` 에 있다 (명령 기록, 파일 보호, 결과에 안내 덧붙이기, 규칙 더하기, 입력 바꾸기, 끝날 때 기록).
5. 다 쓰면 pi 에서 `/reload` 를 입력하라고 알린다 (pi 를 다시 실행해도 됨). 불러오지 못하면 pi 가 오류를 보여 주므로 그 내용대로 고친다.
   hook 이 걸릴 만한 요청으로 시험해 보게 하고, 끄는 법(`/hooks off <파일 이름>`, 또는 파일 이름 끝에 `.off` 를 붙이고 `/reload`)도 알린다.

## 형식
```ts
/**
 * (무엇을 하는 hook 인지 한두 줄)
 * 끄려면: 파일 이름 끝에 .off 를 붙이고 pi 에서 /reload
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event: any, ctx: any) => {
		if (event.toolName !== "bash") return;
		// ...
	});
}
```

## 이벤트
| 이벤트 | 언제 | event 에 있는 것 | 돌려주면 |
|---|---|---|---|
| `tool_call` | 도구 실행 직전 | `toolName`(bash, read, write, edit 등), `input`(bash 는 `command`, 파일 도구는 `path`) | `{ block: true, reason: "이유" }` 실행하지 않음 (이유는 모델에게 감). `terminate: true` 를 더하면 작업도 멈춤. `event.input` 을 고치면 고친 값으로 실행 |
| `tool_result` | 도구 실행 뒤 | `toolName`, `input`, `content`(`[{ type: "text", text }]`), `isError` | `{ content: [{ type: "text", text: "..." }] }` 결과를 바꿈 (모델이 보는 결과) |
| `before_agent_start` | 요청을 모델에 보내기 전 | `prompt`, `systemPromptOptions` | 돌려주지 않고 `event.systemPromptOptions.promptGuidelines.push("규칙")` 으로 지침에 규칙을 더함 |
| `input` | 사용자가 입력을 보냈을 때 | `text` | `{ action: "transform", text: "바꾼 글" }` 바꿔서 보냄. `{ action: "handled" }` 모델에 보내지 않음 |
| `message_end` | 메시지 하나가 끝났을 때 | `message`(`role`, `content`, `stopReason`) | 기록용 (돌려주지 않음) |
| `agent_start` / `agent_end` | 요청 처리 시작·끝 | (`agent_end`: `messages`) | 기록·정리용 |
| `agent_settled` | pi 가 더 이어 가지 않을 때 | | 알림용 |
| `session_start` / `session_shutdown` | 세션 시작·끝 | `reason`(`startup`, `reload` 등) | 준비·정리용 |

`ctx` 에 있는 것: `ctx.hasUI`(화면이 있는지. `pi -p` 면 false), `await ctx.ui.confirm("제목", "내용")`(예/아니오), `ctx.ui.notify("글", "info")`(`"warning"`, `"error"`), `ctx.cwd`(PC 쪽 작업 폴더).

## 규칙
- **읽기·조회는 막지 않는다:** read·grep·find·ls 같은 도구와 읽기만 하는 명령, wiki_search·wiki_read·docs_lookup.
  막는 hook 은 쓰기·실행처럼 무언가를 바꾸는 도구에만 건다. 조건(예: 계획 문서가 없음)이 안 맞는다고 모든 도구를 막으면 pi 가 아무것도 확인하지 못해, 결국 hook 을 다 꺼야 한다.
- **먼저 알리기:** 처음에는 tool_result 에 안내를 덧붙이는 hook 으로 만든다. 꼭 막아야 할 때만 막고, 막을 때는 화면이 있으면 `ctx.ui.confirm` 으로 사용자에게 묻는다. 화면이 없으면(`pi -p`) 막지 말고 안내만 한다.
- **키트 확장은 끄거나 고치지 않는다** (guard.ts 등). hook 을 끄라는 부탁이면 그 hook 파일만 끈다: `/hooks off <이름>`, 내 hook 모두는 `/hooks off mine` (위험 명령 확인은 그대로 남음).
- 외부 npm 패키지는 쓰지 않는다 (사내망이라 설치할 수 없음). Node 기본 모듈(`node:fs`, `node:path`, `node:os`)만 쓴다. `import type` 줄은 실행할 때 지워지므로 그대로 둔다.
- 파일 하나에 `export default function (pi: ExtensionAPI)` 하나. 도움 함수도 같은 파일에 둔다 (extensions 폴더의 .ts 는 모두 확장으로 불러온다).
- 함수 밖(파일을 불러올 때)에서 타이머·프로세스·파일 감시를 시작하지 않는다. 필요하면 `session_start` 에서 시작하고 `session_shutdown` 에서 멈춘다.
- `tool_call` 처리기에서 오류가 나면 그 도구 실행이 막힌다. 막을 뜻이 아니면 처리기 안을 try/catch 로 감싼다.
- 물어볼 때는 `ctx.hasUI` 를 먼저 본다. 화면이 없으면 묻지 말고 막거나 그대로 둔다.
- jupyter 모드에서 hook 은 PC 에서 돈다. 도구의 명령·경로(`input.command`, `input.path`)는 노트북 기준이라 PC 의 `fs` 로 그 파일을 읽을 수 없다.
- `before_agent_start` 로 더하는 규칙은 매번 같은 글로 한다. 요청마다 바뀌는 글(시각, 무작위 값)을 넣으면 Copilot·사내AI 중계 서버가 대화를 새로 열 수 있어 느려지고 사용량이 는다.
- 바꿀 값(패턴, 파일 이름 등)은 파일 맨 위의 상수로 둔다 (고친 뒤 `/reload`).
- 기록 파일은 pi 설정 폴더에 둔다: `join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "my-....log")`. 명령에 섞인 비밀번호·토큰도 기록될 수 있음을 알린다.
- 하지 않는 것: 비밀번호·토큰을 코드에 넣기, 사용자 모르게 밖으로 보내기, Copilot·사내AI 의 보안·개인정보 확인을 피하거나 자동으로 넘기는 hook (자동 답장, 내용을 가려 통과시키기 등).
