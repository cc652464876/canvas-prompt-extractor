param()
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPackage = Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$taskOutput = Join-Path $taskRoot ($taskPackage.productName + '.exe')
$taskWindows = [Environment]::GetFolderPath('Windows')
$taskCompiler = @(
  (Join-Path $taskWindows 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $taskWindows 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $taskCompiler) { throw 'The Windows .NET Framework C# compiler is required to build the GUI launcher.' }
$taskSource = Join-Path $PSScriptRoot 'windows-launcher.cs'
$taskIcon = Join-Path $taskRoot 'src\icons\app.ico'
& $taskCompiler /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 /reference:System.Windows.Forms.dll "/win32icon:$taskIcon" "/out:$taskOutput" $taskSource
if ($LASTEXITCODE -ne 0) { throw 'Unable to build the GUI launcher. Close the app before rebuilding it.' }
Write-Output ('Built GUI launcher: ' + $taskOutput)
