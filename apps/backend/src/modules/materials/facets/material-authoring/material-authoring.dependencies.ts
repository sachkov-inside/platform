import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
import type { AuthorPolicy } from "../../ports/author-policy.js";

export interface MaterialAuthoringDependencies {
  readonly prisma: MaterialsPrismaClient;
  readonly materialBodyOperations: MaterialBodyOperations;
  readonly authorPolicy: AuthorPolicy;
  readonly contentAccess: ContentAccess;
}
