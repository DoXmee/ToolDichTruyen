[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $BuildRoot,
  [Parameter(Mandatory = $true)]
  [string] $OutputRoot
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$templateRoot = Join-Path $projectRoot 'resources\transfer-package'
$buildRoot = [System.IO.Path]::GetFullPath($BuildRoot)
$outputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
$payload = Join-Path $buildRoot 'ToolDichTruyen.exe'

if (-not (Test-Path -LiteralPath $payload -PathType Leaf)) {
  throw "Build Windows chưa hợp lệ: $payload"
}
if (-not (Test-Path -LiteralPath (Join-Path $buildRoot 'Huli Browser Helper\manifest.json') -PathType Leaf)) {
  throw 'Build không có thư mục Huli Browser Helper ngoài cùng.'
}

if (Test-Path -LiteralPath $outputRoot) { Remove-Item -LiteralPath $outputRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$appTarget = Join-Path $outputRoot 'APP\ToolDichTruyen'
New-Item -ItemType Directory -Force -Path $appTarget | Out-Null
Get-ChildItem -LiteralPath $buildRoot -Force | Copy-Item -Destination $appTarget -Recurse -Force
Get-ChildItem -LiteralPath $templateRoot -Force | Copy-Item -Destination $outputRoot -Recurse -Force

# Keep an unpacked helper beside the installer, so it can be selected directly
# from Edge, Chrome, or Cốc Cốc without opening the installed app folder.
$extensionFolderName = 'EXTENSION-HULIWANG - CHON THU MUC NAY'
$extensionTarget = Join-Path $outputRoot $extensionFolderName
Copy-Item -LiteralPath (Join-Path $buildRoot 'Huli Browser Helper') -Destination $extensionTarget -Recurse -Force

$readme = Join-Path $outputRoot 'README-CAI-DAT.txt'
$manifest = Join-Path $appTarget 'Huli Browser Helper\manifest.json'
if (-not (Test-Path -LiteralPath $readme) -or -not (Test-Path -LiteralPath $manifest) -or -not (Test-Path -LiteralPath (Join-Path $extensionTarget 'manifest.json'))) {
  throw 'Gói chuyển máy thiếu hướng dẫn hoặc tiện ích ngoài cùng.'
}

Write-Host "Đã tạo gói thư mục: $outputRoot"
