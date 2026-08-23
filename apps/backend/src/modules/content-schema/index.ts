export {
  CONTENT_SCHEMA,
  type ContentSchema,
  type ContentSchemaResult,
  type DocumentChange,
  type JsonObject,
  type JsonValue,
  type MaterialDocumentV1,
  type ValidationIssue,
} from "./content-schema.interface.js";
export { ContentSchemaModule } from "./content-schema.module.js";
export { validationIssuePath } from "./validation-issue-path.js";

import type { ContentSchema } from "./content-schema.interface.js";
import { ContentSchemaImplementation } from "./internal/content-schema.implementation.js";

export function createContentSchema(): ContentSchema {
  return new ContentSchemaImplementation();
}
