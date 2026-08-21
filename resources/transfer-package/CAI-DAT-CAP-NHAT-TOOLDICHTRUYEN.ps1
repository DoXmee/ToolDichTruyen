[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Resolve-AbsolutePath([string] $Path) {
  return [System.IO.Path]::GetFullPath($Path)
}

# WScript.Shell can reject otherwise valid Vietnamese/Unicode paths on some
# Windows configurations. Use the native wide-character Shell Link contract
# so both the install directory and Desktop path remain fully Unicode-safe.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
internal class ShellLinkObject { }

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
internal interface IShellLinkW {
  void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int maxPath, IntPtr data, uint flags);
  void GetIDList(out IntPtr pidl);
  void SetIDList(IntPtr pidl);
  void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int maxName);
  void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
  void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder directory, int maxPath);
  void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
  void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arguments, int maxPath);
  void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
  void GetHotkey(out short hotkey);
  void SetHotkey(short hotkey);
  void GetShowCmd(out int showCommand);
  void SetShowCmd(int showCommand);
  void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder iconPath, int maxPath, out int iconIndex);
  void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string iconPath, int iconIndex);
  void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
  void Resolve(IntPtr window, uint flags);
  void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
}

public static class UnicodeShortcut {
  public static void Create(string shortcutPath, string targetPath, string workingDirectory, string description) {
    object instance = new ShellLinkObject();
    try {
      IShellLinkW link = (IShellLinkW)instance;
      link.SetPath(targetPath);
      link.SetWorkingDirectory(workingDirectory);
      link.SetDescription(description);
      link.SetIconLocation(targetPath, 0);
      ((IPersistFile)link).Save(shortcutPath, true);
    } finally {
      Marshal.FinalReleaseComObject(instance);
    }
  }
}
'@

$packageRoot = $PSScriptRoot
$payloadRoot = Join-Path $packageRoot 'APP\ToolDichTruyen'
$defaultInstallRoot = Join-Path $env:LOCALAPPDATA 'Programs\ToolDichTruyen'
$installRoot = Resolve-AbsolutePath ($(if ($env:TOOLDICHTRUYEN_INSTALL_ROOT) { $env:TOOLDICHTRUYEN_INSTALL_ROOT } else { $defaultInstallRoot }))
$desktopRoot = Resolve-AbsolutePath ($(if ($env:TOOLDICHTRUYEN_DESKTOP_ROOT) { $env:TOOLDICHTRUYEN_DESKTOP_ROOT } else { [Environment]::GetFolderPath('Desktop') }))
$exeName = 'ToolDichTruyen.exe'
$payloadExe = Join-Path $payloadRoot $exeName
$extensionFolderName = 'EXTENSION-HULIWANG - CHON THU MUC NAY'
$payloadHelperRoot = Join-Path $packageRoot $extensionFolderName
$payloadHelper = Join-Path $payloadHelperRoot 'manifest.json'

if (-not (Test-Path -LiteralPath $payloadExe -PathType Leaf)) {
  throw "App executable is missing from package: $payloadExe"
}
if (-not (Test-Path -LiteralPath $payloadHelper -PathType Leaf)) {
  throw "External browser helper is missing from package: $payloadHelper"
}

# The install destination is an exact, tool-owned application folder. User
# data is intentionally elsewhere (%APPDATA%\tool-dich-truyen) and is never
# removed by this installer.
$expectedDefault = Resolve-AbsolutePath $defaultInstallRoot
$isDefaultDestination = $installRoot.Equals($expectedDefault, [StringComparison]::OrdinalIgnoreCase)
$isIsolatedTestDestination = $installRoot.StartsWith((Resolve-AbsolutePath (Join-Path $packageRoot '_test-install-root')), [StringComparison]::OrdinalIgnoreCase)
if (-not $isDefaultDestination -and -not $isIsolatedTestDestination) {
  throw "Unsafe installation path: $installRoot"
}

if ($isDefaultDestination) {
  Get-Process -Name 'ToolDichTruyen' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
}

if (Test-Path -LiteralPath $installRoot) {
  Write-Host 'Removing old ToolDichTruyen installation...' -ForegroundColor Yellow
  Remove-Item -LiteralPath $installRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
Get-ChildItem -LiteralPath $payloadRoot -Force | Copy-Item -Destination $installRoot -Recurse -Force
# Make the root-level helper the source of truth for the installed helper too.
$installedHelperRoot = Join-Path $installRoot 'Huli Browser Helper'
if (Test-Path -LiteralPath $installedHelperRoot) { Remove-Item -LiteralPath $installedHelperRoot -Recurse -Force }
Copy-Item -LiteralPath $payloadHelperRoot -Destination $installedHelperRoot -Recurse -Force

$installedExe = Join-Path $installRoot $exeName
$installedHelper = Join-Path $installedHelperRoot 'manifest.json'
if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf) -or -not (Test-Path -LiteralPath $installedHelper -PathType Leaf)) {
  throw 'New app copy is incomplete; Desktop shortcut was not created.'
}

New-Item -ItemType Directory -Force -Path $desktopRoot | Out-Null
$shortcutPath = Join-Path $desktopRoot 'ToolDichTruyen.lnk'
[UnicodeShortcut]::Create($shortcutPath, $installedExe, $installRoot, 'Mở Tool Dịch Truyện')

Write-Host 'New clean version installed.' -ForegroundColor Green
Write-Host "App: $installedExe"
Write-Host "Shortcut Desktop: $shortcutPath"
Write-Host "Browser helper: $(Join-Path $installRoot 'Huli Browser Helper')"
Write-Host "Choose this folder in Edge/Chrome: $payloadHelperRoot"
