# 제3자 소스 (Third-party notices)

`runtime/` 의 파일은 아래 npm 공식 배포본(.tgz)에서 **실행에 필요한 파일만 골라 내용 수정 없이** 넣은 것입니다.
- 제외한 파일: 타입 선언(`.d.ts`), 소스맵(`.map`), 라이브러리의 `src/`·하위 `node_modules/`, pi 의 예제(`examples/`)·변경 이력 등 실행에 쓰이지 않는 파일
- 포함한 파일 각각의 sha256: [docs/runtime-SHA256SUMS.txt](docs/runtime-SHA256SUMS.txt)
- 확인: 2026-10-02, 포함한 835개 파일 모두 공식 배포본 안의 같은 경로 파일과 sha256 일치

| 패키지 | 버전 | 라이선스 | 위치 (파일 수) | 원본 소스 저장소 |
|---|---|---|---|---|
| `@earendil-works/pi-coding-agent` | 0.87.1 | MIT — `LICENSE-pi` | `runtime/` (100) | https://github.com/earendil-works/pi (packages/coding-agent) |
| `@earendil-works/chord` | 0.87.1 | MIT — pi 와 같은 저장소, `LICENSE-pi` | `runtime/node_modules/@earendil-works/chord/` (29) | https://github.com/earendil-works/pi (packages/chord) |
| `typebox` | 1.3.27 | MIT — `runtime/node_modules/typebox/license` | `runtime/node_modules/typebox/` (694) | https://github.com/sinclairzx81/typebox |
| `jiti` | 2.7.0 | MIT — `runtime/node_modules/jiti/LICENSE` | `runtime/node_modules/jiti/` (12) | https://github.com/unjs/jiti |

## npm 배포본 (원본 대조용)
공식 배포본을 내려받아 아래 해시와 비교하면 같은 파일인지 확인할 수 있습니다.
`integrity` 는 npm 레지스트리가 기록하는 값과 같은 형식이고, sha512(hex) 는 Windows `certutil -hashfile <파일> SHA512` 결과와 비교할 수 있습니다.
압축을 풀면 `package/` 폴더가 나오며, 그 안의 파일이 위 표의 `위치` 와 대응합니다.

### @earendil-works/pi-coding-agent 0.87.1
- 배포 주소: https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-0.87.1.tgz
- 크기: 7329151 byte
- integrity: `sha512-m8ArJUtVcQMSe1lLE/Ei7vX/JV7O39sWmWBsXV2NOU70F0qCp8GubA24pT3LnwTmM6LL2xV80/h6sQg85n69ew==`
- sha512 (hex): `9bc02b254b557103127b594b13f122eef5ff255ecedfdb1699606c5d5d8d394ef4174a82a7c1ae6c0db8a53dcb9f04e633a2cbdb157cd3f87ab1083ce67ebd7b`

### @earendil-works/chord 0.87.1
- 배포 주소: https://registry.npmjs.org/@earendil-works/chord/-/chord-0.87.1.tgz
- 크기: 236677 byte
- integrity: `sha512-bg7IkJGFcEaMqqYgOGUiq5Ky9RghpRfrlZ8I/v/1b4bBZ02A7t3E+6uhPRbadwWb/kWsnVFbZsqOKRN4a3LLCg==`
- sha512 (hex): `6e0ec890918570468caaa620386522ab92b2f51821a517eb959f08fefff56f86c1674d80eeddc4fbaba13d16da77059bfe45ac9d515b66ca8e2913786b72cb0a`

### typebox 1.3.27
- 배포 주소: https://registry.npmjs.org/typebox/-/typebox-1.3.27.tgz
- 크기: 264178 byte
- integrity: `sha512-zu+jc1pcy4UiNThxikUr36f0Rybk9PEeCg/NE6adeWr/SKsdNO4EzZHYRDlv2YCVAfj3Odq3dESSo/jNyoBXzA==`
- sha512 (hex): `ceefa3735a5ccb85223538718a452bdfa7f44726e4f4f11e0a0fcd13a69d796aff48ab1d34ee04cd91d844396fd9809501f8f739dab7744492a3f8cdca8057cc`

### jiti 2.7.0
- 배포 주소: https://registry.npmjs.org/jiti/-/jiti-2.7.0.tgz
- 크기: 427320 byte
- integrity: `sha512-AC/7JofJvZGrrneWNaEnJeOLUx+JlGt7tNa0wZiRPT4MY1wmfKjt2+6O2p2uz2+skll8OZZmJMNqeke7kKbNgQ==`
- sha512 (hex): `002ffb2687c9bd91abae779635a12725e38b531f89946b7bb4d6b4c198913d3e0c635c267ca8eddbee8eda9daecf6fac92597c39966624c36a7a47bb90a6cd81`
