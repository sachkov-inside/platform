import "server-only";

import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

import type { MaterialReaderResult, PublicMaterialResult } from "../model/material-reader-view";
import { loadMaterialReader } from "./load-material-reader";
import { readPublicMaterial } from "./public-material.public-cache.server";

/**
 * Урок для заголовка вкладки и карточки ссылки. Хватает общей части; личное чтение нужно только
 * материалу, закрытому от гостя целиком: вошедшему он может быть открыт, и заголовок это учитывает.
 * То же личное чтение потом берёт страница — в пределах запроса оно одно.
 */
export async function loadMaterialPreview(
  slug: string,
): Promise<MaterialReaderResult | PublicMaterialResult> {
  const open = await readPublicMaterial(slug);
  if (open.kind !== "not-found") return open;
  const accessToken = await getOptionalPlatformAccessToken();
  return accessToken === undefined ? open : loadMaterialReader(slug, accessToken);
}
