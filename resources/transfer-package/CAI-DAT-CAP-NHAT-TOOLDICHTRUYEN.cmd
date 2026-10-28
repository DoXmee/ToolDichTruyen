@echo off
setlocal
title ToolDichTruyen v1.3.0 - ThanhDongg (DoXmee)

echo ========================================================
echo   TOOL DICH TRUYEN v1.3.0 - CAI DAT / CAP NHAT MOI NHAT
echo   Tac gia / Phat trien: ThanhDongg (DoXmee)
echo   GitHub: https://github.com/DoXmee/ToolDichTruyen
echo ========================================================
echo.

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
