// 기억하기(profiles/common/agent-template/extensions/memory.ts) 단위 테스트: 지침 파일에 "## 기억할 것" 항목 더하기
// 사용법: node tests/test_memory.mjs   (Node 20.15 이상. 저장소의 runtime/node_modules/jiti 로 .ts 를 불러옴)
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";

const jiti = createJiti(import.meta.url);
const { addMemory } = await jiti.import("../profiles/common/agent-template/extensions/memory.ts");
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(detail)));
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

console.log(fails ? `\n실패 ${fails}개` : "\n모두 통과");
process.exit(fails ? 1 : 0);
