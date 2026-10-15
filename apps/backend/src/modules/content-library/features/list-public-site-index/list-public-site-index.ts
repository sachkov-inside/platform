import { createHash } from "node:crypto";
import { z } from "zod";
import { PUBLISHED_CATALOG_CURSOR_MAX_LENGTH } from "@inside/contracts/published-catalog";
import type { PublishedMaterialReader } from "../../../materials/index.js";

const fingerprint = createHash("sha256")
  .update("public-site-index:newest:v1")
  .digest("base64url");
const cursorSchema = z
  .object({
    v: z.literal(1),
    fingerprint: z.literal(fingerprint),
    materialId: z.uuid(),
    publishedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const querySchema = z
  .object({
    after: z
      .string()
      .min(1)
      .max(PUBLISHED_CATALOG_CURSOR_MAX_LENGTH)
      .optional(),
    first: z.number().int().min(1).max(200),
  })
  .strict();

export async function listPublicSiteIndex(
  reader: Pick<PublishedMaterialReader, "listSiteMaterials">,
  query: { readonly after?: string; readonly first: number },
) {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success)
    return {
      ok: false as const,
      error: { code: "invalid_request_shape" as const },
    };
  const after =
    parsed.data.after === undefined
      ? undefined
      : decodeCursor(parsed.data.after);
  if (parsed.data.after !== undefined && after === undefined)
    return {
      ok: false as const,
      error: { code: "invalid_request_shape" as const },
    };
  const result = await reader.listSiteMaterials({
    first: parsed.data.first,
    ...(after === undefined
      ? {}
      : {
          after: {
            materialId: after.materialId,
            publishedAt: after.publishedAt,
          },
        }),
  });
  if (!result.ok) return result;
  return {
    ok: true as const,
    value: {
      items: result.value.items,
      productSlugs: result.value.productSlugs,
      topicSlugs: result.value.topicSlugs,
      nextCursor:
        result.value.continuation === null
          ? null
          : Buffer.from(
              JSON.stringify({
                v: 1,
                fingerprint,
                materialId: result.value.continuation.materialId,
                publishedAt: result.value.continuation.publishedAt,
              }),
              "utf8",
            ).toString("base64url"),
    },
  };
}
function decodeCursor(value: string) {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    const parsed = cursorSchema.safeParse(decoded);
    return parsed.success ? parsed.data : undefined;
  } catch {
    // Not a dependency failure: malformed client continuation is invalid input.
    return undefined;
  }
}
