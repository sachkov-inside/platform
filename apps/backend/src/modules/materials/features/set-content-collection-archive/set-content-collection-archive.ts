import { lockSeries } from "../../infrastructure/postgres/series-order.js";
import { z } from "zod";

import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { authorizeManager } from "../../ports/author-policy.js";
import {
  executeAuthoringTransaction,
  failure,
} from "../../shared/application-result.js";
import {
  accountId,
  entityId,
  parseCommand,
} from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import { contentCollectionPersistence } from "../../infrastructure/postgres/content-collection-persistence.js";
import type {
  SetContentCollectionArchiveError,
  SetContentCollectionArchiveOperation,
} from "./set-content-collection-archive.contract.js";
import {
  checkContentWrite,
  contentWriter,
} from "../../domain/content-write-policy.js";

const commandSchema = z
  .object({
    actor: accountId,
    archived: z.boolean(),
    collectionId: entityId,
    expectedVersion: z.number().int().positive(),
    kind: z.enum(["product", "series", "topic"]),
  })
  .strict();

export function assembleSetContentCollectionArchive(
  dependencies: MaterialAuthoringDependencies,
): SetContentCollectionArchiveOperation {
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
        if (command.kind !== "topic") {
          await lockSeries(transaction, [command.collectionId]);
          const source = await transaction.product.findUnique({
            where: { id: command.collectionId },
            select: { sourceId: true },
          });
          const sourceError = checkContentWrite(contentWriter(), [
            {
              kind: "archive",
              sourceId: source?.sourceId ?? null,
              path: "/collectionId",
            },
          ]);
          if (sourceError !== null) return rollback(sourceError);
        }
        const persistence = contentCollectionPersistence(
          transaction,
          command.kind,
        );
        const updated = await persistence.setArchive({
          archived: command.archived,
          expectedVersion: command.expectedVersion,
          id: command.collectionId,
        });
        if (updated === 0) {
          const current = await persistence.load(command.collectionId);
          return current === undefined
            ? rollback({ code: "content_collection_not_found" })
            : rollback({
                code: "stale_content_collection_version",
                currentVersion: current.version,
              });
        }
        const collection = await persistence.load(command.collectionId);
        return collection ?? rollback({ code: "content_collection_not_found" });
      },
      (error): SetContentCollectionArchiveError => mapPostgresReadError(error),
      "setContentCollectionArchive",
    );
  };
}
