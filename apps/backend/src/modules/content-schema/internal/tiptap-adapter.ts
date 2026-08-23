import type { JsonObject } from "../content-schema.interface.js";
import { contentSchemaV1 } from "./schema-v1.js";

export function roundTripTiptapDocument(document: JsonObject): JsonObject {
  const parsed = contentSchemaV1.nodeFromJSON(document);
  parsed.check();
  return parsed.toJSON();
}
