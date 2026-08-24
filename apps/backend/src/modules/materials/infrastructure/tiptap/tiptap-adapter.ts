import type {
  JsonObject,
} from "../../domain/material-body/material-body.js";
import { isJsonObject } from "../../domain/material-body/json-guards.js";
import { materialDocumentSchemaV1 } from "./schema-v1.js";

export function roundTripTiptapDocument(document: JsonObject): JsonObject {
  const parsed = materialDocumentSchemaV1.nodeFromJSON(document);
  parsed.check();
  const roundTripped: unknown = parsed.toJSON();
  if (!isJsonObject(roundTripped)) {
    throw new TypeError("Tiptap returned a non-JSON document");
  }
  return roundTripped;
}
