Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
public class M {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
"@
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$p = Get-Process electron | Where-Object { $_.MainWindowTitle -eq 'Undertow' } | Select-Object -First 1
if (-not $p) { Write-Output 'NO WINDOW — click aborted'; exit 1 }
[W]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
[W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 800
$r = New-Object W+RECT
[W]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$cx = $r.Left + [int]$args[0]
$cy = $r.Top + [int]$args[1]
[M]::SetCursorPos($cx, $cy) | Out-Null
Start-Sleep -Milliseconds 200
[M]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
[M]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
Write-Output "clicked $cx,$cy"
Start-Sleep -Milliseconds ([int]$args[2])
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
$bmp = New-Object Drawing.Bitmap $w, $h
$g = [Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$bmp.Save('D:\music project\shots\app.png')
Write-Output 'saved'
