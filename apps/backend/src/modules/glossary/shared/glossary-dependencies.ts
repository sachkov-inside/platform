import {
  authorizeManager,
  type AuthorPolicy,
} from "../../../infrastructure/content-authoring/author-policy.js";
import type { GlossaryPrismaClient } from "../../../infrastructure/prisma/index.js";
import type { GlossaryAuthoringError } from "../facets/glossary/glossary.js";

export interface GlossaryOperationDependencies {
  readonly prisma: GlossaryPrismaClient;
  readonly authorPolicy: AuthorPolicy;
}

/** Only an Account that manages Materials writes or lists the Glossary. */
export async function authorizeGlossaryAuthor(
  dependencies: GlossaryOperationDependencies,
  actor: string,
): Promise<GlossaryAuthoringError | null> {
  const authorization = await authorizeManager(
    dependencies.authorPolicy,
    actor,
  );
  return authorization.ok ? null : authorization.error;
}
