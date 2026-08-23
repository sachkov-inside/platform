import type { PlatformDatabase } from "../../../infrastructure/postgres/index.js";
import type { MaterialDocumentOperations } from "../domain/material-document/material-document.js";
import type { AuthorPolicy } from "./ports/author-policy.js";
import type { ContentAccess } from "./ports/content-access.js";

export interface ContentAuthoringDependencies {
  readonly database: PlatformDatabase;
  readonly materialDocumentOperations: MaterialDocumentOperations;
  readonly authorPolicy: AuthorPolicy;
  readonly contentAccess: ContentAccess;
}
