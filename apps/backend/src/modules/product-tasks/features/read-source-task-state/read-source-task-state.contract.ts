import { z } from "zod";

import { sourceNamespaceSchema } from "../../../../infrastructure/contracts/source-namespace.js";
import {
  taskAccessSchema,
  taskCodeSchema,
  taskPublicationSchema,
  taskSourceIdSchema,
} from "../../domain/task-definition.js";
import type { Result, SystemError } from "../../shared/result.js";

export const readSourceTaskStateQuerySchema = z
  .object({ namespace: sourceNamespaceSchema })
  .strict();

const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * Every Product Task whose source ID starts with `<namespace>:`, ordered by source ID, read in one
 * statement. The list is complete: it has no page and no limit. `sourceCommit` is the commit of
 * the task's current Task Version.
 */
export const sourceTaskStateSchema = z
  .object({
    namespace: sourceNamespaceSchema,
    tasks: z.array(
      z
        .object({
          sourceId: taskSourceIdSchema,
          taskId: z.uuid(),
          code: taskCodeSchema,
          productId: z.uuid(),
          chapterId: z.uuid(),
          position: z.number().int().min(1).max(1_000),
          afterMaterialSourceId: z.string().min(1).max(200).nullable(),
          programmeVisibility: z.enum(["standalone", "embedded", "legacy"]),
          embeddedMaterialId: z.uuid().nullable(),
          revision: revisionSchema,
          access: taskAccessSchema,
          publicationState: taskPublicationSchema,
          sourceCommit: z.hash("sha1"),
        })
        .strict(),
    ),
  })
  .strict();

export type SourceTaskState = z.infer<typeof sourceTaskStateSchema>;
export type ReadSourceTaskStateError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "forbidden" }
  | SystemError;
export type ReadSourceTaskStateOperation = (
  input: unknown,
  context: { readonly actor: string },
) => Promise<Result<SourceTaskState, ReadSourceTaskStateError>>;
