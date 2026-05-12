// YouTube Live Chat polling とコメントキュー

import { config } from "./config.mjs";
import { fetchWithTimeout } from "./retry.mjs";
import { sanitizeChatText } from "./text.mjs";

const YT_API_BASE = "https://www.googleapis.com/youtube/v3";

const liveCommentQueue = [];
const seenCommentIds = new Set();
let lastInjectedComment = "";

const abortController = new AbortController();
const aborted = () => abortController.signal.aborted;

async function ytGetActiveLiveChatId(videoId) {
  const url = new URL(`${YT_API_BASE}/videos`);
  url.searchParams.set("part", "liveStreamingDetails");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", config.youtube.apiKey);

  const res = await fetchWithTimeout(url, { signal: abortController.signal }, 15000);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`YT videos.list failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
}

async function ytListLiveChatMessages(liveChatId, pageToken) {
  const url = new URL(`${YT_API_BASE}/liveChat/messages`);
  url.searchParams.set("liveChatId", liveChatId);
  url.searchParams.set("part", "snippet,authorDetails");
  url.searchParams.set("maxResults", "200");
  url.searchParams.set("key", config.youtube.apiKey);
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const res = await fetchWithTimeout(url, { signal: abortController.signal }, 15000);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`YT liveChatMessages.list failed: ${res.status} ${t.slice(0, 200)}`);
  }
  return await res.json();
}

function trimSeenSet() {
  const max = config.youtube.seenIdsMax;
  if (seenCommentIds.size <= max) return;
  const drop = seenCommentIds.size - max;
  const iter = seenCommentIds.values();
  for (let i = 0; i < drop; i++) {
    const v = iter.next().value;
    if (v == null) break;
    seenCommentIds.delete(v);
  }
}

async function abortableSleep(ms) {
  if (aborted()) return;
  await new Promise((resolve) => {
    const t = setTimeout(() => {
      abortController.signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    abortController.signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function startYouTubeLiveChatPolling(videoId) {
  const apiKey = config.youtube.apiKey;
  const debug = config.youtube.debug;
  console.log("[YT] key loaded:", !!apiKey, "len=", (apiKey || "").length);
  if (!apiKey) {
    console.warn("[YT] YT_API_KEY is missing. Live comments disabled.");
    return;
  }
  if (!videoId) {
    console.warn("[YT] YT_VIDEO_ID is missing. Live comments disabled.");
    return;
  }

  if (debug) console.log("[YT] polling start. videoId:", videoId);

  let liveChatId;
  try {
    liveChatId = await ytGetActiveLiveChatId(videoId);
  } catch (e) {
    console.warn("[YT] activeLiveChatId fetch failed:", e?.message || e);
    return;
  }
  if (!liveChatId) {
    console.warn("[YT] activeLiveChatId not found. Stream may be offline or chat disabled.");
    return;
  }

  console.log("[YT] liveChatId:", liveChatId);

  let nextPageToken = null;
  try {
    const warm = await ytListLiveChatMessages(liveChatId, null);
    nextPageToken = warm?.nextPageToken || null;
    const warmWaitMs = Math.max(1000, Number(warm?.pollingIntervalMillis || 5000));
    if (debug) {
      const n = Array.isArray(warm?.items) ? warm.items.length : 0;
      console.log(`[YT] warmup: skipped items=${n} tokenReady=${!!nextPageToken} wait=${warmWaitMs}ms`);
    }
    await abortableSleep(warmWaitMs);
  } catch (e) {
    console.warn("[YT] warmup failed:", e?.message || e);
  }

  while (!aborted()) {
    let data;
    try {
      data = await ytListLiveChatMessages(liveChatId, nextPageToken);
    } catch (e) {
      if (aborted()) break;
      console.warn("[YT] polling error:", e?.message || e);
      await abortableSleep(30_000);
      continue;
    }

    const prevToken = nextPageToken;
    nextPageToken = data?.nextPageToken || nextPageToken;
    const items = Array.isArray(data?.items) ? data.items : [];

    if (debug) {
      console.log(
        `[YT] polled: items=${items.length} queue=${liveCommentQueue.length} wait=${config.youtube.pollIntervalMs}ms tokenChanged=${prevToken !== nextPageToken}`
      );
    }

    let added = 0;
    for (const it of items) {
      const id = it?.id;
      if (!id || seenCommentIds.has(id)) continue;
      seenCommentIds.add(id);

      const text = sanitizeChatText(it?.snippet?.displayMessage || "");
      if (!text) continue;

      liveCommentQueue.push(text);
      if (liveCommentQueue.length > config.youtube.commentQueueMax) liveCommentQueue.shift();
      added++;

      if (debug && added === 1) {
        const author = it?.authorDetails?.displayName || "unknown";
        console.log(`[YT] new: ${author}: ${text}`);
      }
    }

    if (debug) console.log(`[YT] added=${added} queue=${liveCommentQueue.length}`);

    trimSeenSet();
    await abortableSleep(config.youtube.pollIntervalMs);
  }

  if (debug) console.log("[YT] polling stopped.");
}

export function stopYouTubeLiveChatPolling() {
  abortController.abort();
}

export function popLiveCommentDedup() {
  while (liveCommentQueue.length) {
    const c = liveCommentQueue.shift();
    if (c && c !== lastInjectedComment) {
      lastInjectedComment = c;
      return c;
    }
  }
  return null;
}

export function getLiveCommentQueueLength() {
  return liveCommentQueue.length;
}
