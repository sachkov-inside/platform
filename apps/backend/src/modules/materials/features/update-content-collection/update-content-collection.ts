import { z } from "zod";

import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { refreshPublishedMaterialSearchProjections } from "../../infrastructure/postgres/published-material-search.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { executeAuthoringTransaction, failure } from "../../shared/application-result.js";
import { accountId, entityId, parseCommand } from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import { loadContentCollectionDto } from "../../shared/project-content-collection.js";
import type {
  UpdateContentCollectionError,
  UpdateContentCollectionOperation,
} from "./update-content-collection.contract.js";

const commandSchema = z
  .object({
    actor: accountId,
    collectionId: entityId,
    expectedVersion: z.number().int().positive(),
    kind: z.enum(["series", "topic"]),
    name: z.string().trim().min(1).max(120),
    summary: z.string().trim().max(500),
  })
  .strict();

export function assembleUpdateContentCollection(
  dependencies: MaterialAuthoringDependencies,
): UpdateContentCollectionOperation {
  return async (input) => {
    const parsed = parseCommand(commandSchema, input);
    if (!parsed.ok) return failure(parsed.error);
    const command = parsed.value;
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorization.ok) return failure(authorization.error);

    return executeAuthoringTransaction(
      dependencies.prisma,
      async (transaction, rollback) => {
        const updated =
          command.kind === "topic"
            ? await transaction.topic.updateMany({
                where: {
                  id: command.collectionId,
                  version: command.expectedVersion,
                },
                data: {
                  name: command.name,
                  summary: command.summary,
                  updatedAt: new Date(),
                  version: { increment: 1 },
                },
              })
            : await transaction.series.updateMany({
                where: {
                  id: command.collectionId,
                  version: command.expectedVersion,
                },
                data: {
                  name: command.name,
                  summary: command.summary,
                  updatedAt: new Date(),
                  version: { increment: 1 },
                },
              });
        if (updated.count === 0) {
          const current = await loadContentCollectionDto(
            transaction,
            command.kind,
            command.collectionId,
          );
          return current === undefined
            ? rollback({ code: "content_collection_not_found" })
            : rollback({
                code: "stale_content_collection_version",
                currentVersion: current.version,
              });
        }
        await refreshPublishedMaterialSearchProjections(
          transaction,
          command.kind === "topic"
            ? { kind: "topic", topicId: command.collectionId }
            : { kind: "series", seriesId: command.collectionId },
        );
        const collection = await loadContentCollectionDto(
          transaction,
          command.kind,
          command.collectionId,
        );
        return collection ?? rollback({ code: "content_collection_not_found" });
      },
      (error): UpdateContentCollectionError => mapPostgresReadError(error),
    );
  };
}
