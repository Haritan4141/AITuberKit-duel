@echo off
chcp 65001 >nul

echo ===============================
echo  Stopping AITuberKit
echo ===============================

echo Node.js を停止します
taskkill /IM node.exe /F

echo Ollama を停止します
taskkill /IM ollama.exe /F
taskkill /IM ollama_app.exe /F

echo.
echo 停止しました。
pause
