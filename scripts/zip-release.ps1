$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$src = Join-Path $projectRoot 'release\ToolDichTruyen-v1.3.0'
$destDownloads = 'C:\Users\dthuo\Downloads\ToolDichTruyen-v1.3.0-MoiNhat.zip'
$destRelease = Join-Path $projectRoot 'release\ToolDichTruyen-v1.3.0-MoiNhat.zip'

if (Test-Path -LiteralPath $destDownloads) { Remove-Item -LiteralPath $destDownloads -Force }
if (Test-Path -LiteralPath $destRelease) { Remove-Item -LiteralPath $destRelease -Force }

$items = @(Get-ChildItem -LiteralPath $src).FullName
Write-Host "Compressing $($items.Count) items to $destDownloads..."
Compress-Archive -LiteralPath $items -DestinationPath $destDownloads -CompressionLevel Optimal -Force
Copy-Item -LiteralPath $destDownloads -Destination $destRelease -Force

$downInfo = Get-Item -LiteralPath $destDownloads
Write-Host "Done! Size: $($downInfo.Length) bytes ($([math]::Round($downInfo.Length / 1MB, 2)) MB)"
