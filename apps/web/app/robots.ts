import type { MetadataRoute } from "next";

import { publicPageUrl, readPublicSiteOrigin } from "@/shared/link-preview/index.server";

/**
 * Разделы, которым нечего делать в поиске: личный кабинет, авторская часть, служебные маршруты
 * и возврат из оплаты. Совместимый адрес `/series/<slug>` остаётся открытым: поисковику нужно
 * прочитать его канонический адрес, а не упереться в запрет.
 */
const CLOSED_SECTIONS = [
  "/_health/",
  "/account",
  "/api/",
  "/auth/",
  "/authoring",
  "/bookmarks",
  "/callback",
  "/communications/visit",
  "/subscription/return",
] as const;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await readPublicSiteOrigin();
  return {
    rules: { allow: "/", disallow: [...CLOSED_SECTIONS], userAgent: "*" },
    sitemap: publicPageUrl(origin, "/sitemap.xml"),
  };
}
