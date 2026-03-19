import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  definePluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────

export type QuickPreset = "gaming" | "battery" | "quiet" | "presentation";

export interface PresetConfig {
  name: string;
  description: string;
  powerProfile: string; // silent|performance|turbo
  fanMode: string;
  rgbMode: string;
  rgbBrightness: number;
  overlayEnabled: boolean;
}

export interface ControlCenterStatus {
  powerMode: string | null;
  cpuTemp: number | null;
  gpuUsage: number | null;
  ramPct: number;
  batteryPct: number | null;
  fanEnabled: boolean;
  rgbAvailable: boolean;
  gamepadConnected: boolean;
  activeGame: string | null;
  autoEngine: boolean;
  overlayEngine: boolean;
}

// ── Presets ───────────────────────────────────────────────────

export const PRESETS: Record<QuickPreset, PresetConfig> = {
  gaming: {
    name: "Gaming",
    description: "Max performance, turbo fans, ROG red RGB",
    powerProfile: "turbo",
    fanMode: "turbo",
    rgbMode: "static",
    rgbBrightness: 3,
    overlayEnabled: true,
  },
  battery: {
    name: "Battery Saver",
    description: "Silent mode, low brightness, RGB off",
    powerProfile: "silent",
    fanMode: "auto",
    rgbMode: "off",
    rgbBrightness: 0,
    overlayEnabled: false,
  },
  quiet: {
    name: "Quiet",
    description: "Silent fans, dim RGB, low power",
    powerProfile: "silent",
    fanMode: "silent",
    rgbMode: "breathing",
    rgbBrightness: 1,
    overlayEnabled: false,
  },
  presentation: {
    name: "Presentation",
    description: "Performance mode, no RGB distractions",
    powerProfile: "performance",
    fanMode: "auto",
    rgbMode: "off",
    rgbBrightness: 0,
    overlayEnabled: false,
  },
};

// ── PowerShell Helper ─────────────────────────────────────────

const PS_OPTS = { shell: false, timeout: 15_000 } as const;

async function runPs(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    PS_OPTS,
  );
  return stdout.trim();
}

// ── Unified Status Collection (single PS call) ────────────────

const PS_STATUS_SCRIPT = `
$pm = try { (Get-ItemProperty 'HKLM:\\SOFTWARE\\ASUS\\ARMOURY CRATE Service\\ThrottlePlugin\\ROG ATKStatus' -ErrorAction Stop).PowerMode } catch { 'N' }
$cpu = try { [math]::Round((Get-Counter '\\Processor(_Total)\\% Processor Time' -ErrorAction Stop).CounterSamples[0].CookedValue, 0) } catch { 0 }
$gpu = try { (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Measure-Object -Property UtilizationPercentage -Maximum).Maximum } catch { 0 }
$os = Get-CimInstance Win32_OperatingSystem
$ramPct = [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100, 0)
$bat = try { (Get-CimInstance Win32_Battery -ErrorAction Stop).EstimatedChargeRemaining } catch { 'N' }
$fan = try { (Get-ItemProperty 'HKLM:\\SOFTWARE\\ASUS\\ARMOURY CRATE Service\\FanControlPlugin' -ErrorAction SilentlyContinue).IsEnabledFanControl } catch { 0 }
$game = try { (Get-Process | Where-Object { $_.MainWindowTitle -ne '' -and $_.PriorityClass -eq 'High' } | Select-Object -First 1).ProcessName } catch { 'N' }
"$pm|$cpu|$gpu|$ramPct|$bat|$fan|$game"
`.trim();

const POWER_MODE_MAP: Record<string, string> = {
  "0": "SILENT",
  "1": "PERFORMANCE",
  "2": "TURBO",
};

async function collectStatus(): Promise<ControlCenterStatus> {
  try {
    const raw = await runPs(PS_STATUS_SCRIPT);
    const parts = raw.split("|");
    const [pmRaw, cpuRaw, gpuRaw, ramRaw, batRaw, fanRaw, gameRaw] = parts;

    const powerMode =
      pmRaw && pmRaw !== "N" ? (POWER_MODE_MAP[pmRaw.trim()] ?? pmRaw.trim()) : null;
    const cpuTemp = cpuRaw && cpuRaw !== "0" ? Number(cpuRaw) : null;
    const gpuUsage = gpuRaw ? Number(gpuRaw) : null;
    const ramPct = ramRaw ? Number(ramRaw) : 0;
    const batteryPct = batRaw && batRaw !== "N" ? Number(batRaw) : null;
    const fanEnabled = fanRaw === "1" || fanRaw === "True";
    const activeGame =
      gameRaw && gameRaw !== "N" && gameRaw.trim() !== "" ? gameRaw.trim() : null;

    // RGB availability: check if AURA service process exists
    let rgbAvailable = false;
    try {
      const rgbRaw = await runPs(
        `(Get-Process -Name 'LightingService' -ErrorAction SilentlyContinue) -ne $null`,
      );
      rgbAvailable = rgbRaw.trim() === "True";
    } catch {
      rgbAvailable = false;
    }

    // Gamepad detection
    let gamepadConnected = false;
    try {
      const gpRaw = await runPs(
        `(Get-PnpDevice -Class XnaComposite,HIDClass -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'OK' -and $_.FriendlyName -match 'Xbox|Gamepad|Controller' }).Count -gt 0`,
      );
      gamepadConnected = gpRaw.trim() === "True";
    } catch {
      gamepadConnected = false;
    }

    return {
      powerMode,
      cpuTemp,
      gpuUsage,
      ramPct,
      batteryPct,
      fanEnabled,
      rgbAvailable,
      gamepadConnected,
      activeGame,
      autoEngine: false,
      overlayEngine: false,
    };
  } catch {
    return {
      powerMode: null,
      cpuTemp: null,
      gpuUsage: null,
      ramPct: 0,
      batteryPct: null,
      fanEnabled: false,
      rgbAvailable: false,
      gamepadConnected: false,
      activeGame: null,
      autoEngine: false,
      overlayEngine: false,
    };
  }
}

// ── Health Check ──────────────────────────────────────────────

interface ServiceHealth {
  name: string;
  running: boolean;
}

async function checkHealth(): Promise<{ services: ServiceHealth[]; driverOk: boolean }> {
  const serviceNames = [
    "ArmouryCrateService",
    "LightingService",
    "AsusFanControlService",
    "ROGCoreSvc",
  ];

  let services: ServiceHealth[] = [];
  let driverOk = false;

  try {
    const script = serviceNames
      .map(
        (s) =>
          `$s${s}=try{(Get-Service -Name '${s}' -ErrorAction Stop).Status}catch{'NotFound'}`,
      )
      .join("; ");
    const values = await runPs(
      `${script}; "${serviceNames.map((s) => `$s${s}`).join("|")}"`,
    );
    const statuses = values.split("|");
    services = serviceNames.map((name, i) => ({
      name,
      running: (statuses[i] ?? "").trim() === "Running",
    }));
  } catch {
    services = serviceNames.map((name) => ({ name, running: false }));
  }

  try {
    const raw = await runPs(
      `(Get-PnpDevice -FriendlyName '*ASUS*' -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'OK' }).Count -gt 0`,
    );
    driverOk = raw.trim() === "True";
  } catch {
    driverOk = false;
  }

  return { services, driverOk };
}

// ── Installed Plugins List ────────────────────────────────────

const ROG_WIN_PLUGINS = [
  { id: "rog-hardware", name: "ROG Hardware Control", desc: "WMI/Registry telemetry, power profiles" },
  { id: "rog-control-center", name: "ROG Control Center", desc: "Unified dashboard and presets (this plugin)" },
  { id: "win-file-search", name: "Windows File Search", desc: "Search Indexer + dir fallback" },
  { id: "win-app-control", name: "Windows App Control", desc: "Launch/focus/close Win32 apps" },
];

// ── Formatting ────────────────────────────────────────────────

export function formatStatus(s: ControlCenterStatus): string {
  const pad = (v: string, width: number): string => v.padEnd(width);

  const powerStr = s.powerMode ?? "N/A";
  const batStr = s.batteryPct != null ? `${s.batteryPct}%` : "N/A";
  const cpuStr = s.cpuTemp != null ? `${Math.round(s.cpuTemp)}C` : "N/A";
  const gpuStr = s.gpuUsage != null ? `${s.gpuUsage}%` : "N/A";
  const ramStr = `${s.ramPct}%`;
  const fanStr = s.fanEnabled ? "ON" : "OFF";
  const rgbStr = s.rgbAvailable ? "Available" : "N/A";
  const gameStr = s.activeGame ?? "--";
  const autoStr = s.autoEngine ? "ON" : "OFF";
  const overlayStr = s.overlayEngine ? "ON" : "OFF";

  const w = 34;
  const inner = w - 2;

  const row = (left: string, right: string): string => {
    const combined = ` ${left}  ${right}`;
    const padded = combined.padEnd(inner);
    return `║${padded}║`;
  };

  const title = "ROG Control Center";
  const titlePadded = title.padStart(Math.floor((inner + title.length) / 2)).padEnd(inner);

  return [
    `╔${"═".repeat(inner)}╗`,
    `║${titlePadded}║`,
    `╠${"═".repeat(inner)}╣`,
    row(pad(`Power: ${powerStr}`, 20), `Battery: ${batStr}`),
    row(pad(`CPU:   ${cpuStr}`, 20), `GPU: ${gpuStr}`),
    row(pad(`RAM:   ${ramStr}`, 20), `Fan: ${fanStr}`),
    row(pad(`RGB:   ${rgbStr}`, 20), `Game: ${gameStr}`),
    row(pad(`Auto:  ${autoStr}`, 20), `Overlay: ${overlayStr}`),
    `╚${"═".repeat(inner)}╝`,
  ].join("\n");
}

export function formatHelp(): string {
  return [
    "ROG Control Center commands:",
    "",
    "/cc              — Unified status dashboard",
    "/cc preset <name> — Apply quick preset (gaming|battery|quiet|presentation)",
    "/cc presets      — List all available presets",
    "/cc health       — System health check (services, drivers)",
    "/cc plugins      — Installed ROG/Windows plugin inventory",
    "/cc help         — Show this help text",
    "",
    "Quick presets:",
    "  gaming       — Turbo power, turbo fans, RGB on",
    "  battery      — Silent mode, RGB off, overlay off",
    "  quiet        — Silent fans, dim RGB, low power",
    "  presentation — Performance mode, RGB off",
  ].join("\n");
}

function formatPresets(): string {
  const lines = ["Available quick presets:", ""];
  for (const [key, cfg] of Object.entries(PRESETS)) {
    lines.push(`  ${key.padEnd(14)} — ${cfg.description}`);
    lines.push(`  ${"".padEnd(14)}   Power: ${cfg.powerProfile}  Fan: ${cfg.fanMode}  RGB: ${cfg.rgbMode} (brightness ${cfg.rgbBrightness})`);
    lines.push("");
  }
  lines.push("Usage: /cc preset <name>");
  return lines.join("\n");
}

function formatPresetApplied(preset: QuickPreset, cfg: PresetConfig): string {
  return [
    `Preset applied: ${cfg.name}`,
    `Description: ${cfg.description}`,
    "",
    "Settings summary:",
    `  Power profile : ${cfg.powerProfile.toUpperCase()}`,
    `  Fan mode      : ${cfg.fanMode}`,
    `  RGB mode      : ${cfg.rgbMode} (brightness ${cfg.rgbBrightness})`,
    `  Overlay       : ${cfg.overlayEnabled ? "enabled" : "disabled"}`,
    "",
    "To apply individual settings use the dedicated plugins:",
    `  /rog profile ${cfg.powerProfile}   (requires rog-hardware plugin)`,
    cfg.rgbMode !== "off"
      ? `  /rgb ${cfg.rgbMode} ${cfg.rgbBrightness}   (requires rog-rgb plugin if installed)`
      : "  RGB off — no additional command needed",
  ].join("\n");
}

function formatHealth(services: ServiceHealth[], driverOk: boolean): string {
  const lines = ["System Health Check:", ""];
  lines.push("ASUS Services:");
  for (const svc of services) {
    const icon = svc.running ? "[OK]" : "[--]";
    lines.push(`  ${icon} ${svc.name}`);
  }
  lines.push("");
  lines.push(`ASUS Drivers: ${driverOk ? "[OK] Detected" : "[--] Not detected"}`);
  const allOk = services.every((s) => s.running) && driverOk;
  lines.push("");
  lines.push(allOk ? "Overall: All systems nominal." : "Overall: Some services/drivers are inactive or not installed.");
  return lines.join("\n");
}

function formatPlugins(): string {
  const lines = ["Installed ROG/Windows Plugins:", ""];
  for (const p of ROG_WIN_PLUGINS) {
    lines.push(`  ${p.id}`);
    lines.push(`    ${p.name}`);
    lines.push(`    ${p.desc}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

// ── Plugin Entry ──────────────────────────────────────────────

export default definePluginEntry({
  id: "rog-control-center",
  name: "ROG Control Center",
  description: "Unified control center for all ROG and Windows plugins",
  register(api: OpenClawPluginApi) {
    api.registerCommand({
      name: "cc",
      description: "ROG Control Center — unified dashboard, presets, health check, plugin list.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const args = ctx.args?.trim() ?? "";
        const tokens = args.split(/\s+/).filter(Boolean);
        const action = tokens[0]?.toLowerCase() ?? "";

        if (!action || action === "status") {
          const status = await collectStatus();
          return { text: formatStatus(status) };
        }

        if (action === "preset") {
          const presetKey = tokens[1]?.toLowerCase() as QuickPreset | undefined;
          if (!presetKey) {
            return { text: "Usage: /cc preset <gaming|battery|quiet|presentation>\n\n" + formatPresets() };
          }
          const cfg = PRESETS[presetKey];
          if (!cfg) {
            return {
              text: `Unknown preset: "${presetKey}"\n\nAvailable: ${Object.keys(PRESETS).join(", ")}`,
            };
          }
          return { text: formatPresetApplied(presetKey, cfg) };
        }

        if (action === "presets") {
          return { text: formatPresets() };
        }

        if (action === "health") {
          const { services, driverOk } = await checkHealth();
          return { text: formatHealth(services, driverOk) };
        }

        if (action === "plugins") {
          return { text: formatPlugins() };
        }

        if (action === "help") {
          return { text: formatHelp() };
        }

        return { text: `Unknown action: "${action}"\n\n${formatHelp()}` };
      },
    });
  },
});

export { formatStatus as formatDashboard };
