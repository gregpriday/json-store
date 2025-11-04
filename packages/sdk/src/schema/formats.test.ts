/**
 * Tests for custom format validators
 */

import { describe, it, expect } from "vitest";
import {
  slugFormat,
  iso3166_1_alpha_2Format,
  iso3166_2Format,
  markdownPathFormat,
} from "./formats.js";

describe("slugFormat", () => {
  it("should accept valid slugs", () => {
    expect(slugFormat("hello")).toBe(true);
    expect(slugFormat("hello-world")).toBe(true);
    expect(slugFormat("hello-world-123")).toBe(true);
    expect(slugFormat("hello123")).toBe(true);
    expect(slugFormat("a")).toBe(true);
    expect(slugFormat("abc-def-ghi")).toBe(true);
  });

  it("should reject invalid slugs", () => {
    expect(slugFormat("Hello")).toBe(false); // uppercase
    expect(slugFormat("hello_world")).toBe(false); // underscore
    expect(slugFormat("hello world")).toBe(false); // space
    expect(slugFormat("-hello")).toBe(false); // starts with hyphen
    expect(slugFormat("hello-")).toBe(false); // ends with hyphen
    expect(slugFormat("hello--world")).toBe(false); // double hyphen
    expect(slugFormat("")).toBe(false); // empty
    expect(slugFormat("hello.world")).toBe(false); // dot
    expect(slugFormat("hello/world")).toBe(false); // slash
  });

  it("should reject non-strings", () => {
    expect(slugFormat(123 as any)).toBe(false);
    expect(slugFormat(null as any)).toBe(false);
    expect(slugFormat(undefined as any)).toBe(false);
    expect(slugFormat({} as any)).toBe(false);
    expect(slugFormat([] as any)).toBe(false);
  });

  it("should reject unicode and encoded sequences", () => {
    expect(slugFormat("mañana")).toBe(false);
    expect(slugFormat("emoji🙂")).toBe(false);
    expect(slugFormat("hello%2Fworld")).toBe(false);
  });

  it("should accept very long slugs", () => {
    expect(slugFormat("a".repeat(512))).toBe(true);
  });
});

describe("iso3166_1_alpha_2Format", () => {
  it("should accept valid country codes", () => {
    expect(iso3166_1_alpha_2Format("US")).toBe(true);
    expect(iso3166_1_alpha_2Format("GB")).toBe(true);
    expect(iso3166_1_alpha_2Format("FR")).toBe(true);
    expect(iso3166_1_alpha_2Format("DE")).toBe(true);
    expect(iso3166_1_alpha_2Format("JP")).toBe(true);
    expect(iso3166_1_alpha_2Format("CA")).toBe(true);
    expect(iso3166_1_alpha_2Format("AU")).toBe(true);
  });

  it("should reject invalid country codes", () => {
    expect(iso3166_1_alpha_2Format("us")).toBe(false); // lowercase
    expect(iso3166_1_alpha_2Format("USA")).toBe(false); // 3 letters
    expect(iso3166_1_alpha_2Format("U")).toBe(false); // 1 letter
    expect(iso3166_1_alpha_2Format("ZZ")).toBe(false); // invalid code
    expect(iso3166_1_alpha_2Format("XX")).toBe(false); // invalid code
    expect(iso3166_1_alpha_2Format("")).toBe(false); // empty
  });

  it("should reject non-strings", () => {
    expect(iso3166_1_alpha_2Format(123 as any)).toBe(false);
    expect(iso3166_1_alpha_2Format(null as any)).toBe(false);
    expect(iso3166_1_alpha_2Format(undefined as any)).toBe(false);
    expect(iso3166_1_alpha_2Format([] as any)).toBe(false);
    expect(iso3166_1_alpha_2Format({ code: "US" } as any)).toBe(false);
  });

  it("should accept edge country codes", () => {
    expect(iso3166_1_alpha_2Format("UM")).toBe(true); // U.S. Minor Outlying Islands
    expect(iso3166_1_alpha_2Format("EH")).toBe(true); // Western Sahara
    expect(iso3166_1_alpha_2Format("BQ")).toBe(true); // Caribbean Netherlands
  });

  it("should reject quasi-codes and malformed strings", () => {
    expect(iso3166_1_alpha_2Format("XK")).toBe(false); // Kosovo (not in ISO 3166-1)
    expect(iso3166_1_alpha_2Format("U1")).toBe(false); // digit
    expect(iso3166_1_alpha_2Format(" US")).toBe(false); // leading space
    expect(iso3166_1_alpha_2Format("US ")).toBe(false); // trailing space
  });
});

describe("iso3166_2Format", () => {
  it("should accept valid subdivision codes", () => {
    expect(iso3166_2Format("US-NY")).toBe(true);
    expect(iso3166_2Format("US-CA")).toBe(true);
    expect(iso3166_2Format("GB-ENG")).toBe(true);
    expect(iso3166_2Format("CA-QC")).toBe(true);
    expect(iso3166_2Format("FR-75")).toBe(true);
  });

  it("should reject invalid subdivision codes", () => {
    expect(iso3166_2Format("us-ny")).toBe(false); // lowercase country
    expect(iso3166_2Format("US-ny")).toBe(false); // lowercase subdivision
    expect(iso3166_2Format("USA-NY")).toBe(false); // 3-letter country
    expect(iso3166_2Format("US")).toBe(false); // missing subdivision
    expect(iso3166_2Format("ZZ-AA")).toBe(false); // invalid country code
    expect(iso3166_2Format("US-ABCD")).toBe(false); // subdivision too long
    expect(iso3166_2Format("")).toBe(false); // empty
  });

  it("should reject non-strings", () => {
    expect(iso3166_2Format(123 as any)).toBe(false);
    expect(iso3166_2Format(null as any)).toBe(false);
    expect(iso3166_2Format(undefined as any)).toBe(false);
    expect(iso3166_2Format([] as any)).toBe(false);
    expect(iso3166_2Format({ code: "US-NY" } as any)).toBe(false);
  });

  it("should handle subdivision edge cases", () => {
    expect(iso3166_2Format("US-A")).toBe(true); // single char
    expect(iso3166_2Format("US-1")).toBe(true); // single digit
    expect(iso3166_2Format("BR-RIO")).toBe(true); // 3 chars
  });

  it("should reject malformed separators and whitespace", () => {
    expect(iso3166_2Format("US--NY")).toBe(false); // double hyphen
    expect(iso3166_2Format("US -NY")).toBe(false); // space before hyphen
    expect(iso3166_2Format("US-NY ")).toBe(false); // trailing space
    expect(iso3166_2Format(" US-NY")).toBe(false); // leading space
  });
});

describe("markdownPathFormat", () => {
  it("should accept valid markdown paths", () => {
    expect(markdownPathFormat("readme.md")).toBe(true);
    expect(markdownPathFormat("./readme.md")).toBe(true);
    expect(markdownPathFormat("./docs/readme.md")).toBe(true);
    expect(markdownPathFormat("docs/guide/intro.md")).toBe(true);
    expect(markdownPathFormat("a/b/c/d.md")).toBe(true);
  });

  it("should reject invalid markdown paths", () => {
    expect(markdownPathFormat("readme.txt")).toBe(false); // wrong extension
    expect(markdownPathFormat("readme")).toBe(false); // no extension
    expect(markdownPathFormat("/abs/path.md")).toBe(false); // absolute path
    expect(markdownPathFormat("../readme.md")).toBe(false); // parent directory
    expect(markdownPathFormat("./docs/../readme.md")).toBe(false); // parent in path
    expect(markdownPathFormat("C:/docs/readme.md")).toBe(false); // Windows absolute
    expect(markdownPathFormat("")).toBe(false); // empty
  });

  it("should reject non-strings", () => {
    expect(markdownPathFormat(123 as any)).toBe(false);
    expect(markdownPathFormat(null as any)).toBe(false);
    expect(markdownPathFormat(undefined as any)).toBe(false);
    expect(markdownPathFormat({} as any)).toBe(false);
    expect(markdownPathFormat([] as any)).toBe(false);
  });

  it("should reject encoded or injected traversal", () => {
    expect(markdownPathFormat("docs/%2e%2e/secret.md")).toBe(false); // encoded ..
    expect(markdownPathFormat("docs/%2E%2E/secret.md")).toBe(false); // uppercase encoded
    expect(markdownPathFormat("docs/%2fsecret.md")).toBe(false); // encoded slash
  });

  it("should reject null bytes, backslashes, and control characters", () => {
    expect(markdownPathFormat("docs/\u0000secret.md")).toBe(false); // null byte
    expect(markdownPathFormat("..\\readme.md")).toBe(false); // backslash
    expect(markdownPathFormat(" docs/readme.md")).toBe(false); // leading space
    expect(markdownPathFormat("docs/\nsecret.md")).toBe(false); // newline
  });
});
