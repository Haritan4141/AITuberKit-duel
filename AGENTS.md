# AGENTS.md

## 目的
- AITuberKit-duel の運用・改修を安全に進めるための共通指針。

## 重要な前提
- 文字コードは UTF-8 を前提にする（文字化け防止）。
- `duel.mjs` / `src/*.mjs` / `config.json` は UTF-8 で保存すること。
- OBS テロップは `overlay/` 配下の `overlay.html` / `overlay.css` / `overlay.js` に分離。

## ディレクトリ構成
```
duel.mjs            … src/main.mjs への薄い shim（直接編集はほぼ不要）
config.json         … ★ 設定値の単一ソース（編集すべきはここ）
src/
  config.mjs        … config.json + .env 読込み
  log.mjs           … console + JSONL ロガー (logSay / logEvent)
  text.mjs          … 感情タグ / 文頭・語尾フィルタ / clip / 日本語判定
  retry.mjs         … withRetry (指数バックオフ) + fetchWithTimeout
  ollama.mjs        … Ollama 呼び出し
  aituber.mjs       … AITuberKit direct_send
  youtube.mjs       … Live chat polling + AbortController
  overlay.mjs       … OBS overlay HTTP server (:8787)
  topicBrain.mjs    … 話題生成（AI + フォールバック）
  conversation.mjs  … 会話ループ・generate / runConversation
  progress.mjs      … 進捗監視の単一状態
  main.mjs          … エントリポイント
overlay/            … OBS ブラウザソース用のフロント
aituber-kit/        … AITuberKit 本体（A/B 共通。PORT で 2 プロセス起動）
```

## 実行フロー
1) `start_aituber.bat` で A (PORT=3000) / B (PORT=3001) / Ollama を起動
2) ブラウザで http://localhost:3000 と http://localhost:3001 を開き、各ポートで VRM / 背景 / Client ID を設定
3) `start_duel.bat` で `duel.mjs` を起動

## 設定の触り方
- 性格・温度・モデル → `config.json` > `speakers.A` / `speakers.B`
- 会話テンポ → `config.json` > `conversation`
- 話題生成 → `config.json` > `topicBrain`
- OBS テロップ → `config.json` > `overlay`
- YouTube → `config.json` > `youtube`（`apiKey` は `.env` の `YT_API_KEY` を優先）

## 環境変数 / .env
- `.env` には YouTube 連携の設定のみを置く。
  - `YT_API_KEY="..."`
  - `YT_VIDEO_ID="..."`

## OBS テロップ
- ブラウザソースに `http://127.0.0.1:8787/overlay`

## 変更時の注意
- 日本語コメントを含むため、**UTF-8 で保存**する。
- 文字化け / 構文崩れが疑われる場合は、まず該当ブロックの UTF-8 再保存を行う。
- 設定値の追加は `config.json` 側を優先し、`src/` 内に値をハードコードしない。
