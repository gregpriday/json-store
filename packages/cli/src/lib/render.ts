/**
 * Output rendering helpers
 */

type Color = "red" | "green" | "yellow";

/**
 * Print JSON to stdout
 * @param data - Data to serialize
 * @param options - Rendering options
 */
export function printJson(data: unknown, options?: { raw?: boolean }): void {
  const json = options?.raw
    ? JSON.stringify(data)
    : JSON.stringify(data, null, 2);
  console.log(json);
}

/**
 * Print lines to stdout (one per line)
 */
export function printLines(lines: string[]): void {
  lines.forEach((line) => console.log(line));
}

/**
 * Apply ANSI color only if output stream is a TTY
 */
export function colorize(
  text: string,
  color: Color,
  stream: NodeJS.WriteStream = process.stdout
): string {
  if (!(stream.isTTY ?? false)) {
    return text;
  }

  const codes: Record<Color, string> = {
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
  };

  const reset = "\x1b[0m";
  return `${codes[color]}${text}${reset}`;
}
