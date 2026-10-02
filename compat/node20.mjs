// pi 를 Node 20 (20.15+) 에서 실행하기 위한 호환 레이어.  bin/pi 가 Node 22.19 미만일 때 --import 로 자동 로드.
// pi 는 공식적으로 Node 22.19+ 를 요구하므로, 여기서는 pi 번들이 실제로 쓰는 Node 22 기능만 보충한다.
import { createRequire, register } from "node:module";

const require = createRequire(import.meta.url);
const define = (obj, name, value) => {
  if (!(name in obj)) Object.defineProperty(obj, name, { value, writable: true, configurable: true });
};

// Node 22 / V8 12 전역 기능
define(Promise, "withResolvers", function withResolvers() {
  let resolve, reject;
  const promise = new this((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
});
define(process, "getBuiltinModule", (id) => {
  try {
    return require(id.startsWith("node:") ? id : `node:${id}`);
  } catch {
    return undefined;
  }
});
define(Array, "fromAsync", async (items, mapFn, thisArg) => {
  const out = [];
  let i = 0;
  for await (const v of items) out.push(mapFn ? await mapFn.call(thisArg, v, i++) : v);
  return out;
});
const groupBy = (items, fn) => {
  const out = new Map();
  let i = 0;
  for (const v of items) {
    const k = fn(v, i++);
    (out.get(k) ?? out.set(k, []).get(k)).push(v);
  }
  return out;
};
define(Map, "groupBy", groupBy);
define(Object, "groupBy", (items, fn) => Object.assign(Object.create(null), Object.fromEntries(groupBy(items, fn))));

// undici(HTTP 클라이언트)가 쓰는 worker_threads.markAsUncloneable (Node 22.10+): 객체를 복제 불가로 표시하는 보호 기능이라 no-op 으로 대체
const workerThreads = require("node:worker_threads");
if (typeof workerThreads.markAsUncloneable !== "function") workerThreads.markAsUncloneable = () => {};

// node:fs 의 globSync, node:module 의 enableCompileCache 는 ESM named import 라서
// pi 번들에서 import 할 때만 shim 모듈로 연결 (resolve hook)
register("./node20-hooks.mjs", import.meta.url);
