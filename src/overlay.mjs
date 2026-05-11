// OBS 用「現在の話題」テロップサーバー + state

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.mjs";
import { logLine } from "./log.mjs";

const { enabled: ENABLED, port: PORT, title: TITLE, showMeta: SHOW_META } = config.overlay;
const DEFAULT_TEMP = config.topicBrain.temperature;

const state = {
  topic: "",
  source: "INIT",
  topicTemp: DEFAULT_TEMP,
  sessionNo: 0,
  turn: 0,
  updatedAt: Date.now(),
};

export function getOverlayState() {
  return { ...state };
}

export function setOverlayTopic({ topic, source, topicTemp, sessionNo, turn }) {
  state.topic = String(topic ?? "");
  state.source = String(source ?? "");
  state.topicTemp = Number.isFinite(topicTemp) ? topicTemp : DEFAULT_TEMP;
  state.sessionNo = sessionNo ?? state.sessionNo;
  state.turn = turn ?? state.turn;
  state.updatedAt = Date.now();
}

function loadAsset(name) {
  return fs.readFileSync(path.join(config.paths.overlayDir, name), "utf8");
}

function applyTemplate(s) {
  return s
    .replace(/__OVERLAY_TITLE__/g, TITLE)
    .replace(/__SHOW_META_STYLE__/g, SHOW_META ? "" : "display:none;")
    .replace(/__TOPIC_BRAIN_TEMP__/g, String(DEFAULT_TEMP))
    .replace(/__TOPIC_BRAIN_TEMP_FIXED__/g, DEFAULT_TEMP.toFixed(2));
}

export function startObsOverlayServer() {
  if (!ENABLED) return null;

  const overlayHtml = applyTemplate(loadAsset("overlay.html"));
  const overlayCss = applyTemplate(loadAsset("overlay.css"));
  const overlayJs = applyTemplate(loadAsset("overlay.js"));

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
      const send = (status, type, body) => {
        res.writeHead(status, {
          "Content-Type": `${type}; charset=utf-8`,
          "Cache-Control": "no-store",
        });
        res.end(body);
      };

      switch (url.pathname) {
        case "/topic":
          return send(200, "application/json", JSON.stringify(state));
        case "/overlay.css":
          return send(200, "text/css", overlayCss);
        case "/overlay.js":
          return send(200, "application/javascript", overlayJs);
        case "/overlay":
          return send(200, "text/html", overlayHtml);
        case "/":
          res.writeHead(302, { Location: "/overlay" });
          return res.end();
        default:
          return send(404, "text/plain", "Not found");
      }
    } catch (e) {
      console.error("[OBS] handler error:", e?.message ?? e);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Server error");
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    logLine("[OBS]", `Topic overlay: http://127.0.0.1:${PORT}/overlay`);
  });
  server.unref?.();

  return server;
}
