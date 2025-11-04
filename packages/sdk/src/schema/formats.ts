/**
 * Custom format validators for JSON Schema validation
 */

import type { FormatValidator } from "../types.js";

/**
 * Validates slug format: lowercase alphanumeric with hyphens
 * Pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/
 * @example "hello-world" ✓, "Hello-World" ✗, "hello_world" ✗
 */
export const slugFormat: FormatValidator = (value: string): boolean => {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
};

/**
 * ISO 3166-1 alpha-2 country codes (2 uppercase letters)
 * @example "US", "GB", "FR"
 */
const ISO_3166_1_ALPHA_2 = new Set([
  "AD",
  "AE",
  "AF",
  "AG",
  "AI",
  "AL",
  "AM",
  "AO",
  "AQ",
  "AR",
  "AS",
  "AT",
  "AU",
  "AW",
  "AX",
  "AZ",
  "BA",
  "BB",
  "BD",
  "BE",
  "BF",
  "BG",
  "BH",
  "BI",
  "BJ",
  "BL",
  "BM",
  "BN",
  "BO",
  "BQ",
  "BR",
  "BS",
  "BT",
  "BV",
  "BW",
  "BY",
  "BZ",
  "CA",
  "CC",
  "CD",
  "CF",
  "CG",
  "CH",
  "CI",
  "CK",
  "CL",
  "CM",
  "CN",
  "CO",
  "CR",
  "CU",
  "CV",
  "CW",
  "CX",
  "CY",
  "CZ",
  "DE",
  "DJ",
  "DK",
  "DM",
  "DO",
  "DZ",
  "EC",
  "EE",
  "EG",
  "EH",
  "ER",
  "ES",
  "ET",
  "FI",
  "FJ",
  "FK",
  "FM",
  "FO",
  "FR",
  "GA",
  "GB",
  "GD",
  "GE",
  "GF",
  "GG",
  "GH",
  "GI",
  "GL",
  "GM",
  "GN",
  "GP",
  "GQ",
  "GR",
  "GS",
  "GT",
  "GU",
  "GW",
  "GY",
  "HK",
  "HM",
  "HN",
  "HR",
  "HT",
  "HU",
  "ID",
  "IE",
  "IL",
  "IM",
  "IN",
  "IO",
  "IQ",
  "IR",
  "IS",
  "IT",
  "JE",
  "JM",
  "JO",
  "JP",
  "KE",
  "KG",
  "KH",
  "KI",
  "KM",
  "KN",
  "KP",
  "KR",
  "KW",
  "KY",
  "KZ",
  "LA",
  "LB",
  "LC",
  "LI",
  "LK",
  "LR",
  "LS",
  "LT",
  "LU",
  "LV",
  "LY",
  "MA",
  "MC",
  "MD",
  "ME",
  "MF",
  "MG",
  "MH",
  "MK",
  "ML",
  "MM",
  "MN",
  "MO",
  "MP",
  "MQ",
  "MR",
  "MS",
  "MT",
  "MU",
  "MV",
  "MW",
  "MX",
  "MY",
  "MZ",
  "NA",
  "NC",
  "NE",
  "NF",
  "NG",
  "NI",
  "NL",
  "NO",
  "NP",
  "NR",
  "NU",
  "NZ",
  "OM",
  "PA",
  "PE",
  "PF",
  "PG",
  "PH",
  "PK",
  "PL",
  "PM",
  "PN",
  "PR",
  "PS",
  "PT",
  "PW",
  "PY",
  "QA",
  "RE",
  "RO",
  "RS",
  "RU",
  "RW",
  "SA",
  "SB",
  "SC",
  "SD",
  "SE",
  "SG",
  "SH",
  "SI",
  "SJ",
  "SK",
  "SL",
  "SM",
  "SN",
  "SO",
  "SR",
  "SS",
  "ST",
  "SV",
  "SX",
  "SY",
  "SZ",
  "TC",
  "TD",
  "TF",
  "TG",
  "TH",
  "TJ",
  "TK",
  "TL",
  "TM",
  "TN",
  "TO",
  "TR",
  "TT",
  "TV",
  "TW",
  "TZ",
  "UA",
  "UG",
  "UM",
  "US",
  "UY",
  "UZ",
  "VA",
  "VC",
  "VE",
  "VG",
  "VI",
  "VN",
  "VU",
  "WF",
  "WS",
  "YE",
  "YT",
  "ZA",
  "ZM",
  "ZW",
]);

/**
 * Validates ISO 3166-1 alpha-2 country codes (2 uppercase letters)
 * @example "US" ✓, "GB" ✓, "us" ✗, "USA" ✗
 */
export const iso3166_1_alpha_2Format: FormatValidator = (value: string): boolean => {
  if (typeof value !== "string") {
    return false;
  }
  return ISO_3166_1_ALPHA_2.has(value);
};

/**
 * Validates ISO 3166-2 subdivision codes (country code + hyphen + subdivision)
 * Pattern: /^[A-Z]{2}-[A-Z0-9]{1,3}$/
 * @example "US-NY" ✓, "CA-QC" ✓, "GB-ENG" ✓, "us-ny" ✗
 */
export const iso3166_2Format: FormatValidator = (value: string): boolean => {
  if (typeof value !== "string") {
    return false;
  }
  // Basic pattern validation
  if (!/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(value)) {
    return false;
  }
  // Validate the country code part
  const countryCode = value.substring(0, 2);
  return ISO_3166_1_ALPHA_2.has(countryCode);
};

/**
 * Validates markdown file paths (relative paths ending in .md)
 * Must be relative, not contain ".." segments, and end with .md
 * @example "./docs/readme.md" ✓, "readme.md" ✓, "../readme.md" ✗, "/abs/path.md" ✗
 */
export const markdownPathFormat: FormatValidator = (value: string): boolean => {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  // Reject leading/trailing whitespace
  if (value !== value.trim()) {
    return false;
  }

  // Must end with .md
  if (!value.endsWith(".md")) {
    return false;
  }

  // Must be relative (not start with /)
  if (value.startsWith("/")) {
    return false;
  }

  // Cannot contain absolute Windows paths (C:, D:, etc.)
  if (/^[A-Za-z]:/.test(value)) {
    return false;
  }

  // Cannot contain backslashes (Windows path separators / traversal attempts)
  if (value.includes("\\")) {
    return false;
  }

  // Cannot contain null bytes or control characters
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(value)) {
    return false;
  }

  // Cannot contain percent-encoded characters (prevent encoded traversal like %2e%2e)
  if (value.includes("%")) {
    return false;
  }

  // Cannot contain ".." segments (security: prevent directory traversal)
  const segments = value.split("/");
  if (segments.some((seg) => seg === "..")) {
    return false;
  }

  return true;
};

/**
 * Default custom formats for JSON Schema validation
 */
export const DEFAULT_FORMATS: Record<string, FormatValidator> = {
  slug: slugFormat,
  "iso3166-1-alpha-2": iso3166_1_alpha_2Format,
  "iso3166-2": iso3166_2Format,
  markdown_path: markdownPathFormat,
};
