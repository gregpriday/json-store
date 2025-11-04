/**
 * Slug generation and management utilities
 *
 * Provides deterministic, URL-safe slug generation with:
 * - Unicode normalization (NFKC)
 * - Transliteration (diacritics to ASCII)
 * - Cleaning (spaces to dashes, punctuation removal)
 * - Length limiting with word boundary preservation
 * - Reserved word validation
 */

/**
 * Options for slug generation
 */
export interface SlugOptions {
  /** Maximum length for the slug (default: 64) */
  maxLength?: number;
  /** Reserved words that cannot be used as slugs */
  reservedWords?: string[];
  /** Transliteration strategy: 'ascii' (default), 'none', or custom function */
  transliterate?: "ascii" | "none" | ((s: string) => string);
  /** Locale for case conversion (default: 'en') */
  locale?: string;
}

/**
 * Default reserved words (common URL segments that should be avoided)
 */
export const DEFAULT_RESERVED_WORDS = [
  "new",
  "edit",
  "delete",
  "create",
  "update",
  "admin",
  "api",
  "app",
  "assets",
  "public",
  "private",
  "static",
  "index",
  "search",
];

/**
 * Diacritic to ASCII mapping for transliteration
 */
const DIACRITIC_MAP: Record<string, string> = {
  // Latin-1 Supplement
  À: "A",
  Á: "A",
  Â: "A",
  Ã: "A",
  Ä: "A",
  Å: "A",
  Æ: "AE",
  Ç: "C",
  È: "E",
  É: "E",
  Ê: "E",
  Ë: "E",
  Ì: "I",
  Í: "I",
  Î: "I",
  Ï: "I",
  Ð: "D",
  Ñ: "N",
  Ò: "O",
  Ó: "O",
  Ô: "O",
  Õ: "O",
  Ö: "O",
  Ø: "O",
  Ù: "U",
  Ú: "U",
  Û: "U",
  Ü: "U",
  Ý: "Y",
  Þ: "TH",
  ß: "ss",
  à: "a",
  á: "a",
  â: "a",
  ã: "a",
  ä: "a",
  å: "a",
  æ: "ae",
  ç: "c",
  è: "e",
  é: "e",
  ê: "e",
  ë: "e",
  ì: "i",
  í: "i",
  î: "i",
  ï: "i",
  ð: "d",
  ñ: "n",
  ò: "o",
  ó: "o",
  ô: "o",
  õ: "o",
  ö: "o",
  ø: "o",
  ù: "u",
  ú: "u",
  û: "u",
  ü: "u",
  ý: "y",
  þ: "th",
  ÿ: "y",
  // Latin Extended-A
  Ā: "A",
  ā: "a",
  Ă: "A",
  ă: "a",
  Ą: "A",
  ą: "a",
  Ć: "C",
  ć: "c",
  Ĉ: "C",
  ĉ: "c",
  Ċ: "C",
  ċ: "c",
  Č: "C",
  č: "c",
  Ď: "D",
  ď: "d",
  Đ: "D",
  đ: "d",
  Ē: "E",
  ē: "e",
  Ĕ: "E",
  ĕ: "e",
  Ė: "E",
  ė: "e",
  Ę: "E",
  ę: "e",
  Ě: "E",
  ě: "e",
  Ĝ: "G",
  ĝ: "g",
  Ğ: "G",
  ğ: "g",
  Ġ: "G",
  ġ: "g",
  Ģ: "G",
  ģ: "g",
  Ĥ: "H",
  ĥ: "h",
  Ħ: "H",
  ħ: "h",
  Ĩ: "I",
  ĩ: "i",
  Ī: "I",
  ī: "i",
  Ĭ: "I",
  ĭ: "i",
  Į: "I",
  į: "i",
  İ: "I",
  ı: "i",
  Ĳ: "IJ",
  ĳ: "ij",
  Ĵ: "J",
  ĵ: "j",
  Ķ: "K",
  ķ: "k",
  Ĺ: "L",
  ĺ: "l",
  Ļ: "L",
  ļ: "l",
  Ľ: "L",
  ľ: "l",
  Ŀ: "L",
  ŀ: "l",
  Ł: "L",
  ł: "l",
  Ń: "N",
  ń: "n",
  Ņ: "N",
  ņ: "n",
  Ň: "N",
  ň: "n",
  ŉ: "n",
  Ō: "O",
  ō: "o",
  Ŏ: "O",
  ŏ: "o",
  Ő: "O",
  ő: "o",
  Œ: "OE",
  œ: "oe",
  Ŕ: "R",
  ŕ: "r",
  Ŗ: "R",
  ŗ: "r",
  Ř: "R",
  ř: "r",
  Ś: "S",
  ś: "s",
  Ŝ: "S",
  ŝ: "s",
  Ş: "S",
  ş: "s",
  Š: "S",
  š: "s",
  Ţ: "T",
  ţ: "t",
  Ť: "T",
  ť: "t",
  Ŧ: "T",
  ŧ: "t",
  Ũ: "U",
  ũ: "u",
  Ū: "U",
  ū: "u",
  Ŭ: "U",
  ŭ: "u",
  Ů: "U",
  ů: "u",
  Ű: "U",
  ű: "u",
  Ų: "U",
  ų: "u",
  Ŵ: "W",
  ŵ: "w",
  Ŷ: "Y",
  ŷ: "y",
  Ÿ: "Y",
  Ź: "Z",
  ź: "z",
  Ż: "Z",
  ż: "z",
  Ž: "Z",
  ž: "z",
};

/**
 * Normalize a string using Unicode NFKC normalization and trim whitespace
 */
export function normalize(input: string, locale: string = "en"): string {
  // NFKC normalization: Compatibility decomposition, followed by canonical composition
  // This handles things like ligatures, half-width characters, etc.
  const normalized = input.normalize("NFKC");

  // Trim whitespace
  const trimmed = normalized.trim();

  // Convert to lowercase using locale-aware conversion
  return trimmed.toLocaleLowerCase(locale);
}

/**
 * Transliterate non-ASCII characters to ASCII equivalents
 */
export function transliterate(
  input: string,
  strategy: "ascii" | "none" | ((s: string) => string) = "ascii"
): string {
  if (strategy === "none") {
    return input;
  }

  if (typeof strategy === "function") {
    return strategy(input);
  }

  // ASCII transliteration
  let result = "";
  for (const char of input) {
    if (DIACRITIC_MAP[char]) {
      result += DIACRITIC_MAP[char];
    } else {
      result += char;
    }
  }

  return result;
}

/**
 * Clean a string by replacing spaces with dashes, removing punctuation, and collapsing dashes
 * Preserves Unicode letters and numbers
 */
export function clean(input: string): string {
  // Replace whitespace and underscores with dashes
  let cleaned = input.replace(/[\s_]+/g, "-");

  // Remove all characters except Unicode alphanumeric and dash
  // This preserves non-Latin characters like Chinese, Arabic, etc.
  cleaned = cleaned.replace(/[^\p{L}\p{N}-]/gu, "");

  // Collapse multiple consecutive dashes
  cleaned = cleaned.replace(/-+/g, "-");

  // Trim leading and trailing dashes
  cleaned = cleaned.replace(/^-+|-+$/g, "");

  return cleaned;
}

/**
 * Limit length while preserving word boundaries
 * If a suffix will be added, reserves space for it
 */
export function limitLength(
  input: string,
  maxLength: number,
  reserveForSuffix: number = 0
): string {
  const effectiveMax = Math.max(1, maxLength - reserveForSuffix);

  if (input.length <= effectiveMax) {
    return input;
  }

  // Try to break at a word boundary (dash)
  const truncated = input.substring(0, effectiveMax);
  const lastDash = truncated.lastIndexOf("-");

  // If we found a dash in the last 40% of the string, break there
  // Otherwise, just hard truncate
  if (lastDash > effectiveMax * 0.6) {
    return truncated.substring(0, lastDash);
  }

  return truncated;
}

/**
 * Validate that slug is not a reserved word
 */
export function validateReservedWords(slug: string, reservedWords: string[]): void {
  if (reservedWords.includes(slug)) {
    throw new Error(
      `Slug "${slug}" is a reserved word. Reserved words: ${reservedWords.join(", ")}`
    );
  }
}

/**
 * Generate a slug from input text
 *
 * Pipeline:
 * 1. Normalize (NFKC, trim, lowercase)
 * 2. Transliterate (diacritics to ASCII if configured)
 * 3. Clean (spaces to dashes, remove punctuation)
 * 4. Limit length (with word boundary preservation)
 * 5. Validate reserved words
 *
 * @param input - Input text to generate slug from
 * @param options - Slug generation options
 * @returns URL-safe slug string
 */
export function generateSlug(input: string, options: SlugOptions = {}): string {
  const {
    maxLength = 64,
    reservedWords = DEFAULT_RESERVED_WORDS,
    transliterate: translitStrategy = "ascii",
    locale = "en",
  } = options;

  if (!input || typeof input !== "string") {
    throw new Error("Input must be a non-empty string");
  }

  // Step 1: Normalize
  let slug = normalize(input, locale);

  // Step 2: Transliterate
  slug = transliterate(slug, translitStrategy);

  // Step 3: Clean
  slug = clean(slug);

  // Step 4: Limit length (no suffix reservation for base generation)
  slug = limitLength(slug, maxLength, 0);

  // Validate result
  if (!slug) {
    throw new Error(`Unable to generate slug from input: "${input}"`);
  }

  // Validate format (Unicode-aware: letters and numbers with dashes)
  // Allow both lowercase and other Unicode letters (some scripts don't have case)
  if (!/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug)) {
    throw new Error(`Generated slug "${slug}" does not match expected format`);
  }

  // Step 5: Validate reserved words
  validateReservedWords(slug, reservedWords);

  return slug;
}

/**
 * Generate a unique slug by appending a suffix if needed
 *
 * @param base - Base slug
 * @param existingSlugs - Set of existing slugs to check against
 * @param maxLength - Maximum length for the final slug
 * @returns Unique slug with suffix if needed
 */
export function generateUniqueSlug(
  base: string,
  existingSlugs: Set<string>,
  maxLength: number = 64
): string {
  // Normalize base to maxLength up front
  const normalizedBase = base.length > maxLength ? limitLength(base, maxLength, 0) : base;

  // If base is unique, return it
  if (!existingSlugs.has(normalizedBase)) {
    return normalizedBase;
  }

  // Try numbered suffixes
  let counter = 2;
  while (counter < 1000) {
    const suffix = `-${counter}`;

    // Calculate how much space we need for the suffix
    const suffixLength = suffix.length;
    const maxBaseLength = maxLength - suffixLength;

    // Truncate base if needed to make room for suffix
    const truncatedBase =
      normalizedBase.length > maxBaseLength
        ? limitLength(normalizedBase, maxBaseLength, 0)
        : normalizedBase;
    const candidate = `${truncatedBase}${suffix}`;

    if (!existingSlugs.has(candidate)) {
      return candidate;
    }

    counter++;
  }

  // Fallback: use a short hash if we've exhausted reasonable counters
  const hash = Math.random().toString(36).substring(2, 8);
  const suffix = `-${hash}`;
  const maxBaseLength = maxLength - suffix.length;
  const truncatedBase =
    normalizedBase.length > maxBaseLength
      ? limitLength(normalizedBase, maxBaseLength, 0)
      : normalizedBase;
  return `${truncatedBase}${suffix}`;
}
