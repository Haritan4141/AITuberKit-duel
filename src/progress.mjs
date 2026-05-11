// 進捗監視の単一状態。stall 検知のために markProgress() を各動作の後に呼ぶ。

import { config } from "./config.mjs";
import { logLine } from "./log.mjs";

const state = {
  lastProgressMs: Date.now(),
  restartRequested: false,
};

export function markProgress() {
  state.lastProgressMs = Date.now();
}

export function requestRestart() {
  state.restartRequested = true;
}

export function clearRestart() {
  state.restartRequested = false;
  markProgress();
}

export function isRestartRequested() {
  return state.restartRequested;
}

export function startStallWatch() {
  const t = setInterval(() => {
    const idle = Date.now() - state.lastProgressMs;
    if (idle > config.conversation.stallMs && !state.restartRequested) {
      logLine("[STALL]", `No progress for ${Math.round(idle / 1000)}s -> restart`);
      state.restartRequested = true;
    }
  }, 1000);
  t.unref?.();
  return t;
}
