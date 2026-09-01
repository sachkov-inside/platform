import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { failure } from "../../shared/application-result.js";
import { accountId, parseCommand } from "../../shared/command-validation.js";
import {
  isPostgresUniqueViolation,
  mapPostgresReadError,
} from "../../shared/postgres-error-mapping.js";
import { contentCollectionPersistence } from "../../infrastructure/postgres/content-collection-persistence.js";
import type { CreateContentCollectionOperation } from "./create-content-collection.contract.js";

export const contentCollectionInputSchema = z
  .object({
    actor: accountId,
    kind: z.enum(["series", "topic"]),
    name: z.string().trim().min(1).max(120),
    slug: z
      .string()
      .trim()
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    summary: z.string().trim().max(500),
  })
  .strict();

export function assembleCreateContentCollection(
  dependencies: MaterialAuthoringDependencies,
): CreateContentCollectionOperation {
  return async (input) => {
    const parsed = parseCommand(contentCollectionInputSchema, input);
    if (!parsed.ok) return failure(parsed.error);
    const command = parsed.value;
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorization.ok) return failure(authorization.error);

    try {
      const data = {
        id: randomUUID(),
        name: command.name,
        slug: command.slug,
        summary: command.summary,
      };
      const persistence = contentCollectionPersistence(
        dependencies.prisma,
        command.kind,
      );
      return { ok: true, value: await persistence.create(data) };
    } catch (error) {
      const constraint = contentCollectionPersistence(
        dependencies.prisma,
        command.kind,
      ).slugConstraint;
      return failure(
        isPostgresUniqueViolation(error, constraint)
          ? { code: "content_collection_slug_conflict" }
          : mapPostgresReadError(error),
      );
    }
  };
}
