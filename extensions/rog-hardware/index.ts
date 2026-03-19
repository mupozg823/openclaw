import {
  definePluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import {
  type PowerMode,
  getPowerMode,
  parseCommandArgs,
  parseNumber,
  runPs,
  setPowerMode,
  POWER_MODE_MAP,
} from "../rog-win-shared/index.ts";

// ── Types ────────────────────────────────────────────────────

interface RogTelemetry {
  cpu: { tempC: number | null };
  gpu: { usagePct: number | null; vramMB: number | null };
  battery: {
    pct: number | null;
    voltageMV: number | null;
    watts: number | null;
    healthPct: number | null;
    isCharging: boolean;
  };
  powerMode: PowerMode;
  displayHz: number | null;
}

interface RogStatus {
  isRogDevice: boolean;
  model: string | null;
  telemetry: RogTelemetry | null;
}

// ── ROG Detection ────────────────────────────────────────────

async function detectRogDevice(): Promise<{ isRog: boolean; model: string | null }> {
  try {
    const result = await runPs(
      `(Get-CimInstance Win32_ComputerSystem).Model`,
    );
    const isRog = /ROG|Republic of Gamers/i.test(result);
    return { isRog, model: result || null };
  } catch {
    return { isRog: false, model: null };
  }
}

// ── CPU Temperature ──────────────────────────────────────────

async function getCpuTemp(): Promise<number | null> {
  try {
    const raw = await runPs(
      `((Get-Counter '\\Thermal Zone Information(*)\\Temperature' -ErrorAction Stop).CounterSamples | Measure-Object -Property CookedValue -Maximum).Maximum - 273.15`,
    );
    return parseNumber(raw);
  } catch {
    return null;
  }
}

// ── GPU ──────────────────────────────────────────────────────

async function getGpuUsage(): Promise<{ usagePct: number | null; vramMB: number | null }> {
  try {
    const raw = await runPs(
      `$e=(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Measure-Object -Property UtilizationPercentage -Maximum).Maximum; $m=(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPULocalAdapterMemory -ErrorAction Stop | Measure-Object -Property LocalUsage -Maximum).Maximum; "$e|$m"`,
    );
    const [usage, vram] = raw.split("|");
    return {
      usagePct: parseNumber(usage ?? ""),
      vramMB: vram ? parseNumber(String(Math.round(Number(vram) / 1048576))) : null,
    };
  } catch {
    return { usagePct: null, vramMB: null };
  }
}

// ── Battery ──────────────────────────────────────────────────

async function getBattery(): Promise<RogTelemetry["battery"]> {
  try {
    const raw = await runPs(
      `$b=Get-CimInstance Win32_Battery -ErrorAction Stop; $s=Get-CimInstance -Namespace root/WMI -ClassName BatteryStatus -ErrorAction SilentlyContinue; $fc=Get-CimInstance -Namespace root/WMI -ClassName BatteryFullChargedCapacity -ErrorAction SilentlyContinue; "$($b.EstimatedChargeRemaining)|$($s.Voltage)|$($s.DischargeRate)|$($fc.FullChargedCapacity)|$($b.BatteryStatus)"`,
    );
    const [pct, voltage, discharge, fullCharge, status] = raw.split("|");
    const fullCap = parseNumber(fullCharge ?? "");
    const designCap = 80000; // ROG Ally X = 80Wh = 80000mWh
    return {
      pct: parseNumber(pct ?? ""),
      voltageMV: parseNumber(voltage ?? ""),
      watts: discharge ? parseNumber(String(Math.round(Number(discharge) / 1000))) : null,
      healthPct: fullCap ? parseNumber(String(Math.round((fullCap / designCap) * 100))) : null,
      isCharging: status === "2",
    };
  } catch {
    return { pct: null, voltageMV: null, watts: null, healthPct: null, isCharging: false };
  }
}

// ── Display ──────────────────────────────────────────────────

async function getDisplayHz(): Promise<number | null> {
  try {
    const raw = await runPs(
      `(Get-CimInstance Win32_VideoController -ErrorAction Stop).CurrentRefreshRate`,
    );
    return parseNumber(raw);
  } catch {
    return null;
  }
}

// ── Full Telemetry ───────────────────────────────────────────

async function collectTelemetry(): Promise<RogTelemetry> {
  const [cpuTemp, gpu, battery, powerMode, displayHz] = await Promise.all([
    getCpuTemp(),
    getGpuUsage(),
    getBattery(),
    getPowerMode(),
    getDisplayHz(),
  ]);
  return {
    cpu: { tempC: cpuTemp },
    gpu,
    battery,
    powerMode,
    displayHz,
  };
}

// ── Formatting ───────────────────────────────────────────────

function formatTelemetry(t: RogTelemetry): string {
  const lines: string[] = [
    `Power Mode: ${t.powerMode.toUpperCase()}`,
    `CPU Temp: ${t.cpu.tempC != null ? `${Math.round(t.cpu.tempC)}C` : "N/A"}`,
    `GPU Usage: ${t.gpu.usagePct != null ? `${t.gpu.usagePct}%` : "N/A"}`,
    `GPU VRAM: ${t.gpu.vramMB != null ? `${t.gpu.vramMB}MB` : "N/A"}`,
    `Display: ${t.displayHz != null ? `${t.displayHz}Hz` : "N/A"}`,
    `Battery: ${t.battery.pct != null ? `${t.battery.pct}%` : "N/A"}${t.battery.isCharging ? " (charging)" : ""}`,
  ];
  if (t.battery.watts != null) lines.push(`Power Draw: ${t.battery.watts}W`);
  if (t.battery.healthPct != null) lines.push(`Battery Health: ${t.battery.healthPct}%`);
  if (t.battery.voltageMV != null) lines.push(`Voltage: ${t.battery.voltageMV}mV`);
  return lines.join("\n");
}

function formatStatus(s: RogStatus): string {
  if (!s.isRogDevice) return "This device is not an ASUS ROG device.";
  const header = `ROG Device: ${s.model ?? "Unknown"}`;
  if (!s.telemetry) return header;
  return `${header}\n\n${formatTelemetry(s.telemetry)}`;
}

function formatHelp(): string {
  return [
    "ROG Hardware commands:",
    "",
    "/rog status — Show device info + telemetry",
    "/rog profile — Show current performance profile",
    "/rog profile <silent|performance|turbo> — Switch profile",
    "/rog temp — Show CPU/GPU temperatures",
    "/rog battery — Show battery details",
  ].join("\n");
}

// ── Plugin Entry ─────────────────────────────────────────────

export default definePluginEntry({
  id: "rog-hardware",
  name: "ROG Hardware Control",
  description: "ASUS ROG hardware monitoring and performance profile control",
  register(api: OpenClawPluginApi) {
    let rogDetected: { isRog: boolean; model: string | null } | null = null;

    async function ensureRog(): Promise<{ isRog: boolean; model: string | null }> {
      if (!rogDetected) rogDetected = await detectRogDevice();
      return rogDetected;
    }

    api.registerCommand({
      name: "rog",
      description: "ROG hardware monitoring and control (status, profile, temp, battery).",
      acceptsArgs: true,
      handler: async (ctx) => {
        const { action, tokens } = parseCommandArgs(ctx);

        if (!action || action === "help") {
          return { text: formatHelp() };
        }

        const device = await ensureRog();
        if (!device.isRog) {
          return { text: "This device is not an ASUS ROG device. The rog-hardware plugin requires ROG hardware." };
        }

        if (action === "status") {
          const telemetry = await collectTelemetry();
          return { text: formatStatus({ isRogDevice: true, model: device.model, telemetry }) };
        }

        if (action === "profile") {
          const target = tokens[1]?.toLowerCase();
          if (!target) {
            const mode = await getPowerMode();
            return { text: `Current profile: ${mode.toUpperCase()}` };
          }
          if (target !== "silent" && target !== "performance" && target !== "turbo") {
            return { text: "Usage: /rog profile <silent|performance|turbo>" };
          }
          const result = await setPowerMode(target);
          if (!result.ok) {
            return { text: result.error ?? "Failed to switch profile." };
          }
          return { text: `Performance profile switched to ${target.toUpperCase()}.` };
        }

        if (action === "temp") {
          const [cpuTemp, gpu] = await Promise.all([getCpuTemp(), getGpuUsage()]);
          return {
            text: [
              `CPU Temp: ${cpuTemp != null ? `${Math.round(cpuTemp)}C` : "N/A"}`,
              `GPU Usage: ${gpu.usagePct != null ? `${gpu.usagePct}%` : "N/A"}`,
              `GPU VRAM: ${gpu.vramMB != null ? `${gpu.vramMB}MB` : "N/A"}`,
            ].join("\n"),
          };
        }

        if (action === "battery") {
          const bat = await getBattery();
          return {
            text: [
              `Battery: ${bat.pct != null ? `${bat.pct}%` : "N/A"}${bat.isCharging ? " (charging)" : ""}`,
              `Power Draw: ${bat.watts != null ? `${bat.watts}W` : "N/A"}`,
              `Voltage: ${bat.voltageMV != null ? `${bat.voltageMV}mV` : "N/A"}`,
              `Health: ${bat.healthPct != null ? `${bat.healthPct}%` : "N/A"}`,
            ].join("\n"),
          };
        }

        return { text: formatHelp() };
      },
    });
  },
});

export { formatHelp, formatStatus, formatTelemetry, parseNumber, POWER_MODE_MAP };
export type { PowerMode, RogStatus, RogTelemetry };
