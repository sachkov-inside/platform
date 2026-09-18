import { randomUUID } from "node:crypto";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { contentCollectionPersistence } from "../../infrastructure/postgres/content-collection-persistence.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { accountId, parseCommand } from "../../shared/command-validation.js";
import { isPostgresUniqueViolation, mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import { assembleReorderSeries } from "../reorder-series/reorder-series.js";
import { assembleUpdateContentCollection } from "../update-content-collection/update-content-collection.js";
import { reserveSourceGuideBodySchema, reorderSourceGuideBodySchema, updateSourceGuideBodySchema, validateSourceGuideBodySchema, type ReserveSourceGuideOperation, type ReorderSourceGuideOperation, type UpdateSourceGuideOperation, type ValidateSourceGuideOperation } from "./import-source-guide.contract.js";

export function assembleReserveSourceGuide(dependencies: MaterialAuthoringDependencies): ReserveSourceGuideOperation {
  return async (input) => {
    const parsed = parseCommand(reserveSourceGuideBodySchema.extend({ actor: accountId }), input);
    if (!parsed.ok) return parsed;
    const command = parsed.value;
    const authorized = await authorizeManager(dependencies.authorPolicy, command.actor);
    if (!authorized.ok) return authorized;
    const persistence = contentCollectionPersistence(dependencies.prisma, "guide");
    try {
      let current = await dependencies.prisma.guide.findUnique({ where: { sourceId: command.sourceId } });
      if (current === null) {
        try {
          current = await dependencies.prisma.guide.create({ data: { id: randomUUID(), sourceId: command.sourceId, name: command.name, slug: command.slug, summary: command.summary } });
        } catch (error) {
          // Одновременный перенос того же продукта уже создал запись; занятый адрес — другой случай.
          current = await dependencies.prisma.guide.findUnique({ where: { sourceId: command.sourceId } });
          if (current === null) {
            if (isPostgresUniqueViolation(error, persistence.slugConstraint)) return { ok: false, error: { code: "content_collection_slug_conflict" } };
            throw error;
          }
        }
      }
      const result = await persistence.load(current.id);
      if (result === undefined) throw new Error("Reserved Guide disappeared");
      return { ok: true, value: result };
    } catch (error) { return { ok: false, error: mapPostgresReadError(error) }; }
  };
}

/** Только проверка описания и оформления: ничего не читает и не пишет. */
export function assembleValidateSourceGuide(dependencies: MaterialAuthoringDependencies): ValidateSourceGuideOperation {
  return async (input) => {
    const parsed = parseCommand(validateSourceGuideBodySchema.extend({ actor: accountId }), input);
    if (!parsed.ok) return parsed;
    const authorized = await authorizeManager(dependencies.authorPolicy, parsed.value.actor);
    if (!authorized.ok) return authorized;
    return { ok: true, value: { valid: true } };
  };
}

export function assembleUpdateSourceGuide(dependencies: MaterialAuthoringDependencies): UpdateSourceGuideOperation {
  return async (input) => {
    const parsed = parseCommand(updateSourceGuideBodySchema.extend({ actor: accountId }), input);
    if (!parsed.ok) return parsed;
    const { sourceId, ...command } = parsed.value;
    return assembleUpdateContentCollection(dependencies, sourceId)({ ...command, kind: "guide" });
  };
}

export function assembleReorderSourceGuide(dependencies: MaterialAuthoringDependencies): ReorderSourceGuideOperation {
  return async (input) => {
    const parsed = parseCommand(reorderSourceGuideBodySchema.extend({ actor: accountId }), input);
    if (!parsed.ok) return parsed;
    const { sourceId, ...command } = parsed.value;
    return assembleReorderSeries(dependencies, sourceId)(command);
  };
}
