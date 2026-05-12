// 会話 1 セッション。Topic Brain と OBS overlay、コメント注入を結線する。

import { config } from "./config.mjs";
import { logLine, logSay, logEvent } from "./log.mjs";
import { sleep, withRetry } from "./retry.mjs";
import { ollamaChat } from "./ollama.mjs";
import { send } from "./aituber.mjs";
import {
  EMO_SET,
  clipTagged,
  estimateSpeakMs,
  fallbackEmotionForSpeaker,
  isJapanese,
  normalizeEmotionTagged,
  normalizeEndingTagged,
  normalizeStarterTagged,
  stripLeadingEmotionTag,
} from "./text.mjs";
import {
  decideNextTopic,
  getTopicBrainTemp,
  pickTopic,
  pickTopicOwner,
} from "./topicBrain.mjs";
import { setOverlayTopic } from "./overlay.mjs";
import { popLiveCommentDedup } from "./youtube.mjs";
import {
  consumeTopicSkip,
  isPaused,
  isRestartRequested,
  isRunning,
  markProgress,
  waitWhilePaused,
} from "./state.mjs";

function speakerTag(s) {
  return `${s.charName}(${s.id})`;
}

export function speakerById(id) {
  return id === "B" ? config.speakers.B : config.speakers.A;
}

const shouldCallName = () => Math.random() < config.conversation.callNameProb;

function softResetHistory(history) {
  const keepMsgs = config.conversation.historyKeepTurns * 2;
  const extra = Math.max(0, history.length - 1 - keepMsgs);
  if (extra > 0) history.splice(1, extra);
}

function pushBounded(arr, max, item) {
  arr.push(item);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

// =================================================
// システムプロンプト
// =================================================
function makeSystemPrompt(speaker, callName) {
  const emotionText =
    speaker.emotion === "calm"
      ? "落ち着いていて優しい。安心感のある話し方。"
      : speaker.emotion === "friendly"
      ? "親しみやすく、相手に寄り添う。柔らかい相づち。"
      : "元気で感情豊か。リアクション多め。";

  const callRule = callName
    ? `今回は相手の名前「${speaker.partnerName}」を自然に1回だけ呼ぶ。`
    : `今回は相手の名前を呼ばない。`;

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
- 行頭に感情タグを1つだけ付ける：${EMO_SET.map((e) => `[${e}]`).join(" ")}
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
- 直前の相手の文をそのまま繰り返したり引用しない。
- 毎回、具体例を1つ入れる。
- 返答の最後に短い質問を1つ入れて会話を前に進める。
- 抽象的な同意で終わらず、必ず新情報（例・具体）を1つ追加する。
`;
}

// =================================================
// 1 発話生成
// =================================================
async function generate(speaker, history, input) {
  const callName = shouldCallName();
  history[0] = { role: "system", content: makeSystemPrompt(speaker, callName) };
  history.push({ role: "user", content: stripLeadingEmotionTag(input) });

  let out = clipTagged(
    await withRetry(
      () => ollamaChat(speaker.ollamaModel, history, speaker.temperature),
      `Ollama(${speakerTag(speaker)})`
    )
  );

  if (!isJapanese(out)) {
    history.push({
      role: "user",
      content: "英語は禁止。日本語だけで、同じ内容を短く言い直して。",
    });
    out = clipTagged(
      await withRetry(
        () => ollamaChat(speaker.ollamaModel, history, speaker.temperature),
        `Ollama(rewrite:${speakerTag(speaker)})`
      )
    );
  }

  out = normalizeEmotionTagged(out, fallbackEmotionForSpeaker(speaker));
  out = normalizeStarterTagged(out);
  out = normalizeEndingTagged(out);

  history.push({ role: "assistant", content: stripLeadingEmotionTag(out) });
  markProgress();
  return out;
}

// =================================================
// コメント注入
// =================================================
function maybeInjectLiveComment(defaultLine, overlayContext) {
  if (Math.random() >= config.youtube.commentInsertRate) return defaultLine;
  const c = popLiveCommentDedup();
  if (!c) return defaultLine;

  if (overlayContext) {
    setOverlayTopic({
      topic: `コメント: ${c}`,
      source: "Youtube Comment",
      topicTemp: getTopicBrainTemp(),
      sessionNo: overlayContext.sessionNo,
      turn: overlayContext.turn,
    });
  }

  const templates = [
    `[neutral]コメントで「${c}」って流れてたけど、どう思う？`,
    `[neutral]今のコメントに「${c}」ってあったよ。どう感じた？`,
    `[neutral]視聴者コメントで「${c}」って来てたよ。どう答える？`,
    `[neutral]コメントで${c}って話題が出てた。これどう思う？`,
    `[neutral]今コメントで「${c}」って来てた。ちょっと触れてみる？`,
  ];
  const line = templates[Math.floor(Math.random() * templates.length)];
  return clipTagged(line);
}

// =================================================
// 開幕台詞
// =================================================
const OPENING_LINES = [
  (topic) => `[neutral]それじゃあおはなししよう。${topic}についてどう思う？`,
  (topic) => `[happy]今日は${topic}の話からいこっか。何かある？`,
  (topic) => `[relaxed]さっそくだけど、${topic}ってどう？`,
  (topic) => `[neutral]最初の話題は${topic}。気になることある？`,
  (topic) => `[happy]じゃあ${topic}から始めようか。どう思う？`,
];

function pickOpeningLine(topic) {
  return OPENING_LINES[Math.floor(Math.random() * OPENING_LINES.length)](topic);
}

// =================================================
// 話題切替の台詞
// =================================================
function pickTopicChangeLine(topic) {
  const lines = [
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
  return lines[Math.floor(Math.random() * lines.length)];
}

// =================================================
// 1 セッション
// =================================================
export async function runConversation(sessionNo) {
  const SPEAKER_A = config.speakers.A;
  const SPEAKER_B = config.speakers.B;
  const TURN_LOG_MAX = config.topicBrain.turnLogMax;
  const USED_TOPICS_MAX = config.topicBrain.usedTopicsMax;
  const TOPIC_INTERVAL = config.conversation.topicInterval;
  const TURNS = config.conversation.turns;

  const histA = [{ role: "system", content: "" }];
  const histB = [{ role: "system", content: "" }];
  let skipNextB = false;

  const turnLog = [];
  const usedTopics = [];

  let topic = pickTopic();
  pushBounded(usedTopics, USED_TOPICS_MAX, topic);
  logLine("[TOPIC]", `#${sessionNo} start: "${topic}" (INIT)`);
  setOverlayTopic({ topic, source: "INIT", topicTemp: getTopicBrainTemp(), sessionNo, turn: 0 });
  logEvent({ sessionNo, turn: 0, kind: "topic", topic, source: "INIT" });

  let last = pickOpeningLine(topic);

  logLine(
    "[SAY]",
    `${speakerTag(SPEAKER_A)} emotion=${SPEAKER_A.emotion} temp=${SPEAKER_A.temperature} -> ${last}`
  );
  await withRetry(
    () => send(SPEAKER_A.aituberBase, SPEAKER_A.clientId, last),
    `Send(${speakerTag(SPEAKER_A)})`
  );
  pushBounded(turnLog, TURN_LOG_MAX, { who: SPEAKER_A.charName, text: last });
  logSay({ sessionNo, turn: 0, who: SPEAKER_A.charName, speaker: SPEAKER_A.id, text: last });
  markProgress();
  await sleep(estimateSpeakMs(last));

  for (let i = 1; i <= TURNS; i++) {
    if (!isRunning()) throw new Error("STOPPED");
    if (isPaused()) await waitWhilePaused();
    softResetHistory(histA);
    softResetHistory(histB);

    let inputForA = last;

    // B の発話
    if (skipNextB) {
      skipNextB = false;
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
      pushBounded(turnLog, TURN_LOG_MAX, { who: SPEAKER_B.charName, text: b });
      logSay({ sessionNo, turn: i, who: SPEAKER_B.charName, speaker: SPEAKER_B.id, text: b });
      markProgress();
      await sleep(estimateSpeakMs(b));
      last = b;
      inputForA = b;
    }

    if (isPaused()) await waitWhilePaused();

    // A の発話
    const a = await generate(SPEAKER_A, histA, inputForA);
    logLine(
      "[SAY]",
      `${speakerTag(SPEAKER_A)} emotion=${SPEAKER_A.emotion} temp=${SPEAKER_A.temperature} -> ${a}`
    );
    await withRetry(
      () => send(SPEAKER_A.aituberBase, SPEAKER_A.clientId, a),
      `Send(${speakerTag(SPEAKER_A)})`
    );
    pushBounded(turnLog, TURN_LOG_MAX, { who: SPEAKER_A.charName, text: a });
    logSay({ sessionNo, turn: i, who: SPEAKER_A.charName, speaker: SPEAKER_A.id, text: a });
    markProgress();
    await sleep(estimateSpeakMs(a));
    last = a;

    // 話題切替: 通常はターン経過、または GUI からの skip 要求
    const topicSkip = consumeTopicSkip();
    if (topicSkip || i % TOPIC_INTERVAL === 0) {
      const next = await decideNextTopic({
        sessionNo,
        turn: i,
        turnLog,
        lastTopic: topic,
        usedTopics,
      });

      topic = next.topic;
      pushBounded(usedTopics, USED_TOPICS_MAX, topic);
      setOverlayTopic({ topic, source: next.source, topicTemp: next.topicTemp, sessionNo, turn: i });
      logEvent({ sessionNo, turn: i, kind: "topic", topic, source: next.source, skipped: topicSkip });

      last = `[neutral]${pickTopicChangeLine(topic)}`;
      last = maybeInjectLiveComment(last, { sessionNo, turn: i });
      last = normalizeEmotionTagged(last, "neutral");
      last = clipTagged(last);

      const ownerId = pickTopicOwner();
      const owner = speakerById(ownerId);

      logLine(
        "[SAY]",
        `${speakerTag(owner)} (topic change) emotion=${owner.emotion} temp=${owner.temperature} -> ${last}`
      );
      await withRetry(
        () => send(owner.aituberBase, owner.clientId, last),
        `Send(${speakerTag(owner)})`
      );
      pushBounded(turnLog, TURN_LOG_MAX, { who: owner.charName, text: last });
      logSay({ sessionNo, turn: i, who: owner.charName, speaker: owner.id, text: last, kind: "topic_change" });

      if (ownerId === "B") skipNextB = true;
      markProgress();
      await sleep(estimateSpeakMs(last));
    }

    if (isRestartRequested()) throw new Error("STALL_RESTART");
  }

  logLine("[END]", `#${sessionNo} conversation finished`);
}
