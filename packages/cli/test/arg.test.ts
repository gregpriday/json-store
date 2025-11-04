/**
 * Unit tests for argument parsing
 */

import { describe, it, expect } from "vitest";
import { parseNonNegativeInt, parseJson } from "../src/lib/arg.js";
import { InvalidArgumentError } from "commander";

describe("arg parsing", () => {
  describe("parseNonNegativeInt", () => {
    it("should parse valid positive integers", () => {
      expect(parseNonNegativeInt("0", "test")).toBe(0);
      expect(parseNonNegativeInt("1", "test")).toBe(1);
      expect(parseNonNegativeInt("100", "test")).toBe(100);
      expect(parseNonNegativeInt("9999", "test")).toBe(9999);
    });

    it("should reject negative numbers", () => {
      expect(() => parseNonNegativeInt("-1", "test")).toThrow(InvalidArgumentError);
      expect(() => parseNonNegativeInt("-100", "test")).toThrow("must be a non-negative integer");
    });

    it("should reject NaN", () => {
      expect(() => parseNonNegativeInt("abc", "test")).toThrow(InvalidArgumentError);
      expect(() => parseNonNegativeInt("abc", "test")).toThrow("must be a non-negative integer");
    });

    it("should reject values > 10000", () => {
      expect(() => parseNonNegativeInt("10001", "test")).toThrow(InvalidArgumentError);
      expect(() => parseNonNegativeInt("100000", "test")).toThrow("must be <= 10000");
    });

    it("should allow exactly 10000", () => {
      expect(parseNonNegativeInt("10000", "test")).toBe(10000);
    });
  });

  describe("parseJson", () => {
    it("should parse valid JSON", () => {
      expect(parseJson('{"a":1}', "test")).toEqual({ a: 1 });
      expect(parseJson("[1,2,3]", "test")).toEqual([1, 2, 3]);
      expect(parseJson('"string"', "test")).toBe("string");
      expect(parseJson("123", "test")).toBe(123);
      expect(parseJson("true", "test")).toBe(true);
      expect(parseJson("null", "test")).toBe(null);
    });

    it("should handle BOM", () => {
      const withBOM = "\uFEFF" + '{"a":1}';
      expect(parseJson(withBOM, "test")).toEqual({ a: 1 });
    });

    it("should reject invalid JSON with descriptive error", () => {
      expect(() => parseJson("{invalid}", "test")).toThrow(InvalidArgumentError);
      expect(() => parseJson("{invalid}", "test")).toThrow("Invalid JSON in test");
    });

    it("should include source in error message", () => {
      expect(() => parseJson("{", "stdin")).toThrow("stdin");
      expect(() => parseJson("{", "--data")).toThrow("--data");
    });
  });
});
