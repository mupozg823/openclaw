import fs from "node:fs";
import path from "node:path";
import {
  definePluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { runPs, loadState, saveState, parseCommandArgs } from "../rog-win-shared/index.ts";

// ── Types ────────────────────────────────────────────────────

type GamepadButton =
  | "A"
  | "B"
  | "X"
  | "Y"
  | "LB"
  | "RB"
  | "LT"
  | "RT"
  | "Back"
  | "Start"
  | "LSB"
  | "RSB"
  | "DpadUp"
  | "DpadDown"
  | "DpadLeft"
  | "DpadRight";

interface ButtonBinding {
  button: GamepadButton;
  command: string;
  description: string;
}

interface GamepadState {
  connected: boolean;
  buttons: number; // wButtons bitmask
  leftTrigger: number;
  rightTrigger: number;
}

// ── Button Bitmask Map ───────────────────────────────────────

export const BUTTON_MAP: Record<number, GamepadButton> = {
  0x0001: "DpadUp",
  0x0002: "DpadDown",
  0x0004: "DpadLeft",
  0x0008: "DpadRight",
  0x0010: "Start",
  0x0020: "Back",
  0x0040: "LSB",
  0x0080: "RSB",
  0x0100: "LB",
  0x0200: "RB",
  0x1000: "A",
  0x2000: "B",
  0x4000: "X",
  0x8000: "Y",
};

// Trigger thresholds are polled separately; include them as pseudo-buttons
const TRIGGER_LT_MASK = 0x10000;
const TRIGGER_RT_MASK = 0x20000;

// ── Default Bindings (ROG Ally X preset) ─────────────────────

export const DEFAULT_BINDINGS: ButtonBinding[] = [
  { button: "Y",        command: "/overlay",       description: "Toggle HUD overlay" },
  { button: "X",        command: "/rog status",    description: "Show ROG hardware status" },
  { button: "LB",       command: "/desktop left",  description: "Switch to previous virtual desktop" },
  { button: "RB",       command: "/desktop right", description: "Switch to next virtual desktop" },
  { button: "Back",     command: "/fan status",    description: "Show fan status" },
  { button: "Start",    command: "/auto scan",     description: "Run automation scan" },
  { button: "DpadUp",   command: "/aura bright 3", description: "Set AURA lighting to maximum brightness" },
  { button: "DpadDown", command: "/aura bright 0", description: "Turn off AURA lighting" },
];

// ── XInput Polling ───────────────────────────────────────────

const XINPUT_CSHARP = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class XInput {
    [DllImport("xinput1_4.dll")]
    public static extern int XInputGetState(int dwUserIndex, out XINPUT_STATE pState);

    [StructLayout(LayoutKind.Sequential)]
    public struct XINPUT_GAMEPAD {
        public ushort wButtons;
        public byte bLeftTrigger;
        public byte bRightTrigger;
        public short sThumbLX;
        public short sThumbLY;
        public short sThumbRX;
        public short sThumbRY;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct XINPUT_STATE {
        public uint dwPacketNumber;
        public XINPUT_GAMEPAD Gamepad;
    }
}
'@
$state = New-Object XInput+XINPUT_STATE
$result = [XInput]::XInputGetState(INDEX, [ref]$state)
if ($result -eq 0) {
    "Connected|$($state.Gamepad.wButtons)|$($state.Gamepad.bLeftTrigger)|$($state.Gamepad.bRightTrigger)"
} else {
    "Disconnected|0|0|0"
}`.trimStart();

async function pollXInput(controllerIndex = 0): Promise<GamepadState> {
  try {
    const script = XINPUT_CSHARP.replace("INDEX", String(controllerIndex));
    const raw = await runPs(script, 8_000);
    const [status, buttons, lt, rt] = raw.split("|");
    const connected = status === "Connected";
    return {
      connected,
      buttons: connected ? parseInt(buttons ?? "0", 10) : 0,
      leftTrigger: connected ? parseInt(lt ?? "0", 10) : 0,
      rightTrigger: connected ? parseInt(rt ?? "0", 10) : 0,
    };
  } catch {
    return { connected: false, buttons: 0, leftTrigger: 0, rightTrigger: 0 };
  }
}

// ── Binding State (in-memory, per plugin instance) ───────────

function createBindingStore(initial: ButtonBinding[]): {
  getAll: () => ButtonBinding[];
  get: (button: GamepadButton) => ButtonBinding | undefined;
  set: (b: ButtonBinding) => void;
  remove: (button: GamepadButton) => boolean;
  reset: () => void;
} {
  let bindings: ButtonBinding[] = [...initial];

  return {
    getAll: () => [...bindings],
    get: (button) => bindings.find((b) => b.button === button),
    set: (b) => {
      const idx = bindings.findIndex((x) => x.button === b.button);
      if (idx >= 0) bindings[idx] = b;
      else bindings.push(b);
    },
    remove: (button) => {
      const before = bindings.length;
      bindings = bindings.filter((b) => b.button !== button);
      return bindings.length < before;
    },
    reset: () => { bindings = [...initial]; },
  };
}

// ── Formatting ───────────────────────────────────────────────

function formatPressedButtons(state: GamepadState): string {
  const pressed: string[] = [];
  for (const [mask, name] of Object.entries(BUTTON_MAP)) {
    if (state.buttons & Number(mask)) pressed.push(name);
  }
  if (state.leftTrigger > 64) pressed.push("LT");
  if (state.rightTrigger > 64) pressed.push("RT");
  return pressed.length > 0 ? pressed.join(", ") : "none";
}

function formatBindingsList(bindings: ButtonBinding[]): string {
  if (bindings.length === 0) return "No button bindings configured.";
  const lines = bindings.map((b) => `  ${b.button.padEnd(12)} → ${b.command}  (${b.description})`);
  return ["Button bindings:", ...lines].join("\n");
}

export function formatHelp(): string {
  return [
    "Gamepad Commander commands:",
    "",
    "/gamepad               — Show connection status and active binding count",
    "/gamepad status        — Detailed status (button states, all mappings)",
    "/gamepad bindings      — List all button-to-command mappings",
    "/gamepad bind <button> <command> — Add or update a button mapping",
    "/gamepad unbind <button>         — Remove a button mapping",
    "/gamepad reset         — Restore default ROG Ally X bindings",
    "/gamepad poll          — Read current button state (one-shot)",
    "/gamepad help          — Show this help",
    "",
    "Buttons: A B X Y LB RB LT RT Back Start LSB RSB DpadUp DpadDown DpadLeft DpadRight",
  ].join("\n");
}

// ── Plugin Entry ─────────────────────────────────────────────

export default definePluginEntry({
  id: "win-gamepad",
  name: "Gamepad Commander",
  description: "Map gamepad buttons to OpenClaw commands via XInput",
  register(api: OpenClawPluginApi) {
    const stateDir = api.runtime.state.resolveStateDir();
    const bindingsFile = path.join(stateDir, "win-gamepad-bindings.json");

    // Restore saved bindings from disk; fall back to defaults
    const saved = loadState<{ bindings: ButtonBinding[] }>(bindingsFile, { bindings: DEFAULT_BINDINGS });
    const store = createBindingStore(saved.bindings);

    const controllerIndex: number =
      (api.config as Record<string, unknown>)?.controllerIndex as number ?? 0;

    api.registerCommand({
      name: "gamepad",
      description: "Manage gamepad button-to-command mappings (bind, unbind, poll, reset).",
      acceptsArgs: true,
      handler: async (ctx) => {
        const { action, tokens } = parseCommandArgs(ctx);

        // /gamepad  (no args) — quick status
        if (!action) {
          const state = await pollXInput(controllerIndex);
          const bindings = store.getAll();
          const connLine = state.connected
            ? `Controller connected (index ${controllerIndex})`
            : `No controller connected (index ${controllerIndex})`;
          return {
            text: [
              connLine,
              `Active bindings: ${bindings.length}`,
            ].join("\n"),
          };
        }

        if (action === "help") {
          return { text: formatHelp() };
        }

        if (action === "status") {
          const state = await pollXInput(controllerIndex);
          const bindings = store.getAll();
          const lines: string[] = [
            state.connected
              ? `Controller connected (index ${controllerIndex})`
              : `No controller connected (index ${controllerIndex})`,
          ];
          if (state.connected) {
            lines.push(`Buttons held: ${formatPressedButtons(state)}`);
            lines.push(`LT: ${state.leftTrigger}  RT: ${state.rightTrigger}`);
          }
          lines.push("");
          lines.push(formatBindingsList(bindings));
          return { text: lines.join("\n") };
        }

        if (action === "bindings") {
          return { text: formatBindingsList(store.getAll()) };
        }

        if (action === "poll") {
          const state = await pollXInput(controllerIndex);
          if (!state.connected) {
            return { text: `No controller detected at index ${controllerIndex}.` };
          }
          return {
            text: [
              `Buttons held: ${formatPressedButtons(state)}`,
              `LT: ${state.leftTrigger}  RT: ${state.rightTrigger}`,
            ].join("\n"),
          };
        }

        if (action === "reset") {
          store.reset();
          try { fs.unlinkSync(bindingsFile); } catch { /* file may not exist */ }
          return { text: `Bindings reset to default ROG Ally X preset (${DEFAULT_BINDINGS.length} mappings).` };
        }

        if (action === "bind") {
          // /gamepad bind <Button> <command...>
          const rawButton = tokens[1];
          const command = tokens.slice(2).join(" ");
          if (!rawButton || !command) {
            return { text: "Usage: /gamepad bind <button> <command>\nExample: /gamepad bind A /help" };
          }
          const button = rawButton as GamepadButton;
          if (!isValidButton(button)) {
            return { text: `Unknown button: ${rawButton}\nValid buttons: ${validButtonList()}` };
          }
          store.set({ button, command, description: "Custom binding" });
          saveState(bindingsFile, { bindings: store.getAll() });
          return { text: `Bound ${button} → ${command}` };
        }

        if (action === "unbind") {
          const rawButton = tokens[1];
          if (!rawButton) {
            return { text: "Usage: /gamepad unbind <button>" };
          }
          const button = rawButton as GamepadButton;
          if (!isValidButton(button)) {
            return { text: `Unknown button: ${rawButton}\nValid buttons: ${validButtonList()}` };
          }
          const removed = store.remove(button);
          if (removed) saveState(bindingsFile, { bindings: store.getAll() });
          return { text: removed ? `Removed binding for ${button}.` : `No binding found for ${button}.` };
        }

        return { text: formatHelp() };
      },
    });
  },
});

// ── Validation Helpers ───────────────────────────────────────

const ALL_BUTTONS: GamepadButton[] = [
  "A", "B", "X", "Y", "LB", "RB", "LT", "RT",
  "Back", "Start", "LSB", "RSB",
  "DpadUp", "DpadDown", "DpadLeft", "DpadRight",
];

function isValidButton(name: string): name is GamepadButton {
  return (ALL_BUTTONS as string[]).includes(name);
}

function validButtonList(): string {
  return ALL_BUTTONS.join(", ");
}

export type { GamepadButton, ButtonBinding, GamepadState };
export { TRIGGER_LT_MASK, TRIGGER_RT_MASK };
