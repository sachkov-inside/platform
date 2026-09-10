import { z } from "zod";

import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { refreshPublishedMaterialSearchProjections } from "../../infrastructure/postgres/published-material-search.js";
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
import type { GuideIntroductionDto } from "../../facets/material-authoring/content-collection.contract.js";
import type {
  UpdateContentCollectionError,
  UpdateContentCollectionOperation,
} from "./update-content-collection.contract.js";

/** One introduction field holds an authored paragraph, not a headline. */
const GUIDE_INTRODUCTION_FIELD_MAX = 4000;

const introductionField = z.string().trim().max(GUIDE_INTRODUCTION_FIELD_MAX);

const commandSchema = z
  .object({
    actor: accountId,
    collectionId: entityId,
    expectedVersion: z.number().int().positive(),
    introduction: z
      .object({
        audience: introductionField,
        outcome: introductionField,
        prerequisites: introductionField,
        scope: introductionField,
      })
      .strict()
      .optional(),
    kind: z.enum(["guide", "series", "topic"]),
    name: z.string().trim().min(1).max(120),
    summary: z.string().trim().max(500),
  })
  .strict()
  .refine(
    ({ introduction, kind }) => kind !== "topic" || introduction === undefined,
    { path: ["introduction"] },
  );

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
        const persistence = contentCollectionPersistence(
          transaction,
          command.kind,
        );
        // An omitted introduction preserves the stored one, so renaming a Guide
        // from the collection list never clears text the editor owns.
        const introduction = command.introduction ?? null;
        const updated = await persistence.updateMetadata({
          expectedVersion: command.expectedVersion,
          id: command.collectionId,
          introduction,
          name: command.name,
          summary: command.summary,
        });
        if (updated === 0) {
          const current = await persistence.load(command.collectionId);
          if (
            current?.name === command.name &&
            current.summary === command.summary &&
            (introduction === null ||
              introductionMatches(current.introduction, introduction))
          )
            return current;
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
        const collection = await persistence.load(command.collectionId);
        return collection ?? rollback({ code: "content_collection_not_found" });
      },
      (error): UpdateContentCollectionError => mapPostgresReadError(error),
    );
  };
}

function introductionMatches(
  current: GuideIntroductionDto | null,
  requested: GuideIntroductionDto,
): boolean {
  return (
    current !== null &&
    current.audience === requested.audience &&
    current.outcome === requested.outcome &&
    current.prerequisites === requested.prerequisites &&
    current.scope === requested.scope
  );
}
