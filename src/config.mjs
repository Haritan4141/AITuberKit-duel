// 設定値の読み込みと再読込み。
// 各モジュールは const { ... } = config.xxx の destructure を使わず、
// 関数呼び出し時に config.section.field を直接読むこと（reloadConfig で値が変わるため）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONFIG_PATH = path.join(ROOT_DIR, "config.json");

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

function readConfigFromDisk() {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  if (raw.conversation?.streamMode) raw.conversation.turns = Infinity;
  raw.youtube = {
    ...raw.youtube,
    apiKey: process.env.YT_API_KEY || "",
    videoId: process.env.YT_VIDEO_ID || raw.youtube?.videoId || "",
  };
  return raw;
}

// config は同一参照を保ったまま中身だけ差し替える（各モジュールが import 済みでも値が反映される）
export const config = {
  ...readConfigFromDisk(),
  paths: {
    rootDir: ROOT_DIR,
    overlayDir: path.join(ROOT_DIR, "overlay"),
    configPath: CONFIG_PATH,
  },
};

export function reloadConfig() {
  const fresh = readConfigFromDisk();
  // paths は固定。それ以外を入れ替え
  const preservedPaths = config.paths;
  for (const k of Object.keys(config)) {
    if (k === "paths") continue;
    delete config[k];
  }
  Object.assign(config, fresh);
  config.paths = preservedPaths;
  return config;
}

// disk に永続化してはいけないキー（secrets / in-memory only）
function stripSecretsAndDerived(cfg) {
  delete cfg.paths;
  if (cfg.youtube) {
    // apiKey は .env (YT_API_KEY) のみ。disk には絶対に書かない（漏洩防止）。
    delete cfg.youtube.apiKey;
  }
  return cfg;
}

export function writeConfigToDisk(newConfig) {
  const bakPath = `${CONFIG_PATH}.bak`;
  try {
    fs.copyFileSync(CONFIG_PATH, bakPath);
  } catch {
    // 元ファイルが無い等は無視
  }
  // streamMode の Infinity をシリアライズ可能な形に戻す
  const serializable = JSON.parse(JSON.stringify(newConfig, (_, v) =>
    v === Infinity ? null : v
  ));
  if (serializable.conversation && serializable.conversation.turns == null) {
    serializable.conversation.turns = 20;
  }
  stripSecretsAndDerived(serializable);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(serializable, null, 2) + "\n", "utf8");
}
