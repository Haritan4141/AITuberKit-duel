// Ollama OpenAI 互換チャットエンドポイント呼び出し

import { config } from "./config.mjs";
import { fetchWithTimeout } from "./retry.mjs";

const { url: OLLAMA_URL, fetchTimeoutMs } = config.ollama;

export async function ollamaChat(model, messages, temperature) {
  const res = await fetchWithTimeout(
    OLLAMA_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ model, messages, stream: false, temperature }),
    },
    fetchTimeoutMs
  );

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Ollama HTTP ${res.status}: ${t.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Ollama response missing choices[0].message.content");
  return content;
}
