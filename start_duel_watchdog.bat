@echo off
chcp 65001 >nul

echo ===============================
echo  Starting duel.mjs (watchdog)
echo ===============================

cd /d C:\Users\Haritan\Documents\AITuberKit

powershell -ExecutionPolicy Bypass -File run_duel_watchdog.ps1

pause
