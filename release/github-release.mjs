// GitHub Release 만들기(있으면 고치기)와 파일 올리기
//   node release/github-release.mjs [--notes <커밋>] <저장소 폴더> <태그> [올릴 파일...]
//  제목 '버전 <버전>', 본문은 받는 법 + 그 태그의 CHANGELOG.md '## <버전>' 항목. pi 본체(runtime/)가 앞 태그와 다르면 그 안내도
//  --notes: CHANGELOG 항목만 <커밋>(예: HEAD)의 CHANGELOG.md 에서 가져옴. 태그를 낸 뒤 고친 글을 지난 Release 에 반영할 때
//   (링크는 그대로 그 태그의 파일로 가므로, 그 뒤에 바뀐 제목(#…)으로 가는 링크가 없는지 볼 것)
//  같은 이름의 파일이 이미 올라가 있으면 지우고 다시 올림 (몇 번을 돌려도 같은 결과)
//  토큰은 git credential fill 로 얻어 Authorization 머리글로만 씀 (화면·인자에 쓰지 않음)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const args = process.argv.slice(2);
let notesRev = "";
if (args[0] === "--notes") [, notesRev] = args.splice(0, 2);
const [repoDir, tag, ...files] = args;
if (!repoDir || !tag || args.includes("--notes")) {
	console.error("사용법: node release/github-release.mjs [--notes <커밋>] <저장소 폴더> <태그> [올릴 파일...]");
	process.exit(2);
}
const git = (...a) => execFileSync("git", ["-C", repoDir, ...a], { encoding: "utf8" }).trim();
const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(git("remote", "get-url", "origin"));
if (!m) throw new Error("origin 이 GitHub 저장소가 아닙니다");
const [, owner, repo] = m;
const ver = git("show", `${tag}:VERSION`).trim();

// 본문
const section = (() => {
	const out = [];
	let on = false;
	for (const l of git("show", `${notesRev || tag}:CHANGELOG.md`).split(/\r?\n/)) {
		if (/^## /.test(l)) {
			if (on) break;
			on = l.split(/\s+/)[1] === ver;
			continue;
		}
		if (on) out.push(l);
	}
	// CHANGELOG 의 상대 링크(README.md#… 등)는 Release 페이지에서 깨지므로 그 태그의 저장소 주소로
	return out
		.join("\n")
		.trim()
		.replace(/\]\((?![a-z]+:|#|\/)([^)\s]+)\)/gi, (_, p) => `](https://github.com/${owner}/${repo}/blob/${tag}/${p})`);
})();
let prev = "";
try {
	prev = git("describe", "--tags", "--abbrev=0", `${tag}^`);
} catch {}
let runtimeChanged = false;
if (prev)
	try {
		git("diff", "--quiet", prev, tag, "--", "runtime");
	} catch {
		runtimeChanged = true;
	}
const light = `${repo}-${ver}-update.zip`;
// 이 버전으로는 전체 zip 이 필요한 때: pi 본체가 앞 태그와 다르거나, CHANGELOG 의 '할 일' 이 전체 zip 을 말할 때 (예: 예전 update.sh 가 가벼운 zip 을 모름)
const fullNeeded = runtimeChanged || /^- 할 일[^\n]*전체 zip/m.test(section);
const body = [
	"**사내망으로 반입할 파일**",
	fullNeeded
		? `- **이 버전으로 바꿀 때는 전체 zip** (\`Source code (zip)\`)${runtimeChanged ? `: pi 본체가 앞 버전(${prev.replace(/^v/, "")})과 다릅니다` : ": 아래 '할 일' 을 보세요"}. 아래 Assets 의 \`${light}\` (pi 본체 \`runtime/\` 을 뺀 가벼운 zip)는 이미 이 버전 이상을 쓰는 곳에서 씁니다`
		: `- 새 버전으로 바꿀 때: 아래 Assets 의 \`${light}\` (pi 본체 \`runtime/\` 을 뺀 가벼운 zip). 바꾸는 명령은 README 7장`,
	"- 처음 설치할 때, 또는 pi 본체가 바뀐 버전: `Source code (zip)` (전체)",
	"",
	`## ${ver}`,
	section || "(CHANGELOG 에 이 버전의 항목이 없습니다)",
]
	.filter((l, i, a) => l !== "" || a[i - 1] !== "")
	.join("\n");

// 토큰
const cred = execFileSync("git", ["credential", "fill"], {
	input: "protocol=https\nhost=github.com\n\n",
	encoding: "utf8",
	env: { ...process.env, GCM_INTERACTIVE: "never" },
});
const token = /^password=(.+)$/m.exec(cred)?.[1];
if (!token) throw new Error("GitHub 토큰을 얻지 못했습니다 (git credential fill)");

const api = async (method, path, body, headers = {}) => {
	const r = await fetch(path.startsWith("https:") ? path : `https://api.github.com${path}`, {
		method,
		headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...headers },
		body,
	});
	const text = await r.text();
	let json = {};
	try {
		json = text ? JSON.parse(text) : {};
	} catch {}
	return { status: r.status, json };
};
const fail = (what, r) => {
	throw new Error(`${what}: HTTP ${r.status} ${r.json?.message || ""} ${JSON.stringify(r.json?.errors || "")}`.trim());
};

const base = `/repos/${owner}/${repo}/releases`;
const info = { tag_name: tag, name: `버전 ${ver}`, body, draft: false, prerelease: false, make_latest: "true" };
let r = await api("POST", base, JSON.stringify(info), { "Content-Type": "application/json" });
let rel = r.json;
if (r.status === 422) {
	r = await api("GET", `${base}/tags/${encodeURIComponent(tag)}`);
	if (r.status !== 200) fail("있는 Release 찾기", r);
	r = await api("PATCH", `${base}/${r.json.id}`, JSON.stringify({ name: info.name, body, make_latest: "true" }), { "Content-Type": "application/json" });
	if (r.status !== 200) fail("Release 고치기", r);
	rel = r.json;
	console.log(`[release] 있는 Release 를 고침: ${rel.html_url}`);
} else if (r.status === 201) console.log(`[release] Release 를 만듦: ${rel.html_url}`);
else fail("Release 만들기", r);

for (const f of files) {
	const name = basename(f);
	for (const a of rel.assets || [])
		if (a.name === name) {
			const d = await api("DELETE", `${base}/assets/${a.id}`);
			if (d.status !== 204) fail(`${name} 지우기`, d);
		}
	const data = readFileSync(f);
	const up = await api("POST", `https://uploads.github.com/repos/${owner}/${repo}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`, data, {
		"Content-Type": "application/zip",
	});
	if (up.status !== 201) fail(`${name} 올리기`, up);
	console.log(`[release] 올림: ${up.json.name} (${Math.round(up.json.size / 1024)}KB) ${up.json.browser_download_url}`);
}
