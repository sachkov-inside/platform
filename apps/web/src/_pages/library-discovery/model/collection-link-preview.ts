import { coverLinkPreviewImage } from "@/entities/material.model";
import type { LibraryDiscoveryReference } from "@/features/library-discovery";
import type {
  PublicPagePreview,
  SocialCardContent,
} from "@/shared/link-preview";
import {
  productPath,
  socialCardPath,
  topicPath,
} from "@/shared/routing/public-page-path";

/**
 * Как коллекция называет себя читателю. Одно слово отвечает и за заголовок страницы, и за
 * надпись на сгенерированной карточке: переименование остаётся одной правкой.
 */
interface CollectionKind {
  readonly canonicalPathOf: (slug: string) => string;
  readonly label: string;
  readonly materialsPhrase: string;
}

const PRODUCT: CollectionKind = {
  canonicalPathOf: productPath,
  label: "Продукт",
  materialsPhrase: "Опубликованные материалы продукта",
};

const TOPIC: CollectionKind = {
  canonicalPathOf: topicPath,
  label: "Тема",
  materialsPhrase: "Опубликованные материалы по теме",
};

/**
 * Карточка ссылки на продукт. Канонический адрес всегда `/products/<slug>`: прежние `/products/<slug>`
 * и `/series/<slug>` перенаправляются туда и не спорят с ним в поиске.
 */
export function productLinkPreview(
  reference: LibraryDiscoveryReference,
): PublicPagePreview {
  return collectionLinkPreview(reference, PRODUCT);
}

/** Карточка ссылки на тему. */
export function topicLinkPreview(
  reference: LibraryDiscoveryReference,
): PublicPagePreview {
  return collectionLinkPreview(reference, TOPIC);
}

/** Содержимое сгенерированной карточки руководства без обложки. */
export function productSocialCard(
  reference: LibraryDiscoveryReference,
): SocialCardContent {
  return { eyebrow: PRODUCT.label, title: reference.name };
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
