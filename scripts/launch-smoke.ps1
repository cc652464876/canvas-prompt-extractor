param([Parameter(Mandatory=$true)][string]$Launcher, [Parameter(Mandatory=$true)][string]$ReportPath)
$ErrorActionPreference = 'Stop'
& $Launcher "--portable-smoke=$ReportPath"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
