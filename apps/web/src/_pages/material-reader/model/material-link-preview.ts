import { coverLinkPreviewImage } from "@/entities/material.model";
import type { PublicPagePreview } from "@/shared/link-preview";
import { materialPath, socialCardPath } from "@/shared/routing/public-page-path";

import type { MaterialReaderMetadata } from "./material-reader-view";

/**
 * Карточка ссылки на материал. Закрытый материал отдаёт честное название, обещание и обложку,
 * но не тело: карточка собирается из публичной проекции, которую гость и так видит на странице.
 */
export function materialLinkPreview(
  material: MaterialReaderMetadata,
): PublicPagePreview {
  const canonicalPath = materialPath(material.slug);
  return {
    canonicalPath,
    description: material.summary,
    image: coverLinkPreviewImage(
      material.cover,
      material.title,
      socialCardPath(canonicalPath),
    ),
    indexable: true,
    publishedAt: material.publishedAt,
    title: material.title,
  };
}
