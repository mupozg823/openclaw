import {
  definePluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { runPs, isAdmin, parseCommandArgs } from "../rog-win-shared/index.ts";

// ── Types ────────────────────────────────────────────────────

export interface SystemInfo {
  osName: string;
  build: string;
  hostname: string;
  uptime: string;
  user: string;
  isAdmin: boolean;
  nodeVersion: string;
  psVersion: string;
}

export interface ServiceStatus {
  name: string;
  displayName: string;
  status: string;
  startType: string;
}

// ── Autostart (HKCU — no admin needed) ───────────────────────

const AUTOSTART_KEY = `HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run`;
const AUTOSTART_NAME = "OpenClaw";

async function getAutostartPath(): Promise<string | null> {
  try {
    const raw = await runPs(
      `(Get-ItemProperty '${AUTOSTART_KEY}' -ErrorAction SilentlyContinue).${AUTOSTART_NAME}`,
      15_000,
    );
    return raw || null;
  } catch {
    return null;
  }
}

async function enableAutostart(): Promise<{ ok: boolean; error?: string }> {
  try {
    // Resolve the current Node.js / openclaw executable path
    const exePath = process.execPath;
    const scriptPath = process.argv[1] ?? "openclaw";
    const value =
      exePath.endsWith("node.exe") || exePath.endsWith("node")
        ? `"${exePath}" "${scriptPath}" --background`
        : `"${exePath}" --background`;

    await runPs(
      `Set-ItemProperty '${AUTOSTART_KEY}' -Name '${AUTOSTART_NAME}' -Value '${value.replace(/'/g, "''")}'`,
      15_000,
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Registry write failed: ${e}` };
  }
}

async function disableAutostart(): Promise<{ ok: boolean; error?: string }> {
  try {
    await runPs(
      `Remove-ItemProperty '${AUTOSTART_KEY}' -Name '${AUTOSTART_NAME}' -ErrorAction SilentlyContinue`,
      15_000,
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Registry write failed: ${e}` };
  }
}

// ── System Info ───────────────────────────────────────────────

async function getSystemInfo(): Promise<SystemInfo> {
  const [osRaw, psVersionRaw, adminResult] = await Promise.all([
    runPs(
      `$os = Get-CimInstance Win32_OperatingSystem; "$($os.Caption)|$($os.BuildNumber)|$($os.CSName)|$($os.LastBootUpTime)"`,
      15_000,
    ).catch(() => "|||"),
    runPs(`$PSVersionTable.PSVersion.ToString()`, 15_000).catch(() => "unknown"),
    isAdmin(),
  ]);

  const [osName = "Unknown", build = "Unknown", hostname = "Unknown", lastBoot = ""] =
    osRaw.split("|");

  // Calculate uptime from LastBootUpTime
  let uptime = "Unknown";
  if (lastBoot) {
    try {
      const bootMs = Date.parse(lastBoot);
      if (!Number.isNaN(bootMs)) {
        uptime = formatDuration(Date.now() - bootMs);
      }
    } catch {
      // leave as Unknown
    }
  }

  return {
    osName: osName.trim(),
    build: build.trim(),
    hostname: hostname.trim(),
    uptime,
    user: process.env["USERNAME"] ?? process.env["USER"] ?? "Unknown",
    isAdmin: adminResult,
    nodeVersion: process.version,
    psVersion: psVersionRaw.trim(),
  };
}

// ── Uptime ────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(" ");
}

async function getUptime(): Promise<string> {
  try {
    const raw = await runPs(
      `$os = Get-CimInstance Win32_OperatingSystem; (Get-Date) - $os.LastBootUpTime | ForEach-Object { "$($_.Days)|$($_.Hours)|$($_.Minutes)" }`,
      15_000,
    );
    const [d, h, m] = raw.split("|").map((v) => Number(v) || 0);
    const parts: string[] = [];
    if ((d ?? 0) > 0) parts.push(`${d}d`);
    if ((h ?? 0) > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    return parts.join(" ");
  } catch {
    return "Unknown";
  }
}

// ── ASUS Services ─────────────────────────────────────────────

const ASUS_SERVICE_PATTERNS = [
  "ArmouryCrate",
  "AsusCertService",
  "AsusAppService",
  "ASUSROGLSLService",
  "ArmourySocketServer",
  "asus",
];

async function getAsusServices(): Promise<ServiceStatus[]> {
  const pattern = ASUS_SERVICE_PATTERNS.map((p) => `'*${p}*'`).join(",");
  const script = `
Get-Service | Where-Object { $_.Name -like ${pattern.split(",").join(" -or $_.Name -like ")} } |
  Select-Object Name, DisplayName, Status, StartType |
  ForEach-Object { "$($_.Name)|$($_.DisplayName)|$($_.Status)|$($_.StartType)" }
`.trim();

  try {
    const raw = await runPs(script, 15_000);
    if (!raw) return [];
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name = "", displayName = "", status = "", startType = ""] = line.split("|");
        return { name: name.trim(), displayName: displayName.trim(), status: status.trim(), startType: startType.trim() };
      });
  } catch {
    return [];
  }
}

// ── Environment Diagnostics ───────────────────────────────────

async function getDiagnostics(): Promise<string[]> {
  const [psVersion, adminResult] = await Promise.all([
    runPs(`$PSVersionTable.PSVersion.ToString()`, 15_000).catch(() => "unknown"),
    isAdmin(),
  ]);

  const lines: string[] = [
    `Node.js: ${process.version}`,
    `Platform: ${process.platform} (${process.arch})`,
    `PowerShell: ${psVersion.trim()}`,
    `Admin: ${adminResult ? "Yes" : "No"}`,
    `Process: ${process.execPath}`,
  ];

  if (process.argv[1]) {
    lines.push(`Script: ${process.argv[1]}`);
  }

  const pathEnv = process.env["PATH"] ?? process.env["Path"] ?? "";
  const pathCount = pathEnv.split(";").filter(Boolean).length;
  lines.push(`PATH entries: ${pathCount}`);

  return lines;
}

// ── Formatting ────────────────────────────────────────────────

function formatSystemInfo(info: SystemInfo): string {
  return [
    `OS: ${info.osName} (Build ${info.build})`,
    `Host: ${info.hostname}`,
    `User: ${info.user}${info.isAdmin ? " (Administrator)" : ""}`,
    `Uptime: ${info.uptime}`,
    `Node.js: ${info.nodeVersion}`,
    `PowerShell: ${info.psVersion}`,
  ].join("\n");
}

function formatServiceList(services: ServiceStatus[]): string {
  if (services.length === 0) {
    return "No ASUS/Armoury Crate services found on this system.";
  }
  const header = `ASUS services (${services.length}):\n`;
  const lines = services.map(
    (s) => `• ${s.displayName || s.name} — ${s.status} [${s.startType}]`,
  );
  return header + lines.join("\n");
}

export function formatHelp(): string {
  return [
    "Windows OS Integration commands:",
    "",
    "/system               — System info summary (OS, uptime, user, admin)",
    "/system autostart     — Check autostart registration status",
    "/system autostart on  — Register OpenClaw for Windows autostart (HKCU)",
    "/system autostart off — Remove OpenClaw from Windows autostart",
    "/system services      — Show ASUS / Armoury Crate service status",
    "/system uptime        — Show system uptime since last boot",
    "/system diag          — Environment diagnostics (Node, PS, admin, paths)",
    "/system help          — Show this help",
  ].join("\n");
}

// ── Plugin Entry ─────────────────────────────────────────────

export default definePluginEntry({
  id: "win-startup",
  name: "Windows OS Integration",
  description: "Windows OS integration — autostart management, system info, ASUS services, and diagnostics",
  register(api: OpenClawPluginApi) {
    api.registerCommand({
      name: "system",
      description: "Windows OS integration — autostart, system info, services, diagnostics.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const { action, tokens } = parseCommandArgs(ctx);

        // Default: system summary
        if (!action) {
          const info = await getSystemInfo();
          return { text: formatSystemInfo(info) };
        }

        if (action === "help") {
          return { text: formatHelp() };
        }

        if (action === "uptime") {
          const up = await getUptime();
          return { text: `System uptime: ${up}` };
        }

        if (action === "autostart") {
          const sub = tokens[1]?.toLowerCase();

          if (!sub) {
            // Status check
            const path = await getAutostartPath();
            if (path) {
              return { text: `Autostart: ENABLED\nRegistry value: ${path}` };
            }
            return { text: "Autostart: DISABLED (not registered in HKCU Run key)" };
          }

          if (sub === "on" || sub === "enable") {
            const result = await enableAutostart();
            if (!result.ok) {
              return { text: `Failed to enable autostart: ${result.error}` };
            }
            const path = await getAutostartPath();
            return { text: `Autostart enabled.\nRegistry value: ${path ?? "(unknown)"}` };
          }

          if (sub === "off" || sub === "disable") {
            const result = await disableAutostart();
            if (!result.ok) {
              return { text: `Failed to disable autostart: ${result.error}` };
            }
            return { text: "Autostart disabled. OpenClaw removed from HKCU Run key." };
          }

          return { text: `Unknown autostart subcommand: ${sub}\nUsage: /system autostart [on|off]` };
        }

        if (action === "services") {
          const services = await getAsusServices();
          return { text: formatServiceList(services) };
        }

        if (action === "diag") {
          const lines = await getDiagnostics();
          return { text: `Environment diagnostics:\n\n${lines.join("\n")}` };
        }

        return { text: formatHelp() };
      },
    });
  },
});
