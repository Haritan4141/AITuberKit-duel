// 実行時 state の単一ソース。
// - 進捗監視 (stall 検知)
// - 一時停止 (pause/resume)
// - 話題スキップ要求
// - 再起動要求 (config 変更 / stall)
//
// GUI と会話ループから共有される。

import { EventEmitter } from "node:events";
import { config } from "./config.mjs";
import { logLine } from "./log.mjs";

const state = {
  lastProgressMs: Date.now(),
  restartRequested: false,
  paused: false,
  topicSkipRequested: false,
  running: false, // 会話ループが起動しているか (idle / running の切り替え)
};

export const stateEmitter = new EventEmitter();

export function markProgress() {
  state.lastProgressMs = Date.now();
}

export function requestRestart() {
  state.restartRequested = true;
  stateEmitter.emit("change", { key: "restartRequested", value: true });
}

export function clearRestart() {
  state.restartRequested = false;
  markProgress();
  stateEmitter.emit("change", { key: "restartRequested", value: false });
}

export function isRestartRequested() {
  return state.restartRequested;
}

export function pause() {
  if (state.paused) return;
  state.paused = true;
  logLine("[STATE]", "paused");
  stateEmitter.emit("change", { key: "paused", value: true });
}

export function resume() {
  if (!state.paused) return;
  state.paused = false;
  markProgress();
  logLine("[STATE]", "resumed");
  stateEmitter.emit("change", { key: "paused", value: false });
}

export function isPaused() {
  return state.paused;
}

export async function waitWhilePaused() {
  if (!state.paused) return;
  await new Promise((resolve) => {
    const onChange = (ev) => {
      if (ev.key === "paused" && ev.value === false) {
        stateEmitter.off("change", onChange);
        resolve();
      }
    };
    stateEmitter.on("change", onChange);
  });
}

export function requestTopicSkip() {
  state.topicSkipRequested = true;
  stateEmitter.emit("change", { key: "topicSkipRequested", value: true });
}

export function consumeTopicSkip() {
  if (!state.topicSkipRequested) return false;
  state.topicSkipRequested = false;
  stateEmitter.emit("change", { key: "topicSkipRequested", value: false });
  return true;
}

export function setRunning(v) {
  if (state.running === v) return;
  state.running = v;
  if (v) markProgress();
  logLine("[STATE]", v ? "started" : "stopped");
  stateEmitter.emit("change", { key: "running", value: v });
}

export function isRunning() {
  return state.running;
}

export async function waitUntilRunning() {
  if (state.running) return;
  await new Promise((resolve) => {
    const onChange = (ev) => {
      if (ev.key === "running" && ev.value === true) {
        stateEmitter.off("change", onChange);
        resolve();
      }
    };
    stateEmitter.on("change", onChange);
  });
}

export function getState() {
  return { ...state };
}

export function startStallWatch() {
  const t = setInterval(() => {
    // idle / pause 中は stall 判定を凍結
    if (!state.running || state.paused) {
      state.lastProgressMs = Date.now();
      return;
    }
    const idle = Date.now() - state.lastProgressMs;
    if (idle > config.conversation.stallMs && !state.restartRequested) {
      logLine("[STALL]", `No progress for ${Math.round(idle / 1000)}s -> restart`);
      requestRestart();
    }
  }, 1000);
  t.unref?.();
  return t;
}
