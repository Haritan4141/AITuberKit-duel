// エントリポイント。会話ループ + overlay + YouTube polling を統合。

import { config } from "./config.mjs";
import { logLine } from "./log.mjs";
import { sleep } from "./retry.mjs";
import { startServer } from "./server.mjs";
import { startYouTubeLiveChatPolling, stopYouTubeLiveChatPolling } from "./youtube.mjs";
import { runConversation } from "./conversation.mjs";
import { clearRestart, startStallWatch } from "./state.mjs";

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

  let sessionNo = 1;
  while (true) {
    clearRestart();
    try {
      await runConversation(sessionNo);
      process.exit(0); // streamMode=false で TURNS 消化したときの通常終了
    } catch (e) {
      logLine("[RESTART]", `#${sessionNo} -> ${e?.message ?? e}`);
    }
    sessionNo++;
    await sleep(config.conversation.restartWaitMs);
  }
}

run();
