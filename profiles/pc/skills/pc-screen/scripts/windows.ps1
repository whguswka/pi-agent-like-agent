# 보이는 최상위 창을 겹친 차례(위에 있는 것부터)로 나열 (pc-screen 스킬)
#   windows.ps1 -Name <프로세스 이름>          그 프로세스의 창과, 그 창보다 위에 있으면서 겹치는(가리는) 창
#   windows.ps1 -Band 120                      주 모니터 아래쪽 120px 안에서 시작하는 창 (작업 표시줄과 그 위의 작은 창)
#   windows.ps1                                보이는 창 모두 (위에서부터 40개)
#   windows.ps1 -Name <이름> -Watch 10         10초 동안 1초마다 그 창의 위치·크기 (흔들리는지)
# 줄: 차례 프로세스 클래스 L,T,R,B (폭x높이) [항상 위] ["제목"]. 좌표는 물리 픽셀
# 다른 프로그램 창의 제목(메일·메신저 내용이 보일 수 있음)은 적지 않고, -Name 으로 고른 프로세스의 창만 제목을 적는다
param([string]$Name, [int]$Band = 0, [int]$Watch = 0)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class PiWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int n);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
  public class W { public int N, Pid, Ex; public IntPtr H; public string Cls, Title; public RECT R; public bool Top, Min; }
  // 보이는 최상위 창 (EnumWindows 의 차례 = 겹친 차례, 위가 먼저). 숨김(cloaked) 창은 뺌
  public static List<W> All() {
    var o = new List<W>(); int n = 0;
    EnumWindows((h, l) => {
      n++;
      if (!IsWindowVisible(h)) return true;
      int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      RECT r; if (!GetWindowRect(h, out r)) return true;
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      int pid; GetWindowThreadProcessId(h, out pid);
      int ex = GetWindowLong(h, -20);
      o.Add(new W { N = n, Pid = pid, Ex = ex, H = h, Cls = c.ToString(), Title = t.ToString(), R = r, Top = (ex & 0x8) != 0, Min = IsIconic(h) });
      return true;
    }, IntPtr.Zero);
    return o;
  }
}
"@
[PiWin]::SetProcessDPIAware() | Out-Null
$names = @{}
function ProcName($id) {
  if (-not $names.ContainsKey($id)) { $names[$id] = try { (Get-Process -Id $id -ErrorAction Stop).ProcessName } catch { "?" } }
  $names[$id]
}
function Line($w, [switch]$Title) {
  $r = $w.R
  $c = $w.Cls; if ($c.Length -gt 26) { $c = $c.Substring(0, 25) + "…" }
  $s = "{0,4} {1,-16} {2,-26} {3},{4},{5},{6} ({7}x{8})" -f $w.N, (ProcName $w.Pid), $c, $r.L, $r.T, $r.R, $r.B, ($r.R - $r.L), ($r.B - $r.T)
  if ($w.Top) { $s += " 항상 위" }
  if ($w.Min) { $s += " 최소화" }
  if ($w.Ex -band 0x20) { $s += " 클릭 통과" }  # WS_EX_TRANSPARENT: 화면 녹화·도우미의 투명 덮개 등
  if ($Title -and $w.Title) { $t = $w.Title; if ($t.Length -gt 40) { $t = $t.Substring(0, 40) + "…" }; $s += " `"$t`"" }
  $s
}
function Overlap($a, $b) { $a.L -lt $b.R -and $b.L -lt $a.R -and $a.T -lt $b.B -and $b.T -lt $a.B }
$all = [PiWin]::All() | Where-Object { ($_.R.R - $_.R.L) -gt 1 -and ($_.R.B - $_.R.T) -gt 1 }

if ($Name) {
  $ids = @(Get-Process -Name $Name -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  if (-not $ids) { "'$Name' 프로세스가 실행 중이 아닙니다"; exit 1 }
  $mine = @($all | Where-Object { $ids -contains $_.Pid })
  if (-not $mine) { "'$Name' (pid $($ids -join ', ')) 는 실행 중이지만 보이는 창이 없습니다"; exit 1 }
  if ($Watch -gt 0) {
    $main = ($mine | Sort-Object { ($_.R.R - $_.R.L) * ($_.R.B - $_.R.T) } -Descending | Select-Object -First 1).H
    $last = $null
    for ($i = 0; $i -le $Watch; $i++) {
      $w = [PiWin]::All() | Where-Object { $_.H -eq $main } | Select-Object -First 1
      if (-not $w) { "{0:HH:mm:ss} 창이 사라짐" -f (Get-Date); exit 1 }
      $r = $w.R; $now = "{0},{1},{2},{3} ({4}x{5})" -f $r.L, $r.T, $r.R, $r.B, ($r.R - $r.L), ($r.B - $r.T)
      "{0:HH:mm:ss} {1}{2}{3}" -f (Get-Date), $now, $(if ($w.Top) { " 항상 위" } else { "" }), $(if ($last -and $last -ne $now) { "  <- 바뀜" } else { "" })
      $last = $now
      if ($i -lt $Watch) { Start-Sleep -Seconds 1 }
    }
    exit 0
  }
  "'$Name' 의 창 (위에 있는 것부터):"
  foreach ($w in $mine) {
    Line $w -Title
    if ($w.Min) { continue }
    $above = @($all | Where-Object { $_.N -lt $w.N -and $ids -notcontains $_.Pid -and -not $_.Min -and -not ($_.Ex -band 0x20) -and (Overlap $_.R $w.R) })
    if ($above) {
      "     가리는 창 (이 창보다 위에 있고 겹침):"
      foreach ($a in $above) { "  " + (Line $a) }
    } else { "     가리는 창 없음 (이 창 위에 겹친 창이 없음)" }
  }
  exit 0
}
$list = $all
if ($Band -gt 0) {
  $bottom = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Bottom
  # 위쪽 끝이 그 띠 안에 있는 창 (작업 표시줄과 그 위에 올린 작은 창들. 화면을 덮는 큰 창은 뺌)
  $list = @($all | Where-Object { $_.R.T -ge $bottom - $Band -and $_.R.T -lt $bottom -and -not $_.Min })
  "주 모니터 아래쪽 ${Band}px 안에서 시작하는 창 (위에 있는 것부터):"
} else { "보이는 창 (위에 있는 것부터, 40개까지):" }
$list | Select-Object -First 40 | ForEach-Object { Line $_ }
