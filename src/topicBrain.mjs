// 話題生成。AI による Topic Brain + 固定フォールバック。

import { config } from "./config.mjs";
import { logLine } from "./log.mjs";
import { withRetry } from "./retry.mjs";
import { ollamaChat } from "./ollama.mjs";
import { oneLine, stripLeadingEmotionTag, isJapanese } from "./text.mjs";

export function getTopicBrainTemp() {
  return config.topicBrain.temperature;
}

export function pickTopic() {
  const list = config.topicBrain.fallbackTopics;
  return list[Math.floor(Math.random() * list.length)];
}

export function softClipTopic(s) {
  s = oneLine(s);
  s = s.replace(/^["'「『（(【\[]+/, "").replace(/["'」』）)】\]]+$/, "");
  s = s.replace(/[。！？!?]+$/g, "");
  const max = config.topicBrain.maxChars;
  if (s.length > max) s = s.slice(0, max);
  return s;
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
  return common >= 2;
}

let _lastTopicBy = "B";
export function pickTopicOwner() {
  const mode = config.topicBrain.changeBy.mode;
  if (mode === "alternate") {
    _lastTopicBy = _lastTopicBy === "A" ? "B" : "A";
    return _lastTopicBy;
  }
  return Math.random() < config.topicBrain.changeBy.aWeight ? "A" : "B";
}

function buildRecentTranscript(turnLog) {
  const lookback = config.topicBrain.lookback;
  const lastN = turnLog.slice(-lookback);
  if (lastN.length === 0) return "";
  return lastN.map((t) => `${t.who}: ${oneLine(stripLeadingEmotionTag(t.text))}`).join("\n");
}

async function topicBrain({ speakerForModel, recentTranscript, lastTopic, usedTopics, temperature }) {
  const system = `
あなたは会話を活性化させる「話題生成AI」です。人格は演じません。
日本語のみ。出力は「話題」1つだけ（1行）にしてください。

条件:
- 直近の会話と少し関係はあるが、少しだけ意外性（ズラし）を入れる
- 雑談向き（軽いテーマ）
- 重い話（政治/事件/暴力/差別/自傷/露骨な性的話題）は避ける
- 話題は短く（${config.topicBrain.maxChars}文字以内が理想）
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
    `TopicBrain(${speakerForModel.charName})`
  );
  raw = softClipTopic(raw);

  if (!isJapanese(raw)) {
    const rewrite = [
      { role: "system", content: system },
      { role: "user", content: "英語は禁止。日本語の話題だけを1つ、短く出して。" },
    ];
    raw = softClipTopic(
      await withRetry(
        () => ollamaChat(speakerForModel.ollamaModel, rewrite, Math.max(0.35, temperature - 0.1)),
        `TopicBrain(rewrite:${speakerForModel.charName})`
      )
    );
  }

  const avoid = config.topicBrain.repeatAvoid;
  for (let i = Math.max(0, usedTopics.length - avoid); i < usedTopics.length; i++) {
    if (isTooSimilarTopic(raw, usedTopics[i])) return "";
  }
  if (isTooSimilarTopic(raw, lastTopic)) return "";
  if (!raw) return "";

  return raw;
}

export async function decideNextTopic({ sessionNo, turn, turnLog, lastTopic, usedTopics }) {
  const temp = config.topicBrain.temperature;
  const brainSpeaker = config.speakers.B;

  if (!config.topicBrain.enabled) {
    const t = pickTopic();
    logLine("[TOPIC]", `#${sessionNo} turn=${turn}: "${t}" (FIXED)`);
    return { topic: t, source: "FIXED", topicTemp: temp };
  }

  const transcript = buildRecentTranscript(turnLog);
  try {
    const t = await topicBrain({
      speakerForModel: brainSpeaker,
      recentTranscript: transcript,
      lastTopic,
      usedTopics,
      temperature: temp,
    });
    if (t) {
      logLine("[TOPIC]", `#${sessionNo} turn=${turn}: "${t}" (BRAIN temp=${temp})`);
      return { topic: t, source: "BRAIN", topicTemp: temp };
    }
  } catch (e) {
    logLine("[WARN]", `TopicBrain error -> fallback: ${e?.message ?? e}`);
  }

  const fb = pickTopic();
  logLine("[TOPIC]", `#${sessionNo} turn=${turn}: "${fb}" (FALLBACK)`);
  return { topic: fb, source: "FALLBACK", topicTemp: temp };
}
