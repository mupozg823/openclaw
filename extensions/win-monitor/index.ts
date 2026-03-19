import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { definePluginEntry } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────

interface CpuSnapshot {
  usagePct: number;
  topProcesses: Array<{ name: string; pid: number; cpuPct: number }>;
}

interface GpuSnapshot {
  usagePct: number | null;
  vramUsedMB: number | null;
  vramTotalMB: number | null;
  tempC: number | null;
}

interface RamSnapshot {
  usedGB: number;
  totalGB: number;
  usagePct: number;
  topProcesses: Array<{ name: string; pid: number; memMB: number }>;
}

interface DiskSnapshot {
  drives: Array<{ letter: string; usedGB: number; totalGB: number; usagePct: number }>;
}

interface NetworkSnapshot {
  adapters: Array<{ name: string; sentKBs: number; recvKBs: number }>;
}

interface SystemSnapshot {
  timestamp: number;
  cpu: CpuSnapshot;
  gpu: GpuSnapshot;
  ram: RamSnapshot;
  disk: DiskSnapshot;
  network: NetworkSnapshot;
}

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

// ── CPU ──────────────────────────────────────────────────────

async function getCpu(): Promise<CpuSnapshot> {
  try {
    const raw = await runPs(`
$cpu = (Get-Counter '\\Processor(_Total)\\% Processor Time' -ErrorAction Stop).CounterSamples[0].CookedValue
$top = Get-Process | Sort-Object CPU -Descending | Select-Object -First 5 | ForEach-Object {
  "$($_.ProcessName)|$($_.Id)|$([math]::Round($_.CPU, 1))"
}
"CPU:$([math]::Round($cpu,1))"
$top
`.trim());
    const lines = raw.split("\n").filter(Boolean);
    const cpuLine = lines.find((l) => l.startsWith("CPU:"));
    const usagePct = cpuLine ? Number(cpuLine.split(":")[1]) || 0 : 0;
    const topProcesses = lines
      .filter((l) => !l.startsWith("CPU:"))
      .map((l) => {
        const [name, pid, cpu] = l.split("|");
        return { name: name ?? "", pid: Number(pid) || 0, cpuPct: Number(cpu) || 0 };
      });
    return { usagePct, topProcesses };
  } catch {
    return { usagePct: 0, topProcesses: [] };
  }
}

// ── GPU ──────────────────────────────────────────────────────

async function getGpu(): Promise<GpuSnapshot> {
  try {
    const raw = await runPs(`
$e = (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Measure-Object -Property UtilizationPercentage -Maximum).Maximum
$local = (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPULocalAdapterMemory -ErrorAction Stop | Measure-Object -Property LocalUsage -Maximum).Maximum
$vc = Get-CimInstance Win32_VideoController -ErrorAction Stop | Select-Object -First 1
$vram = $vc.AdapterRAM
$temp = $null
try { $temp = ((Get-Counter '\\GPU Engine(*)\\Temperature' -ErrorAction Stop).CounterSamples | Measure-Object -Property CookedValue -Maximum).Maximum } catch {}
"$e|$([math]::Round($local/1MB,0))|$([math]::Round($vram/1MB,0))|$temp"
`.trim());
    const [usage, used, total, temp] = raw.split("|");
    return {
      usagePct: usage ? Number(usage) : null,
      vramUsedMB: used ? Number(used) : null,
      vramTotalMB: total ? Number(total) : null,
      tempC: temp && temp !== "" ? Number(temp) : null,
    };
  } catch {
    return { usagePct: null, vramUsedMB: null, vramTotalMB: null, tempC: null };
  }
}

// ── RAM ──────────────────────────────────────────────────────

async function getRam(): Promise<RamSnapshot> {
  try {
    const raw = await runPs(`
$os = Get-CimInstance Win32_OperatingSystem
$total = [math]::Round($os.TotalVisibleMemorySize/1MB, 1)
$free = [math]::Round($os.FreePhysicalMemory/1MB, 1)
$used = [math]::Round($total - $free, 1)
$pct = [math]::Round(($used/$total)*100, 0)
$top = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 5 | ForEach-Object {
  "$($_.ProcessName)|$($_.Id)|$([math]::Round($_.WorkingSet64/1MB,0))"
}
"RAM:$used|$total|$pct"
$top
`.trim());
    const lines = raw.split("\n").filter(Boolean);
    const ramLine = lines.find((l) => l.startsWith("RAM:"));
    const ramParts = ramLine?.replace("RAM:", "").split("|") ?? [];
    const topProcesses = lines
      .filter((l) => !l.startsWith("RAM:"))
      .map((l) => {
        const [name, pid, mem] = l.split("|");
        return { name: name ?? "", pid: Number(pid) || 0, memMB: Number(mem) || 0 };
      });
    return {
      usedGB: Number(ramParts[0]) || 0,
      totalGB: Number(ramParts[1]) || 0,
      usagePct: Number(ramParts[2]) || 0,
      topProcesses,
    };
  } catch {
    return { usedGB: 0, totalGB: 0, usagePct: 0, topProcesses: [] };
  }
}

// ── Disk ─────────────────────────────────────────────────────

async function getDisk(): Promise<DiskSnapshot> {
  try {
    const raw = await runPs(`
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction Stop | ForEach-Object {
  $total = [math]::Round($_.Size/1GB, 1)
  $free = [math]::Round($_.FreeSpace/1GB, 1)
  $used = [math]::Round($total - $free, 1)
  $pct = if ($total -gt 0) { [math]::Round(($used/$total)*100, 0) } else { 0 }
  "$($_.DeviceID)|$used|$total|$pct"
}
`.trim());
    const drives = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [letter, used, total, pct] = l.split("|");
        return {
          letter: letter ?? "",
          usedGB: Number(used) || 0,
          totalGB: Number(total) || 0,
          usagePct: Number(pct) || 0,
        };
      });
    return { drives };
  } catch {
    return { drives: [] };
  }
}

// ── Network ──────────────────────────────────────────────────

async function getNetwork(): Promise<NetworkSnapshot> {
  try {
    const raw = await runPs(`
Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface -ErrorAction Stop |
  Where-Object { $_.BytesTotalPersec -gt 0 } |
  Select-Object -First 3 |
  ForEach-Object {
    "$($_.Name)|$([math]::Round($_.BytesSentPersec/1KB,1))|$([math]::Round($_.BytesReceivedPersec/1KB,1))"
  }
`.trim());
    const adapters = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [name, sent, recv] = l.split("|");
        return { name: name ?? "", sentKBs: Number(sent) || 0, recvKBs: Number(recv) || 0 };
      });
    return { adapters };
  } catch {
    return { adapters: [] };
  }
}

// ── Collect All ──────────────────────────────────────────────

async function collectSnapshot(): Promise<SystemSnapshot> {
  const [cpu, gpu, ram, disk, network] = await Promise.all([
    getCpu(),
    getGpu(),
    getRam(),
    getDisk(),
    getNetwork(),
  ]);
  return { timestamp: Date.now(), cpu, gpu, ram, disk, network };
}

// ── Sparkline ────────────────────────────────────────────────

function sparkline(values: number[], max: number): string {
  const chars = " ▁▂▃▄▅▆▇█";
  return values.map((v) => {
    const idx = Math.min(Math.round((v / max) * 8), 8);
    return chars[idx];
  }).join("");
}

// ── Formatting ───────────────────────────────────────────────

function bar(pct: number, width = 20): string {
  const filled = Math.round((pct / 100) * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}] ${pct}%`;
}

function formatDashboard(s: SystemSnapshot): string {
  const lines: string[] = [];

  // CPU
  lines.push(`CPU  ${bar(Math.round(s.cpu.usagePct))}`);
  if (s.cpu.topProcesses.length > 0) {
    lines.push(`  Top: ${s.cpu.topProcesses.map((p) => `${p.name}(${p.cpuPct}s)`).join(", ")}`);
  }

  // GPU
  lines.push("");
  lines.push(`GPU  ${s.gpu.usagePct != null ? bar(s.gpu.usagePct) : "N/A"}`);
  const gpuDetails: string[] = [];
  if (s.gpu.vramUsedMB != null && s.gpu.vramTotalMB != null) {
    gpuDetails.push(`VRAM: ${s.gpu.vramUsedMB}/${s.gpu.vramTotalMB}MB`);
  }
  if (s.gpu.tempC != null) gpuDetails.push(`Temp: ${Math.round(s.gpu.tempC)}C`);
  if (gpuDetails.length > 0) lines.push(`  ${gpuDetails.join(" | ")}`);

  // RAM
  lines.push("");
  lines.push(`RAM  ${bar(s.ram.usagePct)}  ${s.ram.usedGB}/${s.ram.totalGB}GB`);
  if (s.ram.topProcesses.length > 0) {
    lines.push(`  Top: ${s.ram.topProcesses.map((p) => `${p.name}(${p.memMB}MB)`).join(", ")}`);
  }

  // Disk
  if (s.disk.drives.length > 0) {
    lines.push("");
    for (const d of s.disk.drives) {
      lines.push(`${d.letter}   ${bar(d.usagePct, 15)}  ${d.usedGB}/${d.totalGB}GB`);
    }
  }

  // Network
  if (s.network.adapters.length > 0) {
    lines.push("");
    lines.push("Network:");
    for (const a of s.network.adapters) {
      const name = a.name.length > 25 ? `${a.name.slice(0, 22)}...` : a.name;
      lines.push(`  ${name}  ↑${a.sentKBs}KB/s  ↓${a.recvKBs}KB/s`);
    }
  }

  return lines.join("\n");
}

function formatCpuDetail(cpu: CpuSnapshot): string {
  const lines = [`CPU Usage: ${bar(Math.round(cpu.usagePct))}`];
  if (cpu.topProcesses.length > 0) {
    lines.push("");
    lines.push("Top processes by CPU time:");
    for (const [i, p] of cpu.topProcesses.entries()) {
      lines.push(`  ${i + 1}. ${p.name} (PID ${p.pid}) — ${p.cpuPct}s`);
    }
  }
  return lines.join("\n");
}

function formatGpuDetail(gpu: GpuSnapshot): string {
  const lines: string[] = [];
  lines.push(`GPU Usage: ${gpu.usagePct != null ? bar(gpu.usagePct) : "N/A"}`);
  if (gpu.vramUsedMB != null && gpu.vramTotalMB != null) {
    const vramPct = Math.round((gpu.vramUsedMB / gpu.vramTotalMB) * 100);
    lines.push(`VRAM: ${bar(vramPct, 15)}  ${gpu.vramUsedMB}/${gpu.vramTotalMB}MB`);
  }
  if (gpu.tempC != null) lines.push(`Temperature: ${Math.round(gpu.tempC)}C`);
  return lines.join("\n");
}

function formatRamDetail(ram: RamSnapshot): string {
  const lines = [`RAM: ${bar(ram.usagePct)}  ${ram.usedGB}/${ram.totalGB}GB`];
  if (ram.topProcesses.length > 0) {
    lines.push("");
    lines.push("Top processes by memory:");
    for (const [i, p] of ram.topProcesses.entries()) {
      lines.push(`  ${i + 1}. ${p.name} (PID ${p.pid}) — ${p.memMB}MB`);
    }
  }
  return lines.join("\n");
}

function formatHelp(): string {
  return [
    "System Monitor commands:",
    "",
    "/monitor — Full system dashboard (CPU, GPU, RAM, disk, network)",
    "/monitor cpu — CPU usage + top processes",
    "/monitor gpu — GPU usage, VRAM, temperature",
    "/monitor ram — Memory usage + top processes",
    "/monitor disk — Disk usage per drive",
    "/monitor net — Network throughput per adapter",
  ].join("\n");
}

// ── History ──────────────────────────────────────────────────

const history: Array<{ ts: number; cpu: number; gpu: number; ram: number }> = [];
const MAX_HISTORY = 30;

function recordHistory(s: SystemSnapshot): void {
  history.push({
    ts: s.timestamp,
    cpu: Math.round(s.cpu.usagePct),
    gpu: s.gpu.usagePct ?? 0,
    ram: s.ram.usagePct,
  });
  if (history.length > MAX_HISTORY) history.shift();
}

// ── Plugin Entry ─────────────────────────────────────────────

export { bar, sparkline };

export default definePluginEntry({
  id: "win-monitor",
  name: "Windows System Monitor",
  description: "Real-time CPU, GPU, RAM, disk, and network monitoring dashboard",
  register(api: OpenClawPluginApi) {
    api.registerCommand({
      name: "monitor",
      description: "System monitoring dashboard (cpu, gpu, ram, disk, net).",
      acceptsArgs: true,
      handler: async (ctx) => {
        const args = ctx.args?.trim().toLowerCase() ?? "";

        if (args === "help") return { text: formatHelp() };

        if (args === "cpu") {
          const cpu = await getCpu();
          return { text: formatCpuDetail(cpu) };
        }

        if (args === "gpu") {
          const gpu = await getGpu();
          return { text: formatGpuDetail(gpu) };
        }

        if (args === "ram" || args === "mem") {
          const ram = await getRam();
          return { text: formatRamDetail(ram) };
        }

        if (args === "disk") {
          const disk = await getDisk();
          if (disk.drives.length === 0) return { text: "No drives found." };
          const lines = disk.drives.map(
            (d) => `${d.letter}  ${bar(d.usagePct, 15)}  ${d.usedGB}/${d.totalGB}GB`,
          );
          return { text: lines.join("\n") };
        }

        if (args === "net" || args === "network") {
          const net = await getNetwork();
          if (net.adapters.length === 0) return { text: "No active network adapters." };
          const lines = net.adapters.map(
            (a) => `${a.name}\n  ↑ ${a.sentKBs}KB/s  ↓ ${a.recvKBs}KB/s`,
          );
          return { text: lines.join("\n") };
        }

        if (args === "history" || args === "trend") {
          if (history.length < 2) {
            return { text: "Not enough data yet. Run /monitor a few times to build history." };
          }
          const cpuVals = history.map((h) => h.cpu);
          const gpuVals = history.map((h) => h.gpu);
          const ramVals = history.map((h) => h.ram);
          return {
            text: [
              `CPU  ${sparkline(cpuVals, 100)}  ${cpuVals[cpuVals.length - 1]}%`,
              `GPU  ${sparkline(gpuVals, 100)}  ${gpuVals[gpuVals.length - 1]}%`,
              `RAM  ${sparkline(ramVals, 100)}  ${ramVals[ramVals.length - 1]}%`,
              `(${history.length} samples)`,
            ].join("\n"),
          };
        }

        // Default: full dashboard
        const snapshot = await collectSnapshot();
        recordHistory(snapshot);
        return { text: formatDashboard(snapshot) };
      },
    });
  },
});
