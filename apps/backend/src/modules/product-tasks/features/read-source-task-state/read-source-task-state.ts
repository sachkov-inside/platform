import { z } from "zod";

import { compareCodePoints } from "../../../../infrastructure/contracts/code-point-order.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type ProductTasksPrisma,
} from "../../../../infrastructure/prisma/index.js";
import type { AuthorPolicy } from "../../ports/author-policy.js";
import { authorizeAuthor } from "../../shared/authorize-author.js";
import { scope, systemFailure } from "../../shared/result.js";
import {
  readSourceTaskStateQuerySchema,
  sourceTaskStateSchema,
  type ReadSourceTaskStateOperation,
} from "./read-source-task-state.contract.js";

export interface ReadSourceTaskStateDependencies {
  readonly prisma: ProductTasksPrisma;
  readonly authorPolicy: AuthorPolicy;
}

const taskRowSchema = z.object({
  source_id: z.string(),
  id: z.uuid(),
  code: z.string(),
  product_id: z.uuid(),
  chapter_id: z.uuid(),
  position: z.number().int(),
  after_material_source_id: z.string().nullable(),
  programme_visibility: z.string(),
  embedded_material_id: z.uuid().nullable(),
  revision: z.number().int(),
  access: z.string(),
  publication_state: z.string(),
  source_commit: z.string(),
});

/**
 * Reads what Platform holds for one source namespace of Product Tasks, so the authoring tool can
 * compare it with the repository before deciding what to write. One statement joins each task to
 * its current Task Version, so the answer is one snapshot.
 */
export function assembleReadSourceTaskState(
  dependencies: ReadSourceTaskStateDependencies,
): ReadSourceTaskStateOperation {
  return async (input, { actor }) => {
    const parsed = readSourceTaskStateQuerySchema.safeParse(input);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request_shape" } };
    const authorized = await authorizeAuthor(
      dependencies.authorPolicy,
      actor,
      "readSourceTaskState",
    );
    if (!authorized.ok) return authorized;
    const { namespace } = parsed.data;
    try {
      // Raw: a model query cannot join each task to the version its own `current_version` names.
      const rows = z.array(taskRowSchema).parse(
        await dependencies.prisma.$queryRaw(Prisma.sql`
          select t.source_id, t.id, t.code, t.product_id, t.chapter_id, t.position,
            t.after_material_source_id, t.programme_visibility, t.embedded_material_id,
            t.revision, t.access, t.publication_state, v.source_commit
          from product_tasks.tasks t
          join product_tasks.task_versions v
            on v.task_id = t.id and v.version = t.current_version
          where starts_with(t.source_id, ${`${namespace}:`})
        `),
      );
      return {
        ok: true,
        value: sourceTaskStateSchema.parse({
          namespace,
          tasks: rows
            .map((row) => ({
              sourceId: row.source_id,
              taskId: row.id,
              code: row.code,
              productId: row.product_id,
              chapterId: row.chapter_id,
              position: row.position,
              afterMaterialSourceId: row.after_material_source_id,
              programmeVisibility: row.programme_visibility,
              embeddedMaterialId: row.embedded_material_id,
              revision: row.revision,
              access: row.access,
              publicationState: row.publication_state,
              sourceCommit: row.source_commit,
            }))
            // Code-point order keeps the answer independent of the database collation.
            .sort((left, right) =>
              compareCodePoints(left.sourceId, right.sourceId),
            ),
        }),
      };
    } catch (error) {
      return dependencyFailure(
        scope("readSourceTaskState"),
        error,
        systemFailure(error),
      );
    }
  };
}
