/**
 * Unit tests for error handling
 */

import { describe, it, expect } from "vitest";
import { CliError, mapSdkErrorToExitCode, formatCliError } from "../src/lib/errors.js";

describe("error handling", () => {
  describe("CliError", () => {
    it("should create error with default exit code 1", () => {
      const err = new CliError("test error");
      expect(err.message).toBe("test error");
      expect(err.exitCode).toBe(1);
      expect(err.name).toBe("CliError");
    });

    it("should create error with custom exit code", () => {
      const err = new CliError("not found", { exitCode: 2 });
      expect(err.exitCode).toBe(2);
    });

    it("should support cause", () => {
      const cause = new Error("underlying error");
      const err = new CliError("wrapper", { cause });
      expect(err.cause).toBe(cause);
    });
  });

  describe("mapSdkErrorToExitCode", () => {
    it("should map DocumentNotFoundError to exit code 2", () => {
      const err = new Error("not found");
      err.name = "DocumentNotFoundError";
      expect(mapSdkErrorToExitCode(err)).toBe(2);
    });

    it("should map NotFoundError to exit code 2", () => {
      const err = new Error("not found");
      err.name = "NotFoundError";
      expect(mapSdkErrorToExitCode(err)).toBe(2);
    });

    it("should map validation errors to exit code 1", () => {
      const errors = [
        "ValidationError",
        "InvalidArgumentError",
        "DocumentReadError",
        "DocumentWriteError",
        "DocumentRemoveError",
        "DirectoryError",
        "ListFilesError",
        "JSONStoreError",
      ];

      for (const name of errors) {
        const err = new Error("test");
        err.name = name;
        expect(mapSdkErrorToExitCode(err)).toBe(1);
      }
    });

    it("should default to exit code 1 for unknown errors", () => {
      expect(mapSdkErrorToExitCode(new Error("unknown"))).toBe(1);
      expect(mapSdkErrorToExitCode("string error")).toBe(1);
      expect(mapSdkErrorToExitCode(null)).toBe(1);
    });
  });

  describe("formatCliError", () => {
    it("should format error message", () => {
      const err = new Error("test error");
      expect(formatCliError(err)).toBe("test error");
    });

    it("should truncate long messages", () => {
      const longMessage = "x".repeat(3000);
      const err = new Error(longMessage);
      const formatted = formatCliError(err);
      expect(formatted.length).toBeLessThan(2100);
      expect(formatted).toContain("(truncated)");
    });

    it("should include cause in verbose mode", () => {
      const cause = new Error("underlying");
      const err = new Error("wrapper");
      (err as any).cause = cause;

      const formatted = formatCliError(err, true);
      expect(formatted).toContain("Cause:");
      expect(formatted).toContain("underlying");
    });

    it("should include stack in verbose mode", () => {
      const err = new Error("test");
      const formatted = formatCliError(err, true);
      expect(formatted).toContain("Error: test");
    });

    it("should not include stack in non-verbose mode", () => {
      const err = new Error("test");
      const formatted = formatCliError(err, false);
      expect(formatted).toBe("test");
    });

    it("should handle non-Error values", () => {
      expect(formatCliError("string error")).toBe("string error");
      expect(formatCliError(42)).toBe("42");
      expect(formatCliError(null)).toBe("null");
    });
  });
});
