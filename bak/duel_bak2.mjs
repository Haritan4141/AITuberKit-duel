// duel.mjs
// ===== AITuberKit x2 + Ollama : 安定運用版 + Topic Brain =====
// 追加: しゃべった内容ログ / 感情・温度ログ / AI話題生成(Topic Brain) / 会話停止の自動再開
//
// ★ よく触る場所は「★」コメントを付けています。

const OLLAMA_URL = "http://127.0.0.1:11434/v1/chat/completions";

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
  ollamaModel: "llama3.1:8b",

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
  ollamaModel: "llama3.1:8b",

  temperature: 0.55,
  emotion: "friendly",
};

// =================================================
// ★ 会話全体のテンポ・長さ調整
// =================================================
const TURNS = 20;            // ★ 会話の往復回数（増やすと長くなる）
const MAX_CHARS = 160;       // ★ 1発言の最大文字数（短いほど安定）
const CALL_NAME_PROB = 0.2;  // ★ 名前を呼ぶ確率（0.2 = 20%）

// =================================================
// ★ 話題切り替え関連（番組感に直結）
// =================================================
const TOPIC_INTERVAL = 4; // ★ 何ターンごとに話題を変えるか

// ★ 旧: 固定トピック（Topic Brain が不調のときの「保険」として残す）

const TOPICS = [
  "最近ハマっていること",
  "最近見た動画や配信",
  "好きな食べ物の話",
  "ちょっとした日常の失敗談",
  "最近気になっているゲームやアプリ",
  "子どもの頃の思い出",
];
// const TOPICS = [
//   "新型トイレが好きな人",
// ];


// =================================================
// ★ Topic Brain（AIに話題を考えさせる）
// =================================================
const TOPIC_BRAIN_ENABLED = true; // ★ true=AIが話題生成 / false=固定TOPICSのみ
const TOPIC_BRAIN_TEMP = 0.9;    // ★★★ ズラし度（高いほど予想外 / 低いほど安定）
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
const BASE_WAIT = 1200;    // ★ 発話開始前の準備待ち（ms）
const PER_CHAR = 160;     // ★ 1文字あたりの読み上げ時間（ms）
const MAX_WAIT = 18000;   // ★ 長文でも待ちすぎない上限

// =================================================
// ★ 会話停止の自動再開（ここも調整ポイント）
// =================================================
const STALL_MS = 45_000;        // ★ この時間進捗が無ければ「停止」とみなす
const RESTART_WAIT_MS = 2_000;  // ★ 再開前の待ち（連続再開の暴走防止）
const API_RETRY = 3;            // ★ Ollama/Send のリトライ回数

// =================================================
// ★ 暴走防止（基本触らなくてOK）
// =================================================
const MAX_RUN_MS = 10 * 60 * 1000; // ★ 全体の最大実行時間

process.on("SIGINT", () => {
  console.log("\n[STOP] Ctrl+C で終了");
  process.exit(0);
});

setTimeout(() => {
  console.log("\n[STOP] タイムアウトで終了");
  process.exit(0);
}, MAX_RUN_MS);

// =================================================
// util
// =================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clip(text) {
  if (!text) return "";
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
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

  return `
あなたは日本語で話すAIです。英語は禁止。
あなたの名前は「${speaker.charName}」、相手は「${speaker.partnerName}」。

感情・雰囲気:
- ${emotionText}

ルール:
- 1〜3文の短い日本語
- ${callRule}
- 最後は必ず質問で終える
- 箇条書き・コード・URLは禁止
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

  history.push({ role: "user", content: input });

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

  history.push({ role: "assistant", content: out });
  markProgress();

  return out;
}

// =================================================
// ★ Topic Brain：AIで「次の話題」を生成（モデルは同じ）
// =================================================
function buildRecentTranscript(turnLog) {
  // 直近N発言だけまとめる
  const lastN = turnLog.slice(-TOPIC_BRAIN_LOOKBACK);
  if (lastN.length === 0) return "";
  return lastN
    .map((t) => `${t.who}: ${oneLine(t.text)}`)
    .join("\n");
}

function isTooSimilarTopic(a, b) {
  a = oneLine(a);
  b = oneLine(b);
  if (!a || !b) return false;
  // 超ざっくり：片方がもう片方を含む、または共通語が多い
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
    {
      role: "user",
      content:
        "次の話題を1つだけ出して。余計な説明は不要。話題だけ。",
    },
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
        () => ollamaChat(speakerForModel.ollamaModel, rewrite, Math.max(0.35, temperature - 0.1)),
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
  // ★ 話題生成に使う speaker（モデル同じなのでどっちでもOK）
  const brainSpeaker = SPEAKER_B;

  if (!TOPIC_BRAIN_ENABLED) {
    const t = pickTopic();
    logLine("[TOPIC]", `#${sessionNo} turn=${turn}: "${t}" (FIXED)`);
    return t;
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
      return t;
    }
  } catch (e) {
    logLine("[WARN]", `TopicBrain error -> fallback: ${e?.message ?? e}`);
  }

  // フォールバック（保険）
  const fb = pickTopic();
  logLine("[TOPIC]", `#${sessionNo} turn=${turn}: "${fb}" (FALLBACK)`);
  return fb;
}

// =================================================
// 会話1セッション
// =================================================
async function runConversation(sessionNo) {
  const histA = [{ role: "system", content: "" }];
  const histB = [{ role: "system", content: "" }];

  // ★ Topic Brain のために「実際に喋ったログ」を貯める（直近だけ使う）
  const turnLog = []; // {who: string, text: string}

  // ★ 話題の履歴（被り回避用）
  const usedTopics = [];

  let topic = pickTopic();
  usedTopics.push(topic);
  logLine("[TOPIC]", `#${sessionNo} start: "${topic}" (INIT)`);

  let last = `じゃあ雑談しよう。${topic}についてどう思う？`;

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
    // B
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

    // A
    const a = await generate(SPEAKER_A, histA, b);
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
      const nextTopic = await decideNextTopic({
        sessionNo,
        turn: i,
        turnLog,
        lastTopic: topic,
        usedTopics,
      });

      topic = nextTopic;
      usedTopics.push(topic);

      // ★ 話題切替の台詞（ここも微調整ポイント）
      last = `話変わるけどいい？${topic}ってどう？`;

      logLine(
        "[SAY]",
        `${speakerTag(SPEAKER_A)} (topic change) emotion=${SPEAKER_A.emotion} temp=${SPEAKER_A.temperature} -> ${last}`
      );
      await withRetry(
        () => send(SPEAKER_A.aituberBase, SPEAKER_A.clientId, last),
        `Send(${speakerTag(SPEAKER_A)})`
      );
      turnLog.push({ who: SPEAKER_A.charName, text: last });
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
      // STALLでも通常エラーでもここに来る
      logLine("[RESTART]", `#${sessionNo} -> ${e?.message ?? e}`);
    }

    sessionNo++;
    await sleep(RESTART_WAIT_MS);
  }
}

run();
