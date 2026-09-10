import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalize(child)]));
}

/**
 * Отпечаток команды для повторов: порядок ключей и отсутствующие необязательные поля не меняют
 * результат, поэтому та же нагрузка узнаётся, а изменённая конфликтует.
 */
export function commandFingerprint(operation: string, command: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize({ version: 1, operation, command }))).digest("hex");
}
