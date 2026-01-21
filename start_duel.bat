@echo off
chcp 65001 >nul

echo ===============================
echo  Starting duel.mjs
echo ===============================

cd /d "%~dp0"

node duel.mjs

echo.
echo duel.mjs が終了しました。
pause
