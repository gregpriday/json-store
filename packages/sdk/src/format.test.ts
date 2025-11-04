import { describe, it, expect } from "vitest";
import { stableStringify, jsonEqual } from "./format.js";

describe("stableStringify", () => {
  it("should stringify with stable alphabetical key order", () => {
    const obj = { z: 1, a: 2, m: 3 };
    const result = stableStringify(obj);
    expect(result).toBe('{\n  "a": 2,\n  "m": 3,\n  "z": 1\n}\n');
  });

  it("should handle nested objects", () => {
    const obj = {
      z: { b: 2, a: 1 },
      a: { y: 2, x: 1 },
    };
    const result = stableStringify(obj);
    const parsed = JSON.parse(result);
    expect(parsed.z.a).toBe(1);
    expect(parsed.z.b).toBe(2);
  });

  it("should preserve array order", () => {
    const obj = { items: [3, 1, 2] };
    const result = stableStringify(obj);
    expect(result).toBe('{\n  "items": [\n    3,\n    1,\n    2\n  ]\n}\n');
  });

  it("should detect circular references", () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    expect(() => stableStringify(obj)).toThrow("Circular reference");
  });

  it("should use custom key order when provided", () => {
    const obj = { id: "123", type: "task", title: "Test" };
    const result = stableStringify(obj, 2, ["type", "id", "title"]);
    const lines = result.split("\n").filter((l) => l.trim());
    expect(lines[1]).toContain('"type"');
    expect(lines[2]).toContain('"id"');
    expect(lines[3]).toContain('"title"');
  });

  it("should sort unicode keys using code point order", () => {
    const obj = { ä: 1, z: 2, a: 3 };
    const result = stableStringify(obj);
    const parsed = JSON.parse(result);
    expect(Object.keys(parsed)).toEqual(["a", "z", "ä"]);
  });
});

describe("jsonEqual", () => {
  it("should return true for semantically equal JSON", () => {
    const a = '{"a":1,"b":2}';
    const b = '{"b":2,"a":1}';
    expect(jsonEqual(a, b)).toBe(true);
  });

  it("should return false for different JSON", () => {
    const a = '{"a":1}';
    const b = '{"a":2}';
    expect(jsonEqual(a, b)).toBe(false);
  });

  it("should handle invalid JSON gracefully", () => {
    expect(jsonEqual("invalid", '{"a":1}')).toBe(false);
  });
});
