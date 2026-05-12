// 統合 HTTP サーバー (:8787)
// - /overlay        OBS 用テロップ (既存)
// - /topic          OBS overlay 用 JSON state
// - /admin          管理 UI (新規)
// - /api/*          GUI から呼ぶ制御エンドポイント (新規)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.mjs";
import { logLine } from "./log.mjs";
import {
  getOverlayState,
  loadOverlayAsset,
  applyOverlayTemplate,
} from "./overlay.mjs";
import { handleApi } from "./admin.mjs";

function sendText(res, status, type, body, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": `${type}; charset=utf-8`,
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

function sendJson(res, status, obj) {
  sendText(res, status, "application/json", JSON.stringify(obj));
}

function readStatic(name) {
  return fs.readFileSync(path.join(config.paths.overlayDir, name), "utf8");
}

export function startServer() {
  if (!config.overlay.enabled) return null;

  // overlay 静的アセットは起動時 1 回ロード（template 展開）
  const overlayHtml = applyOverlayTemplate(loadOverlayAsset("overlay.html"));
  const overlayCss = applyOverlayTemplate(loadOverlayAsset("overlay.css"));
  const overlayJs = applyOverlayTemplate(loadOverlayAsset("overlay.js"));

  // admin 静的アセットは都度読込み（編集時の反映を楽にする）
  const adminHtml = () => readStatic("admin.html");
  const adminCss = () => readStatic("admin.css");
  const adminJs = () => readStatic("admin.js");

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${config.overlay.port}`);

      // ---- overlay (既存) ----
      switch (url.pathname) {
        case "/topic":
          return sendJson(res, 200, getOverlayState());
        case "/overlay.css":
          return sendText(res, 200, "text/css", overlayCss);
        case "/overlay.js":
          return sendText(res, 200, "application/javascript", overlayJs);
        case "/overlay":
          return sendText(res, 200, "text/html", overlayHtml);
        case "/":
          res.writeHead(302, { Location: "/overlay" });
          return res.end();
      }

      // ---- admin (新規) ----
      switch (url.pathname) {
        case "/admin":
          return sendText(res, 200, "text/html", adminHtml());
        case "/admin.css":
          return sendText(res, 200, "text/css", adminCss());
        case "/admin.js":
          return sendText(res, 200, "application/javascript", adminJs());
      }

      // ---- API (新規) ----
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(req, res, url);
      }

      sendText(res, 404, "text/plain", "Not found");
    } catch (e) {
      console.error("[server] handler error:", e?.message ?? e);
      try {
        sendText(res, 500, "text/plain", "Server error");
      } catch {}
    }
  });

  server.listen(config.overlay.port, "127.0.0.1", () => {
    logLine("[OBS]", `Topic overlay: http://127.0.0.1:${config.overlay.port}/overlay`);
    logLine("[ADMIN]", `Admin UI:      http://127.0.0.1:${config.overlay.port}/admin`);
  });
  // 注: ここで server.unref() しない。
  // idle 待機モード (waitUntilRunning の Promise) では server が唯一の event loop handle
  // になることがあり、unref すると Node.js が早期 exit してしまう。
  // SIGINT/SIGTERM ハンドラで明示的に process.exit(0) しているので、終了制御は問題ない。

  return server;
}
