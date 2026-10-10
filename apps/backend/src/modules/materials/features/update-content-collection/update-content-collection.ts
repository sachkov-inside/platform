import {
  checkContentWrite,
  contentWriter,
} from "../../domain/content-write-policy.js";
import { lockSeries } from "../../infrastructure/postgres/series-order.js";
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
  collectionSlug,
  entityId,
  parseCommand,
} from "../../shared/command-validation.js";
import {
  isPostgresUniqueViolation,
  mapPostgresReadError,
} from "../../shared/postgres-error-mapping.js";
import { contentCollectionPersistence } from "../../infrastructure/postgres/content-collection-persistence.js";
import {
  productPageSchema,
  productPresentationSchema,
  type ProductSourceFields,
} from "../../domain/product-page.js";
import { contractDigest } from "../../../../infrastructure/contracts/canonical-digest.js";
import type { MaterialsPrismaTransaction } from "../../../../infrastructure/prisma/index.js";
import {
  PRODUCT_INTRODUCTION_FIELD_MAX,
  type ProductIntroductionDto,
} from "../../facets/material-authoring/content-collection.contract.js";
import type {
  UpdateContentCollectionError,
  UpdateContentCollectionOperation,
} from "./update-content-collection.contract.js";

const introductionField = z.string().trim().max(PRODUCT_INTRODUCTION_FIELD_MAX);

export const updateContentCollectionCommandSchema = z
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
    kind: z.enum(["product", "series", "topic"]),
    name: z.string().trim().min(1).max(120),
    /** Адрес, оформление и страница перенесённого Product; их пишет только source-scoped импорт. */
    source: z
      .object({
        page: productPageSchema.nullable(),
        presentation: productPresentationSchema,
        slug: collectionSlug,
      })
      .strict()
      .optional(),
    summary: z.string().trim().max(500),
  })
  .strict()
  .refine(
    ({ introduction, kind }) => kind !== "topic" || introduction === undefined,
    { path: ["introduction"] },
  )
  .refine(({ kind, source }) => kind === "product" || source === undefined, {
    path: ["source"],
  });

export function assembleUpdateContentCollection(
  dependencies: MaterialAuthoringDependencies,
  sourceId: string | null = null,
): UpdateContentCollectionOperation {
  return async (input) => {
    const parsed = parseCommand(updateContentCollectionCommandSchema, input);
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
          const currentSource = await transaction.product.findUnique({
            where: { id: command.collectionId },
            select: { sourceId: true },
          });
          if (currentSource !== null) {
            const sourceError = checkContentWrite(contentWriter(sourceId), [
              {
                kind: "product",
                sourceId: currentSource.sourceId,
                path: "/collectionId",
              },
            ]);
            if (sourceError !== null) return rollback(sourceError);
          }
        }
        if (command.source !== undefined && sourceId === null)
          return rollback({ code: "forbidden" });
        const persistence = contentCollectionPersistence(
          transaction,
          command.kind,
        );
        // An omitted introduction preserves the stored one, so renaming a Product
        // from the collection list never clears the stored text.
        const introduction = command.introduction ?? null;
        const updated = await persistence.updateMetadata({
          expectedVersion: command.expectedVersion,
          id: command.collectionId,
          introduction,
          name: command.name,
          source: command.source,
          summary: command.summary,
        });
        if (updated === 0) {
          const current = await persistence.load(command.collectionId);
          if (
            current?.name === command.name &&
            current.summary === command.summary &&
            (introduction === null ||
              introductionMatches(current.introduction, introduction)) &&
            (command.source === undefined ||
              (await sourceMatches(
                transaction,
                command.collectionId,
                command.source,
              )))
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
      (error): UpdateContentCollectionError =>
        isPostgresUniqueViolation(
          error,
          contentCollectionPersistence(dependencies.prisma, command.kind)
            .slugConstraint,
        )
          ? { code: "content_collection_slug_conflict" }
          : mapPostgresReadError(error),
      "updateContentCollection",
    );
  };
}

async function sourceMatches(
  transaction: MaterialsPrismaTransaction,
  id: string,
  requested: ProductSourceFields,
): Promise<boolean> {
  const current = await transaction.product.findUnique({
    where: { id },
    select: { page: true, presentation: true, slug: true },
  });
  return (
    current !== null &&
    current.slug === requested.slug &&
    current.presentation === requested.presentation &&
    contractDigest(current.page) === contractDigest(requested.page)
  );
}

function introductionMatches(
  current: ProductIntroductionDto | null,
  requested: ProductIntroductionDto,
): boolean {
  return (
    current !== null &&
    current.audience === requested.audience &&
    current.outcome === requested.outcome &&
    current.prerequisites === requested.prerequisites &&
    current.scope === requested.scope
  );
}
