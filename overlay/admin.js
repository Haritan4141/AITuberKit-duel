// Admin UI front-end
// - 1s polling: /api/status
// - SSE:        /api/log/stream
// - 設定編集:   GET /api/config を textarea に流し込み、POST で保存

const $ = (id) => document.getElementById(id);

const els = {
  statePill: $("statePill"),
  sessionNo: $("sessionNo"),
  turn: $("turn"),
  idle: $("idle"),
  yt: $("yt"),
  topicTemp: $("topicTemp"),
  topic: $("topic"),
  source: $("source"),

  btnStart: $("btnStart"),
  btnStop: $("btnStop"),
  btnSkip: $("btnSkip"),
  btnPause: $("btnPause"),
  btnResume: $("btnResume"),
  btnRestart: $("btnRestart"),
  ctrlMsg: $("ctrlMsg"),

  configEditor: $("configEditor"),
  btnLoadConfig: $("btnLoadConfig"),
  btnSaveConfig: $("btnSaveConfig"),
  saveResult: $("saveResult"),

  logView: $("logView"),
  logAutoScroll: $("logAutoScroll"),
  logShowLine: $("logShowLine"),
  logShowSay: $("logShowSay"),
  logShowEvent: $("logShowEvent"),
  btnLogClear: $("btnLogClear"),
};

// =================================================
// Status polling
// =================================================
let lastStatus = null;
let restartCountdown = 0;

async function fetchStatus() {
  try {
    const r = await fetch("/api/status", { cache: "no-store" });
    if (!r.ok) throw new Error(`status ${r.status}`);
    const s = await r.json();
    applyStatus(s);
  } catch (e) {
    setStatePill("offline", "offline");
  }
}

function setStatePill(cls, label) {
  els.statePill.className = `pill ${cls}`;
  els.statePill.textContent = label;
}

function applyStatus(s) {
  // 状態 pill: idle / running / paused / restarting
  if (!s.running) {
    setStatePill("idle", "idle");
  } else if (s.restartRequested || restartCountdown > 0) {
    setStatePill("restarting", "restarting");
    restartCountdown = Math.max(0, restartCountdown - 1);
  } else if (s.paused) {
    setStatePill("paused", "paused");
  } else {
    setStatePill("running", "running");
  }

  els.sessionNo.textContent = s.sessionNo ?? "-";
  els.turn.textContent = s.turn ?? "-";
  els.idle.textContent = s.idleSec ?? "-";
  els.yt.textContent = s.youtubeQueueLen ?? "-";
  els.topicTemp.textContent = (s.topicTemp ?? 0).toFixed(2);
  els.topic.textContent = s.topic || "-";
  els.source.textContent = s.source ? `(${s.source})` : "";

  // ボタンの有効/無効
  els.btnStart.disabled = !!s.running;
  els.btnStop.disabled = !s.running;
  els.btnSkip.disabled = !s.running;
  els.btnPause.disabled = !s.running || !!s.paused;
  els.btnResume.disabled = !s.running || !s.paused;

  lastStatus = s;
}

setInterval(fetchStatus, 1000);
fetchStatus();

// =================================================
// Control buttons
// =================================================
async function call(path, opts = {}) {
  const r = await fetch(path, { method: "POST", ...opts });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${path} -> ${r.status} ${t}`);
  }
  return r.json().catch(() => ({}));
}

function flashMsg(el, text, cls = "") {
  el.textContent = text;
  el.className = cls;
  setTimeout(() => { if (el.textContent === text) el.textContent = ""; }, 4000);
}

els.btnStart.addEventListener("click", async () => {
  try { await call("/api/start"); flashMsg(els.ctrlMsg, "started"); }
  catch (e) { flashMsg(els.ctrlMsg, e.message, "err"); }
});
els.btnStop.addEventListener("click", async () => {
  try { await call("/api/stop"); flashMsg(els.ctrlMsg, "stopped (current turn will finish first)"); }
  catch (e) { flashMsg(els.ctrlMsg, e.message, "err"); }
});
els.btnSkip.addEventListener("click", async () => {
  try { await call("/api/skip-topic"); flashMsg(els.ctrlMsg, "skip requested"); }
  catch (e) { flashMsg(els.ctrlMsg, e.message, "err"); }
});
els.btnPause.addEventListener("click", async () => {
  try { await call("/api/pause"); flashMsg(els.ctrlMsg, "paused"); }
  catch (e) { flashMsg(els.ctrlMsg, e.message, "err"); }
});
els.btnResume.addEventListener("click", async () => {
  try { await call("/api/resume"); flashMsg(els.ctrlMsg, "resumed"); }
  catch (e) { flashMsg(els.ctrlMsg, e.message, "err"); }
});
els.btnRestart.addEventListener("click", async () => {
  if (!confirm("会話セッションを再起動しますか？ (history はリセットされます)")) return;
  try {
    // skip 経由ではなく、設定変更と同じパスで restart シグナルを立てる方法は別途必要。
    // 当面は POST /api/config に現在の設定を再送して reload + restart させる。
    const cur = await fetch("/api/config", { cache: "no-store" }).then(r => r.json());
    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cur),
    });
    restartCountdown = 5;
    flashMsg(els.ctrlMsg, "restart requested");
  } catch (e) {
    flashMsg(els.ctrlMsg, e.message, "err");
  }
});

// =================================================
// Config editor
// =================================================
async function loadConfigToEditor() {
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    const text = await r.text();
    // 整形（pretty-print）
    try {
      els.configEditor.value = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      els.configEditor.value = text;
    }
    flashMsg(els.saveResult, "loaded", "ok");
  } catch (e) {
    flashMsg(els.saveResult, e.message, "err");
  }
}

async function saveConfigFromEditor() {
  let parsed;
  try {
    parsed = JSON.parse(els.configEditor.value);
  } catch (e) {
    return flashMsg(els.saveResult, `JSON parse error: ${e.message}`, "err");
  }
  try {
    const r = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    restartCountdown = 5;
    flashMsg(els.saveResult, "saved (restarting)", "ok");
  } catch (e) {
    flashMsg(els.saveResult, e.message, "err");
  }
}

els.btnLoadConfig.addEventListener("click", loadConfigToEditor);
els.btnSaveConfig.addEventListener("click", saveConfigFromEditor);
loadConfigToEditor();

// =================================================
// Log stream (SSE)
// =================================================
const LOG_MAX_ROWS = 1000;

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtTs(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function appendLog(kind, data) {
  const show = {
    line: els.logShowLine.checked,
    say: els.logShowSay.checked,
    event: els.logShowEvent.checked,
  };
  if (!show[kind]) return;

  let html;
  if (kind === "line") {
    const cls = data.tag && data.tag.includes("WARN") ? "warn"
              : data.tag && data.tag.includes("STOP") ? "stop"
              : "";
    html = `<div class="row ${cls}"><span class="ts">${fmtTs(data.ts)}</span><span class="tag">${escapeHtml(data.tag)}</span>${escapeHtml(data.msg)}</div>`;
  } else if (kind === "say") {
    html = `<div class="row say"><span class="ts">${fmtTs(Date.now())}</span><span class="tag">[SAY]</span>${escapeHtml(data.who)}(${escapeHtml(data.speaker)}): ${escapeHtml(data.text)}</div>`;
  } else if (kind === "event") {
    html = `<div class="row event"><span class="ts">${fmtTs(Date.now())}</span><span class="tag">[EVENT]</span>${escapeHtml(JSON.stringify(data))}</div>`;
  } else {
    return;
  }

  els.logView.insertAdjacentHTML("beforeend", html);

  while (els.logView.children.length > LOG_MAX_ROWS) {
    els.logView.removeChild(els.logView.firstElementChild);
  }
  if (els.logAutoScroll.checked) {
    els.logView.scrollTop = els.logView.scrollHeight;
  }
}

let sse;
function connectSse() {
  try { sse?.close(); } catch {}
  sse = new EventSource("/api/log/stream");
  sse.addEventListener("line",  (ev) => appendLog("line",  JSON.parse(ev.data)));
  sse.addEventListener("say",   (ev) => appendLog("say",   JSON.parse(ev.data)));
  sse.addEventListener("event", (ev) => appendLog("event", JSON.parse(ev.data)));
  sse.onerror = () => {
    // 接続切れたら 3 秒後に再接続
    setTimeout(connectSse, 3000);
  };
}
connectSse();

els.btnLogClear.addEventListener("click", () => {
  els.logView.innerHTML = "";
});
