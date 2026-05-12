@echo off
chcp 65001 >nul

echo ===============================
echo  Stopping AITuberKit
echo ===============================

REM ---- start_aituber.bat で開いたウィンドウタイトルで停止（A/B/Ollama/Duel）----
echo Speaker A / B / Duel のウィンドウを停止します
taskkill /FI "WINDOWTITLE eq AITuberKit A*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq AITuberKit B*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Ollama*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Starting duel.mjs*" /T /F >nul 2>&1

REM ---- 念のためポートでも特定停止 (3000 / 3001 / 8787=duel) ----
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo   PID %%a を停止 (port 3000 = AITuberKit A)
    taskkill /PID %%a /F /T >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001 " ^| findstr "LISTENING"') do (
    echo   PID %%a を停止 (port 3001 = AITuberKit B)
    taskkill /PID %%a /F /T >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8787 " ^| findstr "LISTENING"') do (
    echo   PID %%a を停止 (port 8787 = duel.mjs / OBS overlay / Admin UI)
    taskkill /PID %%a /F /T >nul 2>&1
)

REM ---- Ollama 本体プロセス ----
echo Ollama を停止します
taskkill /IM ollama.exe /F >nul 2>&1
taskkill /IM ollama_app.exe /F >nul 2>&1

echo.
echo 停止しました。
pause
