// AITuberKit の direct_send エンドポイント呼び出し

import { config } from "./config.mjs";
import { fetchWithTimeout } from "./retry.mjs";

export async function send(base, clientId, text) {
  const res = await fetchWithTimeout(
    `${base}/api/messages/?clientId=${clientId}&type=direct_send`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ messages: [text] }),
    },
    config.ollama.fetchTimeoutMs
  );

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`AITuberKit send HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
}
