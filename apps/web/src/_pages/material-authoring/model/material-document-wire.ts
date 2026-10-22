import type { JSONContent } from "@tiptap/core";
import { z } from "zod";

/** The 1 MiB editor document contract; its structure is checked after the body is admitted. */
const MAX_MATERIAL_DOCUMENT_JSON_LENGTH = 1_048_576;

/**
 * The editor document as it travels in a create or Save body. The Route Handler checks its
 * structure separately, so a malformed document gets the editor's own message.
 */
export const materialDocumentWireSchema = z.custom<JSONContent>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    JSON.stringify(value).length <= MAX_MATERIAL_DOCUMENT_JSON_LENGTH,
);

/** Series memberships in editor order; the Route Handler checks their identifiers. */
export const materialSeriesIdsWireSchema = z.array(z.string()).readonly();
