$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) {
  $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $csc)) {
  throw 'Не найден csc.exe из .NET Framework 4.x'
}
$out = Join-Path $root 'resources\zapret\UndertowDpiService.exe'
$tmp = Join-Path $env:TEMP 'UndertowDpiService.exe'
Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
& $csc -nologo -target:exe -platform:x64 -out:$tmp `
  -reference:System.dll `
  -reference:System.Core.dll `
  -reference:System.ServiceProcess.dll `
  (Join-Path $root 'helper\UndertowDpiService.cs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
try {
  Copy-Item -LiteralPath $tmp -Destination $out -Force
} catch {
  throw "Не удалось обновить $out. Останови службу UndertowDpi и повтори сборку."
}
Write-Host "helper: $out"
