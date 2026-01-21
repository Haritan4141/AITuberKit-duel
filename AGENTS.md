# AGENTS.md

## 目的
- AITuberKit-duel の運用・改修を安全に進めるための共通指針をまとめる。

## 重要な前提
- 文字コードは UTF-8 を前提にする（文字化け防止）。
- `duel.mjs` は UTF-8 で保存すること。
- OBS テロップは `overlay/` 配下の `overlay.html` / `overlay.css` / `overlay.js` に分離されている。

## 実行フロー
1) `start_aituber.bat` で A/B と Ollama を起動
2) `start_duel.bat` で `duel.mjs` を起動

## 環境変数 / .env
- `duel.mjs` は `.env` を読み込む。
- `.env` には YouTube 連携用の設定のみを置く。
- 例:
  - `YT_API_KEY="..."`
  - `YT_VIDEO_ID="..."`

## よく触る設定（duel.mjs）
- キャラ設定: `SPEAKER_A`, `SPEAKER_B`
- 話題生成: `TOPIC_BRAIN_*`
- YouTube コメント: `COMMENT_*`
- テロップ: `OVERLAY_*`

## OBS テロップ
- OBS のブラウザソースに `http://127.0.0.1:8787/overlay` を設定

## 変更時の注意
- 日本語のコメントや文字列が含まれるため、**UTF-8 で保存**する。
- 文字化けや構文崩れが疑われる場合は、まず該当ブロックの UTF-8 再保存を行う。
