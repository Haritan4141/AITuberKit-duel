# AITuberKit-duel

AITuberKit を 2系統起動して、Ollama で会話させるデュエル構成です。
YouTube コメントの取り込みと、OBS 用の話題テロップも同梱しています。

## 必要なもの
- Node.js: ^20.0.0
- npm: ^10.0.0
- Ollama (ローカルで `ollama serve` が動くこと)
- Windows (同梱の .bat / .ps1 は Windows 向け)

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
cd ..\aituber-kit-B
npm install
cd ..
```

## 起動手順
1) AITuberKit (A/B) + Ollama を起動
```bat
start_aituber.bat
```

2) デュエルを開始
```bat
start_duel.bat
```

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
- AITuberKit / Ollama を止める: `stop_aituber.bat`
- デュエル単体は `start_duel.bat` のウィンドウを閉じる or `Ctrl+C`

