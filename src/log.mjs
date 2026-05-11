// ログ出力ユーティリティ。コンソール + JSONL。

import fs from "node:fs";
import path from "node:path";
import { config } from "./config.mjs";

function nowStr() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function logLine(tag, msg) {
  console.log(`[${nowStr()}] ${tag} ${msg}`);
}

function jsonlPath(name) {
  return name ? path.join(config.paths.rootDir, name) : null;
}

function appendJsonl(filePath, obj) {
  if (!filePath || !config.log.enabled) return;
  try {
    fs.appendFileSync(filePath, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n", "utf8");
  } catch {
    // ログ失敗は会話を止めない
  }
}

const SAY_PATH = jsonlPath(config.log.sayJsonl);
const EVENTS_PATH = jsonlPath(config.log.eventsJsonl);

export function logSay(entry) {
  appendJsonl(SAY_PATH, { kind: "say", ...entry });
}

export function logEvent(entry) {
  appendJsonl(EVENTS_PATH, { kind: "event", ...entry });
}
