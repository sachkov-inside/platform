import type { MetadataRoute } from "next";

import { LEGAL_NAVIGATION } from "@/entities/legal-document";
import { getPublicSiteIndex } from "@/features/public-site-index.server";
import { publicPageUrl, readPublicSiteOrigin } from "@/shared/link-preview/index.server";
import {
  guidePath,
  HOME_PATH,
  LEGAL_PATH,
  legalDocumentPath,
  LIBRARY_PATH,
  MAP_PATH,
  materialPath,
  topicPath,
} from "@/shared/routing/public-page-path";

/**
 * Карта сайта опубликованных страниц. Когда каталог временно недоступен, карта отдаёт постоянные
 * публичные адреса вместо ошибки: поиск не должен считать сайт пропавшим из-за сбоя зависимости.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await readPublicSiteOrigin();
  const alwaysPublic = [
    HOME_PATH,
    LIBRARY_PATH,
    MAP_PATH,
    LEGAL_PATH,
    ...LEGAL_NAVIGATION.map((entry) => legalDocumentPath(entry.key)),
  ].map((path) => ({
    url: publicPageUrl(origin, path),
  }));
  const index = await getPublicSiteIndex();
  if (index.kind === "unavailable") {
    return alwaysPublic;
  }
  return [
    ...alwaysPublic,
    ...index.guideSlugs.map((slug) => ({ url: publicPageUrl(origin, guidePath(slug)) })),
    ...index.topicSlugs.map((slug) => ({ url: publicPageUrl(origin, topicPath(slug)) })),
    ...index.materials.map(({ publishedAt, slug }) => ({
      lastModified: publishedAt,
      url: publicPageUrl(origin, materialPath(slug)),
    })),
  ];
}
