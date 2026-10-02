// node:module + enableCompileCache (Node 22.1+) 대체: 컴파일 캐시는 성능 최적화일 뿐이므로 no-op
import mod from "node:module";
export * from "node:module";
export default mod;
export const enableCompileCache = mod.enableCompileCache ?? (() => ({ status: 0 }));
