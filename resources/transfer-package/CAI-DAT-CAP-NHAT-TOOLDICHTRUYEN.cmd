@echo off
setlocal
title ToolDichTruyen setup and update

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0CAI-DAT-CAP-NHAT-TOOLDICHTRUYEN.ps1"
if errorlevel 1 (
  echo.
  echo Setup did not finish. Read the error above.
  pause
  exit /b 1
)

echo.
echo Finished. The ToolDichTruyen shortcut is on Desktop.
pause
