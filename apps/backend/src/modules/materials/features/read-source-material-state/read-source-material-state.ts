import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { Prisma } from "../../../../infrastructure/prisma/index.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { failure } from "../../shared/application-result.js";
import { accountId, parseCommand } from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import {
  readSourceMaterialStateQuerySchema,
  sourceMaterialStateSchema,
  type ReadSourceMaterialStateOperation,
} from "./read-source-material-state.contract.js";

const querySchema = readSourceMaterialStateQuerySchema.extend({
  actor: accountId,
});
const membershipRowSchema = z.object({
  material_id: z.uuid(),
  series_id: z.uuid(),
  ordinal: z.number().int().positive(),
  chapter_id: z.uuid().nullable(),
});

/**
 * Reads what Platform holds for one source namespace, so the authoring tool can compare it with
 * the repository before deciding what to write. Materials and their Product memberships come from
 * one repeatable-read snapshot.
 */
export function assembleReadSourceMaterialState(
  dependencies: MaterialAuthoringDependencies,
): ReadSourceMaterialStateOperation {
  return async (input) => {
    const parsed = parseCommand(querySchema, input);
    if (!parsed.ok) return parsed;
    const { actor, namespace } = parsed.value;
    const authorized = await authorizeManager(dependencies.authorPolicy, actor);
    if (!authorized.ok) return authorized;
    const prefix = `${namespace}:`;
    try {
      const { materials, memberships } = await dependencies.prisma.$transaction(
        async (transaction) => {
          await transaction.$executeRaw(
            Prisma.sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`,
          );
          // The namespace admits no LIKE wildcard, so the prefix filter matches it literally.
          const materialRows = await transaction.material.findMany({
            where: { sourceId: { startsWith: prefix } },
            select: {
              id: true,
              sourceId: true,
              sourcePath: true,
              sourceRevision: true,
              sourceCommit: true,
              showInFeed: true,
              slug: true,
              access: true,
              contentVersion: true,
              publicationState: true,
            },
          });
          const membershipRows = z.array(membershipRowSchema).parse(
            await transaction.$queryRaw(Prisma.sql`
              select m.material_id, m.series_id, m.ordinal, m.chapter_id
              from materials.series_memberships m
              join materials.materials x on x.id = m.material_id
              where starts_with(x.source_id, ${prefix})
              order by m.material_id, m.series_id
            `),
          );
          return { materials: materialRows, memberships: membershipRows };
        },
      );
      const membershipsByMaterial = new Map<
        string,
        z.infer<typeof membershipRowSchema>[]
      >();
      for (const row of memberships) {
        const list = membershipsByMaterial.get(row.material_id) ?? [];
        list.push(row);
        membershipsByMaterial.set(row.material_id, list);
      }
      return {
        ok: true,
        value: sourceMaterialStateSchema.parse({
          namespace,
          materials: materials
            .map((row) => ({
              sourceId: row.sourceId,
              materialId: row.id,
              slug: row.slug,
              contentVersion: Number(row.contentVersion),
              access: row.access,
              publicationState: row.publicationState,
              source: {
                path: row.sourcePath,
                revision: row.sourceRevision,
                commit: row.sourceCommit,
                showInFeed: row.showInFeed,
              },
              memberships: (membershipsByMaterial.get(row.id) ?? []).map(
                (membership) => ({
                  productId: membership.series_id,
                  ordinal: membership.ordinal,
                  chapterId: membership.chapter_id,
                }),
              ),
            }))
            // Code-point order keeps the answer independent of the database collation.
            .sort((left, right) =>
              compareCodePoints(left.sourceId ?? "", right.sourceId ?? ""),
            ),
        }),
      };
    } catch (error) {
      return failure(
        dependencyFailure(
          { module: "materials", operation: "readSourceMaterialState" },
          error,
          mapPostgresReadError(error),
        ),
      );
    }
  };
}

function compareCodePoints(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
