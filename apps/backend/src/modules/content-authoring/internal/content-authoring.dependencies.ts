import type { PlatformDatabase } from "../../../infrastructure/postgres/index.js";
import type { ContentSchema } from "../../content-schema/index.js";
import type { AuthorPolicy } from "./author-policy.js";

export interface ContentAuthoringDependencies {
  readonly database: PlatformDatabase;
  readonly contentSchema: ContentSchema;
  readonly authorPolicy: AuthorPolicy;
}
