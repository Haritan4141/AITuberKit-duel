# AITuberKit-duel

AITuberKit を 2系統起動して、Ollama で会話させるデュエル構成です。
YouTube コメントの取り込みと、OBS 用の話題テロップも同梱しています。

## 必要なもの
- Node.js: ^20.0.0
- npm: ^10.0.0
- Ollama (ローカルで `ollama serve` が動くこと)
- Windows (同梱の .bat / .ps1 は Windows 向け)
- VOICEBOX（テキスト読み上げ用）

## セットアップ
1) リポジトリを取得
```bat
git clone <このリポジトリのURL>
cd AITuberKit
```

2) 依存関係のインストール
```bat
cd .\aituber-kit
npm install
```
※ 本構成では `aituber-kit/` 1 つを 2 プロセス（PORT=3000 / 3001）で起動します。
   それぞれの dev サーバーは `.next-A` / `.next-B` を `distDir` に使うので互いに衝突しません。

2) LLMモデルのダウンロード（初期設定はgemma3:12b）
```bat
ollama pull gemma3:12b
```

## 起動手順
1) すべて起動（A/B + Ollama + duel + Admin UI）
```bat
start_aituber.bat
```
このバッチで以下が立ち上がります:
- Ollama
- AITuberKit A (http://localhost:3000)
- AITuberKit B (http://localhost:3001)
- duel.mjs（**idle 待機状態**で起動。会話はまだ始まりません）
- Admin UI (http://127.0.0.1:8787/admin) が自動でブラウザで開く

2) AITuberKit(ブラウザ)の設定（初回のみ）
http://localhost:3000/ と http://localhost:3001/ それぞれで
左上歯車から その他 外部からの指示を受け付ける の状態を **ON**
Client ID をそれぞれ「speakerA」「speakerB」に設定
VRM / 背景は各ポートで個別に設定（localStorage がポート別オリジンで独立保持）。
同梱 VRM: `aituber-kit/public/vrm/` （`Mafuyu_VRM.vrm` / `MANUKA.vrm`）

3) VOICEBOX の起動（読み上げ不要ならスキップ）

4) Admin UI から会話を開始
http://127.0.0.1:8787/admin で **「▶ Start」** ボタンを押すと会話開始。
- 「■ Stop」で会話だけ停止（サーバーは生きたまま）
- 「↪ Skip Topic」「⏸ Pause / ▶ Resume」で会話制御
- 左側の textarea で config.json を編集して「Save & Restart」で設定反映

※ `config.json` の `"conversation": { "autoStart": true }` にすると duel 起動と同時に会話が始まります。
※ duel 単体起動（ターミナルからログを直接見たい場合）は従来通り `start_duel.bat`

## 30分ごとの自動再起動 (任意)
```bat
start_duel_watchdog.bat
```

## YouTube コメント連携 (任意)
`duel.mjs` の以下を設定してください。
- `YT_API_KEY`
- `YT_VIDEO_ID`

環境変数で `YT_API_KEY` を設定して起動すると簡単です。
```bat
set YT_API_KEY=YOUR_KEY
start_duel.bat
```

## OBS 話題テロップ
OBS の「ブラウザ」ソースに以下を追加してください。
- http://127.0.0.1:8787/overlay

## 停止
- すべて止める: `stop_aituber.bat`（AITuberKit A/B + Ollama + duel.mjs を一括停止）
- 会話だけ止めて GUI / OBS overlay は維持したい場合は Admin UI の「■ Stop」

