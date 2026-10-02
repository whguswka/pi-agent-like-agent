// Windows Git Bash: VS Code 계열 편집기(Electron) 내장 Node 로 대화형 화면(TUI)을 쓰기 위한 TTY 흉내.
// Code.exe 는 GUI 프로그램이라 터미널을 직접 쓰지 못하므로, bin/tty-relay.sh 가 터미널을 raw 모드로 바꾸고
// 입출력을 파이프로 중계한다. 이 파일은 그 파이프를 pi 가 터미널(TTY)로 인식하게 만든다.
//  - PI_TTY_RELAY = 창 크기 파일 경로 ("행 열"). bin/tty-relay.sh 가 0.4초마다 갱신
import fs from "node:fs";

const sizeFile = process.env.PI_TTY_RELAY;
delete process.env.PI_TTY_RELAY;

if (sizeFile) {
  let rows = 24;
  let cols = 80;
  const readSize = () => {
    try {
      const [r, c] = fs.readFileSync(sizeFile, "utf8").trim().split(/\s+/).map(Number);
      if (r > 0 && c > 0 && (r !== rows || c !== cols)) {
        rows = r;
        cols = c;
        return true;
      }
    } catch {}
    return false;
  };
  readSize();

  const stdin = process.stdin;
  const stdout = process.stdout;
  // 터미널은 이미 raw 모드(tty-relay.sh) 이므로 setRawMode 는 상태만 기록
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.setRawMode = function setRawMode(mode) {
    this.isRaw = Boolean(mode);
    return this;
  };
  Object.defineProperty(stdout, "isTTY", { value: true, configurable: true, writable: true });
  Object.defineProperty(stdout, "columns", { get: () => cols, configurable: true });
  Object.defineProperty(stdout, "rows", { get: () => rows, configurable: true });
  stdout.getWindowSize = () => [cols, rows];
  stdout.hasColors = (count = 16) => count <= 2 ** 24;
  stdout.getColorDepth = () => 24;

  // 창 크기 변경 -> resize 이벤트
  setInterval(() => {
    if (readSize()) stdout.emit("resize");
  }, 300).unref();
}
