import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { definePluginEntry } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────

type PowerProfile = "silent" | "performance" | "turbo";

type AuraMode = "static" | "breathing" | "color-cycle" | "rainbow" | "strobe" | "off";

interface AutoRule {
  id: string;
  name: string;
  processNames: string[];
  profile: PowerProfile;
  enabled: boolean;
  rgbMode?: AuraMode;
  rgbColor?: string; // hex "#RRGGBB"
  rgbBrightness?: number; // 0-3
  fanMode?: "auto" | "silent" | "turbo";
}

// ── Built-in game/app rules ──────────────────────────────────

const BUILTIN_RULES: AutoRule[] = [
  { id: "steam-games", name: "Steam Games", processNames: ["steam_osc", "steamwebhelper"], profile: "performance", enabled: true, rgbMode: "breathing", rgbColor: "#00D4FF", rgbBrightness: 2 },
  { id: "cyberpunk", name: "Cyberpunk 2077", processNames: ["Cyberpunk2077"], profile: "turbo", enabled: true, rgbMode: "static", rgbColor: "#FFFF00", rgbBrightness: 3, fanMode: "turbo" },
  { id: "elden-ring", name: "Elden Ring", processNames: ["eldenring"], profile: "turbo", enabled: true, rgbMode: "breathing", rgbColor: "#FFD700", rgbBrightness: 3, fanMode: "turbo" },
  { id: "baldurs-gate", name: "Baldur's Gate 3", processNames: ["bg3", "bg3_dx11"], profile: "turbo", enabled: true, rgbMode: "static", rgbColor: "#FF4655", rgbBrightness: 3 },
  { id: "genshin", name: "Genshin Impact", processNames: ["GenshinImpact", "YuanShen"], profile: "performance", enabled: true, rgbMode: "breathing", rgbColor: "#00BFFF", rgbBrightness: 2 },
  { id: "fortnite", name: "Fortnite", processNames: ["FortniteClient-Win64-Shipping"], profile: "turbo", enabled: true, rgbMode: "color-cycle", rgbBrightness: 3 },
  { id: "valorant", name: "Valorant", processNames: ["VALORANT-Win64-Shipping"], profile: "turbo", enabled: true, rgbMode: "static", rgbColor: "#FF4655", rgbBrightness: 3, fanMode: "turbo" },
  { id: "cod", name: "Call of Duty", processNames: ["cod", "ModernWarfare"], profile: "turbo", enabled: true, rgbMode: "strobe", rgbColor: "#FF0000", rgbBrightness: 3 },
  { id: "apex", name: "Apex Legends", processNames: ["r5apex"], profile: "turbo", enabled: true, rgbMode: "static", rgbColor: "#FF0000", rgbBrightness: 3 },
  { id: "lol", name: "League of Legends", processNames: ["League of Legends"], profile: "performance", enabled: true, rgbMode: "breathing", rgbColor: "#00D4FF", rgbBrightness: 2 },
  { id: "obs", name: "OBS Studio", processNames: ["obs64"], profile: "performance", enabled: true, rgbMode: "static", rgbColor: "#FFFFFF", rgbBrightness: 1 },
  { id: "premiere", name: "Adobe Premiere", processNames: ["Adobe Premiere Pro"], profile: "turbo", enabled: true, rgbMode: "static", rgbColor: "#9999FF", rgbBrightness: 1 },
  { id: "davinci", name: "DaVinci Resolve", processNames: ["Resolve"], profile: "turbo", enabled: true, rgbMode: "static", rgbColor: "#FF8000", rgbBrightness: 2 },
  { id: "blender", name: "Blender", processNames: ["blender"], profile: "turbo", enabled: true, rgbMode: "static", rgbColor: "#FF8000", rgbBrightness: 2 },
  { id: "vscode", name: "VS Code (light)", processNames: ["Code"], profile: "silent", enabled: false, rgbMode: "breathing", rgbColor: "#007ACC", rgbBrightness: 1 },
];

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

async function isAdmin(): Promise<boolean> {
  try {
    const raw = await runPs(
      `([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)`,
    );
    return raw.trim() === "True";
  } catch {
    return false;
  }
}

// ── Process Detection ────────────────────────────────────────

async function getRunningProcessNames(): Promise<Set<string>> {
  try {
    const raw = await runPs(
      `Get-Process | Select-Object -ExpandProperty ProcessName -Unique`,
    );
    return new Set(raw.split("\n").map((l) => l.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function findMatchingRule(running: Set<string>, rules: AutoRule[]): AutoRule | null {
  // Priority: turbo > performance > silent
  const priorityOrder: PowerProfile[] = ["turbo", "performance", "silent"];
  for (const profile of priorityOrder) {
    for (const rule of rules) {
      if (!rule.enabled || rule.profile !== profile) continue;
      if (rule.processNames.some((p) => running.has(p))) {
        return rule;
      }
    }
  }
  return null;
}

// ── Profile Switching ────────────────────────────────────────

const POWER_MODE_MAP: Record<PowerProfile, string> = {
  silent: "0",
  performance: "1",
  turbo: "2",
};

async function getCurrentProfile(): Promise<PowerProfile | null> {
  try {
    const raw = await runPs(
      `(Get-ItemProperty 'HKLM:\\SOFTWARE\\ASUS\\ARMOURY CRATE Service\\ThrottlePlugin\\ROG ATKStatus' -ErrorAction Stop).PowerMode`,
    );
    const map: Record<string, PowerProfile> = { "0": "silent", "1": "performance", "2": "turbo" };
    return map[raw.trim()] ?? null;
  } catch {
    return null;
  }
}

async function setProfile(profile: PowerProfile): Promise<boolean> {
  try {
    await runPs(
      `Set-ItemProperty 'HKLM:\\SOFTWARE\\ASUS\\ARMOURY CRATE Service\\ThrottlePlugin\\ROG ATKStatus' -Name PowerMode -Value ${POWER_MODE_MAP[profile]}`,
    );
    return true;
  } catch {
    return false;
  }
}

// ── State Persistence ────────────────────────────────────────

interface PersistedState {
  customRules: AutoRule[];
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

// ── Engine State ─────────────────────────────────────────────

let engineRunning = false;
let engineInterval: ReturnType<typeof setInterval> | null = null;
let lastAppliedRule: string | null = null;
let customRules: AutoRule[] = [];

function getAllRules(): AutoRule[] {
  return [...BUILTIN_RULES, ...customRules];
}

// ── Linked Subsystem Control ─────────────────────────────────

const AURA_REG_CANDIDATES = [
  "HKLM:\\SOFTWARE\\ASUS\\ARMOURY CRATE Service\\AuraService",
  "HKLM:\\SOFTWARE\\ASUS\\AsRogAuraServiceSDK",
  "HKLM:\\SOFTWARE\\ASUS\\AURA lighting effect add-on x64",
] as const;

async function applyRgb(rule: AutoRule): Promise<void> {
  if (!rule.rgbMode) return;
  const modeMap: Record<string, string> = { static: "0", breathing: "1", "color-cycle": "2", rainbow: "3", strobe: "4", off: "255" };
  const modeVal = modeMap[rule.rgbMode] ?? "0";
  const bright = rule.rgbBrightness ?? 3;
  const colorHex = rule.rgbColor ?? "#FF0000";
  const match = colorHex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return;
  const [, rH, gH, bH] = match;
  const r = parseInt(rH!, 16);
  const g = parseInt(gH!, 16);
  const b = parseInt(bH!, 16);

  for (const regPath of AURA_REG_CANDIDATES) {
    try {
      await runPs(`
$p = '${regPath}'
Set-ItemProperty $p -Name LedMode -Value ${modeVal} -ErrorAction Stop
Set-ItemProperty $p -Name LedColorR -Value ${r} -ErrorAction SilentlyContinue
Set-ItemProperty $p -Name LedColorG -Value ${g} -ErrorAction SilentlyContinue
Set-ItemProperty $p -Name LedColorB -Value ${b} -ErrorAction SilentlyContinue
Set-ItemProperty $p -Name Brightness -Value ${bright} -ErrorAction SilentlyContinue
`.trim());
      return; // success on first working path
    } catch {
      // try next candidate
    }
  }
}

async function applyFanMode(rule: AutoRule): Promise<void> {
  if (!rule.fanMode) return;
  const fanMap: Record<string, string> = { auto: "0", silent: "1", turbo: "2" };
  const val = fanMap[rule.fanMode];
  if (val == null) return;
  try {
    await runPs(
      `Set-ItemProperty 'HKLM:\\SOFTWARE\\ASUS\\ARMOURY CRATE Service\\FanControlPlugin' -Name FanScenario -Value ${val} -ErrorAction SilentlyContinue`,
    );
  } catch {
    // silent fail
  }
}

async function revertRgb(): Promise<void> {
  for (const regPath of AURA_REG_CANDIDATES) {
    try {
      await runPs(
        `Set-ItemProperty '${regPath}' -Name LedMode -Value 1 -ErrorAction Stop; Set-ItemProperty '${regPath}' -Name Brightness -Value 1 -ErrorAction SilentlyContinue`,
      );
      return;
    } catch {
      // try next
    }
  }
}

// ── Scan & Apply ─────────────────────────────────────────────

async function scanAndApply(): Promise<string | null> {
  const running = await getRunningProcessNames();
  const match = findMatchingRule(running, getAllRules());

  if (match && match.id !== lastAppliedRule) {
    const current = await getCurrentProfile();
    if (current !== match.profile) {
      const ok = await setProfile(match.profile);
      if (ok) {
        lastAppliedRule = match.id;
        // Apply linked subsystems
        await applyRgb(match);
        await applyFanMode(match);
        return `[auto] ${match.name} detected → ${match.profile.toUpperCase()}${match.rgbMode ? ` + RGB:${match.rgbMode}` : ""}${match.fanMode ? ` + Fan:${match.fanMode}` : ""}`;
      }
    } else {
      lastAppliedRule = match.id;
    }
  } else if (!match && lastAppliedRule) {
    // No matching app, revert to silent
    const current = await getCurrentProfile();
    if (current !== "silent") {
      await setProfile("silent");
    }
    await revertRgb();
    lastAppliedRule = null;
  }

  return null;
}

// ── Formatting ───────────────────────────────────────────────

function formatRuleList(rules: AutoRule[]): string {
  const lines = rules.map((r) => {
    const status = r.enabled ? "ON" : "OFF";
    const procs = r.processNames.join(", ");
    const extras: string[] = [];
    if (r.rgbMode) extras.push(`RGB:${r.rgbMode}${r.rgbColor ? ` ${r.rgbColor}` : ""}`);
    if (r.fanMode) extras.push(`Fan:${r.fanMode}`);
    const extrasStr = extras.length > 0 ? `\n      Linked: ${extras.join(", ")}` : "";
    return `[${status}] ${r.name} → ${r.profile.toUpperCase()}\n      Detects: ${procs}${extrasStr}`;
  });
  return `Automation Rules (${rules.length}):\n\n${lines.join("\n\n")}`;
}

function formatHelp(): string {
  return [
    "ROG Automation commands:",
    "",
    "/auto — Show engine status + active rule",
    "/auto rules — List all rules (built-in + custom)",
    "/auto start — Start automation engine",
    "/auto stop — Stop automation engine",
    "/auto scan — Run one-time scan",
    "/auto add <name> <process> <profile> — Add custom rule",
    "/auto enable <id> — Enable a rule",
    "/auto disable <id> — Disable a rule",
  ].join("\n");
}

// ── Plugin Entry ─────────────────────────────────────────────

export { findMatchingRule };
export type { AutoRule, PowerProfile };

export default definePluginEntry({
  id: "rog-automate",
  name: "ROG Automation Rules",
  description: "Auto-switch performance profiles based on running applications",
  register(api: OpenClawPluginApi) {
    const stateDir = api.runtime.state.resolveStateDir();
    const stateFile = path.join(stateDir, "rog-automate-state.json");

    // Restore custom rules from disk
    const saved = loadState<PersistedState>(stateFile, { customRules: [] });
    customRules = saved.customRules;

    const pollMs = 5000;

    api.registerCommand({
      name: "auto",
      description: "ROG automation engine (start, stop, scan, rules, add, enable, disable).",
      acceptsArgs: true,
      handler: async (ctx) => {
        const args = ctx.args?.trim() ?? "";
        const tokens = args.split(/\s+/).filter(Boolean);
        const action = tokens[0]?.toLowerCase() ?? "";

        if (action === "help") return { text: formatHelp() };

        // /auto rules
        if (action === "rules" || action === "list") {
          return { text: formatRuleList(getAllRules()) };
        }

        // /auto start
        if (action === "start") {
          if (engineRunning) return { text: "Automation engine is already running." };
          engineRunning = true;
          engineInterval = setInterval(() => {
            scanAndApply().then((msg) => {
              if (msg) api.logger.info(msg);
            });
          }, pollMs);
          return { text: `Automation engine started (polling every ${pollMs / 1000}s).` };
        }

        // /auto stop
        if (action === "stop") {
          if (!engineRunning) return { text: "Automation engine is not running." };
          engineRunning = false;
          if (engineInterval) clearInterval(engineInterval);
          engineInterval = null;
          lastAppliedRule = null;
          return { text: "Automation engine stopped." };
        }

        // /auto scan
        if (action === "scan") {
          const msg = await scanAndApply();
          if (msg) return { text: msg };
          const current = await getCurrentProfile();
          return {
            text: lastAppliedRule
              ? `Active rule: ${lastAppliedRule} (profile: ${current ?? "unknown"})`
              : `No matching app detected. Current profile: ${current ?? "unknown"}`,
          };
        }

        // /auto add <name> <process> <profile>
        if (action === "add") {
          const name = tokens[1];
          const proc = tokens[2];
          const profile = tokens[3]?.toLowerCase() as PowerProfile | undefined;
          if (!name || !proc || !profile || !["silent", "performance", "turbo"].includes(profile)) {
            return { text: "Usage: /auto add <name> <process-name> <silent|performance|turbo>" };
          }
          const id = `custom-${name.toLowerCase()}`;
          customRules.push({ id, name, processNames: [proc], profile, enabled: true });
          saveState(stateFile, { customRules });
          return { text: `Rule added: ${name} → detect "${proc}" → ${profile.toUpperCase()}` };
        }

        // /auto enable/disable <id>
        if (action === "enable" || action === "disable") {
          const targetId = tokens[1]?.toLowerCase();
          if (!targetId) return { text: `Usage: /auto ${action} <rule-id>` };
          const allRules = getAllRules();
          const rule = allRules.find((r) => r.id.toLowerCase() === targetId || r.name.toLowerCase() === targetId);
          if (!rule) return { text: `Rule "${targetId}" not found.` };
          rule.enabled = action === "enable";
          saveState(stateFile, { customRules });
          return { text: `Rule "${rule.name}" ${action}d.` };
        }

        // Default: show status
        const current = await getCurrentProfile();
        const lines = [
          `Engine: ${engineRunning ? "RUNNING" : "STOPPED"}`,
          `Current profile: ${current?.toUpperCase() ?? "unknown"}`,
          `Active rule: ${lastAppliedRule ?? "none"}`,
          `Rules: ${getAllRules().filter((r) => r.enabled).length} enabled / ${getAllRules().length} total`,
        ];
        return { text: lines.join("\n") };
      },
    });
  },
});
