import { compareCodePoints } from "../../../../infrastructure/contracts/code-point-order.js";
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
// Bounds the Material ID list of one membership statement well below the bind-parameter limit.
const MEMBERSHIP_BATCH_SIZE = 1_000;

interface MembershipRow {
  readonly materialId: string;
  readonly seriesId: string;
  readonly ordinal: number;
  readonly chapterId: string | null;
}

/**
 * Reads what Platform holds for one source namespace, so the authoring tool can compare it with
 * the repository before deciding what to write. Materials and their Product memberships come from
 * one repeatable-read snapshot, so the batched membership statements see the same rows.
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
          // Memberships have no Prisma relation to Materials, so they are read by Material ID in
          // the same snapshot.
          const membershipRows: MembershipRow[] = [];
          const ids = materialRows.map((row) => row.id);
          for (
            let start = 0;
            start < ids.length;
            start += MEMBERSHIP_BATCH_SIZE
          )
            membershipRows.push(
              ...(await transaction.productMembership.findMany({
                where: {
                  materialId: {
                    in: ids.slice(start, start + MEMBERSHIP_BATCH_SIZE),
                  },
                },
                select: {
                  materialId: true,
                  seriesId: true,
                  ordinal: true,
                  chapterId: true,
                },
                orderBy: [{ materialId: "asc" }, { seriesId: "asc" }],
              })),
            );
          return { materials: materialRows, memberships: membershipRows };
        },
      );
      const membershipsByMaterial = new Map<string, MembershipRow[]>();
      for (const row of memberships) {
        const list = membershipsByMaterial.get(row.materialId) ?? [];
        list.push(row);
        membershipsByMaterial.set(row.materialId, list);
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
                  productId: membership.seriesId,
                  ordinal: membership.ordinal,
                  chapterId: membership.chapterId,
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
