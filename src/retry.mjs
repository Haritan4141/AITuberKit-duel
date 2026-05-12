// リトライラッパ（指数バックオフ）と タイムアウト付き fetch

import { config } from "./config.mjs";
import { logLine } from "./log.mjs";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withRetry(fn, label, tries) {
  const max = tries ?? config.conversation.apiRetry;
  const baseMs = config.conversation.apiRetryBaseMs;
  let lastErr;
  for (let i = 1; i <= max; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      logLine("[WARN]", `${label} failed (${i}/${max}): ${e?.message ?? e}`);
      if (i < max) {
        await sleep(baseMs * Math.pow(2, i - 1));
      }
    }
  }
  throw lastErr;
}

export async function fetchWithTimeout(url, options = {}, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: options.signal ?? controller.signal });
  } finally {
    clearTimeout(t);
  }
}
