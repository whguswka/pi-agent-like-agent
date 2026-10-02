// VS Code 계열 편집기(Electron)에 내장된 Node 로 pi 를 실행할 때 bin/pi 가 --import 로 로드.
// ELECTRON_RUN_AS_NODE 는 실행 시점에만 필요하므로 지워서, pi 가 실행하는 하위 프로세스
// (bash 도구에서 실행한 `code .` 등)가 Node 모드로 잘못 실행되지 않게 한다.
delete process.env.ELECTRON_RUN_AS_NODE;
