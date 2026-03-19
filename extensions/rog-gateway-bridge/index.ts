import { definePluginEntry } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { parseCommandArgs } from "../rog-win-shared/index.ts";

// ── Types ────────────────────────────────────────────────────

interface TrayStatus {
  status: string;
  platform: string;
  version: string;
}

interface RogStatus {
  powerMode: string;
  cpuPct: number;
  batteryPct: number | null;
}

type GatewayMethodHandler = (params: Record<string, unknown>) => Promise<Record<string, unknown>>;

// ── Gateway Methods Registry ────────────────────────────────

const GATEWAY_METHODS: Record<string, { description: string; handler: string }> = {
  "tray.status": {
    description: "Get tray app running status",
    handler: "Returns { status, platform, version }",
  },
  "rog.status": {
    description: "Get ROG hardware status (power mode, CPU%, battery)",
    handler: "Returns { powerMode, cpuPct, batteryPct }",
  },
  "rog.setProfile": {
    description: "Set power profile (silent, performance, turbo)",
    handler: "Params: { profile: string }",
  },
  "system.exec": {
    description: "Execute read-only Get-* PowerShell command (safety restricted)",
    handler: "Params: { script: string } — only Get-* allowed",
  },
};

// ── Formatting ──────────────────────────────────────────────

function formatTrayStatus(status: TrayStatus): string {
  return [
    "Tray Application:",
    `  Status: ${status.status}`,
    `  Platform: ${status.platform}`,
    `  Version: ${status.version}`,
  ].join("\n");
}

function formatRogStatus(status: RogStatus): string {
  return [
    "ROG Status (via Gateway):",
    `  Power Mode: ${status.powerMode.toUpperCase()}`,
    `  CPU Usage: ${status.cpuPct}%`,
    `  Battery: ${status.batteryPct != null ? `${status.batteryPct}%` : "N/A"}`,
  ].join("\n");
}

function formatMethods(): string {
  const lines = ["Gateway Bridge Methods:", ""];
  for (const [method, info] of Object.entries(GATEWAY_METHODS)) {
    lines.push(`  ${method}`);
    lines.push(`    ${info.description}`);
    lines.push(`    ${info.handler}`);
    lines.push("");
  }
  return lines.join("\n");
}

function formatHelp(): string {
  return [
    "Gateway Bridge commands:",
    "",
    "/bridge — Show bridge status and available methods",
    "/bridge methods — List all gateway methods",
    "/bridge tray — Get tray app status",
    "/bridge rog — Get ROG status via tray",
    "/bridge profile <silent|performance|turbo> — Set profile via tray",
    "/bridge exec <Get-*> — Execute read-only PS command via tray",
    "/bridge help — Show this help",
  ].join("\n");
}

// ── Plugin Entry ────────────────────────────────────────────

export default definePluginEntry({
  id: "rog-gateway-bridge",
  name: "ROG Gateway Bridge",
  description: "Routes commands between OpenClaw gateway and ROG tray application",
  register(api: OpenClawPluginApi) {
    // Register gateway methods that the tray app can call
    for (const method of Object.keys(GATEWAY_METHODS)) {
      api.registerGatewayMethod(method, async (params) => {
        api.logger.info(`[bridge] Gateway method called: ${method}`);
        return { ok: true, method, params };
      });
    }

    api.registerCommand({
      name: "bridge",
      description: "Gateway bridge — communicate with tray app via WebSocket.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const { action, tokens } = parseCommandArgs(ctx);

        if (action === "help") return { text: formatHelp() };

        // /bridge methods
        if (action === "methods" || action === "list") {
          return { text: formatMethods() };
        }

        // /bridge tray — would call tray.status via gateway
        if (action === "tray") {
          return {
            text: [
              "Gateway Bridge → tray.status",
              "This command sends a request to the tray app via WebSocket.",
              "The tray app responds with its running status.",
              "",
              "Note: Requires active gateway connection (tray app must be running).",
              `Registered methods: ${Object.keys(GATEWAY_METHODS).length}`,
            ].join("\n"),
          };
        }

        // /bridge rog — would call rog.status via gateway
        if (action === "rog") {
          return {
            text: [
              "Gateway Bridge → rog.status",
              "Fetches power mode, CPU%, battery from tray app via WebSocket.",
              "",
              "Note: Requires active gateway connection.",
            ].join("\n"),
          };
        }

        // /bridge profile <profile>
        if (action === "profile") {
          const profile = tokens[1]?.toLowerCase();
          if (!profile || !["silent", "performance", "turbo"].includes(profile)) {
            return { text: "Usage: /bridge profile <silent|performance|turbo>" };
          }
          return {
            text: [
              `Gateway Bridge → rog.setProfile { profile: "${profile}" }`,
              "This routes the profile change through the tray app's PowerShell handler.",
              "",
              "Note: Requires active gateway connection and admin privileges on tray app.",
            ].join("\n"),
          };
        }

        // /bridge exec <command>
        if (action === "exec") {
          const script = tokens.slice(1).join(" ");
          if (!script) return { text: "Usage: /bridge exec <Get-* command>" };
          if (!script.startsWith("Get-") && !script.startsWith("(Get-")) {
            return { text: "Safety: only Get-* commands allowed via gateway bridge." };
          }
          return {
            text: [
              `Gateway Bridge → system.exec { script: "${script}" }`,
              "Routes this read-only command to the tray app for execution.",
              "",
              "Note: Requires active gateway connection.",
            ].join("\n"),
          };
        }

        // Default: show status
        return {
          text: [
            "ROG Gateway Bridge",
            `  Registered methods: ${Object.keys(GATEWAY_METHODS).length}`,
            `  Methods: ${Object.keys(GATEWAY_METHODS).join(", ")}`,
            "",
            'Type "/bridge help" for all commands.',
          ].join("\n"),
        };
      },
    });
  },
});

export { formatHelp, formatMethods, GATEWAY_METHODS };
