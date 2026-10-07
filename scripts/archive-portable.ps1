param([Parameter(Mandatory=$true)][string]$InputDirectory, [Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference = 'Stop'
Compress-Archive -LiteralPath $InputDirectory -DestinationPath $OutputFile -CompressionLevel Optimal
