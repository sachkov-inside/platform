import "server-only";

import { applyCatalogCachePolicy } from "@/shared/api/catalog-cache.server";

import type { PublicMaterialResult } from "../model/material-reader-view";
import { getGuestMaterial } from "./get-material-reader";

/** Урок глазами гостя из общего кеша: запрос идёт без токена, ключ записи — slug (ADR 0027). */
export async function readPublicMaterial(
  slug: string,
): Promise<PublicMaterialResult> {
  "use cache";
  const result = await getGuestMaterial(slug);
  applyCatalogCachePolicy(result.kind);
  return result;
}
