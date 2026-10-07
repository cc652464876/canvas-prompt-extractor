$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskPortable = Join-Path $taskRoot '自由画布提取.exe'
if (-not (Test-Path -LiteralPath $taskPortable)) {
  $taskPortable = Join-Path $taskRoot 'dist\自由画布提取-v1.0.0-Windows-x64-便携版\自由画布提取.exe'
}
if (Test-Path -LiteralPath $taskPortable) {
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  Start-Process -FilePath $taskPortable -WorkingDirectory $taskRoot -WindowStyle Hidden
  exit 0
}
$taskElectron = Join-Path $taskRoot 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $taskElectron)) { $taskElectron = Join-Path (Split-Path $taskRoot -Parent) 'node_modules\electron\dist\electron.exe' }
if (-not (Test-Path -LiteralPath $taskElectron)) {
  Write-Host 'Development runtime missing. Use the v1.0 portable release or install the pinned Electron dependency.'
  Read-Host 'Press Enter to exit'
  exit 1
}
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $taskElectron -ArgumentList ('"' + $taskRoot + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden
