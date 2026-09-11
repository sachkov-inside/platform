import { isJsonObject } from "@inside/material-blocks";
import { materialDocumentSchemaV1 } from "@inside/material-blocks/schema";

import type { JsonObject } from "../../domain/material-body/material-body.js";

export function roundTripTiptapDocument(document: JsonObject): JsonObject {
  const parsed = materialDocumentSchemaV1.nodeFromJSON(document);
  parsed.check();
  const roundTripped: unknown = parsed.toJSON();
  if (!isJsonObject(roundTripped)) {
    throw new TypeError("Tiptap returned a non-JSON document");
  }
  return roundTripped;
}
