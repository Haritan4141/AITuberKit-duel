// エントリポイント。
// HTTP サーバー + YT polling は常時起動、会話ループは isRunning() に従って待機/起動する。

import { config } from "./config.mjs";
import { logLine } from "./log.mjs";
import { sleep } from "./retry.mjs";
import { startServer } from "./server.mjs";
import { startYouTubeLiveChatPolling, stopYouTubeLiveChatPolling } from "./youtube.mjs";
import { runConversation } from "./conversation.mjs";
import {
  clearRestart,
  setRunning,
  startStallWatch,
  waitUntilRunning,
} from "./state.mjs";

function installSignalHandlers() {
  const onSignal = (sig) => {
    logLine("[STOP]", `${sig} で終了`);
    stopYouTubeLiveChatPolling();
    process.exit(0);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
}

async function run() {
  installSignalHandlers();
  startServer();

  if (config.youtube.videoId) {
    startYouTubeLiveChatPolling(config.youtube.videoId);
  } else {
    console.warn("[YT] YT_VIDEO_ID is missing. Live comments disabled.");
  }

  if (!config.conversation.streamMode) {
    setTimeout(() => {
      logLine("[STOP]", "タイムアウトで終了");
      process.exit(0);
    }, config.conversation.maxRunMs);
  }

  startStallWatch();

  if (config.conversation.autoStart) {
    logLine("[STATE]", "autoStart=true: starting conversation immediately");
    setRunning(true);
  } else {
    logLine("[STATE]", "idle (waiting for /api/start from admin UI)");
  }

  let sessionNo = 1;
  while (true) {
    // running になるまで待機（GUI の Start ボタン or autoStart=true）
    await waitUntilRunning();
    clearRestart();
    try {
      await runConversation(sessionNo);
      // streamMode=false で TURNS 消化 → 通常終了
      if (!config.conversation.streamMode) process.exit(0);
    } catch (e) {
      logLine("[RESTART]", `#${sessionNo} -> ${e?.message ?? e}`);
    }
    sessionNo++;
    await sleep(config.conversation.restartWaitMs);
  }
}

run();
