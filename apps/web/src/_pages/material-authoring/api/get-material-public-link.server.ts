import "server-only";

import { z } from "zod";

import { requestCurrentMaterial } from "@/shared/api/backend/index.server";
import { materialPath } from "@/shared/routing/public-page-path";

const linkSourceSchema = z.object({
  materialId: z.uuid(),
  publicationState: z.enum(["draft", "published", "unpublished"]),
  metadata: z.object({ slug: z.string().min(1).nullable() }),
});

/** Resolve on demand: also works immediately after first publication, without reloading the editor. */
export async function getMaterialPublicLink(
  materialId: string,
  token: string,
  load: typeof requestCurrentMaterial = requestCurrentMaterial,
): Promise<
  | { readonly kind: "ready"; readonly path: string | null }
  | { readonly kind: "rejected"; readonly status: number }
> {
  if (!z.uuid().safeParse(materialId).success)
    return { kind: "rejected", status: 404 };
  const result = await load(materialId, token);
  if (!result.ok) {
    return {
      kind: "rejected",
      status: [401, 403, 404].includes(result.response.status)
        ? result.response.status
        : 503,
    };
  }
  const current = linkSourceSchema.parse(result.body);
  if (current.materialId !== materialId)
    throw new TypeError("Material link identity mismatch");
  return {
    kind: "ready",
    path:
      current.publicationState === "published" && current.metadata.slug !== null
        ? materialPath(current.metadata.slug)
        : null,
  };
}
