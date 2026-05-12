@echo off
chcp 65001 >nul
title Starting duel.mjs (watchdog)

echo ===============================
echo  Starting duel.mjs (watchdog)
echo ===============================

cd /d "%~dp0"

powershell -ExecutionPolicy Bypass -File run_duel_watchdog.ps1

pause
