import { randomUUID } from "node:crypto";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { contentCollectionPersistence } from "../../infrastructure/postgres/content-collection-persistence.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { accountId, parseCommand } from "../../shared/command-validation.js";
import {
  isPostgresUniqueViolation,
  mapPostgresReadError,
} from "../../shared/postgres-error-mapping.js";
import { assembleReorderSeries } from "../reorder-series/reorder-series.js";
import { assembleUpdateContentCollection } from "../update-content-collection/update-content-collection.js";
import {
  reserveSourceProductBodySchema,
  reorderSourceProductBodySchema,
  updateSourceProductBodySchema,
  validateSourceProductBodySchema,
  type ReserveSourceProductOperation,
  type ReorderSourceProductOperation,
  type UpdateSourceProductOperation,
  type ValidateSourceProductOperation,
} from "./import-source-product.contract.js";

export function assembleReserveSourceProduct(
  dependencies: MaterialAuthoringDependencies,
): ReserveSourceProductOperation {
  return async (input) => {
    const parsed = parseCommand(
      reserveSourceProductBodySchema.extend({ actor: accountId }),
      input,
    );
    if (!parsed.ok) return parsed;
    const command = parsed.value;
    const authorized = await authorizeManager(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorized.ok) return authorized;
    const persistence = contentCollectionPersistence(
      dependencies.prisma,
      "product",
    );
    try {
      let current = await dependencies.prisma.product.findUnique({
        where: { sourceId: command.sourceId },
      });
      if (current === null) {
        try {
          current = await dependencies.prisma.product.create({
            data: {
              id: randomUUID(),
              sourceId: command.sourceId,
              name: command.name,
              slug: command.slug,
              summary: command.summary,
            },
          });
        } catch (error) {
          // Одновременный перенос того же продукта уже создал запись; занятый адрес — другой случай.
          current = await dependencies.prisma.product.findUnique({
            where: { sourceId: command.sourceId },
          });
          if (current === null) {
            if (isPostgresUniqueViolation(error, persistence.slugConstraint))
              return {
                ok: false,
                error: { code: "content_collection_slug_conflict" },
              };
            throw error;
          }
        }
      }
      const result = await persistence.load(current.id);
      if (result === undefined) throw new Error("Reserved Product disappeared");
      return { ok: true, value: result };
    } catch (error) {
      return {
        ok: false,
        error: dependencyFailure(
          { module: "materials", operation: "reserveSourceProduct" },
          error,
          mapPostgresReadError(error),
        ),
      };
    }
  };
}

/** Только проверка описания и оформления: ничего не читает и не пишет. */
export function assembleValidateSourceProduct(
  dependencies: MaterialAuthoringDependencies,
): ValidateSourceProductOperation {
  return async (input) => {
    const parsed = parseCommand(
      validateSourceProductBodySchema.extend({ actor: accountId }),
      input,
    );
    if (!parsed.ok) return parsed;
    const authorized = await authorizeManager(
      dependencies.authorPolicy,
      parsed.value.actor,
    );
    if (!authorized.ok) return authorized;
    return { ok: true, value: { valid: true } };
  };
}

export function assembleUpdateSourceProduct(
  dependencies: MaterialAuthoringDependencies,
): UpdateSourceProductOperation {
  return async (input) => {
    const parsed = parseCommand(
      updateSourceProductBodySchema.extend({ actor: accountId }),
      input,
    );
    if (!parsed.ok) return parsed;
    const { sourceId, ...command } = parsed.value;
    return assembleUpdateContentCollection(
      dependencies,
      sourceId,
    )({ ...command, kind: "product" });
  };
}

export function assembleReorderSourceProduct(
  dependencies: MaterialAuthoringDependencies,
): ReorderSourceProductOperation {
  return async (input) => {
    const parsed = parseCommand(
      reorderSourceProductBodySchema.extend({ actor: accountId }),
      input,
    );
    if (!parsed.ok) return parsed;
    const { sourceId, ...command } = parsed.value;
    return assembleReorderSeries(dependencies, sourceId)(command);
  };
}
