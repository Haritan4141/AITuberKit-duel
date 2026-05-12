@echo off
chcp 65001 >nul

echo ===============================
echo  Starting AITuberKit (A/B) + duel
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

REM ---- duel.mjs (idle で起動。会話は GUI の Start ボタンで開始) ----
REM autoStart=false (config.json) の場合、HTTP サーバー + YT polling だけが起動する。
timeout /t 2 >nul
start "Starting duel.mjs" /D "%ROOT%" cmd /k "node duel.mjs"

echo.
echo 起動しました。
echo   Speaker A: http://localhost:3000
echo   Speaker B: http://localhost:3001
echo   Admin UI : http://127.0.0.1:8787/admin
echo.
echo VRM / 背景はブラウザ側の歯車 -^> キャラクター設定で各ポートごとに切り替えてください。
echo 同梱 VRM: aituber-kit\public\vrm\ (Mafuyu_VRM.vrm / MANUKA.vrm)
echo.
echo Admin UI から「▶ Start」ボタンで会話を開始してください。
echo （config.json の "autoStart": true にすると duel 起動と同時に会話が始まります）
echo.

REM ---- duel の HTTP サーバー (:8787) が立ち上がるまで待ってから admin を開く ----
echo Admin UI が起動するまで待機中...
:wait_admin
timeout /t 1 >nul
netstat -ano | findstr ":8787 " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 goto wait_admin

start "" "http://127.0.0.1:8787/admin"

echo Admin UI を開きました。
echo.
pause
