// node:fs + globSync (Node 22+) 대체 구현.
// 지원: * ? ** [..] [!..] {a,b}, 옵션 cwd / exclude.  Node 와 같이 와일드카드는 '.' 으로 시작하는 항목과 매칭하지 않음
import fs from "node:fs";
import path from "node:path";
export * from "node:fs";
export default fs;

function segmentRegExp(seg) {
  let re = "";
  let inClass = false;
  let braces = 0;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (inClass) {
      if (c === "]") inClass = false;
      re += c === "\\" ? "\\\\" : c;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "[") {
      inClass = true;
      if (seg[i + 1] === "!") {
        i++;
        re += "[^";
      } else re += "[";
    } else if (c === "{") {
      braces++;
      re += "(?:";
    } else if (c === "}" && braces) {
      braces--;
      re += ")";
    } else if (c === "," && braces) re += "|";
    else re += /[.+^$()|\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${seg.startsWith(".") ? "" : "(?!\\.)"}${re}$`);
}

const compile = (glob) => glob.split("/").map((s) => (s === "**" ? "**" : segmentRegExp(s)));

function matches(pat, segs, pi = 0, si = 0) {
  if (pi === pat.length) return si === segs.length;
  if (pat[pi] === "**") {
    if (matches(pat, segs, pi + 1, si)) return true;
    for (let k = si; k < segs.length; k++) {
      if (segs[k].startsWith(".")) return false;
      if (matches(pat, segs, pi + 1, k + 1)) return true;
    }
    return false;
  }
  return si < segs.length && pat[pi].test(segs[si]) && matches(pat, segs, pi + 1, si + 1);
}

const toPosix = (p) => p.split(path.sep).join("/");

// Node 22.0~22.18 처럼 globSync 가 이미 있는 버전에서는 원래 구현을 그대로 사용
export const globSync = fs.globSync ?? globSyncPolyfill;

function globSyncPolyfill(pattern, options = {}) {
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  const cwd = options.cwd ? String(options.cwd instanceof URL ? options.cwd.pathname : options.cwd) : process.cwd();
  const exclude = options.exclude;
  const excludePats = Array.isArray(exclude) ? exclude.map((x) => compile(toPosix(x))) : [];
  const results = new Set();
  for (const raw of patterns) {
    const p = path.posix.normalize(toPosix(raw));
    const absolute = path.isAbsolute(raw);
    const parts = p.split("/");
    const firstMagic = parts.findIndex((s) => /[*?[{]/.test(s));
    if (firstMagic === -1) {
      if (fs.existsSync(path.resolve(cwd, p))) results.add(p.split("/").join(path.sep));
      continue;
    }
    if (firstMagic === 0 && matches(compile(p), [])) results.add("."); // '**' 는 cwd 자신도 포함
    const pat = compile(p);
    const deep = parts.slice(firstMagic).includes("**");
    const maxDepth = deep ? Infinity : parts.length - firstMagic;
    const baseAbs = path.resolve(cwd, parts.slice(0, firstMagic).join("/") || ".");
    const consider = (abs) => {
      const rel = toPosix(path.relative(cwd, abs));
      const candidate = absolute ? toPosix(abs) : rel;
      if (!candidate) return false;
      if (typeof exclude === "function" && exclude(absolute ? abs : rel)) return false;
      if (excludePats.some((x) => matches(x, candidate.split("/")))) return false;
      if (matches(pat, candidate.split("/"))) results.add(absolute ? abs : rel.split("/").join(path.sep));
      return true;
    };
    if (firstMagic > 0) consider(baseAbs); // 'a/**' 는 'a' 자신도 포함
    const walk = (dirAbs, depth) => {
      let entries;
      try {
        entries = fs.readdirSync(dirAbs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const abs = path.join(dirAbs, e.name);
        if (consider(abs) && e.isDirectory() && depth + 1 < maxDepth) walk(abs, depth + 1);
      }
    };
    walk(baseAbs, 0);
  }
  return [...results];
}

// 테스트용 (Node 22+ 에서도 대체 구현을 직접 검증하기 위함)
export const __globSyncPolyfill = globSyncPolyfill;
