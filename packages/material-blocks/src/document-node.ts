import type { JsonObject, JsonValue } from "./json.js";
import { isJsonArray, isJsonObject } from "./json.js";

/**
 * Readers of an accepted document node. The node already passed the ProseMirror schema, so a
 * mismatch here is a defect rather than invalid input: each helper fails loudly.
 */
export function expectObject(
  value: JsonValue | undefined,
  context: string,
): JsonObject {
  if (value === undefined || !isJsonObject(value)) {
    throw new TypeError(`Expected ${context}`);
  }
  return value;
}

export function expectArray(
  value: JsonValue | undefined,
  context: string,
): readonly JsonValue[] {
  if (value === undefined || !isJsonArray(value)) {
    throw new TypeError(`Expected ${context}`);
  }
  return value;
}

export function expectString(
  value: JsonValue | undefined,
  context: string,
): string {
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${context}`);
  }
  return value;
}

/** An absent attribute and an empty one mean the same thing to a reader. */
export function optionalText(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function nodeAttributes(node: JsonObject): JsonObject {
  const value = node.attrs;
  return value === undefined ? {} : expectObject(value, "node attributes");
}
