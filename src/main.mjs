// エントリーポイント。会話ループ + overlay + YouTube polling を統合。

import { config } from "./config.mjs";
import { logLine } from "./log.mjs";
import { sleep } from "./retry.mjs";
import { startObsOverlayServer } from "./overlay.mjs";
import { startYouTubeLiveChatPolling, stopYouTubeLiveChatPolling } from "./youtube.mjs";
import { runConversation } from "./conversation.mjs";
import { clearRestart, startStallWatch } from "./progress.mjs";

const { streamMode, restartWaitMs, maxRunMs } = config.conversation;

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
  startObsOverlayServer();

  if (config.youtube.videoId) {
    startYouTubeLiveChatPolling(config.youtube.videoId);
  } else {
    console.warn("[YT] YT_VIDEO_ID is missing. Live comments disabled.");
  }

  if (!streamMode) {
    setTimeout(() => {
      logLine("[STOP]", "タイムアウトで終了");
      process.exit(0);
    }, maxRunMs);
  }

  startStallWatch();

  let sessionNo = 1;
  while (true) {
    clearRestart();
    try {
      await runConversation(sessionNo);
      process.exit(0); // 通常終了（streamMode=false で TURNS 消化）
    } catch (e) {
      logLine("[RESTART]", `#${sessionNo} -> ${e?.message ?? e}`);
    }
    sessionNo++;
    await sleep(restartWaitMs);
  }
}

run();
