import "server-only";

import type { MetadataRoute } from "next";
import { cache } from "react";

import { LEGAL_NAVIGATION } from "@/entities/legal-document";
import { getPublicSiteIndex } from "./get-public-site-index";
import {
  publicPageUrl,
  readPublicSiteOrigin,
} from "@/shared/link-preview/index.server";
import {
  productPath,
  HOME_PATH,
  LEGAL_PATH,
  legalDocumentPath,
  MAP_PATH,
  materialPath,
  topicPath,
} from "@/shared/routing/public-page-path";

import { partitionPublicSitemap } from "../model/sitemap-chunks";
export const getPublicSitemapChunks = cache(
  async function getPublicSitemapChunks(): Promise<
    readonly MetadataRoute.Sitemap[]
  > {
    const origin = await readPublicSiteOrigin();
    const alwaysPublic = [
      HOME_PATH,
      MAP_PATH,
      LEGAL_PATH,
      ...LEGAL_NAVIGATION.map((entry) => legalDocumentPath(entry.key)),
    ].map((path) => ({
      url: publicPageUrl(origin, path),
    }));
    const index = await getPublicSiteIndex();
    if (index.kind === "unavailable") {
      return [alwaysPublic];
    }
    return partitionPublicSitemap([
      ...alwaysPublic,
      ...index.productSlugs.map((slug) => ({
        url: publicPageUrl(origin, productPath(slug)),
      })),
      ...index.topicSlugs.map((slug) => ({
        url: publicPageUrl(origin, topicPath(slug)),
      })),
      ...index.materials.map(({ publishedAt, slug }) => ({
        lastModified: publishedAt,
        url: publicPageUrl(origin, materialPath(slug)),
      })),
    ]);
  },
);
