import type { JsonObject } from "../../domain/material-document/material-document.js";
import { materialDocumentSchemaV1 } from "./schema-v1.js";

export function roundTripTiptapDocument(document: JsonObject): JsonObject {
  const parsed = materialDocumentSchemaV1.nodeFromJSON(document);
  parsed.check();
  return parsed.toJSON();
}
