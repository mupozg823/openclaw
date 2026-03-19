import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  definePluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────

export type FanMode = "auto" | "silent" | "turbo";

export interface ThermalSnapshot {
  cpuTempC: number | null;
  gpuTempC: number | null;
  fanMode: FanMode;
  fanSpeedPct: number | null;
  fanControlEnabled: boolean;
}

// Fan profile: three named presets mapping to mode + descriptive label
interface FanProfile {
  name: string;
  mode: FanMode;
  description: string;
}

// ── PowerShell Helpers ───────────────────────────────────────

const PS_OPTS = { shell: false, timeout: 10_000 } as const;

async function runPs(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    PS_OPTS,
  );
  return stdout.trim();
}

function parseNumber(raw: string): number | null {
  if (raw === "" || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ── Fan Control Registry ─────────────────────────────────────

const FAN_REG_KEY = "HKLM:\\SOFTWARE\\ASUS\\ARMOURY CRATE Service\\FanControlPlugin";

// Maps FanMode to Armoury Crate registry values for fan scenario
const FAN_MODE_MAP: Record<string, FanMode> = {
  "0": "silent",
  "1": "auto",
  "2": "turbo",
};

const FAN_MODE_TO_REG: Record<FanMode, string> = {
  silent: "0",
  auto: "1",
  turbo: "2",
};

async function isFanControlEnabled(): Promise<boolean> {
  try {
    const raw = await runPs(
      `(Get-ItemProperty '${FAN_REG_KEY}' -ErrorAction Stop).IsEnabledFanControl`,
    );
    return raw.trim() === "1" || raw.trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

async function getFanMode(): Promise<FanMode> {
  try {
    const raw = await runPs(
      `(Get-ItemProperty '${FAN_REG_KEY}' -ErrorAction Stop).FanScenario`,
    );
    return FAN_MODE_MAP[raw.trim()] ?? "auto";
  } catch {
    return "auto";
  }
}

async function setFanMode(mode: FanMode): Promise<{ ok: boolean; error?: string }> {
  const regValue = FAN_MODE_TO_REG[mode];
  try {
    await runPs(
      `Set-ItemProperty '${FAN_REG_KEY}' -Name FanScenario -Value ${regValue} -ErrorAction Stop`,
    );
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: `Registry write failed: ${e}. Try running OpenClaw as Administrator.`,
    };
  }
}

// ── Fan Speed ────────────────────────────────────────────────

async function getFanSpeedPct(): Promise<number | null> {
  try {
    // Win32_Fan reports DesiredSpeed as a percentage on some ASUS implementations
    const raw = await runPs(
      `(Get-CimInstance Win32_Fan -ErrorAction Stop | Measure-Object -Property DesiredSpeed -Maximum).Maximum`,
    );
    const val = parseNumber(raw);
    if (val != null && val > 0 && val <= 100) return val;
    // Fallback: read ActiveCooling flag count as presence indicator
    return null;
  } catch {
    return null;
  }
}

// ── CPU Temperature ──────────────────────────────────────────

async function getCpuTempC(): Promise<number | null> {
  // Primary: Performance Counter (no admin required)
  try {
    const raw = await runPs(
      `((Get-Counter '\\Thermal Zone Information(*)\\Temperature' -ErrorAction Stop).CounterSamples | Measure-Object -Property CookedValue -Maximum).Maximum - 273.15`,
    );
    return parseNumber(raw);
  } catch {
    /* fall through */
  }
  // Fallback: WMI TemperatureProbe (may return Kelvin × 10)
  try {
    const raw = await runPs(
      `(Get-CimInstance Win32_TemperatureProbe -ErrorAction Stop | Measure-Object -Property CurrentReading -Maximum).Maximum`,
    );
    const val = parseNumber(raw);
    if (val != null && val > 2000) return Math.round(val / 10 - 273.15); // Kelvin × 10
    if (val != null && val > 273) return Math.round(val - 273.15); // Kelvin
    return val;
  } catch {
    return null;
  }
}

// ── GPU Temperature ──────────────────────────────────────────

async function getGpuTempC(): Promise<number | null> {
  // Try OpenHardwareMonitor WMI namespace if installed
  try {
    const raw = await runPs(
      `(Get-WmiObject -Namespace root/OpenHardwareMonitor -Class Sensor -ErrorAction Stop | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -like '*GPU*' } | Measure-Object -Property Value -Maximum).Maximum`,
    );
    return parseNumber(raw);
  } catch {
    /* fall through */
  }
  // Fallback: GPU adapter driver via Win32_PerfFormattedData (approximate)
  try {
    const raw = await runPs(
      `(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Measure-Object -Property UtilizationPercentage -Maximum).Maximum`,
    );
    // We cannot get GPU temp without OHM; return null and signal unavailability
    void raw;
    return null;
  } catch {
    return null;
  }
}

// ── Full Thermal Snapshot ────────────────────────────────────

async function collectSnapshot(): Promise<ThermalSnapshot> {
  const [cpuTempC, gpuTempC, fanMode, fanSpeedPct, fanControlEnabled] =
    await Promise.all([
      getCpuTempC(),
      getGpuTempC(),
      getFanMode(),
      getFanSpeedPct(),
      isFanControlEnabled(),
    ]);
  return { cpuTempC, gpuTempC, fanMode, fanSpeedPct, fanControlEnabled };
}

// ── Built-in Fan Profiles ────────────────────────────────────

const FAN_PROFILES: FanProfile[] = [
  {
    name: "quiet",
    mode: "silent",
    description: "Minimizes fan noise; suitable for light tasks and media",
  },
  {
    name: "balanced",
    mode: "auto",
    description: "Dynamic fan curve adapts to workload automatically",
  },
  {
    name: "aggressive",
    mode: "turbo",
    description: "Maximum cooling; best for sustained gaming or heavy workloads",
  },
];

function formatProfiles(): string {
  return [
    "Fan profiles:",
    "",
    ...FAN_PROFILES.map((p) => `  ${p.name} (${p.mode.toUpperCase()}) — ${p.description}`),
    "",
    "Use /fan mode <auto|silent|turbo> to apply.",
  ].join("\n");
}

// ── Formatting ───────────────────────────────────────────────

function formatSnapshot(s: ThermalSnapshot): string {
  const lines: string[] = [
    `Fan Mode: ${s.fanMode.toUpperCase()}`,
    `Fan Control: ${s.fanControlEnabled ? "Enabled" : "Disabled"}`,
    `Fan Speed: ${s.fanSpeedPct != null ? `${s.fanSpeedPct}%` : "N/A"}`,
    `CPU Temp: ${s.cpuTempC != null ? `${Math.round(s.cpuTempC)}°C` : "N/A"}`,
    `GPU Temp: ${s.gpuTempC != null ? `${Math.round(s.gpuTempC)}°C` : "N/A (install OpenHardwareMonitor for GPU temp)"}`,
  ];
  return lines.join("\n");
}

export function formatHelp(): string {
  return [
    "ROG Fan Control commands:",
    "",
    "/fan           — Current fan status + temperatures",
    "/fan status    — Fan mode, speed, and thermal details",
    "/fan mode <auto|silent|turbo>  — Set fan mode",
    "/fan temp      — CPU/GPU temperatures only",
    "/fan profile   — Show fan profiles (quiet/balanced/aggressive)",
    "/fan help      — Show this help",
  ].join("\n");
}

// ── Plugin Entry ─────────────────────────────────────────────

export default definePluginEntry({
  id: "rog-fan",
  name: "ROG Fan Control",
  description: "Fan curve control and thermal monitoring for ASUS ROG devices",
  register(api: OpenClawPluginApi) {
    api.registerCommand({
      name: "fan",
      description: "ROG fan control and thermal monitoring (status, mode, temp, profile).",
      acceptsArgs: true,
      handler: async (ctx) => {
        const args = ctx.args?.trim() ?? "";
        const tokens = args.split(/\s+/).filter(Boolean);
        const action = tokens[0]?.toLowerCase() ?? "";

        // /fan or /fan help
        if (!action || action === "help") {
          return { text: formatHelp() };
        }

        // /fan status or /fan (with action === "status")
        if (action === "status") {
          const snapshot = await collectSnapshot();
          return { text: formatSnapshot(snapshot) };
        }

        // /fan mode <auto|silent|turbo>
        if (action === "mode") {
          const target = tokens[1]?.toLowerCase();
          if (!target) {
            const current = await getFanMode();
            return { text: `Current fan mode: ${current.toUpperCase()}` };
          }
          if (target !== "auto" && target !== "silent" && target !== "turbo") {
            return { text: "Usage: /fan mode <auto|silent|turbo>" };
          }
          const result = await setFanMode(target as FanMode);
          if (!result.ok) {
            return { text: result.error ?? "Failed to set fan mode." };
          }
          return { text: `Fan mode set to ${target.toUpperCase()}.` };
        }

        // /fan temp
        if (action === "temp") {
          const [cpuTempC, gpuTempC] = await Promise.all([getCpuTempC(), getGpuTempC()]);
          return {
            text: [
              `CPU Temp: ${cpuTempC != null ? `${Math.round(cpuTempC)}°C` : "N/A"}`,
              `GPU Temp: ${gpuTempC != null ? `${Math.round(gpuTempC)}°C` : "N/A (install OpenHardwareMonitor for GPU temp)"}`,
            ].join("\n"),
          };
        }

        // /fan profile
        if (action === "profile") {
          return { text: formatProfiles() };
        }

        // Fallback
        return { text: formatHelp() };
      },
    });
  },
});

export {
  FAN_MODE_MAP,
  FAN_MODE_TO_REG,
  FAN_PROFILES,
  formatProfiles,
  formatSnapshot,
  parseNumber,
};
