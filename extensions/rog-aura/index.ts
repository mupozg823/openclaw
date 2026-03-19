import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { definePluginEntry } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────

type AuraMode = "static" | "breathing" | "color-cycle" | "rainbow" | "strobe" | "off";

interface AuraState {
  mode: AuraMode;
  color: string; // hex "#RRGGBB"
  brightness: number; // 0-3
  speed: number; // 0-2
}

// ── Constants ────────────────────────────────────────────────

const AURA_REG_CANDIDATES = [
  "HKLM:\\SOFTWARE\\ASUS\\ARMOURY CRATE Service\\AuraService",
  "HKLM:\\SOFTWARE\\ASUS\\AsRogAuraServiceSDK",
  "HKLM:\\SOFTWARE\\ASUS\\AURA lighting effect add-on x64",
] as const;

const MODE_MAP: Record<string, AuraMode> = {
  "0": "static",
  "1": "breathing",
  "2": "color-cycle",
  "3": "rainbow",
  "4": "strobe",
  "255": "off",
};

const MODE_TO_VALUE: Record<AuraMode, string> = {
  static: "0",
  breathing: "1",
  "color-cycle": "2",
  rainbow: "3",
  strobe: "4",
  off: "255",
};

const BRIGHTNESS_LABELS = ["Off", "Low", "Medium", "High"];
const SPEED_LABELS = ["Slow", "Medium", "Fast"];

// ── Named Colors ─────────────────────────────────────────────

const NAMED_COLORS: Record<string, string> = {
  red: "#FF0000",
  green: "#00FF00",
  blue: "#0000FF",
  white: "#FFFFFF",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  yellow: "#FFFF00",
  orange: "#FF8000",
  purple: "#8000FF",
  pink: "#FF69B4",
  rog: "#FF4655", // ROG Republic Red
  republic: "#FF4655",
};

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

// ── Registry Path Resolution ─────────────────────────────────

let cachedAuraPath: string | null | undefined;

async function resolveAuraRegPath(): Promise<string | null> {
  if (cachedAuraPath !== undefined) return cachedAuraPath;
  for (const candidate of AURA_REG_CANDIDATES) {
    try {
      const raw = await runPs(
        `(Get-ItemProperty '${candidate}' -Name LedMode -ErrorAction Stop).LedMode`,
      );
      if (raw.trim() !== "") {
        cachedAuraPath = candidate;
        return candidate;
      }
    } catch {
      // try next
    }
  }
  cachedAuraPath = null;
  return null;
}

// ── Read State ───────────────────────────────────────────────

async function readAuraState(): Promise<AuraState | null> {
  const regPath = await resolveAuraRegPath();
  if (!regPath) return null;
  try {
    const raw = await runPs(`
$p = '${regPath}'
$mode = (Get-ItemProperty $p -Name LedMode -ErrorAction Stop).LedMode
$r = (Get-ItemProperty $p -Name LedColorR -ErrorAction SilentlyContinue).LedColorR
$g = (Get-ItemProperty $p -Name LedColorG -ErrorAction SilentlyContinue).LedColorG
$b = (Get-ItemProperty $p -Name LedColorB -ErrorAction SilentlyContinue).LedColorB
$bright = (Get-ItemProperty $p -Name Brightness -ErrorAction SilentlyContinue).Brightness
$speed = (Get-ItemProperty $p -Name Speed -ErrorAction SilentlyContinue).Speed
if ($r -eq $null) { $r = 255 }
if ($g -eq $null) { $g = 0 }
if ($b -eq $null) { $b = 0 }
if ($bright -eq $null) { $bright = 3 }
if ($speed -eq $null) { $speed = 1 }
"$mode|$r|$g|$b|$bright|$speed"
`.trim());
    const [mode, r, g, b, bright, speed] = raw.split("|");
    const rN = Number(r) || 0;
    const gN = Number(g) || 0;
    const bN = Number(b) || 0;
    const hex = `#${rN.toString(16).padStart(2, "0")}${gN.toString(16).padStart(2, "0")}${bN.toString(16).padStart(2, "0")}`.toUpperCase();
    return {
      mode: MODE_MAP[mode ?? ""] ?? "static",
      color: hex,
      brightness: Math.min(Math.max(Number(bright) || 0, 0), 3),
      speed: Math.min(Math.max(Number(speed) || 0, 0), 2),
    };
  } catch {
    return null;
  }
}

// ── Write State ──────────────────────────────────────────────

async function setAuraMode(mode: AuraMode): Promise<boolean> {
  const val = MODE_TO_VALUE[mode];
  if (val == null) return false;
  const regPath = await resolveAuraRegPath();
  if (!regPath) return false;
  try {
    await runPs(
      `Set-ItemProperty '${regPath}' -Name LedMode -Value ${val} -ErrorAction Stop`,
    );
    return true;
  } catch {
    return false;
  }
}

async function setAuraColor(hex: string): Promise<boolean> {
  const match = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return false;
  const [, rH, gH, bH] = match;
  const r = parseInt(rH!, 16);
  const g = parseInt(gH!, 16);
  const b = parseInt(bH!, 16);
  const regPath = await resolveAuraRegPath();
  if (!regPath) return false;
  try {
    await runPs(`
$p = '${regPath}'
Set-ItemProperty $p -Name LedColorR -Value ${r}
Set-ItemProperty $p -Name LedColorG -Value ${g}
Set-ItemProperty $p -Name LedColorB -Value ${b}
`.trim());
    return true;
  } catch {
    return false;
  }
}

async function setAuraBrightness(level: number): Promise<boolean> {
  if (level < 0 || level > 3) return false;
  const regPath = await resolveAuraRegPath();
  if (!regPath) return false;
  try {
    await runPs(
      `Set-ItemProperty '${regPath}' -Name Brightness -Value ${level} -ErrorAction Stop`,
    );
    return true;
  } catch {
    return false;
  }
}

async function setAuraSpeed(level: number): Promise<boolean> {
  if (level < 0 || level > 2) return false;
  const regPath = await resolveAuraRegPath();
  if (!regPath) return false;
  try {
    await runPs(
      `Set-ItemProperty '${regPath}' -Name Speed -Value ${level} -ErrorAction Stop`,
    );
    return true;
  } catch {
    return false;
  }
}

// ── Formatting ───────────────────────────────────────────────

function formatState(s: AuraState, regPath: string): string {
  return [
    `Mode: ${s.mode.toUpperCase()}`,
    `Color: ${s.color}`,
    `Brightness: ${BRIGHTNESS_LABELS[s.brightness] ?? s.brightness} (${s.brightness}/3)`,
    `Speed: ${SPEED_LABELS[s.speed] ?? s.speed} (${s.speed}/2)`,
    `Registry: ${regPath}`,
  ].join("\n");
}

function formatHelp(regPath: string | null): string {
  const modes = Object.keys(MODE_TO_VALUE).join(", ");
  const colors = Object.keys(NAMED_COLORS).join(", ");
  const pathLine = regPath
    ? `Registry path: ${regPath}`
    : "Registry path: not found (LedMode key missing in all candidate paths)";
  return [
    "ROG Aura Sync RGB commands:",
    "",
    "/aura — Show current RGB state",
    `/aura mode <${modes}> — Set LED mode`,
    "/aura color <#hex|name> — Set color (e.g., #FF0000, red, rog)",
    "/aura bright <0-3> — Set brightness (0=off, 3=high)",
    "/aura speed <0-2> — Set animation speed (0=slow, 2=fast)",
    "/aura off — Turn off LEDs",
    "/aura rog — Set ROG Republic Red static",
    "",
    `Named colors: ${colors}`,
    "",
    pathLine,
  ].join("\n");
}

// ── Plugin Entry ─────────────────────────────────────────────

export { NAMED_COLORS, MODE_TO_VALUE };

export default definePluginEntry({
  id: "rog-aura",
  name: "ROG Aura Sync RGB",
  description: "Control ASUS Aura Sync RGB lighting on ROG devices",
  register(api: OpenClawPluginApi) {
    api.registerCommand({
      name: "aura",
      description: "ROG Aura Sync RGB control (mode, color, brightness, speed).",
      acceptsArgs: true,
      handler: async (ctx) => {
        const args = ctx.args?.trim() ?? "";
        const tokens = args.split(/\s+/).filter(Boolean);
        const action = tokens[0]?.toLowerCase() ?? "";

        if (action === "help") {
          const regPath = await resolveAuraRegPath();
          return { text: formatHelp(regPath) };
        }

        // /aura off — shortcut
        if (action === "off") {
          const ok = await setAuraMode("off");
          return { text: ok ? "LEDs turned off." : "Failed to turn off LEDs. Admin may be required." };
        }

        // /aura rog — shortcut for ROG red static
        if (action === "rog" || action === "republic") {
          const mOk = await setAuraMode("static");
          const cOk = await setAuraColor("#FF4655");
          const bOk = await setAuraBrightness(3);
          return {
            text: mOk && cOk && bOk
              ? "ROG Republic Red activated (static, #FF4655, max brightness)."
              : "Partially applied. Admin may be required.",
          };
        }

        // /aura mode <mode>
        if (action === "mode") {
          const target = tokens[1]?.toLowerCase();
          if (!target || !(target in MODE_TO_VALUE)) {
            return { text: `Usage: /aura mode <${Object.keys(MODE_TO_VALUE).join("|")}>` };
          }
          const ok = await setAuraMode(target as AuraMode);
          return { text: ok ? `LED mode set to ${target.toUpperCase()}.` : "Failed. Admin may be required." };
        }

        // /aura color <hex|name>
        if (action === "color") {
          const input = tokens[1]?.toLowerCase() ?? "";
          const hex = NAMED_COLORS[input] ?? (input.startsWith("#") ? input : `#${input}`);
          if (!/^#[0-9a-f]{6}$/i.test(hex)) {
            return { text: `Invalid color. Use hex (#FF0000) or name (red, blue, rog, etc.)` };
          }
          const ok = await setAuraColor(hex);
          return { text: ok ? `LED color set to ${hex}.` : "Failed. Admin may be required." };
        }

        // /aura bright <0-3>
        if (action === "bright" || action === "brightness") {
          const level = Number(tokens[1]);
          if (!Number.isInteger(level) || level < 0 || level > 3) {
            return { text: "Usage: /aura bright <0-3> (0=off, 1=low, 2=medium, 3=high)" };
          }
          const ok = await setAuraBrightness(level);
          return {
            text: ok
              ? `Brightness set to ${BRIGHTNESS_LABELS[level]} (${level}/3).`
              : "Failed. Admin may be required.",
          };
        }

        // /aura speed <0-2>
        if (action === "speed") {
          const level = Number(tokens[1]);
          if (!Number.isInteger(level) || level < 0 || level > 2) {
            return { text: "Usage: /aura speed <0-2> (0=slow, 1=medium, 2=fast)" };
          }
          const ok = await setAuraSpeed(level);
          return {
            text: ok
              ? `Animation speed set to ${SPEED_LABELS[level]} (${level}/2).`
              : "Failed. Admin may be required.",
          };
        }

        // Default: show current state
        const regPath = await resolveAuraRegPath();
        if (!regPath) {
          return {
            text: [
              "Could not read Aura Sync state. LedMode key not found in any candidate registry path.",
              "",
              "Checked paths:",
              ...AURA_REG_CANDIDATES.map((p) => `  ${p}`),
            ].join("\n"),
          };
        }
        const state = await readAuraState();
        if (!state) {
          return { text: "Could not read Aura Sync state. Registry path found but read failed." };
        }
        return { text: formatState(state, regPath) };
      },
    });
  },
});
