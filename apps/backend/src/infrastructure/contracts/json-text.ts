/**
 * JSON text of a value, or undefined for undefined, functions and symbols: `JSON.stringify` returns
 * undefined for them although its lib type promises a string.
 */
export function jsonText(value: unknown): string | undefined {
  return JSON.stringify(value);
}
