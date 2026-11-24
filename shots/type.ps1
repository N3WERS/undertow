Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W2 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
public class M2 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
"@
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$p = Get-Process electron | Where-Object { $_.MainWindowTitle -eq 'Undertow' } | Select-Object -First 1
if (-not $p) { Write-Output 'NO WINDOW'; exit 1 }
[W2]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
[W2]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 700
$r = New-Object W2+RECT
[W2]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
[M2]::SetCursorPos($r.Left + [int]$args[0], $r.Top + [int]$args[1]) | Out-Null
[M2]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero); [M2]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 600
[System.Windows.Forms.SendKeys]::SendWait($args[2])
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds ([int]$args[3])
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
$bmp = New-Object Drawing.Bitmap $w, $h
$g = [Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$bmp.Save('D:\music project\shots\app.png')
Write-Output 'typed+saved'
