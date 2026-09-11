import { coverLinkPreviewImage } from "@/entities/material.model";
import type { LibraryDiscoveryReference } from "@/features/library-discovery";
import type { PublicPagePreview } from "@/shared/link-preview";
import { guidePath, socialCardPath, topicPath } from "@/shared/routing/public-page-path";

/**
 * Карточка ссылки на руководство. Канонический адрес всегда `/guides/<slug>`: `/series/<slug>`
 * остался совместимым адресом той же страницы и не должен спорить с ним в поиске.
 */
export function guideLinkPreview(
  reference: LibraryDiscoveryReference,
): PublicPagePreview {
  return collectionLinkPreview(reference, {
    canonicalPath: guidePath(reference.slug),
    kind: "руководство",
    materialsPhrase: "Опубликованные материалы руководства",
  });
}

/** Карточка ссылки на тему. */
export function topicLinkPreview(
  reference: LibraryDiscoveryReference,
): PublicPagePreview {
  return collectionLinkPreview(reference, {
    canonicalPath: topicPath(reference.slug),
    kind: "тема",
    materialsPhrase: "Опубликованные материалы по теме",
  });
}

function collectionLinkPreview(
  reference: LibraryDiscoveryReference,
  collection: {
    readonly canonicalPath: string;
    readonly kind: string;
    readonly materialsPhrase: string;
  },
): PublicPagePreview {
  return {
    canonicalPath: collection.canonicalPath,
    description:
      reference.summary.trim().length > 0
        ? reference.summary
        : `${collection.materialsPhrase} «${reference.name}» в авторском порядке.`,
    image: coverLinkPreviewImage(
      reference.cover,
      reference.name,
      socialCardPath(collection.canonicalPath),
    ),
    indexable: true,
    title: `${reference.name} — ${collection.kind}`,
  };
}
