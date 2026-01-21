// duel.mjs
// ===== AITuberKit x2 + Ollama : 安定運用版 + Topic Brain + OBS演出連動 =====
// 追加: しゃべった内容ログ / 感情・温度ログ / AI話題生成(Topic Brain) / 会話停止の自動再開
// 追加: OBS用「話題テロップ」(色・SE・フェード) を自動表示（常時表示）
//
// ★ よく触る場所は「★」コメントを付けています。

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (!key) continue;
    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

const ENV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");
loadEnvFile(ENV_PATH);

const OLLAMA_URL = "http://127.0.0.1:11434/v1/chat/completions";


// ================================
// YouTube Live Chat (polling)
// ================================
const YT_API_KEY = process.env.YT_API_KEY; // ★必須
const YT_API_BASE = "https://www.googleapis.com/youtube/v3";
const YT_VIDEO_ID = process.env.YT_VIDEO_ID || "XXXXXXXXXXX";

// ★微調整ポイント：YouTubeコメント取得のデバッグログ
const YT_DEBUG = true;

// ★微調整ポイント：コメントを混ぜる確率（0.15〜0.25くらいが配信っぽい）
const COMMENT_INSERT_RATE = 1.0;

// ★微調整ポイント：長すぎるコメントで会話が壊れないように
const COMMENT_MAX_LEN = 60;

// ★微調整ポイント：溜めすぎ防止
const COMMENT_QUEUE_MAX = 10;

// ★YouTubeコメント取得のポーリング間隔（固定）
const YT_POLL_INTERVAL_MS = 60_000; // 60秒


async function ytGetActiveLiveChatId(videoId) {
  const url = new URL(`${YT_API_BASE}/videos`);
  url.searchParams.set("part", "liveStreamingDetails");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", YT_API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`YT videos.list failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
}

async function ytListLiveChatMessages(liveChatId, pageToken) {
  const url = new URL(`${YT_API_BASE}/liveChat/messages`);
  url.searchParams.set("liveChatId", liveChatId);
  url.searchParams.set("part", "snippet,authorDetails");
  url.searchParams.set("maxResults", "200");
  url.searchParams.set("key", YT_API_KEY);
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`YT liveChatMessages.list failed: ${res.status} ${t.slice(0, 200)}`);
  }
  return await res.json();
}

// AITuberKitの [happy] 等を壊さないようにサニタイズ（超重要）
function sanitizeChatText(s) {
  if (!s) return "";
  return String(s)
    .replace(/\r?\n|\r/g, " ")      // 1行化
    .replace(/\s+/g, " ")
    .replace(/\[|\]/g, "")         // [happy] など事故防止
    .replace(/`{3,}/g, "")         // ``` を潰す
    .replace(/[<>]/g, "")          // 念のため
    .slice(0, COMMENT_MAX_LEN)
    .trim();
}

const liveCommentQueue = [];
let ytPollingAbort = false;

function popLiveComment() {
  return liveCommentQueue.length ? liveCommentQueue.shift() : null;
}

// ★同じコメントの連続注入を防ぐ
let lastInjectedComment = "";

function popLiveCommentDedup() {
  while (liveCommentQueue.length) {
    const c = liveCommentQueue.shift();
    if (c && c !== lastInjectedComment) {
      lastInjectedComment = c;
      return c;
    }
  }
  return null;
}

// ★微調整ポイント：同じコメントが何度も入るのを減らす
const seenCommentIds = new Set();
function trimSeenSet(max = 2000) {
  if (seenCommentIds.size <= max) return;
  // Set の古い順は取り出せないので雑にリセット（十分）
  seenCommentIds.clear();
}

async function startYouTubeLiveChatPolling(videoId) {
  console.log("[YT] key loaded:", !!YT_API_KEY, "len=", (YT_API_KEY || "").length);
  if (!YT_API_KEY) {
    console.warn("[YT] YT_API_KEY is missing. Live comments disabled.");
    return;
  }

  if (YT_DEBUG) console.log("[YT] polling start. videoId:", videoId);

  const liveChatId = await ytGetActiveLiveChatId(videoId);
  if (!liveChatId) {
    console.warn("[YT] activeLiveChatId not found. Stream may be offline or chat disabled.");
    return;
  }

  console.log("[YT] liveChatId:", liveChatId);

  // ★ここから：ウォームアップ（過去ログを捨てて「今」から拾う）
  // nextPageToken を最初に最新位置へ進める（この1回の items はキューに入れない）
  let nextPageToken = null;
  try {
    const warm = await ytListLiveChatMessages(liveChatId, null);
    nextPageToken = warm?.nextPageToken || null;

    const warmWaitMs = Math.max(1000, Number(warm?.pollingIntervalMillis || 5000));

    if (YT_DEBUG) {
      const n = Array.isArray(warm?.items) ? warm.items.length : 0;
      console.log(
        `[YT] warmup: skipped items=${n} tokenReady=${!!nextPageToken} wait=${warmWaitMs}ms`
      );
    }

    // ★重要：warmup直後は待つ（連続リクエストで403を食らうのを防ぐ）
    await new Promise((r) => setTimeout(r, warmWaitMs));
  } catch (e) {
    console.warn("[YT] warmup failed:", e?.message || e);
  }

  // ★ここまで：ウォームアップ

  while (!ytPollingAbort) {
    let data;
    try {
      data = await ytListLiveChatMessages(liveChatId, nextPageToken);
    } catch (e) {
      console.warn("[YT] polling error:", e?.message || e);
      await new Promise((r) => setTimeout(r, 30_000));
      continue;
    }

    const prevToken = nextPageToken;
    nextPageToken = data?.nextPageToken || nextPageToken;
    const waitMs = YT_POLL_INTERVAL_MS;

    const items = Array.isArray(data?.items) ? data.items : [];

    if (YT_DEBUG) {
      console.log(
        `[YT] polled: items=${items.length} queue=${liveCommentQueue.length} wait=${waitMs}ms tokenChanged=${prevToken !== nextPageToken}`
      );
    }

    let added = 0;

    for (const it of items) {
      const id = it?.id;
      if (!id || seenCommentIds.has(id)) continue;
      seenCommentIds.add(id);

      const raw = it?.snippet?.displayMessage || "";
      const text = sanitizeChatText(raw);
      if (!text) continue;

      liveCommentQueue.push(text);
      if (liveCommentQueue.length > COMMENT_QUEUE_MAX) liveCommentQueue.shift();
      added++;

      // 新規コメントの中身を最初の1件だけ出す（ログ出しすぎ防止）
      if (YT_DEBUG && added === 1) {
        const author = it?.authorDetails?.displayName || "unknown";
        console.log(`[YT] new: ${author}: ${text}`);
      }
    }

    if (YT_DEBUG) {
      console.log(`[YT] added=${added} queue=${liveCommentQueue.length}`);
    }

    trimSeenSet();
    await new Promise((r) => setTimeout(r, waitMs));
  }

  if (YT_DEBUG) console.log("[YT] polling stopped.");
}



function stopYouTubeLiveChatPolling() {
  ytPollingAbort = true;
}

// last を作ったあとに「たまに」コメントに差し替える
function maybeInjectLiveComment(defaultLine) {
  if (Math.random() >= COMMENT_INSERT_RATE) return defaultLine;

  const c = popLiveCommentDedup();
  if (!c) return defaultLine;

  // ★微調整ポイント：コメント挿入の言い回し
  return `[neutral]コメントで「${c}」って流れてたけど、どう思う？`;
}

// =================================================
// ★ ソフトリセット：履歴を短く保つ（system + 直近Nターンだけ残す）
// =================================================
const HISTORY_KEEP_TURNS = 8; // ★微調整ポイント：6〜12くらいが配信向き

function softResetHistory(history) {
  // history[0] は system なので残す
  const keepMsgs = HISTORY_KEEP_TURNS * 2; // user+assistant で2個/ターン想定
  const extra = Math.max(0, (history.length - 1) - keepMsgs);
  if (extra > 0) {
    history.splice(1, extra); // system(0)以外を前から削る
  }
}



// =================================================
// ★ OBS用：話題テロップ（中央“番組の軸”）
// =================================================
// OBSに「ブラウザ」ソースを追加して、下のURLを入れるだけで使えます。
// 例) http://127.0.0.1:8787/overlay
//
// ★ 常時表示: ON
const OBS_OVERLAY_ENABLED = true;
const OBS_OVERLAY_PORT = 8787; // ★ 他とかぶるなら変える

// ★ テロップの見た目（ここ触ると配信っぽさが変わる）
// ★ テロップ左のラベル（例: "現在の話題" / "本日のテーマ"）
const OVERLAY_TITLE = "現在の話題";
const OVERLAY_SHOW_META = true;     // ズラし度/生成元を表示

const OVERLAY_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "overlay");

function loadOverlayAsset(name) {
  return fs.readFileSync(path.join(OVERLAY_DIR, name), "utf8");
}

function applyOverlayTemplate(s) {
  return s
    .replace(/__OVERLAY_TITLE__/g, OVERLAY_TITLE)
    .replace(/__SHOW_META_STYLE__/g, OVERLAY_SHOW_META ? "" : "display:none;")
    .replace(/__TOPIC_BRAIN_TEMP__/g, String(TOPIC_BRAIN_TEMP))
    .replace(/__TOPIC_BRAIN_TEMP_FIXED__/g, TOPIC_BRAIN_TEMP.toFixed(2));
}

// =================================================
// ★ キャラ設定（ここが一番よく触る）
// =================================================
const SPEAKER_A = {
  id: "A",

  // ★ キャラの表示名・会話内で呼ばれる名前
  charName: "マヌカ",
  partnerName: "真冬",

  // ★ AITuberKit 側の接続先（通常は触らない）
  aituberBase: "http://localhost:3000",
  clientId: "speakerA",

  // ★ 使用するモデル（A/B同じでもOK）
  ollamaModel: "gemma3:12b",

  // ★ 性格差を出すための温度（低いほど安定 / 高いほど発散）
  temperature: 0.75,

  // ★ 感情キャラ（system prompt 用）
  emotion: "cheerful", // calm / energetic / friendly / cheerful …など増やしてOK
};

const SPEAKER_B = {
  id: "B",
  charName: "真冬",
  partnerName: "マヌカ",
  aituberBase: "http://localhost:3001",
  clientId: "speakerB",
  ollamaModel: "gemma3:12b",

  temperature: 0.55,
  emotion: "friendly",
};


// =================================================
// ★ speaker lookup（未定義で落ちるのを防ぐ）
// =================================================
// 仕切り直し/話題変更で「どっちが喋るか」をIDで引くためのヘルパ。
// A/B以外が来たときはAに倒す（安全側）。
function speakerById(id) {
  return id === "B" ? SPEAKER_B : SPEAKER_A;
}

// 旧バージョン互換：もしどこかに speakEitherById 呼び出しが残っていても落ちないようにする
function speakEitherById(id) {
  return speakerById(id ?? (Math.random() < 0.5 ? "A" : "B"));
}

// =================================================
// ★ 配信モード切り替え
// =================================================
const STREAM_MODE = true;   // true: 無限雑談（配信用） / false: 通常モード

// =================================================
// ★ 会話全体のテンポ・長さ調整
// =================================================
const TURNS = STREAM_MODE ? Infinity : 20;           // ★ 会話の往復回数（増やすと長くなる）
const MAX_CHARS = 220;       // ★ 1発言の最大文字数（短いほど安定）
const CALL_NAME_PROB = 0.2;  // ★ 名前を呼ぶ確率（0.2 = 20%）

// =================================================
// ★ 話題切り替え関連（番組感に直結）
// =================================================
const TOPIC_INTERVAL = 3; // ★ 何ターンごとに話題を変えるか

// ★ 旧: 固定トピック（Topic Brain が不調のときの「保険」として残す）
const TOPICS = [
  "最近ハマっていること",
  "最近見た動画や配信",
  "好きな食べ物の話",
  "ちょっとした日常の失敗談",
  "最近気になっているゲームやアプリ",
  "子どもの頃の思い出",
];

// =================================================
// ★ Topic Brain（AIに話題を考えさせる）
// =================================================
const TOPIC_BRAIN_ENABLED = true; // ★ true=AIが話題生成 / false=固定TOPICSのみ

// ★★★ ズラし度（高いほど予想外 / 低いほど安定）
// OBSテロップの色もここに連動します。
const TOPIC_BRAIN_TEMP = 0.75;
/*
  ★ TOPIC_BRAIN_TEMP の目安
  - 0.55〜0.65 : 安定（配信向き・破綻しにくい）
  - 0.70〜0.85 : 予想外（雑談が跳ねる・たまに変化球）
  - 0.90以上   : カオス（話題は面白いが壊れやすい）
*/
const TOPIC_BRAIN_MAX_CHARS = 28; // ★ 話題名の最大文字数（短いほど安定）
const TOPIC_BRAIN_LOOKBACK = 10;  // ★ 直近何発言ぶんを読ませるか（増やすと文脈重視）
const TOPIC_REPEAT_AVOID = 2;     // ★ 直近この回数ぶん話題の近似被りを避ける（簡易）

// =================================================
// ★ 読み上げ待ち時間（超重要）
// =================================================
const BASE_WAIT = 800;    // ★ 発話開始前の準備待ち（ms）
const PER_CHAR = 170;     // ★ 1文字あたりの読み上げ時間（ms）
const MAX_WAIT = 60000;   // ★ 長文でも待ちすぎない上限

// =================================================
// ★ 会話停止の自動再開（ここも調整ポイント）
// =================================================
const STALL_MS = 45_000;        // ★ この時間進捗が無ければ「停止」とみなす
const RESTART_WAIT_MS = 2_000;  // ★ 再開前の待ち（連続再開の暴走防止）
const API_RETRY = 3;            // ★ Ollama/Send のリトライ回数

// =================================================
// 話題切替：どっちが提案する？（微調整ゾーン）
// =================================================
const TOPIC_CHANGE_BY = {
  mode: "prob",        // "prob" | "alternate"
  aWeight: 0.5,       // Aが提案する確率（0〜1）
  bWeight: 0.5,       // B（aWeightと合計1にすると分かりやすい）
};

// =================================================
// ★ 暴走防止（基本触らなくてOK）
// =================================================
const MAX_RUN_MS = 10 * 60 * 1000; // ★ 全体の最大実行時間

process.on("SIGINT", () => {
  console.log("\n[STOP] Ctrl+C で終了");
  process.exit(0);
});

if (!STREAM_MODE) {
  setTimeout(() => {
    console.log("\n[STOP] タイムアウトで終了");
    process.exit(0);
  }, MAX_RUN_MS);
}

// =================================================
// util
// =================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function appendJsonl(filePath, obj) {
  if (!filePath) return;
  try {
    fs.appendFileSync(filePath, JSON.stringify(obj) + "\n", "utf8");
  } catch (e) {
    // ログ失敗は会話を止めない
  }
}

const LOG_JSONL = "duel_log.jsonl";
const LOG_EVENTS_JSONL = "duel_events.jsonl";

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// =================================================
// ★ 文頭テンプレ化 防止フィルタ
// =================================================
const STARTER_BLACKLIST = [
  /^はい[！、]/,
  /^あっ[、！]/,
  /^えっと[、！]/,
  /^なるほど[、！]/,
  /^うーん[、！]/,
];

const STARTER_ALTERNATIVES = [
  "",                 // いきなり本題
  "そうだね、",
  "たしかに、",
  "個人的には、",
  "感覚的には、",
];

function normalizeStarterTagged(text) {
  const s = String(text ?? "").trim();
  const m = s.match(/^\[(neutral|happy|angry|sad|relaxed|surprised)\]\s*([\s\S]*)$/);
  if (!m) return normalizeStarter(s); // タグが無ければ通常版

  const emo = m[1];
  const body = m[2].trim();

  // 本文の文頭だけを揺らす（はい/あっ問題対策）
  const fixedBody = normalizeStarter(body);

  return `[${emo}]${fixedBody}`;
}
// =================================================
// ★ 感情タグを1つだけに正規化する（AITuberKit表情連動用）
// =================================================
const EMO_SET = ["neutral", "happy", "angry", "sad", "relaxed", "surprised"];

function normalizeEmotionTagged(text, fallback = "neutral") {
  let s = String(text ?? "").trim();

  // 先頭が [xxx] ならそれを採用。違うならfallbackを付ける
  const m = s.match(/^\[([a-zA-Z]+)\]\s*([\s\S]*)$/);
  if (!m) {
    return `[${fallback}]${s}`;
  }

  const emo = String(m[1]).toLowerCase();
  // 本文側に余計な感情タグが混ざるとAITuberKitが誤動作しやすいので除去（先頭1個だけ残す）
  const body = String(m[2] ?? "")
    .replace(/\[(neutral|happy|angry|sad|relaxed|surprised)\]/gi, "")
    .trim();

  const use = EMO_SET.includes(emo) ? emo : fallback;
  return `[${use}]${body}`;
}

// =================================================
// ★ タグをモデルに見せない用（タグ増殖/引用を防ぐ）
// =================================================
function stripLeadingEmotionTag(text) {
  const s = String(text ?? "").trim();
  const m = s.match(/^\[(neutral|happy|angry|sad|relaxed|surprised)\]\s*([\s\S]*)$/i);
  return m ? String(m[2] ?? "").trim() : s;
}

// =================================================
// ★ speakerごとの「タグが付かなかった時の保険」（表情が確実に動く）
// =================================================
// ※ ここを触ると「無タグ出力」時でも表情がちゃんと変わります。
function fallbackEmotionForSpeaker(speaker) {
  // ★ emotion の粒度は好みで増やしてOK
  switch (speaker?.emotion) {
    case "cheerful":
      return "happy";
    case "friendly":
      return "relaxed";
    case "calm":
      return "neutral";
    case "energetic":
      return "surprised";
    default:
      return "neutral";
  }
}

// =================================================
// ★ 語尾テンプレ化 防止フィルタ（〜だよね/〜かな/〜かも）
// =================================================
const ENDING_PATTERNS = [
  // 末尾の「だよね」
  { re: /だよね[。！!？?]*\s*$/, alts: ["だと思う", "って感じ", "かな", "かも"] },

  // 末尾の「かな」
  { re: /かな[。！!？?]*\s*$/, alts: ["かも", "って思う", "だと思う", "って感じ"] },

  // 末尾の「かも」
  { re: /かも[。！!？?]*\s*$/, alts: ["かな", "って思う", "だと思う", "って感じ"] },
];

let _lastEndingKey = "";

// 句読点は維持（? / ！など）
function pickEndingAlt(alts) {
  if (alts.length === 1) return alts[0];
  let alt;
  for (let i = 0; i < 6; i++) {
    alt = alts[Math.floor(Math.random() * alts.length)];
    if (alt !== _lastEndingKey) break;
  }
  _lastEndingKey = alt;
  return alt;
}

function normalizeEnding(body) {
  let s = String(body ?? "").trim();

  // 質問終わり（？）はなるべく保持したいので、最後の記号を退避
  const punct = (s.match(/[。！!？?]+$/) || [""])[0];
  const core = punct ? s.slice(0, -punct.length) : s;

  // 置換は「末尾だけ」対象
  for (const p of ENDING_PATTERNS) {
    if (p.re.test(core)) {
      const alt = pickEndingAlt(p.alts);

      // 「質問で終える」ルールがあるので、元が ? なら維持
      const keepQ = /[？?]/.test(punct);

      const replaced = core.replace(p.re, alt);
      return replaced + (keepQ ? "？" : punct || "。");
    }
  }

  return s;
}

// タグ付き（[happy]...）でも本文だけ語尾ゆらし
function normalizeEndingTagged(text) {
  const s = String(text ?? "").trim();
  const m = s.match(/^\[(neutral|happy|angry|sad|relaxed|surprised)\]\s*([\s\S]*)$/);
  if (!m) return normalizeEnding(s);

  const emo = m[1];
  const body = m[2].trim();
  const fixed = normalizeEnding(body);
  return `[${emo}]${fixed}`;
}

let _lastStarter = "";

function normalizeStarter(text) {
  let s = String(text ?? "").trim();

  for (const re of STARTER_BLACKLIST) {
    if (re.test(s)) {
      // 直前と同じ始まりを避ける
      let alt;
      do {
        alt = STARTER_ALTERNATIVES[Math.floor(Math.random() * STARTER_ALTERNATIVES.length)];
      } while (alt === _lastStarter && STARTER_ALTERNATIVES.length > 1);

      _lastStarter = alt;
      s = s.replace(re, alt);
      break;
    }
  }

  return s;
}

function clip(text) {
  if (!text) return "";

  if (text.length <= MAX_CHARS) return text;

  // いったん MAX_CHARS で切る
  const cut = text.slice(0, MAX_CHARS);

  // 文として自然に終われる位置を探す（最後の句点・感嘆符など）
  const m = cut.match(/(.+[。！？!?])/);
  if (m) {
    return m[1];
  }

  // それでもダメなら、語尾を整えて三点リーダで締める
  return cut.replace(/[、。！？!?]*$/, "") + "…";
}


function isJapanese(text) {
  return ((text.match(/[ぁ-んァ-ヶ一-龠]/g) || []).length >= 6);
}

function estimateSpeakMs(text) {
  const punct = (text.match(/[。！？]/g) || []).length * 180;
  return Math.min(BASE_WAIT + text.length * PER_CHAR + punct, MAX_WAIT);
}

const shouldCallName = () => Math.random() < CALL_NAME_PROB;
const pickTopic = () => TOPICS[Math.floor(Math.random() * TOPICS.length)];

function nowStr() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function logLine(tag, msg) {
  console.log(`[${nowStr()}] ${tag} ${msg}`);
}

function speakerTag(s) {
  return `${s.charName}(${s.id})`;
}

function oneLine(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function softClipTopic(s) {
  s = oneLine(s);
  // ありがちな飾り・記号を軽く落とす（壊れにくくする）
  s = s.replace(/^["'「『（(【\[]+/, "").replace(/["'」』）)】\]]+$/, "");
  // 末尾句読点は不要
  s = s.replace(/[。！？!?]+$/g, "");
  if (s.length > TOPIC_BRAIN_MAX_CHARS) s = s.slice(0, TOPIC_BRAIN_MAX_CHARS);
  return s;
}

let _lastTopicBy = "B"; // 交互用の初期値（任意）

function pickTopicOwner() {
  if (TOPIC_CHANGE_BY.mode === "alternate") {
    _lastTopicBy = (_lastTopicBy === "A") ? "B" : "A";
    return _lastTopicBy;
  }

  // prob（確率）
  const r = Math.random();
  return (r < TOPIC_CHANGE_BY.aWeight) ? "A" : "B";
}

// =================================================
// OBS overlay state（話題表示：常時）
// =================================================
const overlayState = {
  topic: "",
  source: "INIT", // INIT / BRAIN / FALLBACK / FIXED
  topicTemp: TOPIC_BRAIN_TEMP,
  sessionNo: 0,
  turn: 0,
  updatedAt: Date.now(),
};

function setOverlayTopic({ topic, source, topicTemp, sessionNo, turn }) {
  overlayState.topic = String(topic ?? "");
  overlayState.source = String(source ?? "");
  overlayState.topicTemp = Number.isFinite(topicTemp) ? topicTemp : TOPIC_BRAIN_TEMP;
  overlayState.sessionNo = sessionNo ?? overlayState.sessionNo;
  overlayState.turn = turn ?? overlayState.turn;
  overlayState.updatedAt = Date.now();
}

function startObsOverlayServer() {
  if (!OBS_OVERLAY_ENABLED) return;

  const overlayHtml = applyOverlayTemplate(loadOverlayAsset("overlay.html"));
  const overlayCss = applyOverlayTemplate(loadOverlayAsset("overlay.css"));
  const overlayJs = applyOverlayTemplate(loadOverlayAsset("overlay.js"));

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${OBS_OVERLAY_PORT}`);

      if (url.pathname === "/topic") {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(overlayState));
        return;
      }

      if (url.pathname === "/overlay.css") {
        res.writeHead(200, {
          "Content-Type": "text/css; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(overlayCss);
        return;
      }

      if (url.pathname === "/overlay.js") {
        res.writeHead(200, {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(overlayJs);
        return;
      }

      if (url.pathname === "/overlay") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(overlayHtml);
        return;
      }

      // 使いやすいようにルートは /overlay にリダイレクト
      if (url.pathname === "/") {
        res.writeHead(302, { Location: "/overlay" });
        res.end();
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Server error");
    }
  });

  server.listen(OBS_OVERLAY_PORT, "127.0.0.1", () => {
    logLine("[OBS]", `Topic overlay: http://127.0.0.1:${OBS_OVERLAY_PORT}/overlay`);
  });

  // OBS overlayサーバは、プロセス終了をブロックしないようにしておく
  server.unref?.();
}

// 進捗監視：止まったら自動再開
let lastProgressMs = Date.now();
let restartRequested = false;
function markProgress() {
  lastProgressMs = Date.now();
}

// =================================================
// ★ キャラの性格・感情が決まる場所（重要）
// =================================================
function makeSystemPrompt(speaker, callName) {
  // ★ emotion の文言（必要なら増やしてOK）
  const emotionText =
    speaker.emotion === "calm"
      ? "落ち着いていて優しい。安心感のある話し方。"
      : speaker.emotion === "friendly"
      ? "親しみやすく、相手に寄り添う。柔らかい相づち。"
      : "元気で感情豊か。リアクション多め。";

  const callRule = callName
    ? `今回は相手の名前「${speaker.partnerName}」を自然に1回だけ呼ぶ。`
    : `今回は相手の名前を呼ばない。`;

  // ★ B専用ルール（真冬だけに適用）
  // ここは微調整ポイント：キャラ名で判定しているので、名前変更するなら条件も合わせる
  const bExtraRule =
    speaker.charName === "真冬"
      ? `
【B専用ルール】
- 相手に質問するときは、推測口調（「〜と思う？」「〜じゃない？」）を使わない
- 素直に「何が好き？」「どんな〜？」の形で聞く
`
      : "";

  return `
あなたは日本語で話すAIです。英語は禁止。
あなたの名前は「${speaker.charName}」、相手は「${speaker.partnerName}」。

【超重要：AITuberKit 表情連動フォーマット】
- 出力は必ず 1行。
- 行頭に感情タグを1つだけ付ける：[neutral] [happy] [angry] [sad] [relaxed] [surprised]
- 形式は「[emotion]本文」。
- JSONや引用符や余計な記号は出さない。
- 本文の途中に感情タグを入れない。

感情・雰囲気:
- ${emotionText}

【会話スタンス（超重要）】
- 雑談では、相手の話題に詳しくなくても「少し興味を持っている態度」で返す
- 分からない話題でも、感想・共感・想像で会話を続ける
- 固有名詞（作品名/ゲーム名/配信サービス/店名など）は「たまに」入れる（目安：3〜5回に1回）
- その回は固有名詞は1つだけ。迷ったら無理に出さず一般名詞でOK
${bExtraRule}

ルール:
- 1〜3文の短い日本語
- 敬語禁止（です/ます/ございます/〜でしょう 等を使わず、砕けた自然な口調）
- ${callRule}

- 箇条書き・コード・URLは禁止
- 文頭の言い回しは毎回変える
- 「はい」「あっ」「えっと」「なるほど」などの定型的な出だしを連続で使わない
- 同じ文頭になりそうな場合は、前置きを省いて本題から入る
- 語尾が毎回「だよね」「かな」「かも」だけにならないよう、言い切り・疑問・言い換えを混ぜる
- 直前と同じ言い回しや定型文の連発は禁止。
- 毎回、具体例を1つ入れる。
- 返答の最後に短い質問を1つ入れて会話を前に進める。
- 抽象的な同意で終わらず、必ず新情報（例・具体）を1つ追加する。
`;
}



// =================================================
// Ollama 呼び出し
// =================================================
async function ollamaChat(model, messages, temperature) {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      temperature,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Ollama HTTP ${res.status}: ${t.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Ollama response missing choices[0].message.content");
  return content;
}

// =================================================
// AITuberKit に喋らせる
// =================================================
async function send(base, clientId, text) {
  const res = await fetch(
    `${base}/api/messages/?clientId=${clientId}&type=direct_send`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ messages: [text] }),
    }
  );

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`AITuberKit send HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
}

// =================================================
// リトライ付きラッパ
// =================================================
async function withRetry(fn, label, tries = API_RETRY) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      logLine("[WARN]", `${label} failed (${i}/${tries}): ${e?.message ?? e}`);
      await sleep(350 * i);
    }
  }
  throw lastErr;
}

// =================================================
// 会話生成（ログは「SAY側」に統一して二重表示を避ける）
// =================================================
async function generate(speaker, history, input) {
  const callName = shouldCallName();

  history[0] = {
    role: "system",
    content: makeSystemPrompt(speaker, callName),
  };

  // ★ モデルにはタグを見せない（タグ増殖/引用を防ぐ）
  history.push({ role: "user", content: stripLeadingEmotionTag(input) });

  let out = clip(
    await withRetry(
      () => ollamaChat(speaker.ollamaModel, history, speaker.temperature),
      `Ollama(${speakerTag(speaker)})`
    )
  );

  // 日本語チェック（たまに英語が混ざる対策）
  if (!isJapanese(out)) {
    history.push({
      role: "user",
      content: "英語は禁止。日本語だけで、同じ内容を短く言い直して。",
    });
    out = clip(
      await withRetry(
        () => ollamaChat(speaker.ollamaModel, history, speaker.temperature),
        `Ollama(rewrite:${speakerTag(speaker)})`
      )
    );
  }

  // ★ タグが付かなかった時でも表情が動くようにspeaker別フォールバック
  out = normalizeEmotionTagged(out, fallbackEmotionForSpeaker(speaker));
  out = normalizeStarterTagged(out);
  out = normalizeEndingTagged(out);

  // ★ 履歴にはタグ無し本文だけを積む（次の生成が安定する）
  history.push({ role: "assistant", content: stripLeadingEmotionTag(out) });
  markProgress();

  return out;
}


// =================================================
// ★ Topic Brain：AIで「次の話題」を生成（モデルは同じ）
// =================================================
function buildRecentTranscript(turnLog) {
  const lastN = turnLog.slice(-TOPIC_BRAIN_LOOKBACK);
  if (lastN.length === 0) return "";
  // ★ Topic Brain にもタグを見せない（話題生成が安定する）
  return lastN.map((t) => `${t.who}: ${oneLine(stripLeadingEmotionTag(t.text))}`).join("\n");
}

function isTooSimilarTopic(a, b) {
  a = oneLine(a);
  b = oneLine(b);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const aw = new Set(a.split(/[ 　・、。！？!?]/).filter(Boolean));
  const bw = new Set(b.split(/[ 　・、。！？!?]/).filter(Boolean));
  let common = 0;
  for (const w of aw) if (bw.has(w)) common++;
  return common >= 2; // ★被り判定はここを調整してもOK
}

async function topicBrain({
  speakerForModel,
  recentTranscript,
  lastTopic,
  usedTopics,
  temperature,
}) {
  const system = `
あなたは会話を活性化させる「話題生成AI」です。人格は演じません。
日本語のみ。出力は「話題」1つだけ（1行）にしてください。

条件:
- 直近の会話と少し関係はあるが、少しだけ意外性（ズラし）を入れる
- 雑談向き（軽いテーマ）
- 重い話（政治/事件/暴力/差別/自傷/露骨な性的話題）は避ける
- 話題は短く（${TOPIC_BRAIN_MAX_CHARS}文字以内が理想）
- 「質問文」ではなく「題材（名詞句）」にする
- 直前の話題「${lastTopic}」と同じ/ほぼ同じは避ける
- もし迷ったら、日常・趣味・食・ゲーム・配信・買い物・季節・子どもの頃等から選ぶ

最近の会話（抜粋）:
${recentTranscript}
`.trim();

  const messages = [
    { role: "system", content: system },
    { role: "user", content: "次の話題を1つだけ出して。余計な説明は不要。話題だけ。" },
  ];

  let raw = await withRetry(
    () => ollamaChat(speakerForModel.ollamaModel, messages, temperature),
    `TopicBrain(${speakerTag(speakerForModel)})`
  );

  raw = softClipTopic(raw);

  // 日本語っぽくない場合は言い直し（Topic Brain専用）
  if (!isJapanese(raw)) {
    const rewrite = [
      { role: "system", content: system },
      { role: "user", content: "英語は禁止。日本語の話題だけを1つ、短く出して。" },
    ];
    raw = softClipTopic(
      await withRetry(
        () =>
          ollamaChat(
            speakerForModel.ollamaModel,
            rewrite,
            Math.max(0.35, temperature - 0.1)
          ),
        `TopicBrain(rewrite:${speakerTag(speakerForModel)})`
      )
    );
  }

  // 近似被り回避（ダメなら空にしてフォールバックへ）
  for (let i = Math.max(0, usedTopics.length - TOPIC_REPEAT_AVOID); i < usedTopics.length; i++) {
    if (isTooSimilarTopic(raw, usedTopics[i])) return "";
  }
  if (isTooSimilarTopic(raw, lastTopic)) return "";
  if (!raw) return "";

  return raw;
}

async function decideNextTopic({ sessionNo, turn, turnLog, lastTopic, usedTopics }) {
  const brainSpeaker = SPEAKER_B; // ★ 話題生成に使う speaker（モデル同じなのでどっちでもOK）

  if (!TOPIC_BRAIN_ENABLED) {
    const t = pickTopic();
    logLine("[TOPIC]", `#${sessionNo} turn=${turn}: "${t}" (FIXED)`);
    return { topic: t, source: "FIXED", topicTemp: TOPIC_BRAIN_TEMP };
  }

  const transcript = buildRecentTranscript(turnLog);
  try {
    const t = await topicBrain({
      speakerForModel: brainSpeaker,
      recentTranscript: transcript,
      lastTopic,
      usedTopics,
      temperature: TOPIC_BRAIN_TEMP, // ★★★ ここが「ズラし度」
    });

    if (t) {
      logLine("[TOPIC]", `#${sessionNo} turn=${turn}: "${t}" (BRAIN temp=${TOPIC_BRAIN_TEMP})`);
      return { topic: t, source: "BRAIN", topicTemp: TOPIC_BRAIN_TEMP };
    }
  } catch (e) {
    logLine("[WARN]", `TopicBrain error -> fallback: ${e?.message ?? e}`);
  }

  // フォールバック（保険）
  const fb = pickTopic();
  logLine("[TOPIC]", `#${sessionNo} turn=${turn}: "${fb}" (FALLBACK)`);
  return { topic: fb, source: "FALLBACK", topicTemp: TOPIC_BRAIN_TEMP };
}

// =================================================
// 会話1セッション
// =================================================
async function runConversation(sessionNo) {
  const histA = [{ role: "system", content: "" }];
  const histB = [{ role: "system", content: "" }];

  let skipNextB = false;

  // ★ Topic Brain のために「実際に喋ったログ」を貯める（直近だけ使う）
  const turnLog = []; // {who: string, text: string}

  // ★ 話題の履歴（被り回避用）
  const usedTopics = [];
  
  // 初期話題（INIT）
  let topic = pickTopic();
  usedTopics.push(topic);
  logLine("[TOPIC]", `#${sessionNo} start: "${topic}" (INIT)`);
  setOverlayTopic({ topic, source: "INIT", topicTemp: TOPIC_BRAIN_TEMP, sessionNo, turn: 0 });

  let last = `[neutral]それじゃあおはなししよう。${topic}についてどう思う？`;

  // Aの最初の一言
  logLine(
    "[SAY]",
    `${speakerTag(SPEAKER_A)} emotion=${SPEAKER_A.emotion} temp=${SPEAKER_A.temperature} -> ${last}`
  );
  await withRetry(
    () => send(SPEAKER_A.aituberBase, SPEAKER_A.clientId, last),
    `Send(${speakerTag(SPEAKER_A)})`
  );
  turnLog.push({ who: SPEAKER_A.charName, text: last });
  markProgress();
  await sleep(estimateSpeakMs(last));

  for (let i = 1; i <= TURNS; i++) {
    // ★保険：履歴が肥大化しすぎないよう毎ターン軽く整える
    softResetHistory(histA);
    softResetHistory(histB);

    // Aが受け取る入力（Bスキップでも必ず定義される）
    let inputForA = last;

    // B
    if (skipNextB) {
      skipNextB = false; // 1回だけスキップ（B連続発話防止）
    } else {
      const b = await generate(SPEAKER_B, histB, last);
      logLine(
        "[SAY]",
        `${speakerTag(SPEAKER_B)} emotion=${SPEAKER_B.emotion} temp=${SPEAKER_B.temperature} -> ${b}`
      );
      await withRetry(
        () => send(SPEAKER_B.aituberBase, SPEAKER_B.clientId, b),
        `Send(${speakerTag(SPEAKER_B)})`
      );
      turnLog.push({ who: SPEAKER_B.charName, text: b });
      markProgress();
      await sleep(estimateSpeakMs(b));

      last = b;
      inputForA = b; // ★Bが喋った時だけA入力を更新
    }

    // A
    const a = await generate(SPEAKER_A, histA, inputForA);
    logLine(
      "[SAY]",
      `${speakerTag(SPEAKER_A)} emotion=${SPEAKER_A.emotion} temp=${SPEAKER_A.temperature} -> ${a}`
    );
    await withRetry(
      () => send(SPEAKER_A.aituberBase, SPEAKER_A.clientId, a),
      `Send(${speakerTag(SPEAKER_A)})`
    );
    turnLog.push({ who: SPEAKER_A.charName, text: a });
    markProgress();
    await sleep(estimateSpeakMs(a));

    last = a;


    // 話題チェンジ（Topic Brain）
    if (i % TOPIC_INTERVAL === 0) {
      const next = await decideNextTopic({
        sessionNo,
        turn: i,
        turnLog,
        lastTopic: topic,
        usedTopics,
      });

      topic = next.topic;
      usedTopics.push(topic);

      // ★ OBS表示もここで更新（常時表示）
      setOverlayTopic({
        topic,
        source: next.source,
        topicTemp: next.topicTemp,
        sessionNo,
        turn: i,
      });

      // ★ 話題切替の台詞（ここも微調整ポイント）
      const topicChangeLines = [
        `話変わるけどいい？${topic}ってどう？`,
        `ちょっと話題変えたいんだけど、${topic}はどう思う？`,
        `今の流れで聞いてみたいんだけど、${topic}ってどう思う？`,
        `そういえばさ、${topic}の話してもいい？`,
        `少し切り替えたいんだけど、${topic}どうかな？`,
        `そういえば${topic}の話、してもいい？`,
        `急だけどさ、${topic}ってどう？`,
        `ふと思い出したんだけど、${topic}ってどう思う？`,
        `${topic}の話、今しても平気？`,
      ];

      // ★ここは微調整ポイント：バリエーション増減OK
      const picked =
        topicChangeLines[Math.floor(Math.random() * topicChangeLines.length)];

      last = `[neutral]${picked}`;
      last = maybeInjectLiveComment(last); // ★ここ追加：たまにYouTubeコメントに差し替え
      last = normalizeEmotionTagged(last, "neutral"); // ★話題転換でもタグ事故を潰す

      const ownerId = pickTopicOwner();
      const owner = speakerById(ownerId);

      logLine("[SAY]", `${speakerTag(owner)} (topic change) emotion=${owner.emotion} temp=${owner.temperature} -> ${last}`);
      await withRetry(() => send(owner.aituberBase, owner.clientId, last), `Send(${speakerTag(owner)})`);
      turnLog.push({ who: owner.charName, text: last });

      if (ownerId === "B") {
        skipNextB = true; // ★Bが話題転換したら次のB通常発話をスキップ
      }

      markProgress();
      await sleep(estimateSpeakMs(last));
    }

    // stall要求が立ってたら早めに抜ける
    if (restartRequested) throw new Error("STALL_RESTART");
  }

  logLine("[END]", `#${sessionNo} conversation finished`);
}

// =================================================
// main（停止したら自動再開）
// =================================================
async function run() {
  // OBS overlay を起動（常時表示）
  startObsOverlayServer();

  // 例：duel開始時
  if (YT_VIDEO_ID) {
  startYouTubeLiveChatPolling(YT_VIDEO_ID);
  } else {
    console.warn("[YT] YT_VIDEO_ID is missing. Live comments disabled.");
  }

  // 終了処理
  process.on("SIGINT", () => {
    stopYouTubeLiveChatPolling();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stopYouTubeLiveChatPolling();
    process.exit(0);
  });

  // 停止監視（進捗が止まったら再開要求）
  const t = setInterval(() => {
    const idle = Date.now() - lastProgressMs;
    if (idle > STALL_MS && !restartRequested) {
      logLine("[STALL]", `No progress for ${Math.round(idle / 1000)}s -> restart`);
      restartRequested = true;
    }
  }, 1000);
  t.unref?.();

  let sessionNo = 1;

  while (true) {
    restartRequested = false;
    markProgress();

    try {
      await runConversation(sessionNo);
      process.exit(0); // 通常終了
    } catch (e) {
      logLine("[RESTART]", `#${sessionNo} -> ${e?.message ?? e}`);
    }

    sessionNo++;
    await sleep(RESTART_WAIT_MS);
  }
}

run();
