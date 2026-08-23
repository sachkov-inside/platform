import type {
  ContentSchema,
  ContentSchemaResult,
  DocumentChange,
  MaterialDocumentV1,
} from "../content-schema.interface.js";
import { acceptDocument } from "./accept-document.js";
import { applyDocumentChanges } from "./apply-document-changes.js";

export class ContentSchemaImplementation implements ContentSchema {
  acceptDocument(input: unknown): ContentSchemaResult<MaterialDocumentV1> {
    return acceptDocument(input);
  }

  applyChanges(
    document: MaterialDocumentV1,
    changes: readonly DocumentChange[],
  ): ContentSchemaResult<MaterialDocumentV1> {
    return applyDocumentChanges(document, changes);
  }
}
