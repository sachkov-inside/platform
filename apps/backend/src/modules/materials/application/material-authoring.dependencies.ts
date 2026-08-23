import type { PlatformDatabase } from "../../../infrastructure/postgres/index.js";
import type { MaterialBodyOperations } from "../domain/material-body/material-body.js";
import type { AuthorPolicy } from "./ports/author-policy.js";
import type { ContentAccess } from "./ports/content-access.js";

export interface MaterialAuthoringDependencies {
  readonly database: PlatformDatabase;
  readonly materialDocumentOperations: MaterialBodyOperations;
  readonly authorPolicy: AuthorPolicy;
  readonly contentAccess: ContentAccess;
}
