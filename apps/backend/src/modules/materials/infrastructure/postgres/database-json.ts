import type { Prisma } from "../../../../infrastructure/prisma/index.js";

type DatabaseJson =
  | boolean
  | number
  | string
  | null
  | DatabaseJson[]
  | { [key: string]: DatabaseJson };

export function toDatabaseJson(
  value: unknown,
): Exclude<Prisma.InputJsonValue, null> {
  const converted = convertJsonValue(value);
  if (converted === null) {
    throw new TypeError("Document root cannot be null");
  }
  return converted;
}

function convertJsonValue(value: unknown): DatabaseJson {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(convertJsonValue);
  }
  if (typeof value === "object") {
    const result: { [key: string]: DatabaseJson } = {};
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) {
        result[key] = convertJsonValue(child);
      }
    }
    return result;
  }
  throw new TypeError("Document contains a non-JSON value");
}
