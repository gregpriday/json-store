/**
 * Unit tests for environment resolution
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveRoot } from "../src/lib/env.js";
import * as path from "node:path";

describe("environment resolution", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.JSONSTORE_ROOT;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.JSONSTORE_ROOT = originalEnv;
    } else {
      delete process.env.JSONSTORE_ROOT;
    }
  });

  describe("resolveRoot", () => {
    it("should use CLI option when provided", () => {
      process.env.JSONSTORE_ROOT = "/env/path";
      const result = resolveRoot("/cli/path");
      expect(result).toBe(path.resolve("/cli/path"));
    });

    it("should use JSONSTORE_ROOT env var when CLI option not provided", () => {
      process.env.JSONSTORE_ROOT = "/env/path";
      const result = resolveRoot();
      expect(result).toBe(path.resolve("/env/path"));
    });

    it("should use default ./data when neither provided", () => {
      delete process.env.JSONSTORE_ROOT;
      const result = resolveRoot();
      expect(result).toBe(path.resolve("./data"));
    });

    it("should resolve relative paths to absolute", () => {
      const result = resolveRoot("./my-data");
      expect(path.isAbsolute(result)).toBe(true);
      expect(result).toContain("my-data");
    });

    it("should handle absolute paths", () => {
      const result = resolveRoot("/absolute/path");
      expect(result).toBe("/absolute/path");
    });
  });
});
