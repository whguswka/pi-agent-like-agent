# 화면을 찍어 PNG 로 저장 (pc-screen 스킬). 찍은 그림은 read 로 열면 모델(Copilot)에 함께 가므로 확인할 창·영역만 찍는다
#   shot.ps1 -Window <프로세스 이름>   그 프로세스의 보이는 창 (여럿이면 가장 큰 것) + 둘레 여백
#   shot.ps1 -Region x,y,w,h           화면 좌표(물리 픽셀)의 영역
#   shot.ps1 -Taskbar                  작업 표시줄
#   shot.ps1 -Screen                   주 모니터 전체 (다른 창의 내용도 찍히므로 꼭 필요할 때만)
#   -Out <png> (기본 shot.png)  -Max <긴 쪽 최대 px> (기본 1600, 넘으면 줄임)  -Pad <창 둘레 여백 px> (기본 8)
# 화면에 실제로 그려진 것을 찍으므로, 다른 창(작업 표시줄 등)에 가려진 부분은 가린 창이 찍힌다 (보이는지 확인하는 데 씀)
param([string]$Window, [string]$Region, [switch]$Taskbar, [switch]$Screen, [string]$Out = "shot.png", [int]$Max = 1600, [int]$Pad = 8)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PiShot {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
}
"@
[PiShot]::SetProcessDPIAware() | Out-Null  # 좌표·크기를 물리 픽셀로 (배율 125%·175% 화면에서도 그대로)
$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$what = ""
if ($Window) {
  $ids = @(Get-Process -Name $Window -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  if (-not $ids) { "창 없음: '$Window' 프로세스가 실행 중이 아닙니다"; exit 1 }
  $script:best = $null; $script:min = $false
  [PiShot]::EnumWindows({ param($h, $l)
      $p = 0; [PiShot]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
      if ($ids -contains $p -and [PiShot]::IsWindowVisible($h)) {
        if ([PiShot]::IsIconic($h)) { $script:min = $true; return $true }
        $r = New-Object PiShot+RECT; [PiShot]::GetWindowRect($h, [ref]$r) | Out-Null
        $a = ($r.R - $r.L) * ($r.B - $r.T)
        if ($a -gt 4 -and (-not $script:best -or $a -gt $script:best.A)) { $script:best = @{ L = $r.L; T = $r.T; R = $r.R; B = $r.B; A = $a } }
      }
      return $true }, [IntPtr]::Zero) | Out-Null
  if (-not $script:best) {
    if ($script:min) { "창 없음: '$Window' 의 창이 최소화되어 있습니다" } else { "창 없음: '$Window' 는 실행 중이지만 보이는 창이 없습니다" }
    exit 1
  }
  $b = $script:best
  $x = $b.L - $Pad; $y = $b.T - $Pad; $w = $b.R - $b.L + 2 * $Pad; $h = $b.B - $b.T + 2 * $Pad
  $what = "창 '$Window' L=$($b.L) T=$($b.T) R=$($b.R) B=$($b.B) ($($b.R - $b.L)x$($b.B - $b.T))"
} elseif ($Region) {  # bash 에서 오면 "x,y,w,h" 한 덩어리 글
  $n = @($Region -split '[,\s]+' | Where-Object { $_ -match '^-?\d+$' } | ForEach-Object { [int]$_ })
  if ($n.Count -ne 4) { "영역은 -Region x,y,w,h (네 수, 물리 픽셀)"; exit 2 }
  $x, $y, $w, $h = $n
  $what = "영역 x=$x y=$y ${w}x${h}"
} elseif ($Taskbar) {
  $r = New-Object PiShot+RECT
  [PiShot]::GetWindowRect([PiShot]::FindWindow("Shell_TrayWnd", $null), [ref]$r) | Out-Null
  $x = $r.L; $y = $r.T; $w = $r.R - $r.L; $h = $r.B - $r.T
  $what = "작업 표시줄 L=$($r.L) T=$($r.T) R=$($r.R) B=$($r.B)"
} elseif ($Screen) {
  $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $x = $s.X; $y = $s.Y; $w = $s.Width; $h = $s.Height
  $what = "주 모니터 전체"
} else {
  "찍을 곳을 정하세요: -Window <프로세스 이름> | -Region x,y,w,h | -Taskbar | -Screen"; exit 2
}
# 화면 밖으로 나간 부분은 잘라 냄 (창이 화면 밖에 있으면 알림)
$x2 = [Math]::Min($x + $w, $vs.Right); $y2 = [Math]::Min($y + $h, $vs.Bottom)
$x = [Math]::Max($x, $vs.Left); $y = [Math]::Max($y, $vs.Top)
$w = $x2 - $x; $h = $y2 - $y
if ($w -le 0 -or $h -le 0) { "찍을 수 없음: $what 이(가) 화면($($vs.Left),$($vs.Top) ~ $($vs.Right),$($vs.Bottom)) 밖에 있습니다"; exit 1 }
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, $bmp.Size)
$g.Dispose()
$nw = $w; $nh = $h
if ([Math]::Max($w, $h) -gt $Max) {  # 긴 쪽을 Max 로 (pi 는 그림을 줄이지 않고 그대로 보냄)
  $k = $Max / [Math]::Max($w, $h)
  $nw = [Math]::Max(1, [int]($w * $k)); $nh = [Math]::Max(1, [int]($h * $k))
  $small = New-Object System.Drawing.Bitmap $nw, $nh
  $g = [System.Drawing.Graphics]::FromImage($small)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($bmp, 0, 0, $nw, $nh)
  $g.Dispose(); $bmp.Dispose(); $bmp = $small
}
$path = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Out)
$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$gs = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero); $dpi = [int]($gs.DpiX * 100 / 96); $gs.Dispose()
$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
"찍음: $path (${nw}x${nh}$(if ($nw -ne $w) { ", 원래 ${w}x${h} 를 줄임" }), $([int]((Get-Item $path).Length / 1024))KB)"
"찍은 곳: $what, 화면 좌표 x=$x y=$y"
"주 모니터 $($s.Width)x$($s.Height), 배율 $dpi%. 그림을 보려면 read 로 이 파일을 엽니다"
