# AI Context

> このファイルは **AI エージェントが新規セッション開始時に最初に読む** ことを前提に書かれています。
> プロジェクトの現在地・判断履歴・未完了事項をここに集約し、セッション間で情報が失われないようにします。
> **重要な進捗があったら必ずこのファイルを更新してください**（運用ルール参照）。

最終更新: 2026-05-12

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
│   ├── config.mjs            config.json + .env 読込み
│   ├── log.mjs               console + JSONL ロガー (logSay / logEvent)
│   ├── text.mjs              感情タグ / 文頭・語尾フィルタ / clip
│   ├── retry.mjs             withRetry (指数バックオフ) + fetchWithTimeout
│   ├── ollama.mjs            Ollama 呼び出し
│   ├── aituber.mjs           AITuberKit /api/messages へ direct_send
│   ├── youtube.mjs           Live Chat polling + AbortController で即時停止
│   ├── overlay.mjs           OBS overlay HTTP server (:8787) + state
│   ├── topicBrain.mjs        話題生成 (AI + フォールバック)
│   ├── progress.mjs          進捗監視の単一状態 (stall 検知)
│   └── conversation.mjs      会話ループ・generate / runConversation
├── overlay/                  OBS ブラウザソース用
│   ├── overlay.html
│   ├── overlay.css
│   └── overlay.js
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
1. `start_aituber.bat` … Ollama + AITuberKit A (port 3000) + B (port 3001) を別ウィンドウで起動
2. ブラウザで http://localhost:3000 と http://localhost:3001 を開き、各ポートで:
   - 歯車 → その他 → 「外部からの指示を受け付ける」を ON
   - Client ID を「speakerA」「speakerB」にそれぞれ設定
   - VRM / 背景はブラウザ側で設定（localStorage はポート違い = 別オリジンで独立保持）
3. (任意) VOICEVOX を起動
4. `start_duel.bat`（テスト/短時間）or `start_duel_watchdog.bat`（長時間配信）で会話開始
5. 停止は `stop_aituber.bat`

### ビルド / テスト
- duel 側は build なし（Node.js + ES Modules で直接起動）。構文確認は `node --check src/*.mjs`。
- AITuberKit 本体は `cd aituber-kit && npm install` のみ必要。dev は `npm run dev`（bat が自動でやる）。

---

## 現在の作業目的

直近のゴール: **GUI 化** — 設定変更（モデル / 温度 / 話題 / VRM 切替など）と制御（pause/resume/skip-topic）をブラウザ UI から操作可能にする。

### 達成したい状態
1. ユーザーが `config.json` を直接編集しなくても GUI から設定を変更できる
2. 会話中に話題スキップ / 一時停止 / 再開ができる
3. ログ（発話・話題切替）をブラウザでライブ表示できる
4. 既存の OBS overlay (`:8787/overlay`) と共存できる

### 変更対象の範囲（想定）
- `src/overlay.mjs` を拡張、または別途 `src/api.mjs` を新設して制御エンドポイント追加
- `overlay/admin.html` 等の管理画面フロントエンドを新規追加
- `src/config.mjs` を「ホットリロード可能」にするか検討
- AITuberKit 本体 (`aituber-kit/`) は触らない方針

---

## これまでに実施した作業

### コミット履歴（新しい順）
| commit | 内容 |
|---|---|
| `b4c65a7` | bat ファイルを CRLF + UTF-8 (BOM なし) に統一、`start_aituber.bat` の `^` 行継続バグを修正、`.gitattributes` 追加 |
| `53fedfa` | 運用スクリプト改善 (`stop_aituber.bat` ピンポイント停止 / watchdog コメント修正) + `AGENTS.md` を新構成に更新 |
| `e6eea39` | `overlay/overlay.js`: 話題更新時のみ DOM/fitFont 再計算 |
| `44aad5b` | `duel.mjs` を `src/` 12 モジュールに分割し設定値を `config.json` に外出し。副作用として SIGINT 二重登録 / fetch タイムアウト / リトライ指数化 / メモリ上限 / AbortController など 10 件の指摘を一括解消 |
| `1523989` | A/B kit 統合: `aituber-kit-B/` を 369 ファイル削除、`next.config.js` に `NEXT_DIST_DIR` 環境変数対応を追加、`start_aituber.bat` を 1 kit + 2 プロセス構成に改修、VRM を `aituber-kit/public/vrm/` に集約 |

### 採用した設計判断
1. **A/B kit は 1 ディレクトリ共有 + dev 2 プロセス**: `aituber-kit-B/` は src/public がほぼ完全重複だったため削除。同じプロジェクトから `PORT=3000 NEXT_DIST_DIR=.next-A` と `PORT=3001 NEXT_DIST_DIR=.next-B` を別ウィンドウで起動。`.next` 衝突は `distDir` を分けて回避。
2. **設定の単一ソースは `config.json`**: GUI 化を見据えて、コード内のリテラル定数を全部 JSON に外出し。`src/config.mjs` が起動時に 1 度だけ読み込み `Object.freeze`。
3. **upstream (`aituber-kit/`) への改変は最小限**: `next.config.js` に `NEXT_DIST_DIR` 1 行を追加しただけ。AITuberKit 本体を fork/改造する方向には進まない方針。
4. **bat は CRLF + UTF-8 (BOM なし)**: Write tool は LF で書くため、`.gitattributes` で `*.bat eol=crlf` を強制。
5. **VRM 切替はブラウザ側 localStorage で**: ポート別 origin で独立保存される。同梱 VRM は `aituber-kit/public/vrm/` 1 箇所に集約。

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

### GUI 化に向けて（次のフェーズ）
- [ ] `src/api.mjs` 新設 or `overlay.mjs` 拡張で制御エンドポイント:
  - `GET /status` 現在の sessionNo / turn / topic / 設定スナップショット
  - `POST /config` 設定変更（hot-reload か再起動かを検討）
  - `POST /skip-topic` 話題スキップ
  - `POST /pause` / `POST /resume` 一時停止
- [ ] `/log/stream` SSE エンドポイントでログのライブ配信
- [ ] 管理 UI 本体（最初は `overlay/admin.html` の単独 HTML でも十分）
- [ ] `config.json` のホットリロード or 「設定変更 → duel.mjs 自動再起動」のどちらにするか判断
- [ ] GUI から VRM を切り替える方式の検討（AITuberKit 側 API の調査が必要）

### 保留中の判断
- AITuberKit 本体に手を入れるか否か（現状: 入れない方針、`next.config.js` の 1 行のみ）
- Electron / Tauri で GUI を内包するか、ブラウザ単独 HTML で済ませるか
- 設定変更の即反映 vs 再起動方式（即反映だと state 整合性を慎重に設計する必要）

### 既知の問題（低優先）
- なし（直近の動作確認ではユーザーが起動成功を確認済み）

---

## 動作確認・検証状況

### 確認できたこと
- `node --check` で `duel.mjs` + `src/*.mjs` 全 12 ファイルの構文 OK
- `duel.mjs` を AITuberKit 未起動下で約 4 秒 dry run → 設定読込み / Topic 生成 / OBS overlay 起動 / fetch リトライ動作（指数バックオフ）まで確認
- ユーザー側で `start_aituber.bat` + `start_duel.bat` の実行を確認、`fetch failed` 連発が解消したことを確認（2026-05-12）
- `start_aituber.bat` の出力を見て A/B/Ollama の 3 ウィンドウが正常に開くこと

### まだ確認できていないこと
- 実 LLM (Ollama gemma3:12b) を通した連続会話の安定性（数十分以上のロングランは未検証）
- `start_duel_watchdog.bat` による 30 分再起動が新構成でも動くこと（旧 `duel.mjs` から呼び方は変わっていないので動くはず）
- YouTube コメント注入の動作（`YT_API_KEY` + `YT_VIDEO_ID` が `.env` にあれば動くはず）
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
