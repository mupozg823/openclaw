import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { definePluginEntry } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

const execFileAsync = promisify(execFile);

// ── PowerShell ───────────────────────────────────────────────

const PS_OPTS = { shell: false, timeout: 15_000 } as const;

async function runPs(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    PS_OPTS,
  );
  return stdout.trim();
}

// ── Virtual Desktop ─────────────────────────────────────────

interface VirtualDesktopInfo {
  index: number;
  name: string;
  isCurrent: boolean;
}

async function getVirtualDesktops(): Promise<VirtualDesktopInfo[]> {
  try {
    const raw = await runPs(`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b")]
public interface IVirtualDesktopManager {
    bool IsWindowOnCurrentVirtualDesktop(IntPtr topLevelWindow);
    Guid GetWindowDesktopId(IntPtr topLevelWindow);
    void MoveWindowToDesktop(IntPtr topLevelWindow, ref Guid desktopId);
}
'@
$shell = New-Object -ComObject Shell.Application
$desktops = Get-ItemProperty 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VirtualDesktops' -ErrorAction SilentlyContinue
$currentId = $desktops.CurrentVirtualDesktop
$ids = $desktops.VirtualDesktopIDs
if ($ids -eq $null) {
  Write-Host "1|Desktop 1|true"
} else {
  $count = $ids.Length / 16
  for ($i = 0; $i -lt $count; $i++) {
    $guidBytes = $ids[($i*16)..(($i+1)*16-1)]
    $guid = [Guid]::new($guidBytes)
    $isCurrent = ($currentId -ne $null) -and ([Guid]::new($currentId) -eq $guid)
    $name = "Desktop $($i+1)"
    try {
      $nameKey = Get-ItemProperty "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VirtualDesktops\\Desktops\\{$guid}" -Name Name -ErrorAction SilentlyContinue
      if ($nameKey.Name) { $name = $nameKey.Name }
    } catch {}
    Write-Host "$($i+1)|$name|$isCurrent"
  }
}
`.trim());
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [idx, name, current] = line.split("|");
        return {
          index: Number(idx) || 1,
          name: name ?? "Desktop",
          isCurrent: current === "True",
        };
      });
  } catch {
    return [{ index: 1, name: "Desktop 1", isCurrent: true }];
  }
}

async function switchDesktop(direction: "left" | "right" | "new"): Promise<boolean> {
  const keyMap: Record<string, string> = {
    left: "^%{LEFT}",
    right: "^%{RIGHT}",
    new: "^%d",
  };
  try {
    await runPs(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${keyMap[direction]}')
`.trim());
    return true;
  } catch {
    return false;
  }
}

async function closeCurrentDesktop(): Promise<boolean> {
  try {
    await runPs(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('^%{F4}')
`.trim());
    return true;
  } catch {
    return false;
  }
}

// ── Display/Monitor ─────────────────────────────────────────

interface MonitorInfo {
  name: string;
  resolution: string;
  primary: boolean;
  position: string;
}

async function getMonitors(): Promise<MonitorInfo[]> {
  try {
    const raw = await runPs(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  $r = $_.Bounds
  "$($_.DeviceName)|$($r.Width)x$($r.Height)|$($_.Primary)|$($r.X),$($r.Y)"
}
`.trim());
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, res, primary, pos] = line.split("|");
        return {
          name: (name ?? "").replace(/\\\\.\\/, ""),
          resolution: res ?? "",
          primary: primary === "True",
          position: pos ?? "0,0",
        };
      });
  } catch {
    return [];
  }
}

// ── Window Management ───────────────────────────────────────

interface WindowInfo {
  title: string;
  pid: number;
  processName: string;
}

async function getVisibleWindows(): Promise<WindowInfo[]> {
  try {
    const raw = await runPs(`
Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 20 | ForEach-Object {
  "$($_.MainWindowTitle)|$($_.Id)|$($_.ProcessName)"
}
`.trim());
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [title, pid, proc] = line.split("|");
        return {
          title: title ?? "",
          pid: Number(pid) || 0,
          processName: proc ?? "",
        };
      });
  } catch {
    return [];
  }
}

async function arrangeWindows(layout: "cascade" | "tile-h" | "tile-v" | "minimize-all" | "restore-all"): Promise<boolean> {
  const scripts: Record<string, string> = {
    "cascade": `$shell = New-Object -ComObject Shell.Application; $shell.CascadeWindows()`,
    "tile-h": `$shell = New-Object -ComObject Shell.Application; $shell.TileHorizontally()`,
    "tile-v": `$shell = New-Object -ComObject Shell.Application; $shell.TileVertically()`,
    "minimize-all": `$shell = New-Object -ComObject Shell.Application; $shell.MinimizeAll()`,
    "restore-all": `$shell = New-Object -ComObject Shell.Application; $shell.UndoMinimizeAll()`,
  };
  const script = scripts[layout];
  if (!script) return false;
  try {
    await runPs(script);
    return true;
  } catch {
    return false;
  }
}

// ── Snap Zones (Win+Arrow) ──────────────────────────────────

async function snapWindow(direction: "left" | "right" | "up" | "down"): Promise<boolean> {
  const keyMap: Record<string, string> = {
    left: "#{LEFT}",
    right: "#{RIGHT}",
    up: "#{UP}",
    down: "#{DOWN}",
  };
  try {
    await runPs(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${keyMap[direction]}')
`.trim());
    return true;
  } catch {
    return false;
  }
}

// ── Formatting ──────────────────────────────────────────────

function formatDesktopList(desktops: VirtualDesktopInfo[]): string {
  if (desktops.length === 0) return "No virtual desktops found.";
  const lines = desktops.map(
    (d) => `  ${d.isCurrent ? "→" : " "} ${d.index}. ${d.name}${d.isCurrent ? " (current)" : ""}`,
  );
  return `Virtual Desktops (${desktops.length}):\n${lines.join("\n")}`;
}

function formatMonitorList(monitors: MonitorInfo[]): string {
  if (monitors.length === 0) return "No monitors detected.";
  const lines = monitors.map(
    (m) =>
      `  ${m.primary ? "★" : " "} ${m.name} — ${m.resolution} at (${m.position})${m.primary ? " [primary]" : ""}`,
  );
  return `Monitors (${monitors.length}):\n${lines.join("\n")}`;
}

function formatWindowList(windows: WindowInfo[]): string {
  if (windows.length === 0) return "No visible windows.";
  const lines = windows.map(
    (w) => {
      const title = w.title.length > 50 ? `${w.title.slice(0, 47)}...` : w.title;
      return `  ${w.processName} (PID ${w.pid}): ${title}`;
    },
  );
  return `Visible windows (${windows.length}):\n${lines.join("\n")}`;
}

function formatHelp(): string {
  return [
    "Desktop & Window commands:",
    "",
    "Virtual Desktops:",
    "  /desktop — List virtual desktops",
    "  /desktop left|right — Switch desktop",
    "  /desktop new — Create new desktop",
    "  /desktop close — Close current desktop",
    "",
    "Monitors:",
    "  /desktop monitors — List connected displays",
    "",
    "Windows:",
    "  /desktop windows — List visible windows",
    "  /desktop snap <left|right|up|down> — Snap active window",
    "  /desktop cascade — Cascade all windows",
    "  /desktop tile-h|tile-v — Tile windows",
    "  /desktop minimize — Minimize all windows",
    "  /desktop restore — Restore all windows",
  ].join("\n");
}

// ── Plugin Entry ────────────────────────────────────────────

export default definePluginEntry({
  id: "win-desktop",
  name: "Windows Desktop Control",
  description: "Virtual desktop switching, multi-monitor info, and window arrangement",
  register(api: OpenClawPluginApi) {
    api.registerCommand({
      name: "desktop",
      description: "Virtual desktops, monitors, and window arrangement.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const args = ctx.args?.trim().toLowerCase() ?? "";
        const tokens = args.split(/\s+/).filter(Boolean);
        const action = tokens[0] ?? "";

        if (action === "help") return { text: formatHelp() };

        // /desktop left|right
        if (action === "left" || action === "right" || action === "prev" || action === "next") {
          const dir = action === "prev" || action === "left" ? "left" : "right";
          const ok = await switchDesktop(dir);
          return { text: ok ? `Switched desktop ${dir}.` : "Failed to switch desktop." };
        }

        // /desktop new
        if (action === "new" || action === "create" || action === "add") {
          const ok = await switchDesktop("new");
          return { text: ok ? "New virtual desktop created." : "Failed to create desktop." };
        }

        // /desktop close
        if (action === "close" || action === "remove" || action === "delete") {
          const ok = await closeCurrentDesktop();
          return { text: ok ? "Current desktop closed." : "Failed to close desktop." };
        }

        // /desktop monitors
        if (action === "monitors" || action === "displays" || action === "screen") {
          const monitors = await getMonitors();
          return { text: formatMonitorList(monitors) };
        }

        // /desktop windows
        if (action === "windows" || action === "win" || action === "list") {
          const windows = await getVisibleWindows();
          return { text: formatWindowList(windows) };
        }

        // /desktop snap <direction>
        if (action === "snap") {
          const dir = tokens[1];
          if (!dir || !["left", "right", "up", "down"].includes(dir)) {
            return { text: "Usage: /desktop snap <left|right|up|down>" };
          }
          const ok = await snapWindow(dir as "left" | "right" | "up" | "down");
          return { text: ok ? `Window snapped ${dir}.` : "Failed to snap window." };
        }

        // /desktop cascade|tile-h|tile-v|minimize|restore
        if (["cascade", "tile-h", "tile-v", "tileh", "tilev"].includes(action)) {
          const layout = action.replace("tileh", "tile-h").replace("tilev", "tile-v") as "cascade" | "tile-h" | "tile-v";
          const ok = await arrangeWindows(layout);
          return { text: ok ? `Windows arranged: ${layout}.` : "Failed to arrange windows." };
        }

        if (action === "minimize" || action === "min") {
          const ok = await arrangeWindows("minimize-all");
          return { text: ok ? "All windows minimized." : "Failed to minimize." };
        }

        if (action === "restore" || action === "unmin") {
          const ok = await arrangeWindows("restore-all");
          return { text: ok ? "All windows restored." : "Failed to restore." };
        }

        // Default: show desktops
        const desktops = await getVirtualDesktops();
        return { text: formatDesktopList(desktops) };
      },
    });
  },
});

export { formatHelp, formatDesktopList, formatMonitorList, formatWindowList };
