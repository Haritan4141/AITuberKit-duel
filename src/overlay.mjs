// OBS overlay の state とアセット読み込み。HTTP server は src/server.mjs 側。

import fs from "node:fs";
import path from "node:path";
import { config } from "./config.mjs";

const state = {
  topic: "",
  source: "INIT",
  topicTemp: 0,
  sessionNo: 0,
  turn: 0,
  updatedAt: Date.now(),
};

export function getOverlayState() {
  return { ...state };
}

export function setOverlayTopic({ topic, source, topicTemp, sessionNo, turn }) {
  state.topic = String(topic ?? "");
  state.source = String(source ?? "");
  state.topicTemp = Number.isFinite(topicTemp) ? topicTemp : config.topicBrain.temperature;
  state.sessionNo = sessionNo ?? state.sessionNo;
  state.turn = turn ?? state.turn;
  state.updatedAt = Date.now();
}

export function loadOverlayAsset(name) {
  return fs.readFileSync(path.join(config.paths.overlayDir, name), "utf8");
}

export function applyOverlayTemplate(s) {
  const temp = config.topicBrain.temperature;
  return s
    .replace(/__OVERLAY_TITLE__/g, config.overlay.title)
    .replace(/__SHOW_META_STYLE__/g, config.overlay.showMeta ? "" : "display:none;")
    .replace(/__TOPIC_BRAIN_TEMP__/g, String(temp))
    .replace(/__TOPIC_BRAIN_TEMP_FIXED__/g, temp.toFixed(2));
}
