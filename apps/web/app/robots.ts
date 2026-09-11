import type { MetadataRoute } from "next";

import { CLOSED_SECTIONS, OPEN_SECTIONS } from "@/shared/link-preview";
import { publicPageUrl, readPublicSiteOrigin } from "@/shared/link-preview/index.server";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await readPublicSiteOrigin();
  return {
    rules: {
      allow: ["/", ...OPEN_SECTIONS],
      disallow: [...CLOSED_SECTIONS],
      userAgent: "*",
    },
    sitemap: publicPageUrl(origin, "/sitemap.xml"),
  };
}
