import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { definePluginEntry } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

const execFileAsync = promisify(execFile);

// ── PowerShell ───────────────────────────────────────────────

const PS_OPTS = { shell: false, timeout: 10_000 } as const;

async function runPs(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    PS_OPTS,
  );
  return stdout.trim();
}

// ── Types ────────────────────────────────────────────────────

type OverlayPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

interface HudFrame {
  timestamp: number;
  cpuPct: number;
  cpuTempC: number | null;
  gpuPct: number;
  gpuTempC: number | null;
  vramUsedMB: number | null;
  ramPct: number;
  fps: number | null;
  batteryPct: number | null;
  powerMode: string | null;
  activeGame: string | null;
}

// ── Telemetry Collectors ────────────────────────────────────

async function collectHudFrame(): Promise<HudFrame> {
  try {
    const raw = await runPs(`
$cpu = try { [math]::Round((Get-Counter '\\Processor(_Total)\\% Processor Time' -ErrorAction Stop).CounterSamples[0].CookedValue, 0) } catch { 0 }
$cpuTemp = try { [math]::Round(((Get-CimInstance MSAcpi_ThermalZoneTemperature -Namespace root/WMI -ErrorAction Stop).CurrentTemperature[0] / 10 - 273.15), 0) } catch { 'N' }
$gpu = try { (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Measure-Object -Property UtilizationPercentage -Maximum).Maximum } catch { 0 }
$gpuTemp = try { [math]::Round(((Get-Counter '\\GPU Engine(*)\\Temperature' -ErrorAction Stop).CounterSamples | Measure-Object -Property CookedValue -Maximum).Maximum, 0) } catch { 'N' }
$vram = try { [math]::Round((Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPULocalAdapterMemory -ErrorAction Stop | Measure-Object -Property LocalUsage -Maximum).Maximum / 1MB, 0) } catch { 'N' }
$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
$ramPct = if ($os) { [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100, 0) } else { 0 }
$fps = try { [math]::Round((Get-Counter '\\GPU Engine(*engtype_3D)\\Running time' -ErrorAction Stop).CounterSamples[0].CookedValue / 10000000, 0) } catch { 'N' }
$bat = try { (Get-CimInstance Win32_Battery -ErrorAction Stop).EstimatedChargeRemaining } catch { 'N' }
$pm = try { (Get-ItemProperty 'HKLM:\\SOFTWARE\\ASUS\\ARMOURY CRATE Service\\ThrottlePlugin\\ROG ATKStatus' -ErrorAction Stop).PowerMode } catch { 'N' }
$game = try { (Get-Process | Where-Object { $_.MainWindowTitle -ne '' -and $_.PriorityClass -eq 'High' } | Select-Object -First 1).ProcessName } catch { 'N' }
"$cpu|$cpuTemp|$gpu|$gpuTemp|$vram|$ramPct|$fps|$bat|$pm|$game"
`.trim());
    const parts = raw.split("|");
    const pmMap: Record<string, string> = { "0": "Silent", "1": "Performance", "2": "Turbo" };
    return {
      timestamp: Date.now(),
      cpuPct: Number(parts[0]) || 0,
      cpuTempC: parts[1] !== "N" ? Number(parts[1]) || null : null,
      gpuPct: Number(parts[2]) || 0,
      gpuTempC: parts[3] !== "N" ? Number(parts[3]) || null : null,
      vramUsedMB: parts[4] !== "N" ? Number(parts[4]) || null : null,
      ramPct: Number(parts[5]) || 0,
      fps: parts[6] !== "N" ? Number(parts[6]) || null : null,
      batteryPct: parts[7] !== "N" ? Number(parts[7]) || null : null,
      powerMode: parts[8] !== "N" ? (pmMap[parts[8] ?? ""] ?? parts[8]) : null,
      activeGame: parts[9] !== "N" && parts[9] !== "" ? (parts[9] ?? null) : null,
    };
  } catch {
    return {
      timestamp: Date.now(),
      cpuPct: 0,
      cpuTempC: null,
      gpuPct: 0,
      gpuTempC: null,
      vramUsedMB: null,
      ramPct: 0,
      fps: null,
      batteryPct: null,
      powerMode: null,
      activeGame: null,
    };
  }
}

// ── HUD Formatting ──────────────────────────────────────────

function miniBar(pct: number, width = 8): string {
  const filled = Math.round((pct / 100) * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function formatCompactHud(f: HudFrame): string {
  const lines: string[] = [];
  lines.push(`CPU ${miniBar(f.cpuPct)} ${f.cpuPct}%${f.cpuTempC != null ? ` ${f.cpuTempC}°C` : ""}`);
  lines.push(`GPU ${miniBar(f.gpuPct)} ${f.gpuPct}%${f.gpuTempC != null ? ` ${f.gpuTempC}°C` : ""}`);
  lines.push(`RAM ${miniBar(f.ramPct)} ${f.ramPct}%${f.vramUsedMB != null ? ` VRAM:${f.vramUsedMB}MB` : ""}`);
  if (f.fps != null) lines.push(`FPS: ${f.fps}`);
  if (f.batteryPct != null) lines.push(`BAT: ${f.batteryPct}%`);
  if (f.powerMode) lines.push(`Mode: ${f.powerMode}`);
  if (f.activeGame) lines.push(`Game: ${f.activeGame}`);
  return lines.join("\n");
}

function formatDetailedHud(f: HudFrame): string {
  const sections: string[] = [];

  sections.push("╔══════════════════════════╗");
  sections.push("║    ROG Performance HUD   ║");
  sections.push("╠══════════════════════════╣");

  const cpuLine = `║ CPU  ${miniBar(f.cpuPct, 10)} ${String(f.cpuPct).padStart(3)}%`;
  const cpuTemp = f.cpuTempC != null ? ` ${f.cpuTempC}°C` : "";
  sections.push(`${cpuLine}${cpuTemp}`.padEnd(27) + "║");

  const gpuLine = `║ GPU  ${miniBar(f.gpuPct, 10)} ${String(f.gpuPct).padStart(3)}%`;
  const gpuTemp = f.gpuTempC != null ? ` ${f.gpuTempC}°C` : "";
  sections.push(`${gpuLine}${gpuTemp}`.padEnd(27) + "║");

  const ramLine = `║ RAM  ${miniBar(f.ramPct, 10)} ${String(f.ramPct).padStart(3)}%`;
  sections.push(`${ramLine}`.padEnd(27) + "║");

  if (f.vramUsedMB != null) {
    sections.push(`║ VRAM ${f.vramUsedMB}MB`.padEnd(27) + "║");
  }

  sections.push("╠══════════════════════════╣");

  if (f.fps != null) sections.push(`║ FPS: ${f.fps}`.padEnd(27) + "║");
  if (f.batteryPct != null) sections.push(`║ Battery: ${f.batteryPct}%`.padEnd(27) + "║");
  if (f.powerMode) sections.push(`║ Profile: ${f.powerMode}`.padEnd(27) + "║");
  if (f.activeGame) {
    const name = f.activeGame.length > 16 ? f.activeGame.slice(0, 13) + "..." : f.activeGame;
    sections.push(`║ Game: ${name}`.padEnd(27) + "║");
  }

  sections.push("╚══════════════════════════╝");
  return sections.join("\n");
}

// ── State Persistence ────────────────────────────────────────

interface OverlayConfig {
  position: OverlayPosition;
}

function loadState<T>(filepath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filepath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveState<T>(filepath: string, data: T): void {
  try {
    const dir = path.dirname(filepath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // silent fail
  }
}

// ── Overlay Engine ──────────────────────────────────────────

let overlayRunning = false;
let overlayInterval: ReturnType<typeof setInterval> | null = null;
let overlayPosition: OverlayPosition = "top-left";
let lastFrame: HudFrame | null = null;
const frameHistory: HudFrame[] = [];
const MAX_FRAMES = 60;

function recordFrame(f: HudFrame): void {
  frameHistory.push(f);
  if (frameHistory.length > MAX_FRAMES) frameHistory.shift();
  lastFrame = f;
}

function getAvgStats(): { avgCpu: number; avgGpu: number; avgFps: number | null; peakCpu: number; peakGpu: number } {
  if (frameHistory.length === 0) {
    return { avgCpu: 0, avgGpu: 0, avgFps: null, peakCpu: 0, peakGpu: 0 };
  }
  const cpuVals = frameHistory.map((f) => f.cpuPct);
  const gpuVals = frameHistory.map((f) => f.gpuPct);
  const fpsVals = frameHistory.map((f) => f.fps).filter((v): v is number => v != null);

  return {
    avgCpu: Math.round(cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length),
    avgGpu: Math.round(gpuVals.reduce((a, b) => a + b, 0) / gpuVals.length),
    avgFps: fpsVals.length > 0 ? Math.round(fpsVals.reduce((a, b) => a + b, 0) / fpsVals.length) : null,
    peakCpu: Math.max(...cpuVals),
    peakGpu: Math.max(...gpuVals),
  };
}

// ── Formatting ──────────────────────────────────────────────

function formatHelp(): string {
  return [
    "ROG Game Overlay commands:",
    "",
    "/overlay — Show current performance HUD (one-shot)",
    "/overlay start — Start overlay engine (continuous polling)",
    "/overlay stop — Stop overlay engine",
    "/overlay compact — Compact HUD format",
    "/overlay detailed — Detailed HUD with box drawing",
    "/overlay stats — Session average/peak statistics",
    "/overlay position <corner> — Set position (top-left, top-right, bottom-left, bottom-right)",
    "/overlay status — Engine status + last frame",
  ].join("\n");
}

function formatStats(): string {
  const stats = getAvgStats();
  const duration = frameHistory.length > 1
    ? Math.round((frameHistory[frameHistory.length - 1]!.timestamp - frameHistory[0]!.timestamp) / 1000)
    : 0;
  const mins = Math.floor(duration / 60);
  const secs = duration % 60;

  return [
    "Session Performance Statistics:",
    `  Duration: ${mins}m ${secs}s (${frameHistory.length} samples)`,
    "",
    `  CPU — avg: ${stats.avgCpu}%  peak: ${stats.peakCpu}%`,
    `  GPU — avg: ${stats.avgGpu}%  peak: ${stats.peakGpu}%`,
    stats.avgFps != null ? `  FPS — avg: ${stats.avgFps}` : "  FPS — N/A",
  ].join("\n");
}

// ── Plugin Entry ────────────────────────────────────────────

export default definePluginEntry({
  id: "rog-overlay",
  name: "ROG Game Overlay",
  description: "Performance HUD overlay for gaming sessions with CPU, GPU, FPS, temp, battery",
  register(api: OpenClawPluginApi) {
    const stateDir = api.runtime.state.resolveStateDir();
    const configFile = path.join(stateDir, "rog-overlay-config.json");

    // Restore saved position from disk
    const savedConfig = loadState<OverlayConfig>(configFile, { position: "top-left" });
    overlayPosition = savedConfig.position;

    const pollMs = 1000;

    api.registerCommand({
      name: "overlay",
      description: "ROG performance overlay — HUD, stats, engine control.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const args = ctx.args?.trim().toLowerCase() ?? "";
        const tokens = args.split(/\s+/).filter(Boolean);
        const action = tokens[0] ?? "";

        if (action === "help") return { text: formatHelp() };

        // /overlay start
        if (action === "start" || action === "on") {
          if (overlayRunning) return { text: "Overlay engine already running." };
          overlayRunning = true;
          overlayInterval = setInterval(() => {
            collectHudFrame().then((frame) => {
              recordFrame(frame);
              api.logger.info(`[overlay] CPU:${frame.cpuPct}% GPU:${frame.gpuPct}%${frame.fps != null ? ` FPS:${frame.fps}` : ""}`);
            });
          }, pollMs);
          return { text: `Overlay engine started (${pollMs}ms polling, position: ${overlayPosition}).` };
        }

        // /overlay stop
        if (action === "stop" || action === "off") {
          if (!overlayRunning) return { text: "Overlay engine not running." };
          overlayRunning = false;
          if (overlayInterval) clearInterval(overlayInterval);
          overlayInterval = null;
          return { text: `Overlay stopped. ${frameHistory.length} frames recorded.\n\n${formatStats()}` };
        }

        // /overlay stats
        if (action === "stats" || action === "avg" || action === "summary") {
          if (frameHistory.length < 2) {
            return { text: "Not enough data. Run /overlay or /overlay start first." };
          }
          return { text: formatStats() };
        }

        // /overlay compact
        if (action === "compact" || action === "mini") {
          const frame = await collectHudFrame();
          recordFrame(frame);
          return { text: formatCompactHud(frame) };
        }

        // /overlay detailed
        if (action === "detailed" || action === "full" || action === "hud") {
          const frame = await collectHudFrame();
          recordFrame(frame);
          return { text: formatDetailedHud(frame) };
        }

        // /overlay position <corner>
        if (action === "position" || action === "pos") {
          const pos = tokens[1];
          const validPositions: OverlayPosition[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
          if (!pos || !validPositions.includes(pos as OverlayPosition)) {
            return { text: `Usage: /overlay position <${validPositions.join("|")}>\nCurrent: ${overlayPosition}` };
          }
          overlayPosition = pos as OverlayPosition;
          saveState(configFile, { position: overlayPosition });
          return { text: `Overlay position set to ${overlayPosition}.` };
        }

        // /overlay status
        if (action === "status") {
          const lines = [
            `Engine: ${overlayRunning ? "RUNNING" : "STOPPED"}`,
            `Position: ${overlayPosition}`,
            `Frames collected: ${frameHistory.length}`,
          ];
          if (lastFrame) {
            lines.push("");
            lines.push("Last frame:");
            lines.push(formatCompactHud(lastFrame));
          }
          return { text: lines.join("\n") };
        }

        // Default: one-shot detailed HUD
        const frame = await collectHudFrame();
        recordFrame(frame);
        return { text: formatDetailedHud(frame) };
      },
    });
  },
});

export { formatHelp, formatCompactHud, formatDetailedHud, miniBar, getAvgStats };
export type { HudFrame, OverlayPosition };
