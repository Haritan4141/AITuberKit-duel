@echo off
chcp 65001 >nul

echo ===============================
echo  Starting AITuberKit
echo ===============================

REM ---- Ollama ----
start cmd /k ollama serve
timeout /t 2

REM ---- Speaker A ----
start cmd /k ^
  cd /d C:\AITuberKit\aituber-kit ^&^& ^
  set PORT=3000 ^&^& ^
  set NEXT_PUBLIC_MESSAGE_RECEIVER_ENABLED=true ^&^& ^
  set NEXT_PUBLIC_CLIENT_ID=speakerA ^&^& ^
  npm run dev

timeout /t 2

REM ---- Speaker B ----
start cmd /k ^
  cd /d C:\AITuberKit\aituber-kit-B ^&^& ^
  set PORT=3001 ^&^& ^
  set NEXT_PUBLIC_MESSAGE_RECEIVER_ENABLED=true ^&^& ^
  set NEXT_PUBLIC_CLIENT_ID=speakerB ^&^& ^
  npm run dev

echo.
echo 起動しました。
echo Speaker A: http://localhost:3000
echo Speaker B: http://localhost:3001
echo.
pause
