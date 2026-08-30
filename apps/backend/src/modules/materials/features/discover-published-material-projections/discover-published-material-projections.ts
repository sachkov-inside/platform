import { z } from "zod";

import type { MaterialsPrisma } from "../../../../infrastructure/prisma/index.js";
import {
  selectPublishedMaterialProjectionsBySeries,
  selectPublishedMaterialProjectionsByTopic,
  selectRelatedPublishedMaterialProjections,
} from "../../infrastructure/postgres/published-material-reader/published-material-projection.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import type {
  DiscoverPublishedMaterialProjectionsQuery,
  PublishedMaterialDiscoveryResult,
} from "./discover-published-material-projections.contract.js";

const querySchema = z
  .object({
    first: z.number().int().min(1).max(100),
    kind: z.enum(["related", "series", "topic"]),
    slug: z
      .string()
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  })
  .strict();

export async function discoverPublishedMaterialProjections(
  prisma: MaterialsPrisma,
  query: DiscoverPublishedMaterialProjectionsQuery,
): Promise<PublishedMaterialDiscoveryResult> {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_request_shape" } };
  }

  try {
    const page = await selectDiscovery(prisma, parsed.data);
    return page === undefined
      ? { ok: false, error: { code: "discovery_not_found" } }
      : {
          ok: true,
          value: { ...page, kind: parsed.data.kind },
        };
  } catch (error) {
    return { ok: false, error: mapPostgresReadError(error) };
  }
}

function selectDiscovery(
  prisma: MaterialsPrisma,
  query: z.infer<typeof querySchema>,
) {
  switch (query.kind) {
    case "topic":
      return selectPublishedMaterialProjectionsByTopic(
        prisma,
        query.slug,
        query.first,
      );
    case "series":
      return selectPublishedMaterialProjectionsBySeries(
        prisma,
        query.slug,
        query.first,
      );
    case "related":
      return selectRelatedPublishedMaterialProjections(
        prisma,
        query.slug,
        query.first,
      );
  }
}
