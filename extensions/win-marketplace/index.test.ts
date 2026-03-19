import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/extensions/plugin-api.js";

describe("win-marketplace plugin", () => {
  it("registers the /market command", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "win-marketplace",
        name: "Plugin Marketplace",
        source: "test",
        config: {},
        pluginConfig: {},
        runtime: {
          state: { resolveStateDir: () => "/tmp" },
          config: { loadConfig: () => ({}), writeConfigFile: async () => {} },
        } as any,
        registerCommand: (cmd: any) => { command = cmd; },
      }),
    );

    expect(command?.name).toBe("market");
    expect(command?.acceptsArgs).toBe(true);
  });

  it("returns help with all commands", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "win-marketplace",
        name: "Plugin Marketplace",
        source: "test",
        config: {},
        pluginConfig: {},
        runtime: {
          state: { resolveStateDir: () => "/tmp" },
          config: { loadConfig: () => ({}), writeConfigFile: async () => {} },
        } as any,
        registerCommand: (cmd: any) => { command = cmd; },
      }),
    );

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      commandBody: "/market help",
      args: "help",
      config: {},
      requestConversationBinding: async () => ({ status: "error" as const }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    });

    const text = String(result?.text ?? "");
    expect(text).toContain("/market search");
    expect(text).toContain("/market install");
    expect(text).toContain("/market categories");
  });

  it("searchCatalog finds by tag", async () => {
    vi.resetModules();
    const { searchCatalog } = await import("./index.js");

    const results = searchCatalog("music");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.id).toBe("spotify-control");
  });

  it("searchCatalog finds by category", async () => {
    vi.resetModules();
    const { searchCatalog } = await import("./index.js");

    const results = searchCatalog("hardware");
    expect(results.length).toBe(2); // razer-chroma + corsair-icue
  });

  it("CATALOG has required fields", async () => {
    vi.resetModules();
    const { CATALOG } = await import("./index.js");

    expect(CATALOG.length).toBeGreaterThanOrEqual(10);
    for (const p of CATALOG) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.url).toMatch(/^https:\/\//);
      expect(p.tags.length).toBeGreaterThan(0);
    }
  });

  it("formatCategories lists all categories", async () => {
    vi.resetModules();
    const { formatCategories } = await import("./index.js");

    const result = formatCategories();
    expect(result).toContain("Categories:");
    expect(result).toContain("tool");
    expect(result).toContain("media");
  });
});
