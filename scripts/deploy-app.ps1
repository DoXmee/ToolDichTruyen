$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$src = Join-Path $projectRoot 'release\win-unpacked\resources\app.asar'
$localApp = Join-Path $env:LOCALAPPDATA 'Programs\ToolDichTruyen\resources\app.asar'
$dWinUnpacked = 'D:\Tool dịch truyện\release\win-unpacked\resources\app.asar'

$v3Asar = Join-Path $projectRoot 'scratch\pipeline-v3-20261111\app-v3.asar'
if (Test-Path -LiteralPath $v3Asar) {
    Copy-Item -LiteralPath $v3Asar -Destination $src -Force
    Write-Host "Updated win-unpacked app.asar from app-v3.asar"
}

Write-Host "Source: $src"
Get-Item -LiteralPath $src | Select-Object FullName, Length, LastWriteTime

Copy-Item -LiteralPath $src -Destination $localApp -Force
Write-Host "Updated LocalAppData: $localApp"
Get-Item -LiteralPath $localApp | Select-Object FullName, Length, LastWriteTime

if (Test-Path 'D:\Tool dịch truyện\release\win-unpacked\resources') {
    Copy-Item -LiteralPath $src -Destination $dWinUnpacked -Force
    Write-Host "Updated D: drive: $dWinUnpacked"
    Get-Item -LiteralPath $dWinUnpacked | Select-Object FullName, Length, LastWriteTime
}

$helperSrc = Join-Path $projectRoot 'resources\huli-browser-helper'
$helperWinUnpacked = Join-Path $projectRoot 'release\win-unpacked\Huli Browser Helper'
$helperLocalApp = Join-Path $env:LOCALAPPDATA 'Programs\ToolDichTruyen\Huli Browser Helper'
$helperD = 'D:\Tool dịch truyện\release\win-unpacked\Huli Browser Helper'

if (-not (Test-Path -LiteralPath $helperWinUnpacked)) { New-Item -ItemType Directory -Force -Path $helperWinUnpacked | Out-Null }
if (-not (Test-Path -LiteralPath $helperLocalApp)) { New-Item -ItemType Directory -Force -Path $helperLocalApp | Out-Null }
Get-ChildItem -LiteralPath $helperSrc | Copy-Item -Destination $helperWinUnpacked -Recurse -Force
Get-ChildItem -LiteralPath $helperSrc | Copy-Item -Destination $helperLocalApp -Recurse -Force
if (Test-Path 'D:\Tool dịch truyện\release\win-unpacked') {
    if (-not (Test-Path -LiteralPath $helperD)) { New-Item -ItemType Directory -Force -Path $helperD | Out-Null }
    Get-ChildItem -LiteralPath $helperSrc | Copy-Item -Destination $helperD -Recurse -Force
}
if (Test-Path 'D:\Tool dịch truyện\resources\huli-browser-helper') {
    Get-ChildItem -LiteralPath $helperSrc | Copy-Item -Destination 'D:\Tool dịch truyện\resources\huli-browser-helper' -Recurse -Force
}
Write-Host "Synced Huli Browser Helper to win-unpacked, LocalAppData and D: drive"

$promptsSrc = Join-Path $projectRoot 'resources\prompts'
$promptsWinUnpacked = Join-Path $projectRoot 'release\win-unpacked\resources\prompts'
$promptsLocalApp = Join-Path $env:LOCALAPPDATA 'Programs\ToolDichTruyen\resources\prompts'
$promptsD = 'D:\Tool dịch truyện\resources\prompts'
$promptsDWin = 'D:\Tool dịch truyện\release\win-unpacked\resources\prompts'

if (-not (Test-Path -LiteralPath $promptsWinUnpacked)) { New-Item -ItemType Directory -Force -Path $promptsWinUnpacked | Out-Null }
if (-not (Test-Path -LiteralPath $promptsLocalApp)) { New-Item -ItemType Directory -Force -Path $promptsLocalApp | Out-Null }
Get-ChildItem -LiteralPath $promptsSrc | Copy-Item -Destination $promptsWinUnpacked -Recurse -Force
Get-ChildItem -LiteralPath $promptsSrc | Copy-Item -Destination $promptsLocalApp -Recurse -Force
if (Test-Path 'D:\Tool dịch truyện\resources') {
    if (-not (Test-Path -LiteralPath $promptsD)) { New-Item -ItemType Directory -Force -Path $promptsD | Out-Null }
    Get-ChildItem -LiteralPath $promptsSrc | Copy-Item -Destination $promptsD -Recurse -Force
}
if (Test-Path 'D:\Tool dịch truyện\release\win-unpacked\resources') {
    if (-not (Test-Path -LiteralPath $promptsDWin)) { New-Item -ItemType Directory -Force -Path $promptsDWin | Out-Null }
    Get-ChildItem -LiteralPath $promptsSrc | Copy-Item -Destination $promptsDWin -Recurse -Force
}
Write-Host "Synced resources/prompts to win-unpacked, LocalAppData and D: drive"

$createScript = Join-Path $PSScriptRoot 'create-clean-transfer-package.ps1'
$winUnpackedDir = Join-Path $projectRoot 'release\win-unpacked'
$pkgOutDir = Join-Path $projectRoot 'release\ToolDichTruyen-v1.3.0'

& $createScript -BuildRoot $winUnpackedDir -OutputRoot $pkgOutDir

$zipScript = Join-Path $PSScriptRoot 'zip-release.ps1'
& $zipScript

$downloadsZip = 'C:\Users\dthuo\Downloads\ToolDichTruyen-v1.3.0-MoiNhat.zip'
if (Test-Path 'D:\Tool dịch truyện\release') {
    Copy-Item -LiteralPath $downloadsZip -Destination 'D:\Tool dịch truyện\release\ToolDichTruyen-v1.3.0-MoiNhat.zip' -Force
    Write-Host 'Synced ZIP to D:\Tool dịch truyện\release\ToolDichTruyen-v1.3.0-MoiNhat.zip'
}
