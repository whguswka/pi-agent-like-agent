// 시험용 @earendil-works/pi-coding-agent (pi 안에서는 pi 가 진짜 것을 넘겨 줌): jupyter.ts 를 불러올 수 있게 도구 만들기 함수만
const tool = (name) => (cwd, opts) => ({ name, cwd, opts });
export const createBashTool = tool("bash");
export const createEditTool = tool("edit");
export const createReadTool = tool("read");
export const createWriteTool = tool("write");
