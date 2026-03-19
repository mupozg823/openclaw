// OpenClaw HUD Overlay — hud.js
// Receives telemetry data via Tauri events and renders mini bars

const $ = (sel) => document.querySelector(sel);

function updateHud(data) {
  // CPU
  const cpuPct = data.cpuPct ?? 0;
  $("#hudCpuBar").style.width = `${cpuPct}%`;
  $("#hudCpuBar").classList.toggle("hot", cpuPct > 85);
  $("#hudCpuVal").textContent = `${cpuPct}%`;

  // GPU
  const gpuPct = data.gpuPct ?? 0;
  $("#hudGpuBar").style.width = `${gpuPct}%`;
  $("#hudGpuBar").classList.toggle("hot", gpuPct > 85);
  $("#hudGpuVal").textContent = `${gpuPct}%`;

  // RAM
  if (data.ramUsed != null && data.ramTotal != null && data.ramTotal > 0) {
    const ramPct = Math.round((data.ramUsed / data.ramTotal) * 100);
    $("#hudRamBar").style.width = `${ramPct}%`;
    $("#hudRamVal").textContent = `${ramPct}%`;
  }

  // FPS
  if (data.fps != null) $("#hudFps").textContent = data.fps;

  // Battery
  if (data.batteryPct != null) $("#hudBat").textContent = `${data.batteryPct}%`;

  // Temp (prefer CPU temp)
  if (data.cpuTemp != null) {
    $("#hudTemp").textContent = `${data.cpuTemp}\u00B0C`;
  }
}

// Listen for Tauri events
async function initHud() {
  if (window.__TAURI__) {
    const { listen } = window.__TAURI__.event;
    await listen("telemetry-update", (event) => {
      updateHud(event.payload);
    });
    console.log("[hud] Listening for telemetry-update events");
  } else {
    // Demo mode: generate fake data
    console.log("[hud] No Tauri, running demo mode");
    setInterval(() => {
      const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
      updateHud({
        cpuPct: rand(15, 65),
        gpuPct: rand(10, 80),
        ramUsed: +(4 + Math.random() * 8).toFixed(1),
        ramTotal: 16,
        fps: rand(30, 120),
        batteryPct: rand(20, 95),
        cpuTemp: rand(45, 78),
      });
    }, 2000);
  }
}

document.addEventListener("DOMContentLoaded", initHud);
