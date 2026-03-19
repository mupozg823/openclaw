import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  definePluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/phone-control";

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────

type PowerProfile = "silent" | "performance" | "turbo";

interface AutoRule {
  id: string;
  name: string;
  processNames: string[];
  profile: PowerProfile;
  enabled: boolean;
}

// ── Built-in game/app rules ──────────────────────────────────

const BUILTIN_RULES: AutoRule[] = [
  { id: "steam-games", name: "Steam Games", processNames: ["steam_osc", "steamwebhelper"], profile: "performance", enabled: true },
  { id: "cyberpunk", name: "Cyberpunk 2077", processNames: ["Cyberpunk2077"], profile: "turbo", enabled: true },
  { id: "elden-ring", name: "Elden Ring", processNames: ["eldenring"], profile: "turbo", enabled: true },
  { id: "baldurs-gate", name: "Baldur's Gate 3", processNames: ["bg3", "bg3_dx11"], profile: "turbo", enabled: true },
  { id: "genshin", name: "Genshin Impact", processNames: ["GenshinImpact", "YuanShen"], profile: "performance", enabled: true },
  { id: "fortnite", name: "Fortnite", processNames: ["FortniteClient-Win64-Shipping"], profile: "turbo", enabled: true },
  { id: "valorant", name: "Valorant", processNames: ["VALORANT-Win64-Shipping"], profile: "turbo", enabled: true },
  { id: "cod", name: "Call of Duty", processNames: ["cod", "ModernWarfare"], profile: "turbo", enabled: true },
  { id: "apex", name: "Apex Legends", processNames: ["r5apex"], profile: "turbo", enabled: true },
  { id: "lol", name: "League of Legends", processNames: ["League of Legends"], profile: "performance", enabled: true },
  { id: "obs", name: "OBS Studio", processNames: ["obs64"], profile: "performance", enabled: true },
  { id: "premiere", name: "Adobe Premiere", processNames: ["Adobe Premiere Pro"], profile: "turbo", enabled: true },
  { id: "davinci", name: "DaVinci Resolve", processNames: ["Resolve"], profile: "turbo", enabled: true },
  { id: "blender", name: "Blender", processNames: ["blender"], profile: "turbo", enabled: true },
  { id: "vscode", name: "VS Code (light)", processNames: ["Code"], profile: "silent", enabled: false },
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

// ── Engine State ─────────────────────────────────────────────

let engineRunning = false;
let engineInterval: ReturnType<typeof setInterval> | null = null;
let lastAppliedRule: string | null = null;
let customRules: AutoRule[] = [];

function getAllRules(): AutoRule[] {
  return [...BUILTIN_RULES, ...customRules];
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
        return `[auto] ${match.name} detected → ${match.profile.toUpperCase()}`;
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
    lastAppliedRule = null;
  }

  return null;
}

// ── Formatting ───────────────────────────────────────────────

function formatRuleList(rules: AutoRule[]): string {
  const lines = rules.map((r) => {
    const status = r.enabled ? "ON" : "OFF";
    const procs = r.processNames.join(", ");
    return `[${status}] ${r.name} → ${r.profile.toUpperCase()}\n      Detects: ${procs}`;
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

export default definePluginEntry({
  id: "rog-automate",
  name: "ROG Automation Rules",
  description: "Auto-switch performance profiles based on running applications",
  register(api: OpenClawPluginApi) {
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
