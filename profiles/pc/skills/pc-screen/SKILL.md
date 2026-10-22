---
name: pc-screen
description: Windows PC 에서 만든 창 프로그램(WinForms·WPF·작업 표시줄 위젯 등)이 화면에 실제로 보이는지, 위치·크기·겹침이 맞는지 확인할 때 사용. 프로그램 띄우기, 창 목록(겹친 차례·항상 위·가리는 창), 화면 찍기. Windows PC 에서만.
---
# PC 화면 확인

창이 있는 프로그램을 만들거나 고쳤으면 "실행된다" 에서 멈추지 말고 화면에 실제로 보이는지까지 확인한다.
(2026-10 시험: '항상 위' 를 넣었다고 끝냈지만 창이 작업 표시줄 아래에 가려 보이지 않았다.)
스크립트는 모두 `ps1` 로 실행한다. 경로는 `~/.pi/agent/skills/pc-screen/scripts/`.

## 1. 띄우기
```bash
ps1 ~/.pi/agent/skills/pc-screen/scripts/start.ps1 ./resmon.exe
```
- `실행: resmon.exe pid 1234` 와 `창: L,T,R,B (폭x높이)` 를 알려 준다. 10초 안에 창이 없으면 그렇다고 알린다 (`start.ps1 -Wait 30 ./resmon.exe` 로 늘림).
- bash 에서 `./app.exe &` 로 띄우지 않는다. pi 의 명령이 그 프로그램이 끝날 때까지 끝나지 않는다.
- 다시 빌드하기 전에 끈다 (실행 중이면 exe 를 덮어쓰지 못함): `ps1 -c 'Stop-Process -Name resmon -ErrorAction SilentlyContinue'`

## 2. 창 확인 (글)
```bash
ps1 ~/.pi/agent/skills/pc-screen/scripts/windows.ps1 -Name resmon
```
- 그 프로그램의 창(위치·크기·항상 위)과, 그 창 위에 겹쳐 **가리는 창** 을 보여 준다. `가리는 창 없음` 이어야 보이는 것이다.
- 작업 표시줄 근처: `-Band 120` (주 모니터 아래쪽 120px 에 걸친 창, 위에 있는 것부터). 작업 표시줄은 `explorer Shell_TrayWnd`.
- 위치·폭이 흔들리는지: `-Name resmon -Watch 10` (10초 동안 1초마다, 바뀌면 `<- 바뀜`).
- 좌표는 물리 픽셀이다 (화면 배율이 175% 면 디자인의 100px 가 175px). 다른 프로그램 창의 제목은 적지 않는다.

## 3. 화면 찍기 (그림)
```bash
ps1 ~/.pi/agent/skills/pc-screen/scripts/shot.ps1 -Window resmon -Out shot.png
```
그다음 read 로 `shot.png` 를 열어 직접 본다. 화면에 실제로 그려진 것을 찍으므로, 가려져 있으면 가린 창(작업 표시줄 등)이 찍힌다.
- 다른 곳: `-Region x,y,w,h` (물리 픽셀), `-Taskbar`, `-Screen` (주 모니터 전체).
- **확인할 창·영역만 찍는다.** 찍은 그림은 모델(Copilot)에 함께 가므로, 화면 전체를 찍으면 다른 창의 내용(메일·메신저 등)도 같이 간다. `-Screen` 은 꼭 필요할 때만.
- 긴 쪽이 1600px 를 넘으면 줄여 저장한다 (`-Max`). 다 본 그림 파일은 지운다.
- 그림을 볼 수 없는 모델(사내AI 는 그림을 보내지 않음)이면 2의 글로 확인한다.

## 4. 끝났다고 하기 전에
- 요구사항의 항목이 화면에 다 나오는지, 글자가 잘리거나 겹치지 않는지, 위치가 맞는지 그림으로 확인한다.
- 확인하지 못한 것(다른 모니터, 배율, 자동 숨김 작업 표시줄 등)은 확인하지 못했다고 적는다.
