// リトライラッパ（指数バックオフ）

import { config } from "./config.mjs";
import { logLine } from "./log.mjs";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { apiRetry, apiRetryBaseMs } = config.conversation;

export async function withRetry(fn, label, tries = apiRetry) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      logLine("[WARN]", `${label} failed (${i}/${tries}): ${e?.message ?? e}`);
      if (i < tries) {
        await sleep(apiRetryBaseMs * Math.pow(2, i - 1));
      }
    }
  }
  throw lastErr;
}

// タイムアウト付き fetch（AbortController 経由）
export async function fetchWithTimeout(url, options = {}, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}
