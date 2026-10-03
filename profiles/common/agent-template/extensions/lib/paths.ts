/**
 * 도구가 받은 경로를 pi 의 도구(read·write·edit)와 같은 방식으로 정리한다 (확장끼리 함께 씀: relay.ts, guard.ts, jupyter.ts).
 * pi 가 하는 것과 맞춘다: 맨 앞의 @ 떼기 (사용자가 @파일 로 적은 것을 LLM 이 그대로 옮겨 쓰는 경우), 특수 공백을 보통 공백으로,
 * file:// 주소를 경로로, (Windows) Git Bash·WSL 형식 /c/..., /mnt/c/..., /cygdrive/c/... 를 C:/... 로.
 * ~ 와 상대 경로는 부르는 쪽에서 푼다 (PC 와 노트북의 기준 폴더가 다르므로).
 * 이 폴더(lib)에는 index.ts 가 없으므로 pi 가 확장으로 불러오지 않는다.
 */

import { fileURLToPath } from "node:url";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/** @ 떼기, 특수 공백, file:// (PC·노트북 공통) */
export function cleanPath(p: unknown): string {
	let s = String(p ?? "").replace(UNICODE_SPACES, " ");
	if (s.startsWith("@")) s = s.slice(1);
	if (/^file:\/\//i.test(s)) {
		try {
			s = fileURLToPath(s);
		} catch {}
	}
	return s;
}

/** (Windows 에서만) /c/..., /mnt/c/..., /cygdrive/c/... -> C:/... */
export function windowsDrivePath(s: string): string {
	if (process.platform !== "win32" || !s.startsWith("/") || s.startsWith("//") || s.includes("\\")) return s;
	const m = s.match(/^\/(?:mnt\/|cygdrive\/)?([a-zA-Z])(?:\/(.*))?$/);
	return m ? `${m[1].toUpperCase()}:/${m[2] ?? ""}` : s;
}

/** PC 의 절대 경로인지: 드라이브(C:/, C:\) 나 공유 폴더(//서버/..., \\서버\...) 로 시작 (노트북 경로는 이렇게 시작하지 않음) */
export const isPcAbsolute = (s: string) => /^[a-zA-Z]:[\\/]/.test(s) || /^(\\\\|\/\/)[^\\/]/.test(s);
