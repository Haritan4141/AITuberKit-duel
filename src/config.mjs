// 設定値の読み込み。config.json + .env の YT_API_KEY をマージして返す。
// 起動時に 1 度だけ評価される想定。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (!key) continue;
    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

loadEnvFile(path.join(ROOT_DIR, ".env"));

const configPath = path.join(ROOT_DIR, "config.json");
const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

if (rawConfig.conversation.streamMode) {
  rawConfig.conversation.turns = Infinity;
}

export const config = Object.freeze({
  ...rawConfig,
  paths: {
    rootDir: ROOT_DIR,
    overlayDir: path.join(ROOT_DIR, "overlay"),
  },
  youtube: {
    ...rawConfig.youtube,
    apiKey: process.env.YT_API_KEY || "",
    videoId: process.env.YT_VIDEO_ID || rawConfig.youtube.videoId || "",
  },
});

export const SPEAKER_A = config.speakers.A;
export const SPEAKER_B = config.speakers.B;
