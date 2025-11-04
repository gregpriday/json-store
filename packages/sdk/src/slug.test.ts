/**
 * Unit tests for slug generation
 */

import { describe, test, expect } from "vitest";
import {
  normalize,
  transliterate,
  clean,
  limitLength,
  validateReservedWords,
  generateSlug,
  generateUniqueSlug,
  DEFAULT_RESERVED_WORDS,
} from "./slug.js";

describe("normalize", () => {
  test("converts to lowercase", () => {
    expect(normalize("Hello World")).toBe("hello world");
    expect(normalize("UPPERCASE")).toBe("uppercase");
  });

  test("trims whitespace", () => {
    expect(normalize("  hello  ")).toBe("hello");
    expect(normalize("\thello\n")).toBe("hello");
  });

  test("applies NFKC normalization", () => {
    // Ligatures
    expect(normalize("ﬁ")).toBe("fi");
    // Half-width characters
    expect(normalize("ﾊﾛｰﾜｰﾙﾄﾞ")).toBe("ハローワールド");
  });

  test("handles Turkish locale", () => {
    // Note: Node.js may not fully support Turkish locale-specific lowercasing
    // This test verifies the function works with locale parameter
    const result = normalize("İstanbul", "tr");
    expect(result.toLowerCase()).toBe(result);
    expect(result).toContain("istanbul");
  });

  test("handles empty string", () => {
    expect(normalize("   ")).toBe("");
  });
});

describe("transliterate", () => {
  test("converts diacritics to ASCII", () => {
    expect(transliterate("café", "ascii")).toBe("cafe");
    expect(transliterate("naïve", "ascii")).toBe("naive");
    expect(transliterate("résumé", "ascii")).toBe("resume");
  });

  test("handles Latin-1 Supplement", () => {
    expect(transliterate("Ñoño", "ascii")).toBe("Nono");
    expect(transliterate("São Paulo", "ascii")).toBe("Sao Paulo");
    expect(transliterate("Zürich", "ascii")).toBe("Zurich");
  });

  test("handles Latin Extended-A", () => {
    expect(transliterate("Łódź", "ascii")).toBe("Lodz");
    expect(transliterate("Kraków", "ascii")).toBe("Krakow");
  });

  test("handles German ß", () => {
    expect(transliterate("Straße", "ascii")).toBe("Strasse");
  });

  test("handles Æ/æ and Œ/œ", () => {
    expect(transliterate("Æon", "ascii")).toBe("AEon");
    expect(transliterate("œuvre", "ascii")).toBe("oeuvre");
  });

  test("preserves ASCII characters", () => {
    expect(transliterate("hello", "ascii")).toBe("hello");
    expect(transliterate("123", "ascii")).toBe("123");
  });

  test("none strategy preserves non-ASCII", () => {
    expect(transliterate("café", "none")).toBe("café");
    expect(transliterate("北京", "none")).toBe("北京");
  });

  test("custom transliterator function", () => {
    const custom = (s: string) => s.replace(/[aeiou]/g, "x");
    expect(transliterate("hello", custom)).toBe("hxllx");
  });
});

describe("clean", () => {
  test("replaces spaces with dashes", () => {
    expect(clean("hello world")).toBe("hello-world");
    expect(clean("foo bar baz")).toBe("foo-bar-baz");
  });

  test("replaces underscores with dashes", () => {
    expect(clean("hello_world")).toBe("hello-world");
  });

  test("removes punctuation", () => {
    expect(clean("hello, world!")).toBe("hello-world");
    expect(clean("foo@bar.com")).toBe("foobarcom");
    expect(clean("one/two\\three")).toBe("onetwothree");
  });

  test("collapses multiple dashes", () => {
    expect(clean("hello---world")).toBe("hello-world");
    expect(clean("foo--bar--baz")).toBe("foo-bar-baz");
  });

  test("trims leading and trailing dashes", () => {
    expect(clean("-hello-")).toBe("hello");
    expect(clean("---foo---")).toBe("foo");
  });

  test("handles mixed whitespace", () => {
    expect(clean("hello   world\t\ntest")).toBe("hello-world-test");
  });

  test("removes non-alphanumeric characters", () => {
    expect(clean("hello (world) [test]")).toBe("hello-world-test");
  });
});

describe("limitLength", () => {
  test("returns unchanged if under limit", () => {
    expect(limitLength("hello", 10)).toBe("hello");
    expect(limitLength("short", 10)).toBe("short");
  });

  test("truncates at exact length", () => {
    expect(limitLength("hello-world", 5)).toBe("hello");
  });

  test("breaks at word boundary when possible", () => {
    const input = "hello-world-test-foo";
    const result = limitLength(input, 12);
    // Should break at dash within last 40% (around "hello-world")
    expect(result).toBe("hello-world");
  });

  test("hard truncates if no good word boundary", () => {
    const input = "helloworldtestfoo";
    const result = limitLength(input, 10);
    expect(result).toBe("helloworld");
  });

  test("reserves space for suffix", () => {
    const result1 = limitLength("hello-world", 10, 2);
    expect(result1.length).toBeLessThanOrEqual(8); // 10 - 2
    const result2 = limitLength("test", 10, 6);
    expect(result2).toBe("test"); // Short enough, no truncation
  });

  test("handles empty string", () => {
    expect(limitLength("", 10)).toBe("");
  });
});

describe("validateReservedWords", () => {
  test("throws for reserved words", () => {
    expect(() => validateReservedWords("new", ["new", "edit"])).toThrow(
      'Slug "new" is a reserved word'
    );
    expect(() => validateReservedWords("admin", DEFAULT_RESERVED_WORDS)).toThrow();
  });

  test("allows non-reserved words", () => {
    expect(() => validateReservedWords("hello", ["new", "edit"])).not.toThrow();
    expect(() => validateReservedWords("my-page", DEFAULT_RESERVED_WORDS)).not.toThrow();
  });
});

describe("generateSlug", () => {
  test("generates basic slug", () => {
    expect(generateSlug("Hello World")).toBe("hello-world");
    expect(generateSlug("Foo Bar Baz")).toBe("foo-bar-baz");
  });

  test("handles diacritics", () => {
    expect(generateSlug("São Paulo")).toBe("sao-paulo");
    expect(generateSlug("Zürich")).toBe("zurich");
    expect(generateSlug("Kraków")).toBe("krakow");
  });

  test("handles punctuation", () => {
    expect(generateSlug("Hello, World!")).toBe("hello-world");
    expect(generateSlug("Foo & Bar")).toBe("foo-bar");
  });

  test("handles multiple spaces", () => {
    expect(generateSlug("Hello    World")).toBe("hello-world");
  });

  test("respects maxLength option", () => {
    const result = generateSlug("This is a very long title that should be truncated", {
      maxLength: 20,
    });
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  test("throws for empty input", () => {
    expect(() => generateSlug("")).toThrow("Input must be a non-empty string");
    expect(() => generateSlug("   ")).toThrow("Unable to generate slug");
  });

  test("throws for reserved words", () => {
    expect(() => generateSlug("new")).toThrow('Slug "new" is a reserved word');
    expect(() => generateSlug("admin")).toThrow('Slug "admin" is a reserved word');
  });

  test("allows custom reserved words", () => {
    expect(() => generateSlug("hello", { reservedWords: ["hello", "world"] })).toThrow();
    expect(() => generateSlug("admin", { reservedWords: [] })).not.toThrow();
  });

  test("handles transliterate: none", () => {
    const result = generateSlug("São Paulo", { transliterate: "none" });
    // With transliterate: none, the "ã" stays but "o" after normalization becomes "o"
    expect(result).toMatch(/são-paulo|so-paulo/);
  });

  test("handles custom transliterator", () => {
    const custom = (s: string) => s.replace(/ã/g, "a");
    const result = generateSlug("São Paulo", { transliterate: custom });
    expect(result).toBe("sao-paulo");
  });

  test("handles Chinese characters with transliterate: none", () => {
    const result = generateSlug("北京 Beijing", { transliterate: "none" });
    // Should preserve Chinese characters
    expect(result).toContain("beijing");
    expect(result).toMatch(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u);
  });

  test("handles Arabic with transliterate: none", () => {
    const result = generateSlug("مرحبا Hello", { transliterate: "none" });
    // Should preserve Arabic characters
    expect(result).toContain("hello");
    expect(result).toMatch(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u);
  });

  test("handles emoji removal", () => {
    expect(generateSlug("Hello 👋 World 🌍")).toBe("hello-world");
  });

  test("validates output format", () => {
    const result = generateSlug("Hello World!");
    expect(result).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  test("handles numbers", () => {
    expect(generateSlug("Route 66")).toBe("route-66");
    expect(generateSlug("2001 Space Odyssey")).toBe("2001-space-odyssey");
  });

  test("handles underscores", () => {
    expect(generateSlug("hello_world")).toBe("hello-world");
  });

  test("handles mixed case with numbers", () => {
    expect(generateSlug("iPhone 13 Pro Max")).toBe("iphone-13-pro-max");
  });
});

describe("generateUniqueSlug", () => {
  test("returns base if unique", () => {
    const existing = new Set(["foo", "bar"]);
    expect(generateUniqueSlug("baz", existing)).toBe("baz");
  });

  test("appends -2 for first collision", () => {
    const existing = new Set(["foo"]);
    expect(generateUniqueSlug("foo", existing)).toBe("foo-2");
  });

  test("appends incrementing numbers", () => {
    const existing = new Set(["foo", "foo-2", "foo-3"]);
    expect(generateUniqueSlug("foo", existing)).toBe("foo-4");
  });

  test("truncates base to make room for suffix", () => {
    const existing = new Set(["hello-world"]);
    const result = generateUniqueSlug("hello-world", existing, 12);
    // Result should be truncated to fit within 12 chars with suffix
    expect(result.length).toBeLessThanOrEqual(12);
    expect(result).toMatch(/-\d+$/); // Should end with dash and number
  });

  test("handles empty existing set", () => {
    const existing = new Set<string>();
    expect(generateUniqueSlug("foo", existing)).toBe("foo");
  });

  test("handles many collisions", () => {
    const existing = new Set(
      Array.from({ length: 100 }, (_, i) => (i === 0 ? "foo" : `foo-${i + 1}`))
    );
    const result = generateUniqueSlug("foo", existing);
    expect(result).toBe("foo-101");
  });

  test("falls back to hash after 1000 attempts", () => {
    const existing = new Set(
      Array.from({ length: 1000 }, (_, i) => (i === 0 ? "foo" : `foo-${i + 1}`))
    );
    const result = generateUniqueSlug("foo", existing);
    expect(result).toMatch(/^foo-[a-z0-9]{6}$/);
  });

  test("preserves word boundaries when truncating", () => {
    const existing = new Set(["very-long-slug-name"]);
    const result = generateUniqueSlug("very-long-slug-name", existing, 20);
    expect(result.length).toBeLessThanOrEqual(20);
    // Should have room for suffix
    expect(result).toMatch(/^very-long-slug-\d+$/);
  });
});
