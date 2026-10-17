param([switch]$Verify, [switch]$Wait, [switch]$Transparent)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskLocalNode = Join-Path $taskRoot 'runtime\node.exe'
$taskNode = Get-Command node.exe -ErrorAction SilentlyContinue
$taskNodePath = if (Test-Path -LiteralPath $taskLocalNode) { $taskLocalNode } elseif ($taskNode) { $taskNode.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $taskNodePath)) {
  Write-Host 'Node.js is required to build and start v1.3 from source.'
  Read-Host 'Press Enter to exit'
  exit 1
}
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$taskLogRoot = Join-Path $taskRoot '.runtime'
New-Item -ItemType Directory -Path $taskLogRoot -Force | Out-Null
$taskArguments = '"' + (Join-Path $taskRoot 'scripts/start.cjs') + '"'
if ($Verify) { $taskArguments += ' --verify-v12' }
if ($Transparent) { $taskArguments += ' --transparent-rendering' }
$taskStartOptions = @{FilePath=$taskNodePath;ArgumentList=$taskArguments;WorkingDirectory=$taskRoot;WindowStyle='Hidden';PassThru=$true;RedirectStandardOutput=(Join-Path $taskLogRoot 'startup.log');RedirectStandardError=(Join-Path $taskLogRoot 'startup-error.log')}
$taskProcess = Start-Process @taskStartOptions
if ($Wait) { $taskProcess.WaitForExit(); exit $taskProcess.ExitCode }
exit 0
