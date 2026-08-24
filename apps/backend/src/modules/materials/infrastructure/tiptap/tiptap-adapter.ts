import type { JsonObject } from "../../domain/material-body/material-body.js";
import { materialDocumentSchemaV1 } from "./schema-v1.js";

export function roundTripTiptapDocument(document: JsonObject): JsonObject {
  const parsed = materialDocumentSchemaV1.nodeFromJSON(document);
  parsed.check();
  return parsed.toJSON();
}
