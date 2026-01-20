# =========================================
# duel.mjs watchdog (30分ごとに再起動) + 演出
# =========================================

$IntervalSec = 30 * 60           # ★テスト用：1分（本番は 30 * 60）
$WorkDir     = "C:\Users\Haritan\Documents\AITuberKit"
$ScriptName  = "duel.mjs"
$NodePath    = "node.exe"       # node が PATH にある前提

# ---- AITuberKitに演出メッセージを送る設定 ----
$A_BaseUrl  = "http://localhost:3000"
$B_BaseUrl  = "http://localhost:3001"
$A_ClientId = "speakerA"
$B_ClientId = "speakerB"

# 再起動直前（短く！）
$PreRestart_A  = '[neutral]ちょっと仕切り直すね！'
$PreRestart_B  = '[relaxed]OK、いったん区切ろう。すぐ再開するよ。'

$PreRestartWaitSec  = 2

# 日本語が文字化けしにくいように
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Send-AITuberDirect([string]$BaseUrl, [string]$ClientId, [string]$Text) {
  try {
    $uri  = "$BaseUrl/api/messages/?clientId=$ClientId&type=direct_send"
    $body = @{ messages = @($Text) } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json; charset=utf-8" -Body $body | Out-Null
    return $true
  } catch {
    Write-Host "WARN: send failed to $BaseUrl ($ClientId): $($_.Exception.Message)" -ForegroundColor DarkYellow
    return $false
  }
}

function Start-Duel {
  Write-Host "=== Starting duel.mjs ===" -ForegroundColor Cyan
  return Start-Process `
    -FilePath $NodePath `
    -ArgumentList $ScriptName `
    -WorkingDirectory $WorkDir `
    -PassThru
}

while ($true) {
  $proc = Start-Duel

  # ★ 起動直後の自己紹介ジングルは「送らない」
  # （duel.mjs 側で“初回だけ自己紹介”をやるならここは不要）

  $restartAt = (Get-Date).AddSeconds($IntervalSec)

  while ((Get-Date) -lt $restartAt) {
    if ($proc.HasExited) {
      Write-Host "=== duel.mjs exited unexpectedly. Restarting... ===" -ForegroundColor Yellow
      break
    }
    Start-Sleep -Seconds 2
  }

  # ---- 再起動直前：仕切り直し演出（ここは残す）----
  Send-AITuberDirect $A_BaseUrl $A_ClientId $PreRestart_A | Out-Null
  Start-Sleep -Milliseconds 1000
  Send-AITuberDirect $B_BaseUrl $B_ClientId $PreRestart_B | Out-Null
  Start-Sleep -Seconds $PreRestartWaitSec

  # 生きてたら再起動
  if (-not $proc.HasExited) {
    Write-Host "=== Restarting duel.mjs (PID $($proc.Id)) ===" -ForegroundColor Yellow
    try {
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    } catch {}
  }

  # ポート・ファイル解放待ち
  Start-Sleep -Seconds 2
}
