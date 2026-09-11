import { coverLinkPreviewImage } from "@/entities/material.model";
import type { LibraryDiscoveryReference } from "@/features/library-discovery";
import type { PublicPagePreview, SocialCardContent } from "@/shared/link-preview";
import { guidePath, socialCardPath, topicPath } from "@/shared/routing/public-page-path";

/**
 * Как коллекция называет себя читателю. Одно слово отвечает и за заголовок страницы, и за
 * надпись на сгенерированной карточке: переименование остаётся одной правкой.
 */
interface CollectionKind {
  readonly canonicalPathOf: (slug: string) => string;
  readonly label: string;
  readonly materialsPhrase: string;
}

const GUIDE: CollectionKind = {
  canonicalPathOf: guidePath,
  label: "Руководство",
  materialsPhrase: "Опубликованные материалы руководства",
};

const TOPIC: CollectionKind = {
  canonicalPathOf: topicPath,
  label: "Тема",
  materialsPhrase: "Опубликованные материалы по теме",
};

/**
 * Карточка ссылки на руководство. Канонический адрес всегда `/guides/<slug>`: `/series/<slug>`
 * остался совместимым адресом той же страницы и не должен спорить с ним в поиске.
 */
export function guideLinkPreview(
  reference: LibraryDiscoveryReference,
): PublicPagePreview {
  return collectionLinkPreview(reference, GUIDE);
}

/** Карточка ссылки на тему. */
export function topicLinkPreview(
  reference: LibraryDiscoveryReference,
): PublicPagePreview {
  return collectionLinkPreview(reference, TOPIC);
}

/** Содержимое сгенерированной карточки руководства без обложки. */
export function guideSocialCard(
  reference: LibraryDiscoveryReference,
): SocialCardContent {
  return { eyebrow: GUIDE.label, title: reference.name };
}

/** Содержимое сгенерированной карточки темы без обложки. */
export function topicSocialCard(
  reference: LibraryDiscoveryReference,
): SocialCardContent {
  return { eyebrow: TOPIC.label, title: reference.name };
}

function collectionLinkPreview(
  reference: LibraryDiscoveryReference,
  kind: CollectionKind,
): PublicPagePreview {
  const canonicalPath = kind.canonicalPathOf(reference.slug);
  return {
    canonicalPath,
    description:
      reference.summary.trim().length > 0
        ? reference.summary
        : `${kind.materialsPhrase} «${reference.name}» в авторском порядке.`,
    image: coverLinkPreviewImage(
      reference.cover,
      reference.name,
      socialCardPath(canonicalPath),
    ),
    indexable: true,
    title: `${reference.name} — ${kind.label.toLocaleLowerCase("ru")}`,
  };
}
