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
  state.mjs         … runtime 状態 (pause / topicSkip / restart / stall)
  server.mjs        … 統合 HTTP サーバー (:8787) /overlay と /admin と /api/* をルーティング
  admin.mjs         … /api/* ハンドラ群 (status/config/skip-topic/pause/resume/log/stream)
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

## OBS テロップ / 管理 UI
- OBS ブラウザソース: `http://127.0.0.1:8787/overlay`
- 管理 UI:           `http://127.0.0.1:8787/admin`
  - 設定編集 (config.json) / pause / resume / skip-topic / restart / ライブログ表示

## API（GUI から / curl から）
| Method | Path | 用途 |
|---|---|---|
| GET  | /api/status      | 現在の sessionNo / turn / topic / paused / idleSec / queueLen |
| GET  | /api/config      | disk の config.json を返す（secrets 含まず） |
| POST | /api/config      | 設定を保存 (`.bak` 自動作成) + reload + 会話再起動 |
| POST | /api/skip-topic  | 次ターンで話題切替を強制 |
| POST | /api/pause       | 一時停止 |
| POST | /api/resume      | 再開 |
| GET  | /api/log/stream  | SSE (events: line / say / event) |

## 変更時の注意
- 日本語コメントを含むため、**UTF-8 で保存**する。
- 文字化け / 構文崩れが疑われる場合は、まず該当ブロックの UTF-8 再保存を行う。
- 設定値の追加は `config.json` 側を優先し、`src/` 内に値をハードコードしない。
- `config.json` には **secret を書かない**。API キー類は `.env` のみ。`writeConfigToDisk` の `stripSecretsAndDerived` で `apiKey` / `paths` を必ず除外。
- 各モジュールで `const { ... } = config.xxx` の destructure をしない。`reloadConfig()` で値が変わるため、関数内で `config.section.field` を都度参照する。
