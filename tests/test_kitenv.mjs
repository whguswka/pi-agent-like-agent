// /kit env (profiles/common/agent-template/extensions/kit.ts) 단위 테스트: 조사 결과 읽기, 지침의 '실행 환경' 부분 쓰기
// 사용법: node tests/test_kitenv.mjs   (저장소의 runtime/node_modules/jiti 로 .ts 를 불러옴)
import { createJiti } from "../runtime/node_modules/jiti/lib/jiti.mjs";

const jiti = createJiti(import.meta.url);
const { parseEnv, putEnv } = await jiti.import("../profiles/common/agent-template/extensions/kit.ts");
let fails = 0;
const check = (name, cond, detail = "") => {
	console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(detail)));
	if (!cond) fails++;
};

const out = "pibridge$ 명령 줄\n@@ OS: Ubuntu 22.04.3 LTS\n@@ Python: 3.10.12\n@@ 패키지: kfp 2.7.0, torch 2.1.0\n@@ nvcc: \n잡음\n@@ GPU: 2× NVIDIA A100, 81920 MiB\n";
const items = parseEnv(out);
check("조사 결과: '@@ 이름: 값' 줄만, 값이 빈 줄은 뺌", JSON.stringify(items) === JSON.stringify([
	["OS", "Ubuntu 22.04.3 LTS"], ["Python", "3.10.12"], ["패키지", "kfp 2.7.0, torch 2.1.0"], ["GPU", "2× NVIDIA A100, 81920 MiB"],
]), items);

const one = putEnv("# 지침\n\n- 규칙 A\n", "notebook", "Kubeflow 노트북 (jupyter 모드)", items, "2026-10-17");
check("처음: 끝에 빈 줄 하나 두고 표시와 함께 더함 (기존 글 그대로)", one.startsWith("# 지침\n\n- 규칙 A\n\n<!-- kit env: notebook -->\n## 실행 환경: Kubeflow 노트북 (jupyter 모드) (/kit env 로 조사, 2026-10-17)\n- OS: Ubuntu 22.04.3 LTS\n")
	&& one.endsWith("<!-- /kit env: notebook -->\n"), one);
const two = putEnv(one + "\n## 다른 부분\n내용\n", "notebook", "Kubeflow 노트북 (jupyter 모드)", [["Python", "3.11.9"]], "2026-10-18");
check("다시 조사: 그 부분만 바꾸고 뒤의 글은 그대로", two.includes("- Python: 3.11.9") && !two.includes("3.10.12") && two.includes("(/kit env 로 조사, 2026-10-18)")
	&& two.endsWith("\n## 다른 부분\n내용\n") && (two.match(/<!-- kit env: notebook -->/g) || []).length === 1, two);
const three = putEnv(two, "pc", "이 PC (Git Bash)", [["OS", "MINGW64_NT-10.0"]], "2026-10-18");
check("다른 곳(pc)은 따로 하나 더", (three.match(/<!-- kit env: /g) || []).length === 2 && three.includes("## 실행 환경: 이 PC (Git Bash)"), three);
const crlf = putEnv("# 지침\r\n- A\r\n", "notebook", "이 노트북", [["OS", "x"]], "2026-10-17");
check("CRLF 파일은 CRLF 로", crlf.includes("\r\n<!-- kit env: notebook -->\r\n") && !/[^\r]\n/.test(crlf), crlf);
check("빈 파일이면 그 부분만", putEnv("", "notebook", "이 노트북", [["OS", "x"]], "2026-10-17").startsWith("<!-- kit env: notebook -->\n"));

console.log(fails ? `RESULT: FAIL (${fails})` : "RESULT: PASS");
process.exit(fails ? 1 : 0);
