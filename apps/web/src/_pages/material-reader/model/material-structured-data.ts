import { materialPath } from "@/shared/routing/public-page-path";
import { coverLinkPreviewImage } from "@/entities/material.model";

import type { MaterialReaderMetadata } from "./material-reader-view";

/** Public article facts only: neither a protected body nor delivery credentials enter JSON-LD. */
export function materialArticleJsonLd(
  origin: URL,
  material: MaterialReaderMetadata,
): string | null {
  if (material.access !== "free") return null;
  const url = new URL(materialPath(material.slug), origin).href;
  const cover = material.cover;
  const image =
    cover == null || cover.renditions.length === 0
      ? undefined
      : new URL(coverLinkPreviewImage(cover, material.title, "").url, origin)
          .href;
  // The product has one author. Do not infer an update date from a content version or request time.
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${url}#article`,
    author: { "@type": "Person", name: "Кирилл Сачков" },
    datePublished: material.publishedAt,
    description: material.summary,
    headline: material.title,
    ...(image === undefined ? {} : { image: [image] }),
    inLanguage: "ru-RU",
    mainEntityOfPage: url,
    url,
  }).replace(/</gu, "\\u003c");
}
