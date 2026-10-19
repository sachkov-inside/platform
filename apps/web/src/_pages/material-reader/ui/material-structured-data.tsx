import "server-only";

import { readPublicSiteOrigin } from "@/shared/link-preview/index.server";

import { readPublicMaterial } from "../api/public-material.public-cache.server";
import { materialArticleJsonLd } from "../model/material-structured-data";

/** Always use the guest read, even for an authenticated author visiting a private preview. */
export async function MaterialStructuredData({
  slug,
}: {
  readonly slug: string;
}) {
  const result = await readPublicMaterial(slug);
  if (result.kind !== "available" || result.material.access !== "free")
    return null;
  const json = materialArticleJsonLd(
    await readPublicSiteOrigin(),
    result.material,
  );
  return json === null ? null : (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
