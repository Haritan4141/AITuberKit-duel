// テキスト処理：感情タグ正規化 / 文頭・語尾フィルタ / clip / サニタイズ / 日本語判定

import { config } from "./config.mjs";

export const EMO_SET = ["neutral", "happy", "angry", "sad", "relaxed", "surprised"];
const EMO_TAG_RE = new RegExp(`^\\[(${EMO_SET.join("|")})\\]\\s*([\\s\\S]*)$`, "i");

const { maxChars, baseWaitMs, perCharMs, maxWaitMs } = config.conversation;
const COMMENT_MAX_LEN = config.youtube.commentMaxLen;

export function oneLine(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

export function isJapanese(text) {
  return ((text.match(/[ぁ-んァ-ヶ一-龠]/g) || []).length >= 6);
}

export function sanitizeChatText(s) {
  if (!s) return "";
  return String(s)
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\[|\]/g, "")
    .replace(/`{3,}/g, "")
    .replace(/[<>]/g, "")
    .slice(0, COMMENT_MAX_LEN)
    .trim();
}

export function stripLeadingEmotionTag(text) {
  const s = String(text ?? "").trim();
  const m = s.match(EMO_TAG_RE);
  return m ? String(m[2] ?? "").trim() : s;
}

export function normalizeEmotionTagged(text, fallback = "neutral") {
  const s = String(text ?? "").trim();
  const m = s.match(/^\[([a-zA-Z]+)\]\s*([\s\S]*)$/);
  if (!m) return `[${fallback}]${s}`;

  const emo = String(m[1]).toLowerCase();
  const body = String(m[2] ?? "")
    .replace(new RegExp(`\\[(${EMO_SET.join("|")})\\]`, "gi"), "")
    .trim();

  const use = EMO_SET.includes(emo) ? emo : fallback;
  return `[${use}]${body}`;
}

export function fallbackEmotionForSpeaker(speaker) {
  switch (speaker?.emotion) {
    case "cheerful": return "happy";
    case "friendly": return "relaxed";
    case "calm":     return "neutral";
    case "energetic": return "surprised";
    default:         return "neutral";
  }
}

// =================================================
// 文頭フィルタ：定型的な出だしを潰す
// =================================================
const STARTER_BLACKLIST = [
  /^はい[！、]/,
  /^あっ[、！]/,
  /^えっと[、！]/,
  /^なるほど[、！]/,
  /^うーん[、！]/,
];

const STARTER_ALTERNATIVES = [
  "",
  "そうだね、",
  "たしかに、",
  "個人的には、",
  "感覚的には、",
];

let _lastStarter = "";

function normalizeStarter(text) {
  let s = String(text ?? "").trim();
  for (const re of STARTER_BLACKLIST) {
    if (re.test(s)) {
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

export function normalizeStarterTagged(text) {
  const s = String(text ?? "").trim();
  const m = s.match(EMO_TAG_RE);
  if (!m) return normalizeStarter(s);
  return `[${m[1].toLowerCase()}]${normalizeStarter(m[2].trim())}`;
}

// =================================================
// 語尾フィルタ：「だよね/かな/かも」の連発を防ぐ
// =================================================
const ENDING_PATTERNS = [
  { re: /だよね[。！!？?]*\s*$/, alts: ["だと思う", "って感じ", "かな", "かも"] },
  { re: /かな[。！!？?]*\s*$/,   alts: ["かも", "って思う", "だと思う", "って感じ"] },
  { re: /かも[。！!？?]*\s*$/,   alts: ["かな", "って思う", "だと思う", "って感じ"] },
];

let _lastEndingKey = "";

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
  const s = String(body ?? "").trim();
  const punct = (s.match(/[。！!？?]+$/) || [""])[0];
  const core = punct ? s.slice(0, -punct.length) : s;

  for (const p of ENDING_PATTERNS) {
    if (p.re.test(core)) {
      const alt = pickEndingAlt(p.alts);
      const keepQ = /[？?]/.test(punct);
      const replaced = core.replace(p.re, alt);
      return replaced + (keepQ ? "？" : punct || "。");
    }
  }
  return s;
}

export function normalizeEndingTagged(text) {
  const s = String(text ?? "").trim();
  const m = s.match(EMO_TAG_RE);
  if (!m) return normalizeEnding(s);
  return `[${m[1].toLowerCase()}]${normalizeEnding(m[2].trim())}`;
}

// =================================================
// 長文クリップ：句点で自然に切る
// =================================================
export function clip(text) {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const m = cut.match(/(.+[。！？!?])/);
  if (m) return m[1];
  return cut.replace(/[、。！？!?]*$/, "") + "…";
}

// タグを残したまま本文だけ clip
export function clipTagged(text) {
  const s = String(text ?? "").trim();
  const m = s.match(EMO_TAG_RE);
  if (!m) return clip(s);
  return `[${m[1].toLowerCase()}]${clip(m[2].trim())}`;
}

export function estimateSpeakMs(text) {
  const punct = (text.match(/[。！？]/g) || []).length * 180;
  return Math.min(baseWaitMs + text.length * perCharMs + punct, maxWaitMs);
}
