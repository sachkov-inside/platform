import { z } from "zod";

import type { ContentAccess } from "../../../content-access/index.js";
import type { PublishedMaterialReader } from "../../../materials/index.js";
import { projectPublishedCatalogItems } from "../../shared/project-published-catalog-items.js";
import type {
  DiscoverPublishedMaterialsQuery,
  PublishedMaterialDiscoveryResult,
} from "./discover-published-materials.contract.js";

const querySchema = z
  .object({
    first: z.number().int().min(1).max(100),
    kind: z.enum(["related", "series", "topic"]),
    slug: z.string().min(1).max(120),
    subject: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("anonymous") }).strict(),
      z.object({ kind: z.literal("account"), accountId: z.uuid() }).strict(),
    ]),
  })
  .strict();

export async function discoverPublishedMaterials(
  publishedMaterialReader: Pick<
    PublishedMaterialReader,
    "discoverProjections"
  >,
  contentAccess: Pick<ContentAccess, "checkAvailabilityMany">,
  query: DiscoverPublishedMaterialsQuery,
): Promise<PublishedMaterialDiscoveryResult> {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_request_shape" } };
  }
  const page = await publishedMaterialReader.discoverProjections({
    first: parsed.data.first,
    kind: parsed.data.kind,
    slug: parsed.data.slug,
  });
  if (!page.ok) {
    return page;
  }
  const projected = await projectPublishedCatalogItems(
    contentAccess,
    query.subject,
    page.value.items,
  );
  return projected.ok
    ? {
        ok: true,
        value: {
          hasNext: page.value.hasNext,
          items: projected.items,
          kind: page.value.kind,
          reference: page.value.reference,
        },
      }
    : projected;
}
