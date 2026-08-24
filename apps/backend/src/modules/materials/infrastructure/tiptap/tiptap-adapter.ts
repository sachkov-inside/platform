import type {
  JsonObject,
  JsonValue,
} from "../../domain/material-body/material-body.js";
import { materialDocumentSchemaV1 } from "./schema-v1.js";

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ["boolean", "string"].includes(typeof value)) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every(isJsonValue)
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && !Array.isArray(value) && isJsonValue(value);
}

export function roundTripTiptapDocument(document: JsonObject): JsonObject {
  const parsed = materialDocumentSchemaV1.nodeFromJSON(document);
  parsed.check();
  const roundTripped: unknown = parsed.toJSON();
  if (!isJsonObject(roundTripped)) {
    throw new TypeError("Tiptap returned a non-JSON document");
  }
  return roundTripped;
}
