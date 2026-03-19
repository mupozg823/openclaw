import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── PowerShell Bridge ────────────────────────────────────────

const DEFAULT_TIMEOUT = 10_000;

export async function runPs(script: string, timeoutMs = DEFAULT_TIMEOUT): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { shell: false, timeout: timeoutMs },
  );
  return stdout.trim();
}

// ── Number Parsing ───────────────────────────────────────────

export function parseNumber(raw: string): number | null {
  if (raw === "" || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ── Admin Detection (cached) ─────────────────────────────────

let adminCache: { value: boolean; expiresAt: number } | null = null;
const ADMIN_CACHE_TTL = 60_000;

export async function isAdmin(): Promise<boolean> {
  if (adminCache && Date.now() < adminCache.expiresAt) {
    return adminCache.value;
  }
  try {
    const raw = await runPs(
      `([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)`,
    );
    const value = raw.trim() === "True";
    adminCache = { value, expiresAt: Date.now() + ADMIN_CACHE_TTL };
    return value;
  } catch {
    adminCache = { value: false, expiresAt: Date.now() + ADMIN_CACHE_TTL };
    return false;
  }
}

// ── State Persistence ────────────────────────────────────────

export function loadState<T>(filepath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filepath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveState<T>(filepath: string, data: T): void {
  try {
    const dir = filepath.replace(/[\\/][^\\/]+$/, "");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  } catch {
    // Best-effort persistence — swallow write errors
  }
}

// ── Command Arg Parsing ──────────────────────────────────────

export function parseCommandArgs(ctx: { args?: string }): { action: string; tokens: string[] } {
  const args = ctx.args?.trim() ?? "";
  const tokens = args.split(/\s+/).filter(Boolean);
  const action = tokens[0]?.toLowerCase() ?? "";
  return { action, tokens };
}

// ── ROG Registry Constants ───────────────────────────────────

export const POWER_REG_PATH =
  "HKLM:\\SOFTWARE\\ASUS\\ARMOURY CRATE Service\\ThrottlePlugin\\ROG ATKStatus";

export const FAN_REG_KEY =
  "HKLM:\\SOFTWARE\\ASUS\\ARMOURY CRATE Service\\FanControlPlugin";

export const AURA_REG_CANDIDATES = [
  "HKLM:\\SOFTWARE\\ASUS\\AURA\\LastProfile",
  "HKLM:\\SOFTWARE\\ASUS\\AuraService\\LastProfile",
  "HKCU:\\SOFTWARE\\ASUS\\AURA\\LastProfile",
] as const;

export type PowerMode = "silent" | "performance" | "turbo" | "unknown";

export const POWER_MODE_MAP: Record<string, PowerMode> = {
  "0": "silent",
  "1": "performance",
  "2": "turbo",
};

export function powerModeToValue(mode: PowerMode): string | undefined {
  return Object.entries(POWER_MODE_MAP).find(([, v]) => v === mode)?.[0];
}

// ── Shared PowerShell Queries ────────────────────────────────

export async function getPowerMode(): Promise<PowerMode> {
  try {
    const raw = await runPs(
      `(Get-ItemProperty '${POWER_REG_PATH}' -ErrorAction Stop).PowerMode`,
    );
    return POWER_MODE_MAP[raw.trim()] ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function setPowerMode(mode: PowerMode): Promise<{ ok: boolean; error?: string }> {
  const modeValue = powerModeToValue(mode);
  if (modeValue == null) return { ok: false, error: `Unknown mode: ${mode}` };
  if (!(await isAdmin())) {
    return { ok: false, error: "Administrator privileges required. Run OpenClaw as admin to change power profiles." };
  }
  try {
    await runPs(
      `Set-ItemProperty '${POWER_REG_PATH}' -Name PowerMode -Value ${modeValue}`,
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Registry write failed: ${e}` };
  }
}
