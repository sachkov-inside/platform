import { randomUUID } from "node:crypto";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { contentCollectionPersistence } from "../../infrastructure/postgres/content-collection-persistence.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { accountId, parseCommand } from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import { assembleReorderSeries } from "../reorder-series/reorder-series.js";
import { assembleSetContentCollectionArchive } from "../set-content-collection-archive/set-content-collection-archive.js";
import { assembleUpdateContentCollection } from "../update-content-collection/update-content-collection.js";
import { archiveSourceGuideBodySchema, reserveSourceGuideBodySchema, reorderSourceGuideBodySchema, updateSourceGuideBodySchema, type ArchiveSourceGuideOperation, type ReserveSourceGuideOperation, type ReorderSourceGuideOperation, type UpdateSourceGuideOperation } from "./import-source-guide.contract.js";

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
          current = await dependencies.prisma.guide.findUnique({ where: { sourceId: command.sourceId } });
          if (current === null) throw error;
        }
      }
      const result = await persistence.load(current.id);
      if (result === undefined) throw new Error("Reserved Guide disappeared");
      return { ok: true, value: result };
    } catch (error) { return { ok: false, error: mapPostgresReadError(error) }; }
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

export function assembleArchiveSourceGuide(dependencies: MaterialAuthoringDependencies): ArchiveSourceGuideOperation {
  return async (input) => {
    const parsed = parseCommand(archiveSourceGuideBodySchema.extend({ actor: accountId }), input);
    if (!parsed.ok) return parsed;
    const { sourceId, ...command } = parsed.value;
    return assembleSetContentCollectionArchive(dependencies, sourceId)({ ...command, kind: "guide" });
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
