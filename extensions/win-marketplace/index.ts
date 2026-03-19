import fs from "node:fs";
import path from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { parseCommandArgs } from "../rog-win-shared/index.ts";

// ── Types ────────────────────────────────────────────────────

interface PluginEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  tags: string[];
  url: string;
}

type PluginCategory = "channel" | "provider" | "tool" | "hardware" | "automation" | "media" | "other";

// ── Built-in Catalog ────────────────────────────────────────
// In production this would be fetched from a remote registry.
// For now, a curated local catalog of community plugin ideas.

const CATALOG: PluginEntry[] = [
  {
    id: "spotify-control",
    name: "Spotify Control",
    description: "Control Spotify playback, search tracks, manage playlists",
    version: "1.0.0",
    author: "community",
    category: "media",
    tags: ["music", "spotify", "playback"],
    url: "https://github.com/openclaw/plugin-spotify-control",
  },
  {
    id: "home-assistant",
    name: "Home Assistant Bridge",
    description: "Control smart home devices via Home Assistant API",
    version: "1.0.0",
    author: "community",
    category: "automation",
    tags: ["iot", "smart-home", "hass"],
    url: "https://github.com/openclaw/plugin-home-assistant",
  },
  {
    id: "obs-websocket",
    name: "OBS WebSocket",
    description: "Control OBS Studio scenes, sources, and streaming via WebSocket",
    version: "1.0.0",
    author: "community",
    category: "media",
    tags: ["obs", "streaming", "video"],
    url: "https://github.com/openclaw/plugin-obs-websocket",
  },
  {
    id: "steam-integration",
    name: "Steam Integration",
    description: "Steam library management, game launch, play time tracking",
    version: "1.0.0",
    author: "community",
    category: "tool",
    tags: ["steam", "gaming", "library"],
    url: "https://github.com/openclaw/plugin-steam",
  },
  {
    id: "system-tweaker",
    name: "System Tweaker",
    description: "Windows registry tweaks, service management, startup optimization",
    version: "1.0.0",
    author: "community",
    category: "tool",
    tags: ["registry", "optimization", "services"],
    url: "https://github.com/openclaw/plugin-system-tweaker",
  },
  {
    id: "network-tools",
    name: "Network Tools",
    description: "Ping, traceroute, port scan, DNS lookup, Wi-Fi management",
    version: "1.0.0",
    author: "community",
    category: "tool",
    tags: ["network", "ping", "dns", "wifi"],
    url: "https://github.com/openclaw/plugin-network-tools",
  },
  {
    id: "razer-chroma",
    name: "Razer Chroma RGB",
    description: "Razer Chroma RGB lighting control for Razer peripherals",
    version: "1.0.0",
    author: "community",
    category: "hardware",
    tags: ["rgb", "razer", "chroma", "lighting"],
    url: "https://github.com/openclaw/plugin-razer-chroma",
  },
  {
    id: "corsair-icue",
    name: "Corsair iCUE",
    description: "Corsair iCUE RGB and fan control integration",
    version: "1.0.0",
    author: "community",
    category: "hardware",
    tags: ["rgb", "corsair", "icue", "fans"],
    url: "https://github.com/openclaw/plugin-corsair-icue",
  },
  {
    id: "pomodoro",
    name: "Pomodoro Timer",
    description: "Pomodoro technique timer with break reminders and stats",
    version: "1.0.0",
    author: "community",
    category: "tool",
    tags: ["timer", "productivity", "pomodoro"],
    url: "https://github.com/openclaw/plugin-pomodoro",
  },
  {
    id: "weather",
    name: "Weather Widget",
    description: "Current weather, forecast, and severe weather alerts",
    version: "1.0.0",
    author: "community",
    category: "tool",
    tags: ["weather", "forecast", "temperature"],
    url: "https://github.com/openclaw/plugin-weather",
  },
];

// ── Installed Plugin Detection ──────────────────────────────

function getInstalledPluginIds(extensionsDir: string): Set<string> {
  const installed = new Set<string>();
  try {
    const dirs = fs.readdirSync(extensionsDir, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const metaPath = path.join(extensionsDir, d.name, "openclaw.plugin.json");
      try {
        const raw = fs.readFileSync(metaPath, "utf-8");
        const meta = JSON.parse(raw) as { id?: string };
        if (meta.id) installed.add(meta.id);
      } catch {
        // not a plugin directory
      }
    }
  } catch {
    // extensions dir not found
  }
  return installed;
}

// ── Search ──────────────────────────────────────────────────

function searchCatalog(query: string): PluginEntry[] {
  const q = query.toLowerCase();
  return CATALOG.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags.some((t) => t.includes(q)) ||
      p.category === q ||
      p.id.includes(q),
  );
}

// ── Formatting ──────────────────────────────────────────────

function formatPluginList(plugins: PluginEntry[], installed: Set<string>): string {
  if (plugins.length === 0) return "No plugins found.";
  const lines = plugins.map((p) => {
    const status = installed.has(p.id) ? "[installed]" : "[available]";
    return `  ${status} ${p.name} (${p.id}) v${p.version}\n    ${p.description}\n    Tags: ${p.tags.join(", ")}`;
  });
  return `Plugins (${plugins.length}):\n\n${lines.join("\n\n")}`;
}

function formatPluginDetail(p: PluginEntry, isInstalled: boolean): string {
  return [
    `${p.name} (${p.id})`,
    `  Version: ${p.version}`,
    `  Author: ${p.author}`,
    `  Category: ${p.category}`,
    `  Status: ${isInstalled ? "Installed" : "Available"}`,
    `  Tags: ${p.tags.join(", ")}`,
    `  Description: ${p.description}`,
    `  URL: ${p.url}`,
  ].join("\n");
}

function formatCategories(): string {
  const cats = new Map<string, number>();
  for (const p of CATALOG) {
    cats.set(p.category, (cats.get(p.category) ?? 0) + 1);
  }
  const lines = [...cats.entries()].map(
    ([cat, count]) => `  ${cat}: ${count} plugins`,
  );
  return `Categories:\n${lines.join("\n")}`;
}

function formatHelp(): string {
  return [
    "Plugin Marketplace commands:",
    "",
    "/market — Browse all available plugins",
    "/market search <query> — Search plugins by name, tag, or category",
    "/market info <plugin-id> — Show plugin details",
    "/market categories — List plugin categories",
    "/market installed — List installed plugins",
    "/market install <plugin-id> — Install a plugin (opens URL)",
    "/market stats — Marketplace statistics",
  ].join("\n");
}

// ── Plugin Entry ────────────────────────────────────────────

export default definePluginEntry({
  id: "win-marketplace",
  name: "Plugin Marketplace",
  description: "Browse, search, and manage community OpenClaw plugins",
  register(api: OpenClawPluginApi) {
    const extensionsDir = path.resolve(__dirname, "..");

    api.registerCommand({
      name: "market",
      description: "Plugin marketplace — browse, search, install community plugins.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const { action, tokens } = parseCommandArgs(ctx);
        const installed = getInstalledPluginIds(extensionsDir);

        if (action === "help") return { text: formatHelp() };

        // /market search <query>
        if (action === "search" || action === "find") {
          const query = tokens.slice(1).join(" ");
          if (!query) return { text: "Usage: /market search <query>" };
          const results = searchCatalog(query);
          if (results.length === 0) return { text: `No plugins matching "${query}".` };
          return { text: formatPluginList(results, installed) };
        }

        // /market info <id>
        if (action === "info" || action === "show" || action === "details") {
          const id = tokens[1]?.toLowerCase();
          if (!id) return { text: "Usage: /market info <plugin-id>" };
          const plugin = CATALOG.find((p) => p.id === id);
          if (!plugin) return { text: `Plugin "${id}" not found in catalog.` };
          return { text: formatPluginDetail(plugin, installed.has(id)) };
        }

        // /market categories
        if (action === "categories" || action === "cats") {
          return { text: formatCategories() };
        }

        // /market installed
        if (action === "installed" || action === "local") {
          if (installed.size === 0) return { text: "No plugins detected in extensions directory." };
          const lines = [...installed].sort().map((id) => `  ${id}`);
          return { text: `Installed plugins (${installed.size}):\n${lines.join("\n")}` };
        }

        // /market install <id>
        if (action === "install" || action === "add") {
          const id = tokens[1]?.toLowerCase();
          if (!id) return { text: "Usage: /market install <plugin-id>" };
          const plugin = CATALOG.find((p) => p.id === id);
          if (!plugin) return { text: `Plugin "${id}" not found in catalog.` };
          if (installed.has(id)) return { text: `Plugin "${id}" is already installed.` };
          return {
            text: [
              `To install ${plugin.name}:`,
              "",
              `  1. Clone: git clone ${plugin.url} extensions/${plugin.id}`,
              `  2. Install deps: cd extensions/${plugin.id} && pnpm install`,
              `  3. Restart OpenClaw`,
              "",
              `Or use: pnpm openclaw plugin install ${plugin.id}`,
            ].join("\n"),
          };
        }

        // /market stats
        if (action === "stats" || action === "summary") {
          return {
            text: [
              "Marketplace Statistics:",
              `  Catalog size: ${CATALOG.length} plugins`,
              `  Installed: ${installed.size}`,
              `  Categories: ${new Set(CATALOG.map((p) => p.category)).size}`,
              `  Tags: ${new Set(CATALOG.flatMap((p) => p.tags)).size} unique`,
            ].join("\n"),
          };
        }

        // Default: browse all
        return { text: formatPluginList(CATALOG, installed) };
      },
    });
  },
});

export { formatHelp, searchCatalog, formatCategories, CATALOG };
