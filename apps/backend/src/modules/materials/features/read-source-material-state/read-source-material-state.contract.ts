import { z } from "zod";

import { sourceNamespaceSchema } from "../../../../infrastructure/contracts/source-namespace.js";
import {
  authoringSourceIdSchema,
  recordedAuthoringSourceSchema,
} from "../../domain/authoring-source.js";
import type {
  ForbiddenError,
  InvalidContentError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export const readSourceMaterialStateQuerySchema = z
  .object({ namespace: sourceNamespaceSchema })
  .strict();

/**
 * Every Material whose source ID starts with `<namespace>:`, ordered by source ID, read in one
 * snapshot. The list is complete: it has no page and no limit.
 */
export const sourceMaterialStateSchema = z
  .object({
    namespace: sourceNamespaceSchema,
    materials: z.array(
      z
        .object({
          sourceId: authoringSourceIdSchema,
          materialId: z.uuid(),
          slug: z.string().nullable(),
          contentVersion: z.number().int().positive(),
          access: z.enum(["free", "closed"]),
          publicationState: z.enum(["draft", "published", "unpublished"]),
          source: recordedAuthoringSourceSchema.omit({ id: true }),
          memberships: z.array(
            z
              .object({
                productId: z.uuid(),
                ordinal: z.number().int().positive(),
                chapterId: z.uuid().nullable(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export type SourceMaterialState = z.infer<typeof sourceMaterialStateSchema>;
export type ReadSourceMaterialStateError =
  ForbiddenError | InvalidContentError | SystemError;
export type ReadSourceMaterialStateOperation = (query: {
  readonly actor: string;
  readonly namespace: string;
}) => Promise<Result<SourceMaterialState, ReadSourceMaterialStateError>>;
