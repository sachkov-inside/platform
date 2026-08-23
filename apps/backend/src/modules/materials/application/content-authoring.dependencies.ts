import type { PlatformDatabase } from "../../../infrastructure/postgres/index.js";
import type { MaterialDocument } from "../domain/material-document/material-document.js";
import type { AuthorPolicy } from "./ports/author-policy.js";

export interface ContentAuthoringDependencies {
  readonly database: PlatformDatabase;
  readonly materialDocument: MaterialDocument;
  readonly authorPolicy: AuthorPolicy;
}
