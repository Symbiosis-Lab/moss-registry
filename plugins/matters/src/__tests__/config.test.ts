import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupMockTauri, type MockTauriContext } from "@symbiosis-lab/moss-api/testing";

import {
  getConfig,
  saveConfig,
  type MattersPluginConfig,
} from "../config";

describe("Config Module", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ pluginName: "matters-syndicator" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("getConfig", () => {
    it("returns default config when file does not exist", async () => {
      // No file set up = file doesn't exist
      const config = await getConfig();
      expect(config).toEqual({});
    });

    it("returns parsed config when file exists", async () => {
      const savedConfig: MattersPluginConfig = {
        userName: "testuser",
        language: "zh_hant",
      };
      // Set up the config file in the plugin's storage directory
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/matters-syndicator/config.json`,
        JSON.stringify(savedConfig)
      );

      const config = await getConfig();
      expect(config).toEqual(savedConfig);
    });

    it("returns empty config on parse error", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/matters-syndicator/config.json`,
        "invalid json {{{"
      );

      const config = await getConfig();
      expect(config).toEqual({});
    });
  });

  describe("saveConfig", () => {
    it("writes config to plugin storage", async () => {
      const config: MattersPluginConfig = {
        userName: "testuser",
        language: "en",
      };

      await saveConfig(config);

      const savedContent = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/plugins/matters-syndicator/config.json`
      );
      expect(savedContent).toBeDefined();
      expect(JSON.parse(savedContent!.content)).toEqual(config);
    });

    it("preserves existing fields when updating", async () => {
      const existingConfig: MattersPluginConfig = {
        userName: "olduser",
        language: "zh_hant",
      };
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/matters-syndicator/config.json`,
        JSON.stringify(existingConfig)
      );

      // Get existing config, merge, and save
      const existing = await getConfig();
      const merged = { ...existing, userName: "newuser" };
      await saveConfig(merged);

      const savedContent = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/plugins/matters-syndicator/config.json`
      );
      expect(JSON.parse(savedContent!.content)).toEqual({
        userName: "newuser",
        language: "zh_hant",
      });
    });
  });

  describe("Config schema", () => {
    it("supports userName field", async () => {
      const config: MattersPluginConfig = { userName: "Matty" };
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/matters-syndicator/config.json`,
        JSON.stringify(config)
      );

      const result = await getConfig();
      expect(result.userName).toBe("Matty");
    });

    it("supports language field", async () => {
      const config: MattersPluginConfig = { language: "zh_hans" };
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/matters-syndicator/config.json`,
        JSON.stringify(config)
      );

      const result = await getConfig();
      expect(result.language).toBe("zh_hans");
    });

    it("supports both userName and language", async () => {
      const config: MattersPluginConfig = {
        userName: "刘果",
        language: "zh_hant",
      };
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/matters-syndicator/config.json`,
        JSON.stringify(config)
      );

      const result = await getConfig();
      expect(result.userName).toBe("刘果");
      expect(result.language).toBe("zh_hant");
    });

    it("handles empty config object", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/matters-syndicator/config.json`,
        "{}"
      );

      const result = await getConfig();
      expect(result).toEqual({});
      expect(result.userName).toBeUndefined();
      expect(result.language).toBeUndefined();
    });

    it("supports lastSyncedAt field for incremental sync", async () => {
      const timestamp = "2024-01-15T12:00:00.000Z";
      const config: MattersPluginConfig = {
        userName: "testuser",
        lastSyncedAt: timestamp,
      };
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/matters-syndicator/config.json`,
        JSON.stringify(config)
      );

      const result = await getConfig();
      expect(result.lastSyncedAt).toBe(timestamp);
    });

    it("stores and retrieves all config fields together", async () => {
      const config: MattersPluginConfig = {
        userName: "testuser",
        language: "zh_hant",
        lastSyncedAt: "2024-01-15T12:00:00.000Z",
      };
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/matters-syndicator/config.json`,
        JSON.stringify(config)
      );

      const result = await getConfig();
      expect(result).toEqual(config);
    });
  });

  describe("Incremental Sync", () => {
    it("can update lastSyncedAt while preserving other fields", async () => {
      const initialConfig: MattersPluginConfig = {
        userName: "testuser",
        language: "en",
      };
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/matters-syndicator/config.json`,
        JSON.stringify(initialConfig)
      );

      // Read, update, and save
      const config = await getConfig();
      const newTimestamp = new Date().toISOString();
      await saveConfig({ ...config, lastSyncedAt: newTimestamp });

      const savedContent = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/plugins/matters-syndicator/config.json`
      );
      const parsed = JSON.parse(savedContent!.content);

      expect(parsed.userName).toBe("testuser");
      expect(parsed.language).toBe("en");
      expect(parsed.lastSyncedAt).toBe(newTimestamp);
    });

    it("lastSyncedAt is undefined on first sync", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/matters-syndicator/config.json`,
        JSON.stringify({ userName: "testuser" })
      );

      const config = await getConfig();
      expect(config.lastSyncedAt).toBeUndefined();
    });
  });
});
