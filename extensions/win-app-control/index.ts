import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  definePluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/phone-control";

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────

interface ProcessInfo {
  name: string;
  pid: number;
  memoryMB: number;
  windowTitle: string;
}

// ── PowerShell Helpers ───────────────────────────────────────

const PS_OPTS = { shell: false, timeout: 15_000 } as const;

async function runPs(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    PS_OPTS,
  );
  return stdout.trim();
}

// ── List running apps ────────────────────────────────────────

async function listRunningApps(maxResults: number): Promise<ProcessInfo[]> {
  const script = `
Get-Process | Where-Object { $_.MainWindowTitle -ne "" } |
  Sort-Object -Property WorkingSet64 -Descending |
  Select-Object -First ${maxResults} |
  ForEach-Object {
    $mem = [math]::Round($_.WorkingSet64/1MB, 0)
    "$($_.ProcessName)|$($_.Id)|$mem|$($_.MainWindowTitle)"
  }
`.trim();

  try {
    const raw = await runPs(script);
    if (!raw) return [];

    return raw.split("\n").filter(Boolean).map((line) => {
      const [name, pid, mem, title] = line.split("|");
      return {
        name: name ?? "",
        pid: Number(pid) || 0,
        memoryMB: Number(mem) || 0,
        windowTitle: title ?? "",
      };
    });
  } catch {
    return [];
  }
}

// ── Launch app ───────────────────────────────────────────────

async function launchApp(appName: string): Promise<{ ok: boolean; message: string }> {
  // Try common app names first
  const appAliases: Record<string, string> = {
    notepad: "notepad.exe",
    calculator: "calc.exe",
    calc: "calc.exe",
    paint: "mspaint.exe",
    terminal: "wt.exe",
    cmd: "cmd.exe",
    explorer: "explorer.exe",
    edge: "msedge.exe",
    chrome: "chrome.exe",
    firefox: "firefox.exe",
    code: "code.exe",
    vscode: "code.exe",
    spotify: "spotify.exe",
    discord: "discord.exe",
    steam: "steam.exe",
    settings: "ms-settings:",
    store: "ms-windows-store:",
    task: "taskmgr.exe",
    taskmgr: "taskmgr.exe",
  };

  const resolved = appAliases[appName.toLowerCase()] ?? appName;

  try {
    // URI-style launches (ms-settings:, ms-windows-store:)
    if (resolved.includes(":")) {
      await runPs(`Start-Process "${resolved}"`);
      return { ok: true, message: `Launched ${appName}.` };
    }

    // Executable launch
    await runPs(`Start-Process "${resolved}" -ErrorAction Stop`);
    return { ok: true, message: `Launched ${appName}.` };
  } catch {
    // Try searching Start Menu
    try {
      const found = await runPs(
        `$app = Get-StartApps | Where-Object { $_.Name -like '*${appName.replace(/'/g, "''")}*' } | Select-Object -First 1; if ($app) { Start-Process "shell:AppsFolder\\$($app.AppID)"; $app.Name } else { throw "Not found" }`,
      );
      return { ok: true, message: `Launched ${found || appName}.` };
    } catch {
      return { ok: false, message: `Could not find or launch "${appName}". Try the full executable name.` };
    }
  }
}

// ── Focus app ────────────────────────────────────────────────

async function focusApp(appName: string): Promise<{ ok: boolean; message: string }> {
  const escapedName = appName.replace(/'/g, "''");
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$proc = Get-Process | Where-Object { $_.ProcessName -like '*${escapedName}*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($proc) {
  [WinAPI]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
  [WinAPI]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
  $proc.MainWindowTitle
} else {
  throw "No matching window"
}
`.trim();

  try {
    const title = await runPs(script);
    return { ok: true, message: `Focused: ${title || appName}` };
  } catch {
    return { ok: false, message: `No running window found for "${appName}".` };
  }
}

// ── Close app ────────────────────────────────────────────────

async function closeApp(appName: string): Promise<{ ok: boolean; message: string }> {
  const escapedName = appName.replace(/'/g, "''");
  const script = `
$procs = Get-Process | Where-Object { $_.ProcessName -like '*${escapedName}*' -and $_.MainWindowHandle -ne 0 }
$count = ($procs | Measure-Object).Count
$procs | ForEach-Object { $_.CloseMainWindow() | Out-Null }
$count
`.trim();

  try {
    const count = await runPs(script);
    const n = Number(count) || 0;
    if (n === 0) {
      return { ok: false, message: `No running window found for "${appName}".` };
    }
    return { ok: true, message: `Closed ${n} window(s) for ${appName}.` };
  } catch {
    return { ok: false, message: `Failed to close "${appName}".` };
  }
}

// ── Formatting ──────────────────────────────────────────────

function formatProcessList(apps: ProcessInfo[]): string {
  if (apps.length === 0) return "No windowed applications currently running.";

  const header = `Running applications (${apps.length}):\n`;
  const lines = apps.map((a, i) =>
    `${i + 1}. ${a.name} (PID ${a.pid}) — ${a.memoryMB}MB\n   ${a.windowTitle}`,
  );

  return header + lines.join("\n");
}

function formatHelp(): string {
  return [
    "Windows App Control commands:",
    "",
    "/app list — List running windowed applications",
    "/app launch <name> — Launch an application (supports aliases: chrome, code, steam, etc.)",
    "/app focus <name> — Bring app window to foreground",
    "/app close <name> — Gracefully close an application",
  ].join("\n");
}

// ── Plugin Entry ─────────────────────────────────────────────

export default definePluginEntry({
  id: "win-app-control",
  name: "Windows App Control",
  description: "Launch, focus, close, and list Windows applications",
  register(api: OpenClawPluginApi) {
    const maxResults = 30;

    api.registerCommand({
      name: "app",
      description: "Windows application control (list, launch, focus, close).",
      acceptsArgs: true,
      handler: async (ctx) => {
        const args = ctx.args?.trim() ?? "";
        const tokens = args.split(/\s+/).filter(Boolean);
        const action = tokens[0]?.toLowerCase() ?? "";

        if (!action || action === "help") {
          return { text: formatHelp() };
        }

        if (action === "list" || action === "ls") {
          const apps = await listRunningApps(maxResults);
          return { text: formatProcessList(apps) };
        }

        const target = tokens.slice(1).join(" ");
        if (!target) {
          return { text: `Usage: /app ${action} <name>` };
        }

        if (action === "launch" || action === "open" || action === "start") {
          const result = await launchApp(target);
          return { text: result.message };
        }

        if (action === "focus" || action === "fg") {
          const result = await focusApp(target);
          return { text: result.message };
        }

        if (action === "close" || action === "kill" || action === "quit") {
          const result = await closeApp(target);
          return { text: result.message };
        }

        return { text: formatHelp() };
      },
    });
  },
});
