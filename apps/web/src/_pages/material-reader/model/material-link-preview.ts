import { coverLinkPreviewImage } from "@/entities/material.model";
import type { PublicPagePreview, SocialCardContent } from "@/shared/link-preview";
import { materialPath, socialCardPath } from "@/shared/routing/public-page-path";

import type { MaterialReaderMetadata } from "./material-reader-view";

/** Как материал называет себя читателю: и в заголовке, и на сгенерированной карточке. */
const MATERIAL_LABEL = "Материал";

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

/** Содержимое сгенерированной карточки материала без обложки. */
export function materialSocialCard(
  material: MaterialReaderMetadata,
): SocialCardContent {
  return { eyebrow: MATERIAL_LABEL, title: material.title };
}
