// OpenClaw ROG Dashboard — app.js
// Frontend logic for the Tauri tray window

// ── Constants ────────────────────────────────────────
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 52; // r=52 from SVG
const SPARK_MAX_POINTS = 60;
const POLL_INTERVAL_MS = 2000;

// ── State ────────────────────────────────────────────
const state = {
  connected: false,
  cpuHistory: [],
  gpuHistory: [],
  overlayOn: false,
  overlayPos: "top-left",
  autoOn: false,
  activeProfile: "performance",
  activeColor: "#FF0033",
  auraMode: "static",
  rules: [
    { id: "game-turbo", name: "Game -> Turbo", desc: "Switch to Turbo when a game is detected", on: true },
    { id: "idle-silent", name: "Idle -> Silent", desc: "Switch to Silent after 5 min idle", on: true },
    { id: "low-bat-dim", name: "Low Battery -> Dim", desc: "Reduce brightness below 20% battery", on: false },
    { id: "charge-rgb", name: "Charging -> RGB", desc: "Enable RGB breathing when plugged in", on: false },
    { id: "hot-notify", name: "High Temp -> Alert", desc: "Toast notification when CPU > 90\u00B0C", on: true },
  ],
  marketPlugins: [
    { icon: "\u{1F321}\uFE0F", name: "rog-hardware", desc: "WMI telemetry: CPU, GPU, battery, power mode", version: "1.0.0", installed: true },
    { icon: "\u{1F50D}", name: "win-file-search", desc: "Windows Search indexer + directory fallback", version: "1.0.0", installed: true },
    { icon: "\u{1F4BB}", name: "win-app-control", desc: "Launch, focus, close Windows apps", version: "1.0.0", installed: true },
    { icon: "\u{1F4CA}", name: "win-monitor", desc: "Real-time CPU/GPU/RAM monitoring dashboard", version: "1.0.0", installed: true },
    { icon: "\u{1F4CB}", name: "win-clipboard", desc: "Clipboard + screenshot analysis", version: "1.0.0", installed: true },
    { icon: "\u{1F308}", name: "rog-aura", desc: "Aura Sync RGB lighting control", version: "1.0.0", installed: true },
    { icon: "\u26A1", name: "rog-automate", desc: "Automation rule engine (15 built-in rules)", version: "1.0.0", installed: true },
    { icon: "\u{1F3A4}", name: "win-voice", desc: "Voice input (STT) and text-to-speech", version: "1.0.0", installed: true },
    { icon: "\u{1F514}", name: "win-notify", desc: "Windows toast notifications + reminders", version: "1.0.0", installed: false },
    { icon: "\u{1F5A5}\uFE0F", name: "win-desktop", desc: "Virtual desktop & multi-monitor control", version: "1.0.0", installed: false },
  ],
};

// ── DOM Refs ─────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Navigation ───────────────────────────────────────
$$(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const view = btn.dataset.view;
    $$(".view").forEach((v) => v.classList.remove("active"));
    $(`#view-${view}`).classList.add("active");
  });
});

// ── Gauge Helpers ────────────────────────────────────
function setGauge(el, pct) {
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = GAUGE_CIRCUMFERENCE * (1 - clamped / 100);
  el.style.strokeDashoffset = offset;
  // Hot state when > 85%
  el.classList.toggle("hot", clamped > 85);
}

function updateDashboard(data) {
  // CPU
  const cpuPct = data.cpuPct ?? 0;
  setGauge($("#cpuGauge"), cpuPct);
  $("#cpuValue").textContent = cpuPct;
  if (data.cpuTemp != null) $("#cpuTemp").textContent = `${data.cpuTemp}\u00B0C`;

  // GPU
  const gpuPct = data.gpuPct ?? 0;
  setGauge($("#gpuGauge"), gpuPct);
  $("#gpuValue").textContent = gpuPct;
  if (data.gpuTemp != null) $("#gpuTemp").textContent = `${data.gpuTemp}\u00B0C`;

  // RAM
  if (data.ramUsed != null && data.ramTotal != null) {
    const ramPct = Math.round((data.ramUsed / data.ramTotal) * 100);
    $("#ramBar").style.width = `${ramPct}%`;
    $("#ramPct").textContent = `${ramPct}%`;
    $("#ramDetail").textContent = `${data.ramUsed.toFixed(1)} / ${data.ramTotal.toFixed(1)} GB`;
  }

  // VRAM
  if (data.vramUsed != null) {
    const vramPct = data.vramTotal ? Math.round((data.vramUsed / data.vramTotal) * 100) : 0;
    $("#vramBar").style.width = `${vramPct}%`;
    $("#vramPct").textContent = `${vramPct}%`;
    $("#vramDetail").textContent = `${data.vramUsed} / ${data.vramTotal ?? "?"} MB`;
  }

  // FPS, Battery, Network
  if (data.fps != null) $("#fpsValue").textContent = data.fps;
  if (data.batteryPct != null) $("#batValue").textContent = `${data.batteryPct}%`;
  if (data.netUp != null && data.netDown != null) {
    $("#netValue").textContent = `\u2191${formatBytes(data.netUp)} \u2193${formatBytes(data.netDown)}/s`;
  }

  // Top Processes
  if (data.topProcs && data.topProcs.length) {
    const list = $("#processList");
    list.innerHTML = data.topProcs
      .slice(0, 5)
      .map((p) => `<div class="process-item"><span class="process-name">${escapeHtml(p.name)}</span><span class="process-cpu">${p.cpu}%</span></div>`)
      .join("");
  }

  // Profile badge
  if (data.powerMode) {
    const badge = $("#profileBadge");
    badge.textContent = data.powerMode.toUpperCase();
    badge.dataset.profile = data.powerMode;
    state.activeProfile = data.powerMode;
    $$(".profile-btn").forEach((b) => b.classList.toggle("active", b.dataset.profile === data.powerMode));
  }

  // Sparklines
  state.cpuHistory.push(cpuPct);
  state.gpuHistory.push(gpuPct);
  if (state.cpuHistory.length > SPARK_MAX_POINTS) state.cpuHistory.shift();
  if (state.gpuHistory.length > SPARK_MAX_POINTS) state.gpuHistory.shift();
  drawSparkline($("#cpuSpark"), state.cpuHistory, "#ff0033");
  drawSparkline($("#gpuSpark"), state.gpuHistory, "#00d4ff");

  // Overlay stats
  if (state.cpuHistory.length > 1) {
    const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    const peak = (arr) => Math.max(...arr);
    $("#statAvgCpu").textContent = `${avg(state.cpuHistory)}%`;
    $("#statAvgGpu").textContent = `${avg(state.gpuHistory)}%`;
    $("#statPeakCpu").textContent = `${peak(state.cpuHistory)}%`;
    if (data.fps != null) $("#statAvgFps").textContent = data.fps;
  }
}

// ── Sparkline Drawing ────────────────────────────────
function drawSparkline(canvas, data, color) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (data.length < 2) return;

  const step = w / (SPARK_MAX_POINTS - 1);
  const startX = w - (data.length - 1) * step;

  // Fill gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color + "40");
  grad.addColorStop(1, color + "00");

  ctx.beginPath();
  ctx.moveTo(startX, h);
  data.forEach((v, i) => {
    const x = startX + i * step;
    const y = h - (v / 100) * h;
    ctx.lineTo(x, y);
  });
  ctx.lineTo(startX + (data.length - 1) * step, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = startX + i * step;
    const y = h - (v / 100) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// ── Utilities ────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / 1048576).toFixed(1)}M`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function toast(msg, type = "") {
  const container = $("#toastContainer");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Profile Switching ────────────────────────────────
$$(".profile-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const profile = btn.dataset.profile;
    if (profile === state.activeProfile) return;
    state.activeProfile = profile;
    $$(".profile-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    $("#profileBadge").textContent = profile.toUpperCase();
    $("#profileBadge").dataset.profile = profile;
    sendCommand("rog.setProfile", { profile });
    toast(`Profile: ${profile}`, "success");
  });
});

// ── RGB Controls ─────────────────────────────────────
$$(".color-swatch").forEach((sw) => {
  sw.addEventListener("click", () => {
    $$(".color-swatch").forEach((s) => s.classList.remove("active"));
    sw.classList.add("active");
    state.activeColor = sw.dataset.color;
    sendCommand("rog.aura.setColor", { color: state.activeColor, mode: state.auraMode });
    toast(`RGB: ${state.activeColor}`);
  });
});

$("#auraMode").addEventListener("change", (e) => {
  state.auraMode = e.target.value;
  sendCommand("rog.aura.setMode", { mode: state.auraMode, color: state.activeColor });
});

// ── Overlay Controls ─────────────────────────────────
$("#overlayToggle").addEventListener("click", () => {
  state.overlayOn = !state.overlayOn;
  const btn = $("#overlayToggle");
  btn.textContent = state.overlayOn ? "ON" : "OFF";
  btn.classList.toggle("on", state.overlayOn);
  sendCommand("rog.overlay.toggle", { enabled: state.overlayOn, position: state.overlayPos });
});

$$(".pos-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".pos-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.overlayPos = btn.dataset.pos;
    if (state.overlayOn) sendCommand("rog.overlay.position", { position: state.overlayPos });
  });
});

// ── Desktop Actions ──────────────────────────────────
$$("[data-action]").forEach((btn) => {
  btn.addEventListener("click", () => {
    sendCommand("desktop.action", { action: btn.dataset.action });
  });
});

// ── Voice ────────────────────────────────────────────
const voiceBtn = $("#voiceListenBtn");
let listening = false;
voiceBtn.addEventListener("click", () => {
  listening = !listening;
  voiceBtn.classList.toggle("listening", listening);
  if (listening) {
    sendCommand("voice.listen", {});
    toast("Listening...");
  } else {
    sendCommand("voice.stop", {});
  }
});

// ── Automation Rules ─────────────────────────────────
function renderRules() {
  const list = $("#rulesList");
  list.innerHTML = state.rules
    .map(
      (r) =>
        `<div class="rule-item" data-id="${r.id}">
      <div class="rule-info">
        <div class="rule-name">${escapeHtml(r.name)}</div>
        <div class="rule-desc">${escapeHtml(r.desc)}</div>
      </div>
      <button class="rule-toggle ${r.on ? "on" : ""}" data-rule="${r.id}"></button>
    </div>`
    )
    .join("");

  list.querySelectorAll(".rule-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rule = state.rules.find((r) => r.id === btn.dataset.rule);
      if (rule) {
        rule.on = !rule.on;
        btn.classList.toggle("on", rule.on);
        sendCommand("automate.setRule", { id: rule.id, enabled: rule.on });
      }
    });
  });
}

$("#autoToggle").addEventListener("click", () => {
  state.autoOn = !state.autoOn;
  const btn = $("#autoToggle");
  btn.textContent = state.autoOn ? "ON" : "OFF";
  btn.classList.toggle("on", state.autoOn);
  sendCommand("automate.toggle", { enabled: state.autoOn });
});

// ── Marketplace ──────────────────────────────────────
function renderMarketplace(filter = "") {
  const grid = $("#marketGrid");
  const filtered = state.marketPlugins.filter(
    (p) => !filter || p.name.includes(filter) || p.desc.toLowerCase().includes(filter.toLowerCase())
  );
  grid.innerHTML = filtered
    .map(
      (p) =>
        `<div class="market-item">
      <div class="market-item-header">
        <span class="market-item-icon">${p.icon}</span>
        <span class="market-item-name">${escapeHtml(p.name)}</span>
      </div>
      <div class="market-item-desc">${escapeHtml(p.desc)}</div>
      <div class="market-item-footer">
        <span class="market-item-version">v${p.version}</span>
        <button class="market-install-btn ${p.installed ? "installed" : ""}" data-plugin="${p.name}">
          ${p.installed ? "Installed" : "Install"}
        </button>
      </div>
    </div>`
    )
    .join("");

  grid.querySelectorAll(".market-install-btn:not(.installed)").forEach((btn) => {
    btn.addEventListener("click", () => {
      const plugin = state.marketPlugins.find((p) => p.name === btn.dataset.plugin);
      if (plugin) {
        plugin.installed = true;
        btn.classList.add("installed");
        btn.textContent = "Installed";
        sendCommand("marketplace.install", { name: plugin.name });
        toast(`Installed ${plugin.name}`, "success");
      }
    });
  });
}

$("#marketSearch").addEventListener("input", (e) => {
  renderMarketplace(e.target.value);
});

// ── Gateway Communication ────────────────────────────
let tauriInvoke = null;

async function initTauri() {
  if (window.__TAURI__) {
    const { invoke } = window.__TAURI__.core;
    tauriInvoke = invoke;
    try {
      const status = await invoke("get_status");
      console.log("[tauri]", status);
      setConnectionStatus(true);
    } catch (e) {
      console.warn("[tauri] invoke failed:", e);
    }
  }
}

function setConnectionStatus(connected) {
  state.connected = connected;
  const el = $("#connStatus");
  el.classList.toggle("connected", connected);
}

function sendCommand(method, params) {
  console.log(`[cmd] ${method}`, params);
  if (tauriInvoke) {
    tauriInvoke("send_gateway_command", { method, params: JSON.stringify(params) }).catch((e) =>
      console.warn("[cmd] failed:", e)
    );
  }
}

// ── Telemetry Polling ────────────────────────────────
let pollBusy = false;

async function pollTelemetry() {
  if (pollBusy) return;
  pollBusy = true;
  try {
    if (tauriInvoke) {
      const data = await tauriInvoke("get_telemetry");
      updateDashboard(data);
      setConnectionStatus(true);
    } else {
      updateDashboard(generateDemoData());
    }
  } catch (e) {
    console.warn("[telemetry] poll failed:", e);
    updateDashboard(generateDemoData());
  } finally {
    pollBusy = false;
  }
}

// ── Demo Data (fallback when Tauri unavailable) ──────
function generateDemoData() {
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  return {
    cpuPct: rand(15, 65),
    cpuTemp: rand(45, 78),
    gpuPct: rand(10, 80),
    gpuTemp: rand(40, 75),
    ramUsed: +(4 + Math.random() * 8).toFixed(1),
    ramTotal: 16,
    vramUsed: rand(512, 4096),
    vramTotal: 8192,
    batteryPct: rand(20, 95),
    powerMode: state.activeProfile,
    topProcs: [
      { name: "explorer.exe", cpu: rand(0, 5) },
      { name: "chrome.exe", cpu: rand(2, 15) },
      { name: "dwm.exe", cpu: rand(0, 4) },
    ].sort((a, b) => b.cpu - a.cpu),
  };
}

// ── Init ─────────────────────────────────────────────
function init() {
  renderRules();
  renderMarketplace();
  initTauri();

  // Start telemetry polling (real data via Tauri, fallback to demo)
  setInterval(pollTelemetry, POLL_INTERVAL_MS);

  // Initial render with demo data (first real poll will overwrite)
  updateDashboard(generateDemoData());
}

document.addEventListener("DOMContentLoaded", init);
