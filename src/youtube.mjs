// YouTube Live Chat polling とコメントキュー

import { config } from "./config.mjs";
import { logLine } from "./log.mjs";
import { sleep, fetchWithTimeout } from "./retry.mjs";
import { sanitizeChatText } from "./text.mjs";

const YT_API_BASE = "https://www.googleapis.com/youtube/v3";
const {
  apiKey: YT_API_KEY,
  debug: YT_DEBUG,
  commentInsertRate: COMMENT_INSERT_RATE,
  commentQueueMax: COMMENT_QUEUE_MAX,
  pollIntervalMs: YT_POLL_INTERVAL_MS,
  seenIdsMax: SEEN_IDS_MAX,
} = config.youtube;

const liveCommentQueue = [];
const seenCommentIds = new Set();
let lastInjectedComment = "";

const abortController = new AbortController();
const aborted = () => abortController.signal.aborted;

async function ytGetActiveLiveChatId(videoId) {
  const url = new URL(`${YT_API_BASE}/videos`);
  url.searchParams.set("part", "liveStreamingDetails");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", YT_API_KEY);

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
  url.searchParams.set("key", YT_API_KEY);
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const res = await fetchWithTimeout(url, { signal: abortController.signal }, 15000);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`YT liveChatMessages.list failed: ${res.status} ${t.slice(0, 200)}`);
  }
  return await res.json();
}

function trimSeenSet() {
  // SEEN_IDS_MAX を超えたら古い順に間引く（FIFO）
  if (seenCommentIds.size <= SEEN_IDS_MAX) return;
  const drop = seenCommentIds.size - SEEN_IDS_MAX;
  const iter = seenCommentIds.values();
  for (let i = 0; i < drop; i++) {
    const v = iter.next().value;
    if (v == null) break;
    seenCommentIds.delete(v);
  }
}

// abortController.signal が立ったら早めに抜ける sleep
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
  console.log("[YT] key loaded:", !!YT_API_KEY, "len=", (YT_API_KEY || "").length);
  if (!YT_API_KEY) {
    console.warn("[YT] YT_API_KEY is missing. Live comments disabled.");
    return;
  }
  if (!videoId) {
    console.warn("[YT] YT_VIDEO_ID is missing. Live comments disabled.");
    return;
  }

  if (YT_DEBUG) console.log("[YT] polling start. videoId:", videoId);

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

  // ウォームアップ：過去ログは捨て「今」から拾う
  let nextPageToken = null;
  try {
    const warm = await ytListLiveChatMessages(liveChatId, null);
    nextPageToken = warm?.nextPageToken || null;
    const warmWaitMs = Math.max(1000, Number(warm?.pollingIntervalMillis || 5000));
    if (YT_DEBUG) {
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

    if (YT_DEBUG) {
      console.log(
        `[YT] polled: items=${items.length} queue=${liveCommentQueue.length} wait=${YT_POLL_INTERVAL_MS}ms tokenChanged=${prevToken !== nextPageToken}`
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
      if (liveCommentQueue.length > COMMENT_QUEUE_MAX) liveCommentQueue.shift();
      added++;

      if (YT_DEBUG && added === 1) {
        const author = it?.authorDetails?.displayName || "unknown";
        console.log(`[YT] new: ${author}: ${text}`);
      }
    }

    if (YT_DEBUG) console.log(`[YT] added=${added} queue=${liveCommentQueue.length}`);

    trimSeenSet();
    await abortableSleep(YT_POLL_INTERVAL_MS);
  }

  if (YT_DEBUG) console.log("[YT] polling stopped.");
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

export const COMMENT_INSERT_RATE_VALUE = COMMENT_INSERT_RATE;
