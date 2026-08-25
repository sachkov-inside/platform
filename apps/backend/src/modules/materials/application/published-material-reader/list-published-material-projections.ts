import { z } from "zod";

import type { PlatformDatabase } from "../../../../infrastructure/postgres/index.js";
import { materialId } from "../../domain/material-identifiers.js";
import { selectPublishedMaterialProjectionPage } from "../../infrastructure/postgres/published-material-reader/published-material-projection.js";
import { normalizedUuidSchema } from "../../domain/uuid.js";
import { mapPostgresReadError } from "../shared/postgres-error-mapping.js";
import type {
  ListPublishedMaterialProjectionsQuery,
  PublishedMaterialProjectionListResult,
} from "./published-material-reader.js";

const querySchema = z
  .object({
    after: z
      .object({
        materialId: normalizedUuidSchema,
        publishedAt: z.iso.datetime({ offset: true }),
      })
      .strict()
      .optional(),
    first: z.number().int().min(1).max(24),
  })
  .strict();

export async function listPublishedMaterialProjections(
  database: PlatformDatabase,
  query: ListPublishedMaterialProjectionsQuery,
): Promise<PublishedMaterialProjectionListResult> {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_request_shape" } };
  }

  try {
    const page = await selectPublishedMaterialProjectionPage(database, {
      first: parsed.data.first,
      ...(parsed.data.after === undefined
        ? {}
        : {
            after: {
              materialId: materialId(parsed.data.after.materialId),
              publishedAt: new Date(parsed.data.after.publishedAt),
            },
          }),
    });
    return { ok: true, value: page };
  } catch (error) {
    return { ok: false, error: mapPostgresReadError(error) };
  }
}
