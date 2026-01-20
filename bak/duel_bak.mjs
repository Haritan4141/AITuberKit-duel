// duel.mjs
// ===== AITuberKit x2 + Ollama : 安定運用版 =====
// 追加: しゃべった内容ログ / 感情・温度ログ / 話題切替ログ / 会話停止の自動再開

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
  temperature: 0.70,

  // ★ 感情キャラ（system prompt 用）
  emotion: "cheerful", // calm / energetic（必要なら増やしてOK）
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
const TURNS = 10;            // ★ 会話の往復回数（増やすと長くなる）
const MAX_CHARS = 160;       // ★ 1発言の最大文字数（短いほど安定）
const CALL_NAME_PROB = 0.2;  // ★ 名前を呼ぶ確率（0.2 = 20%）

// =================================================
// ★ 話題切り替え関連（番組感に直結）
// =================================================
const TOPIC_INTERVAL = 4; // ★ 何ターンごとに話題を変えるか
const TOPICS = [
  "最近ハマっていること",
  "最近見た動画や配信",
  "好きな食べ物の話",
  "ちょっとした日常の失敗談",
  "最近気になっているゲームやアプリ",
  "子どもの頃の思い出",
];

// =================================================
// ★ 読み上げ待ち時間（超重要）
// =================================================
const BASE_WAIT = 1200;    // ★ 発話開始前の準備待ち（ms）
const PER_CHAR = 160;    // ★ 1文字あたりの読み上げ時間（ms）
const MAX_WAIT = 18000;  // ★ 長文でも待ちすぎない上限

// =================================================
// ★ 会話停止の自動再開（ここも調整ポイント）
// =================================================
const STALL_MS = 45_000;        // ★ この時間進捗が無ければ「停止」とみなす
const RESTART_WAIT_MS = 2_000;  // ★ 再開前の待ち（連続再開の暴走防止）
const API_RETRY = 3;            // ★ Ollama/Send のリトライ回数

// =================================================
// ★ 暴走防止（基本触らなくてOK）
// =================================================
const MAX_RUN_MS = 7 * 60 * 1000; // ★ 全体の最大実行時間

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
  const emotionText =
    speaker.emotion === "calm"
      ? "落ち着いていて優しい。安心感のある話し方。"
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
// 会話生成（ログ出力を追加）
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

  // ★ 生成ログ（感情・温度も表示）
  // logLine(
  //   "[GEN]",
  //   `${speakerTag(speaker)} emotion=${speaker.emotion} temp=${speaker.temperature} -> ${out}`
  // );

  return out;
}

// =================================================
// 会話1セッション
// =================================================
async function runConversation(sessionNo) {
  const histA = [{ role: "system", content: "" }];
  const histB = [{ role: "system", content: "" }];

  let topic = pickTopic();
  logLine("[TOPIC]", `#${sessionNo} start: "${topic}"`);

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
    markProgress();
    await sleep(estimateSpeakMs(a));

    last = a;

    // 話題チェンジ
    if (i % TOPIC_INTERVAL === 0) {
      topic = pickTopic();
      logLine("[TOPIC]", `#${sessionNo} turn=${i}: "${topic}"`);

      last = `ところで話題を変えるね。${topic}ってどう？`;

      logLine("[SAY]", `${speakerTag(SPEAKER_A)} (topic change) -> ${last}`);
      await withRetry(
        () => send(SPEAKER_A.aituberBase, SPEAKER_A.clientId, last),
        `Send(${speakerTag(SPEAKER_A)})`
      );
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
