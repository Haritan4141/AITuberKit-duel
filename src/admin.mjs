// GUI 管理画面のための API ハンドラ
// /api/status, /api/config (GET/POST), /api/skip-topic, /api/pause, /api/resume, /api/log/stream

import { config, reloadConfig, writeConfigToDisk } from "./config.mjs";
import { logEmitter, logLine } from "./log.mjs";
import { getOverlayState } from "./overlay.mjs";
import {
  getState,
  isPaused,
  pause,
  requestRestart,
  requestTopicSkip,
  resume,
} from "./state.mjs";
import { getLiveCommentQueueLength } from "./youtube.mjs";

function sendJson(res, status, obj) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(obj));
}

function sendText(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// =================================================
// /api/status
// =================================================
function handleStatus(req, res) {
  const overlay = getOverlayState();
  const state = getState();
  sendJson(res, 200, {
    sessionNo: overlay.sessionNo,
    turn: overlay.turn,
    topic: overlay.topic,
    source: overlay.source,
    topicTemp: overlay.topicTemp,
    overlayUpdatedAt: overlay.updatedAt,
    paused: state.paused,
    restartRequested: state.restartRequested,
    topicSkipRequested: state.topicSkipRequested,
    lastProgressMs: state.lastProgressMs,
    idleSec: Math.round((Date.now() - state.lastProgressMs) / 1000),
    youtubeQueueLen: getLiveCommentQueueLength(),
  });
}

// =================================================
// /api/config GET / POST
// =================================================
function handleGetConfig(req, res) {
  // Infinity は JSON シリアライズで null になる → クライアント側で streamMode を見て判定
  sendJson(res, 200, config);
}

async function handlePostConfig(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    return sendJson(res, 400, { error: e?.message ?? "bad request" });
  }

  // 必須セクションの軽い validation
  const required = ["ollama", "speakers", "conversation", "topicBrain", "overlay", "youtube", "log"];
  for (const k of required) {
    if (typeof body[k] !== "object" || body[k] == null) {
      return sendJson(res, 400, { error: `missing section: ${k}` });
    }
  }
  if (!body.speakers.A || !body.speakers.B) {
    return sendJson(res, 400, { error: "speakers.A and speakers.B are required" });
  }

  try {
    writeConfigToDisk(body);
    reloadConfig();
    logLine("[ADMIN]", "config updated and reloaded -> request restart");
    requestRestart();
    sendJson(res, 200, { ok: true, restarting: true });
  } catch (e) {
    logLine("[ADMIN]", `config save failed: ${e?.message ?? e}`);
    sendJson(res, 500, { error: e?.message ?? "save failed" });
  }
}

// =================================================
// /api/skip-topic /api/pause /api/resume
// =================================================
function handleSkipTopic(req, res) {
  requestTopicSkip();
  logLine("[ADMIN]", "topic skip requested");
  sendJson(res, 200, { ok: true });
}

function handlePause(req, res) {
  pause();
  sendJson(res, 200, { ok: true, paused: true });
}

function handleResume(req, res) {
  resume();
  sendJson(res, 200, { ok: true, paused: false });
}

// =================================================
// /api/log/stream  (SSE)
// =================================================
function handleLogStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    "Connection": "keep-alive",
  });

  const writeEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // 接続維持用 heartbeat
  const hb = setInterval(() => {
    try {
      res.write(": hb\n\n");
    } catch {}
  }, 15000);
  hb.unref?.();

  const onLine = (e) => writeEvent("line", e);
  const onSay = (e) => writeEvent("say", e);
  const onEvent = (e) => writeEvent("event", e);

  logEmitter.on("line", onLine);
  logEmitter.on("say", onSay);
  logEmitter.on("event", onEvent);

  writeEvent("hello", { ts: Date.now() });

  const cleanup = () => {
    clearInterval(hb);
    logEmitter.off("line", onLine);
    logEmitter.off("say", onSay);
    logEmitter.off("event", onEvent);
  };
  req.on("close", cleanup);
  req.on("error", cleanup);
}

// =================================================
// dispatcher
// =================================================
export async function handleApi(req, res, url) {
  const method = req.method || "GET";
  const route = `${method} ${url.pathname}`;

  switch (route) {
    case "GET /api/status":      return handleStatus(req, res);
    case "GET /api/config":      return handleGetConfig(req, res);
    case "POST /api/config":     return handlePostConfig(req, res);
    case "POST /api/skip-topic": return handleSkipTopic(req, res);
    case "POST /api/pause":      return handlePause(req, res);
    case "POST /api/resume":     return handleResume(req, res);
    case "GET /api/log/stream":  return handleLogStream(req, res);
  }

  sendText(res, 404, "Not found");
}
