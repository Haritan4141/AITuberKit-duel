# AI Context

> このファイルは **AI エージェントが新規セッション開始時に最初に読む** ことを前提に書かれています。
> プロジェクトの現在地・判断履歴・未完了事項をここに集約し、セッション間で情報が失われないようにします。
> **重要な進捗があったら必ずこのファイルを更新してください**（運用ルール参照）。

最終更新: 2026-05-12（idle 待機モード + GUI Start/Stop ボタン追加）

---

## プロジェクト概要

### これは何か
**AITuberKit-duel** — AITuberKit を 2 系統（speakerA / speakerB）立ち上げ、ローカル LLM (Ollama) で **2 体の AI キャラクターに対談させる** デュエル構成のセットアップ。YouTube Live のコメント取り込みと、OBS 用「現在の話題」テロップを同梱。配信用途を想定。

### 主な技術スタック
| レイヤ | 技術 |
|---|---|
| AITuberKit 本体 | Next.js 14 / React 18 / TypeScript / Zustand (`aituber-kit/` 配下) |
| LLM | Ollama（OpenAI 互換エンドポイント `http://127.0.0.1:11434/v1/chat/completions`） |
| 既定モデル | `gemma3:12b`（A/B 共通。`config.json` で変更可） |
| 会話オーケストレータ | Node.js (ES Modules) — `src/*.mjs` |
| OBS テロップ | 自前 HTTP サーバー (`:8787`) + 静的フロントエンド (`overlay/`) |
| 音声合成 | VOICEVOX（AITuberKit 側設定。任意） |
| 起動環境 | Windows + PowerShell / cmd（同梱の `.bat` / `.ps1`） |

### 重要なディレクトリとファイル
```
AITuberKit/
├── duel.mjs                  ← src/main.mjs への薄い shim（基本いじらない）
├── config.json               ← ★ 設定値の単一ソース（編集すべきはここ）
├── src/
│   ├── main.mjs              エントリポイント (SIGINT/SIGTERM 1 回登録)
│   ├── config.mjs            config.json + .env 読込み / reloadConfig() / writeConfigToDisk()
│   ├── state.mjs             runtime 状態 (pause / topicSkip / restart / stall) の単一ソース
│   ├── log.mjs               console + JSONL ロガー + SSE 用 logEmitter
│   ├── text.mjs              感情タグ / 文頭・語尾フィルタ / clip
│   ├── retry.mjs             withRetry (指数バックオフ) + fetchWithTimeout
│   ├── ollama.mjs            Ollama 呼び出し
│   ├── aituber.mjs           AITuberKit /api/messages へ direct_send
│   ├── youtube.mjs           Live Chat polling + AbortController で即時停止
│   ├── overlay.mjs           OBS overlay の state + テンプレ展開（HTTP は server.mjs 側）
│   ├── topicBrain.mjs        話題生成 (AI + フォールバック)
│   ├── conversation.mjs      会話ループ・generate / runConversation
│   ├── server.mjs            統合 HTTP サーバー (:8787) /overlay と /admin と /api/* をルーティング
│   └── admin.mjs             /api/* ハンドラ群 (status/config/skip-topic/pause/resume/log/stream)
├── overlay/                  ブラウザフロント
│   ├── overlay.html / .css / .js   OBS ブラウザソース用テロップ
│   └── admin.html  / .css  / .js   管理 UI (http://127.0.0.1:8787/admin)
├── aituber-kit/              AITuberKit 本体 (A/B 共通)
│   ├── next.config.js        NEXT_DIST_DIR 対応の 1 行を追加（upstream 改変はこれだけ）
│   └── public/vrm/           Mafuyu_VRM.vrm / MANUKA.vrm / nikechan_v1.vrm
├── start_aituber.bat         Ollama + AITuberKit A/B を別ウィンドウで起動
├── start_duel.bat            duel.mjs を 1 回起動
├── start_duel_watchdog.bat   run_duel_watchdog.ps1 経由で 30 分ごとに再起動
├── stop_aituber.bat          A/B + Ollama をピンポイント停止
├── run_duel_watchdog.ps1     watchdog 本体
├── .gitattributes            *.bat / *.cmd / *.ps1 を eol=crlf 固定
├── .env                      YT_API_KEY / YT_VIDEO_ID のみ
├── AGENTS.md                 運用ガイド（src/ 構成・設定の触り方）
├── README.md                 セットアップ手順
└── docs/
    └── ai_context.md         ← 本ファイル
```

### 起動方法（人間向け手順）
1. `start_aituber.bat` 一発で Ollama + AITuberKit A (3000) + B (3001) + **duel.mjs (idle 起動)** が立ち上がり、Admin UI (`:8787/admin`) が自動でブラウザで開く
2. ブラウザで http://localhost:3000 / :3001 を開いて各ポートで設定（初回のみ）:
   - 歯車 → その他 → 「外部からの指示を受け付ける」を ON
   - Client ID を「speakerA」「speakerB」にそれぞれ設定
   - VRM / 背景はブラウザ側で設定
3. (任意) VOICEVOX を起動
4. Admin UI で **「▶ Start」** ボタンを押すと会話開始
5. 停止は Admin UI の「■ Stop」（会話だけ）or `stop_aituber.bat`（全部）
6. `start_duel.bat` は duel 単体起動用に残存（ログを同じ窓で見たい人向け）
7. `config.conversation.autoStart = true` にすれば duel 起動と同時に会話が始まる（手順 4 不要）

### ビルド / テスト
- duel 側は build なし（Node.js + ES Modules で直接起動）。構文確認は `node --check src/*.mjs`。
- AITuberKit 本体は `cd aituber-kit && npm install` のみ必要。dev は `npm run dev`（bat が自動でやる）。

---

## 現在の作業目的

**GUI 化 第一弾は完了** — ブラウザ管理画面 (`:8787/admin`) で設定編集 / pause / resume / skip-topic / ライブログ表示まで動作する状態。

### 次フェーズの候補（未着手）
1. **設定の項目別フォーム化** — 現在は textarea で生 JSON を編集。よく触る項目（speaker.temperature, charName, topicBrain.temperature, topicInterval 等）をフォーム化して、JSON 編集と相互同期。
2. **ロングラン検証** — 実 LLM 起動下で数時間流して、reload / restart / topic-skip / pause/resume の総合挙動を確認。
3. **メトリクス収集** — JSONL ログから 1 セッションあたりの平均 turn 数 / topic 切替頻度 / 再起動回数を集計するスクリプト or admin UI のサマリーカード。
4. **VRM 切替 API の探索** — AITuberKit 側に外部から VRM を切り替える endpoint があるか調査（現状は localStorage 経由のブラウザ操作のみ）。
5. **Electron 化** — 配布のしやすさで現在の HTML を `BrowserWindow.loadURL("http://127.0.0.1:8787/admin")` で包む。優先度は低い。

---

## これまでに実施した作業

### コミット履歴（新しい順）
| commit | 内容 |
|---|---|
| (latest) | duel に idle 待機モード追加 (state.running) + GUI Start/Stop ボタン + start_aituber.bat で duel も立てる + server.unref() 削除 (idle 待機時の早期 exit 回避) |
| `3a02e77` | start_aituber.bat 起動後に /admin をブラウザで自動オープン（旧、後で書き換え） |
| `10e9d30` | stop_aituber.bat に duel.mjs (port 8787) の停止を追加 |
| `89d4900` | docs/ai_context.md と AGENTS.md を GUI 化第一弾の完了状態に更新 |
| `6cdcce7` | 管理 UI フロント (overlay/admin.*) を追加 + secrets / paths を disk から除外 |
| `d94d03e` | HTTP サーバー統合 + 管理用 API + 会話ループとの結線 (src/server.mjs / src/admin.mjs 新設) |
| `ac5722e` | config を mutable 化し reloadConfig() を実装。state.mjs に runtime 状態を集約 |
| `c5fa5d2` | docs/ai_context.md を追加: AI エージェント引き継ぎ用コンテキスト |
| `b4c65a7` | bat ファイルを CRLF + UTF-8 (BOM なし) に統一、`start_aituber.bat` の `^` 行継続バグを修正、`.gitattributes` 追加 |
| `53fedfa` | 運用スクリプト改善 + `AGENTS.md` を新構成に更新 |
| `e6eea39` | `overlay.js`: 話題更新時のみ DOM/fitFont 再計算 |
| `44aad5b` | `duel.mjs` を `src/` 12 モジュールに分割し設定値を `config.json` に外出し |
| `1523989` | A/B kit 統合: `aituber-kit-B/` 削除、`NEXT_DIST_DIR` 対応、VRM 集約 |

### 採用した設計判断
1. **A/B kit は 1 ディレクトリ共有 + dev 2 プロセス**: `aituber-kit-B/` は src/public がほぼ完全重複だったため削除。同じプロジェクトから `PORT=3000 NEXT_DIST_DIR=.next-A` と `PORT=3001 NEXT_DIST_DIR=.next-B` を別ウィンドウで起動。`.next` 衝突は `distDir` を分けて回避。
2. **設定の単一ソースは `config.json`**: GUI 化を見据えてコード内のリテラル定数を全部 JSON に外出し。`config` オブジェクトは mutable 参照を共有し、`reloadConfig()` で disk から再読込み（各モジュールは destructure せず `config.section.field` で都度参照）。
3. **upstream (`aituber-kit/`) への改変は最小限**: `next.config.js` に `NEXT_DIST_DIR` 1 行を追加しただけ。AITuberKit 本体を fork/改造する方向には進まない方針。
4. **bat は CRLF + UTF-8 (BOM なし)**: Write tool は LF で書くため、`.gitattributes` で `*.bat eol=crlf` を強制。
5. **VRM 切替はブラウザ側 localStorage で**: ポート別 origin で独立保存される。同梱 VRM は `aituber-kit/public/vrm/` 1 箇所に集約。
6. **GUI 反映方式は「会話セッション再起動」**: hot-reload ではなく、`requestRestart()` で `runConversation` を throw → 外側ループが新セッションを開始。プロセス再起動なしで watchdog 不要、state 整合性も担保。
7. **secrets は disk に書かない**: `youtube.apiKey` は `.env` から実行時注入。`writeConfigToDisk` で `stripSecretsAndDerived` を必ず通し、`apiKey` と `paths` を除外（過去に POST 経由で disk に漏れたケースあり、コミット前に修復済み）。
8. **duel.mjs は idle 待機モードを既定**: 起動時は HTTP サーバー + YT polling だけ動かし、会話ループは `setRunning(true)` まで待機（`config.conversation.autoStart=true` で従来挙動）。これにより `start_aituber.bat` 一発で「Admin UI が開けるが会話はまだ始まっていない」状態を実現。`server.unref()` を使うと idle 待機中に Node.js が早期 exit するため呼ばない（SIGINT/SIGTERM の `process.exit(0)` で終了制御）。

### 解消済みのレビュー指摘
- SIGINT 二重登録（旧 duel.mjs L434 と L1269）→ `src/main.mjs` で 1 回のみ登録
- fetch にタイムアウト無し → `fetchWithTimeout` (60s) で全箇所統一
- リトライ間隔が短すぎる (350ms × i) → 指数バックオフ (`apiRetryBaseMs * 2^(i-1)`)
- `turnLog` / `usedTopics` が無制限に肥大化 → `config.topicBrain.turnLogMax` / `usedTopicsMax` で上限
- YT polling の即時停止不可 → `AbortController` で abort 可能、`abortableSleep` 採用
- `seenCommentIds.clear()` のリセット → FIFO 化（古い順に間引く）
- `maybeInjectLiveComment` 後の長文 → `clipTagged` で正規化
- セッション再開時の第一声が毎回同じ → `OPENING_LINES` 5 種からランダム
- 感情タグ一覧の二重定義 → `EMO_SET` 単一ソース
- `appendJsonl` 未使用 → `logSay` / `logEvent` として実利用
- `pick` / `speakEitherById` 等の未使用関数 → 削除済み
- `overlay.js` の毎ポーリング reflow → 話題更新時のみ DOM 更新
- `stop_aituber.bat` が `taskkill /IM node.exe /F` で全 Node 巻き込み → ウィンドウタイトル + listen ポート (3000/3001) でピンポイント停止
- `run_duel_watchdog.ps1` のテスト用コメント残骸 → 正しい説明に修正

---

## 未完了タスク

### GUI 化 第二弾まで完了
| 項目 | 状態 |
|---|---|
| `GET /api/status` (running 含む) | ✅ 動作確認済 |
| `GET /api/config` (disk 生 JSON) | ✅ 動作確認済 |
| `POST /api/config` (validation + bak + reload + restart) | ✅ 動作確認済 |
| `POST /api/start` / `POST /api/stop` (idle/running 切替) | ✅ 動作確認済 |
| `POST /api/skip-topic` | ✅ 動作確認済 |
| `POST /api/pause` / `POST /api/resume` | ✅ 動作確認済 |
| `GET /api/log/stream` (SSE) | ✅ 実装済 (実 LLM での連続動作は未検証) |
| `/admin` 画面 (Start/Stop/Skip/Pause/Resume/Restart) | ✅ curl で HTML/CSS/JS 配信を確認、Start/Stop の API は疎通確認済 |
| `start_aituber.bat` 一発で全部起動 + admin 自動オープン | ✅ 実装済 (ユーザー側で動作確認待ち) |

### 次フェーズ候補（未着手）
- [ ] 設定の項目別フォーム化（speaker 温度や TopicBrain 関連の頻出項目を専用 UI に）
- [ ] 実 LLM 起動下のロングラン検証（Ollama + AITuberKit A/B を起動して数時間流す）
- [ ] メトリクスサマリー（duel_log.jsonl の集計を admin に表示）
- [ ] VRM 切替 API の探索（AITuberKit 側に外部から切り替える endpoint があるか）
- [ ] Electron 化（優先度低）

### 保留中の判断（決着済を含む）
- ~~AITuberKit 本体に手を入れるか~~ → 入れない方針確定（`next.config.js` の 1 行のみ）
- ~~Electron vs ブラウザ単独~~ → ブラウザ単独 HTML 確定
- ~~設定変更の反映方式~~ → 再起動方式確定

### 既知の問題（低優先）
- `/admin` の `Restart duel` ボタンは「現在の config を POST し直す」実装。`POST /api/config` の副作用に依存しているのでわかりにくい。専用の `POST /api/restart` エンドポイントを足すと綺麗。
- `/api/config` の validation は浅い (必須セクションの存在チェックのみ)。型まで踏み込むなら JSON Schema 導入を検討。

---

## 動作確認・検証状況

### 確認できたこと
- `node --check` で `duel.mjs` + `src/*.mjs` 全 13 ファイルの構文 OK
- AITuberKit 未起動下での dry run で設定読込み / Topic 生成 / overlay 起動 / fetch リトライ（指数バックオフ）まで確認
- ユーザー側で `start_aituber.bat` + `start_duel.bat` の実行を確認、`fetch failed` 連発が解消したことを確認（2026-05-12）
- GUI 化後の API 群を curl で疎通確認:
  - `GET /api/status` → JSON state
  - `POST /api/pause` → `{paused:true}`、再度 `GET` で `paused:true` 維持
  - `POST /api/resume` → `{paused:false}`
  - `POST /api/skip-topic` → `{ok:true}`
  - `POST /api/config` (current 設定をエコーバック) → `{ok:true,restarting:true}` ＋ ログに `[ADMIN] config updated and reloaded -> request restart`
- `/admin` 画面の HTML/CSS/JS 配信を確認 (curl で size 確認、後の動作確認はユーザー側で実 LLM 起動下で)

### まだ確認できていないこと
- ブラウザで `/admin` を実際に開いた時の **UI 全体の挙動**（ステータス表示の即時更新、SSE のリアルタイム描画、save & restart の往復）
- 実 LLM (Ollama gemma3:12b) を通した連続会話の安定性（数十分以上のロングラン）
- `start_duel_watchdog.bat` による 30 分再起動が新構成でも動くこと
- YouTube コメント注入の動作
- OBS の「ブラウザソース」に `http://127.0.0.1:8787/overlay` を入れたときの表示

### よく使う検証コマンド
```bash
# 構文確認
node --check duel.mjs && for f in src/*.mjs; do node --check "$f"; done

# Dry run（数秒で kill）
timeout 4 node duel.mjs

# bat の改行コード確認
od -c start_aituber.bat | head -3
file start_aituber.bat
```

---

## 重要なファイル・ディレクトリ

| パス | 役割 | 編集頻度 |
|---|---|---|
| `config.json` | 全設定の単一ソース | **高**（GUI の編集対象） |
| `src/conversation.mjs` | 会話ループ本体 | 中 |
| `src/topicBrain.mjs` | 話題生成 | 中 |
| `src/overlay.mjs` | OBS overlay HTTP server | GUI 化で拡張予定 |
| `overlay/overlay.*` | OBS フロント | 演出変更時 |
| `aituber-kit/next.config.js` | upstream に 1 行追加済み | **低**（触らない方針） |
| `aituber-kit/` その他 | upstream | **触らない** |
| `start_aituber.bat` / `stop_aituber.bat` | 起動・停止 | 構成変更時 |
| `.gitattributes` | 改行コード制御 | 触らない |
| `.env` | `YT_API_KEY` / `YT_VIDEO_ID` | ユーザー管理 |

---

## 注意事項・制約

### 既存仕様を壊さない
- `config.json` のキー名は既に呼び出し側で利用されているため、リネームしたい場合は呼び出し箇所も同時に変更する。
- `overlay/` の HTML/CSS/JS は `src/overlay.mjs` がテンプレ変数 `__OVERLAY_TITLE__` / `__SHOW_META_STYLE__` / `__TOPIC_BRAIN_TEMP__` / `__TOPIC_BRAIN_TEMP_FIXED__` を起動時に置換する。**この 4 つのプレースホルダーは消さない**こと。
- AITuberKit 本体 (`aituber-kit/`) は upstream に追従する想定。`next.config.js` への `NEXT_DIST_DIR` 対応 1 行以外は加えない。

### 影響範囲が大きい変更
- `config.json` のスキーマ変更 → `src/config.mjs` の読み込み + 全モジュールに影響
- `src/conversation.mjs` の `runConversation` フロー変更 → セッション再起動・stall 検知の挙動と関わるため、`progress.mjs` も併せて検討
- `aituber-kit/` への改変 → upstream pull 時の競合の温床になるので、明示的な指示がない限り避ける

### ユーザー資産を尊重する
- ブラウザの localStorage に保存された AITuberKit 側設定（VRM・背景・各種設定）は、ユーザーが手動で組み上げた資産。これを失わせるような構成変更は事前に確認する。
- `.env` の内容（API キー類）は表示・コミットしない。
- `インストーラー/` `素材/` `VRM/` ディレクトリは `.gitignore` 済み。中身を勝手に削除しない。

### secrets を disk に書かない
- `config.json` には絶対に `apiKey` を含めない。API キーは `.env` (`YT_API_KEY`) のみ。
- `writeConfigToDisk` は `stripSecretsAndDerived` を必ず通す。新たに secret を増やす場合はその関数で削除リストに追加。
- `config.json.bak` も `.gitignore` 済みだが、念のため中身に secrets が無いことを確認すること。

### 不明点の扱い
- 推測で大きく進めず、必要に応じてユーザーに確認する（AskUserQuestion）。
- 特に「GUI のフレームワーク選択」「設定変更の即反映 vs 再起動」など、後戻りコストが大きい判断は必ず確認する。

---

## Git 操作に関する厳守事項

### 絶対に実行してはいけないコマンド
以下は **ユーザーの明示的かつ具体的な許可なしに実行しない**：
- `git reset` / `git reset --hard`
- `git clean -fd` 等の `git clean`
- `git checkout -- .` / `git restore .`（差分を破棄する形）
- `git push --force` / `git push -f` / `git push --force-with-lease`
- `git rebase`（特に `-i` は禁止、interactive は使えない）
- `git commit --amend`（過去コミットを書き換える）
- `git filter-branch` / `git filter-repo`
- 履歴を書き換えるあらゆる操作
- ユーザーが追加・編集したファイルの削除

### 必ず事前に確認すべき操作
- `git commit`（メッセージ案を提示して確認 → 実行）
- 新規ブランチ作成 (`git checkout -b`)
- `git push`（リモートへの反映）
- `git pull` / `git fetch` （リモートの取り込み）
- `git merge`
- 既存ファイルの大量変更や削除

### 安全な慣習
- ステージングは `git add <個別ファイル>` を使い、`git add -A` / `git add .` は基本使わない（`.env` などを誤って巻き込まないため）。
- コミット前に必ず `git status --short` と `git diff --stat` で内容を提示する。
- Co-Authored-By 行をコミットに含めるかはユーザー指示に従う（現状この repo では含めている）。
- `git config` の変更は禁止（一度ローカル限定で `user.name` / `user.email` を設定済みなので、再設定不要）。

### Git 操作を提案するときは
1. 実行するコマンドを明示
2. 何が変わるか・取り消せるか
3. リスク（ある場合）
4. ユーザーの承認を得てから実行

---

## 運用ルール

### このファイル自体の更新ルール
- **重要な進捗があったら、本ファイルを必ず更新すること。**
- 以下のときは「これまでに実施した作業」「未完了タスク」「動作確認・検証状況」を更新:
  - 方針変更
  - 重要な実装の完了
  - 新しい問題の発見
  - 未完了タスクの追加・解決
  - 動作確認の結果（成功・失敗ともに）
- 作業を中断する前、または機能が一段落したタイミングで、最新状況を反映してから引き継ぐ。
- 次回セッションの AI エージェントは **このファイルを最初に読む** 前提で書く。冗長な説明を避けつつ、判断の経緯と現在地が分かるよう簡潔・具体的に。
- 「最終更新」日付と「更新履歴」セクションを毎回更新。

### 他のドキュメントとの役割分担
| ファイル | 想定読者 | 内容 |
|---|---|---|
| `README.md` | エンドユーザー | セットアップ・起動手順 |
| `AGENTS.md` | 開発者 / AI エージェント | ディレクトリ構成・設定の触り方・運用注意 |
| `docs/ai_context.md`（本ファイル） | **AI エージェント (セッション間引き継ぎ用)** | 作業履歴・判断履歴・未完了タスク・厳守事項 |

`AGENTS.md` と内容が重複する箇所があるが、本ファイルは **時系列の状態** を保持する点で性質が違う。

---

## 更新履歴

| 日付 | 更新者 | 内容 |
|---|---|---|
| 2026-05-12 | Claude Opus 4.7 | 初版作成。A/B 統合 / duel.mjs 分割 / overlay 最適化 / 運用スクリプト改善 / bat 改行修正 までの履歴を集約。GUI 化を次フェーズとして設定。 |
| 2026-05-12 | Claude Opus 4.7 | GUI 化第一弾を完了: config の mutable 化 + reloadConfig、state.mjs 新設、HTTP サーバー統合 (server.mjs)、API ハンドラ (admin.mjs)、管理 UI フロント (overlay/admin.*)。`writeConfigToDisk` から secrets / paths を除外する `stripSecretsAndDerived` を追加。動作確認状況と次フェーズ候補を更新。 |
| 2026-05-12 | Claude Opus 4.7 | idle 待機モード追加。`state.running` を新設し `main.mjs` を「running になるまで待機 → ループ」に変更。`POST /api/start` / `POST /api/stop` を新設し、GUI に Start/Stop ボタンを追加。`config.conversation.autoStart` (デフォルト false)。`start_aituber.bat` で A/B + Ollama + duel (idle) + ブラウザ自動オープンまで実行する形に統合。idle 待機時の Node.js 早期 exit を防ぐため `server.unref()` を撤去。 |
