// ログ出力ユーティリティ。コンソール + JSONL + イベント emitter (SSE 用)。

import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { config } from "./config.mjs";

export const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(100);

function nowStr() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function logLine(tag, msg) {
  const line = `[${nowStr()}] ${tag} ${msg}`;
  console.log(line);
  logEmitter.emit("line", { ts: Date.now(), tag, msg });
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

export function logSay(entry) {
  appendJsonl(jsonlPath(config.log.sayJsonl), { kind: "say", ...entry });
  logEmitter.emit("say", entry);
}

export function logEvent(entry) {
  appendJsonl(jsonlPath(config.log.eventsJsonl), { kind: "event", ...entry });
  logEmitter.emit("event", entry);
}
