// pi 번들(runtime/dist/bundle)의 node:fs / node:module import 를 shim 으로 연결하는 resolve hook
const SHIMS = {
  "node:fs": new URL("./shims/fs.mjs", import.meta.url).href,
  fs: new URL("./shims/fs.mjs", import.meta.url).href,
  "node:module": new URL("./shims/module.mjs", import.meta.url).href,
  module: new URL("./shims/module.mjs", import.meta.url).href,
};
export async function resolve(specifier, context, next) {
  const shim = SHIMS[specifier];
  if (shim && context.parentURL && /\/runtime\/dist\/bundle\//.test(context.parentURL)) {
    return { url: shim, shortCircuit: true };
  }
  return next(specifier, context);
}
