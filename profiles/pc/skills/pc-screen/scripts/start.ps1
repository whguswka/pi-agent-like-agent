# 창이 있는 프로그램을 띄우고 바로 돌아옴 (pc-screen 스킬)
#   start.ps1 [-Wait 초] [-Hidden] <실행 파일> [그 프로그램의 인자...]   (이 스크립트의 옵션은 실행 파일 앞에)
#   -Wait <초> (기본 10): 그동안 보이는 창이 생기면 위치를 알림 (그 뒤에도 프로그램은 계속 실행)
#   -Hidden: 창을 숨겨서 띄움 (콘솔 프로그램을 뒤에서 돌릴 때)
# bash 에서 ./app.exe & 로 띄우면 그 프로그램이 bash 의 출력을 쥐고 있어 pi 의 명령이 프로그램이 끝날 때까지 끝나지 않는다.
# 여기서는 Start-Process 로 따로 띄워 바로 돌아온다. 끄기: ps1 -c 'Stop-Process -Id <pid>'
# (param 을 두지 않음: 프로그램의 인자(-c 등)가 이 스크립트의 옵션으로 잘못 묶이지 않게 직접 나눈다)
$Wait = 10; $Hidden = $false; $rest = @($args)
while ($rest.Count -gt 0) {
  if ($rest[0] -eq "-Wait" -and $rest.Count -gt 1) { $Wait = [int]$rest[1]; $rest = @($rest | Select-Object -Skip 2) }
  elseif ($rest[0] -eq "-Hidden") { $Hidden = $true; $rest = @($rest | Select-Object -Skip 1) }
  else { break }
}
if ($rest.Count -lt 1) { "사용법: start.ps1 [-Wait 초] [-Hidden] <실행 파일> [인자...]"; exit 2 }
$Path = [string]$rest[0]; $progArgs = @($rest | Select-Object -Skip 1)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PiStart {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
  public static string Find(int pid) {
    string o = null;
    EnumWindows((h, l) => {
      int p; GetWindowThreadProcessId(h, out p);
      RECT r;
      if (p == pid && IsWindowVisible(h) && GetWindowRect(h, out r) && r.R - r.L > 1 && r.B - r.T > 1) {
        o = string.Format("{0},{1},{2},{3} ({4}x{5})", r.L, r.T, r.R, r.B, r.R - r.L, r.B - r.T);
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return o;
  }
}
"@
[PiStart]::SetProcessDPIAware() | Out-Null
$exe = $Path
if (Test-Path -LiteralPath $Path) { $exe = (Resolve-Path -LiteralPath $Path).ProviderPath }
# 인자는 빈칸·따옴표가 있으면 따옴표로 감싸 넘김 (Windows PowerShell 5.1 의 Start-Process 는 그냥 빈칸으로 이음)
$line = ($progArgs | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
$opt = @{ FilePath = $exe; WorkingDirectory = (Get-Location).ProviderPath; PassThru = $true }
if ($line) { $opt.ArgumentList = $line }
if ($Hidden) { $opt.WindowStyle = "Hidden" }
try { $p = Start-Process @opt -ErrorAction Stop } catch { "띄우지 못함: $Path ($($_.Exception.Message))"; exit 1 }
"실행: $([IO.Path]::GetFileName($exe)) pid $($p.Id)"
if ($Hidden) { exit 0 }
$end = (Get-Date).AddSeconds($Wait)
while ((Get-Date) -lt $end) {
  if ($p.HasExited) { "바로 끝남: 종료 코드 $($p.ExitCode)"; exit 1 }
  $r = [PiStart]::Find($p.Id)
  if ($r) { "창: $r (물리 픽셀). 보이는지는 shot.ps1 -Window 로 찍어 확인"; exit 0 }
  Start-Sleep -Milliseconds 500
}
"${Wait}초 안에 보이는 창이 생기지 않음 (프로그램은 계속 실행 중. windows.ps1 -Name 로 다시 확인)"
