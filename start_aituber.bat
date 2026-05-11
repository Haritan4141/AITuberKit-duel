@echo off
chcp 65001 >nul

echo ===============================
echo  Starting AITuberKit (A/B)
echo ===============================

set "ROOT=%~dp0"
set "KIT=%ROOT%aituber-kit"

REM ---- Ollama ----
start "Ollama" cmd /k ollama serve
timeout /t 2 >nul

REM ---- Speaker A (port 3000, dist .next-A) ----
start "AITuberKit A" /D "%KIT%" cmd /k "set PORT=3000&& set NEXT_DIST_DIR=.next-A&& set NEXT_PUBLIC_MESSAGE_RECEIVER_ENABLED=true&& set NEXT_PUBLIC_CLIENT_ID=speakerA&& npm run dev"

timeout /t 2 >nul

REM ---- Speaker B (port 3001, dist .next-B) ----
start "AITuberKit B" /D "%KIT%" cmd /k "set PORT=3001&& set NEXT_DIST_DIR=.next-B&& set NEXT_PUBLIC_MESSAGE_RECEIVER_ENABLED=true&& set NEXT_PUBLIC_CLIENT_ID=speakerB&& npm run dev"

echo.
echo 起動しました。
echo   Speaker A: http://localhost:3000
echo   Speaker B: http://localhost:3001
echo.
echo VRM / 背景はブラウザ側の歯車 -^> キャラクター設定で各ポートごとに切り替えてください。
echo 同梱 VRM: aituber-kit\public\vrm\ (Mafuyu_VRM.vrm / MANUKA.vrm)
echo.
pause
