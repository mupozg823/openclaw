import { describe, expect, it } from "vitest";
import {
  AURA_REG_CANDIDATES,
  FAN_REG_KEY,
  POWER_MODE_MAP,
  POWER_REG_PATH,
  parseCommandArgs,
  parseNumber,
  powerModeToValue,
} from "./index.ts";

describe("rog-win-shared", () => {
  describe("parseNumber", () => {
    it("parses valid numbers", () => {
      expect(parseNumber("42")).toBe(42);
      expect(parseNumber("3.14")).toBeCloseTo(3.14);
      expect(parseNumber("0")).toBe(0);
    });

    it("returns null for empty/invalid", () => {
      expect(parseNumber("")).toBeNull();
      expect(parseNumber("abc")).toBeNull();
      expect(parseNumber("NaN")).toBeNull();
      expect(parseNumber("Infinity")).toBeNull();
    });
  });

  describe("parseCommandArgs", () => {
    it("parses action and tokens", () => {
      const result = parseCommandArgs({ args: "  status --verbose  " });
      expect(result.action).toBe("status");
      expect(result.tokens).toEqual(["status", "--verbose"]);
    });

    it("handles empty args", () => {
      expect(parseCommandArgs({ args: "" }).action).toBe("");
      expect(parseCommandArgs({ args: undefined }).action).toBe("");
      expect(parseCommandArgs({}).action).toBe("");
    });
  });

  describe("powerModeToValue", () => {
    it("maps modes to registry values", () => {
      expect(powerModeToValue("silent")).toBe("0");
      expect(powerModeToValue("performance")).toBe("1");
      expect(powerModeToValue("turbo")).toBe("2");
    });

    it("returns undefined for unknown", () => {
      expect(powerModeToValue("unknown")).toBeUndefined();
    });
  });

  describe("constants", () => {
    it("POWER_MODE_MAP has 3 entries", () => {
      expect(Object.keys(POWER_MODE_MAP)).toHaveLength(3);
    });

    it("AURA_REG_CANDIDATES has 3 paths", () => {
      expect(AURA_REG_CANDIDATES).toHaveLength(3);
    });

    it("registry paths are non-empty", () => {
      expect(POWER_REG_PATH).toContain("ASUS");
      expect(FAN_REG_KEY).toContain("FanControl");
    });
  });
});
