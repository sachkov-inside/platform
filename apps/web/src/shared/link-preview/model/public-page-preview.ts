import type { Metadata } from "next";

import { HOME_PATH, socialCardPath } from "@/shared/routing/public-page-path";

import { SOCIAL_CARD_SIZE } from "./social-card-content";

/** Название площадки в карточке ссылки и в заголовке вкладки. */
export const SITE_NAME = "Sachkov Inside";

/** Обещание площадки одной строкой: название на карточке главной. */
export const SITE_TAGLINE = "Материалы, темы и руководства";

/** Описание главной: то же обещание вместе с названием площадки. */
export const SITE_DESCRIPTION = `${SITE_TAGLINE} ${SITE_NAME}`;

const OPEN_GRAPH_LOCALE = "ru_RU";

/**
 * Картинка предпросмотра. Адрес относительный: Next разворачивает его по `metadataBase`,
 * поэтому карточка всегда ссылается на рабочий домен, а не на адрес сборки.
 */
export interface LinkPreviewImage {
  readonly alt: string;
  readonly height?: number | undefined;
  readonly url: string;
  readonly width?: number | undefined;
}

/**
 * Публичная страница глазами мессенджера и поиска: что показать в карточке ссылки,
 * какой адрес считать каноническим и можно ли индексировать страницу.
 */
export interface PublicPagePreview {
  readonly canonicalPath: string;
  readonly description: string;
  readonly image: LinkPreviewImage;
  readonly indexable: boolean;
  readonly publishedAt?: string | undefined;
  /** Название в карточке ссылки, когда заголовок страницы звучит для неё слишком служебно. */
  readonly socialTitle?: string | undefined;
  readonly title: string;
}

export type PublicPageKind = "article" | "website";

export function publicPageMetadata(
  origin: URL,
  kind: PublicPageKind,
  preview: PublicPagePreview,
): Metadata {
  const images = [
    {
      alt: preview.image.alt,
      ...(preview.image.height === undefined ? {} : { height: preview.image.height }),
      url: preview.image.url,
      ...(preview.image.width === undefined ? {} : { width: preview.image.width }),
    },
  ];
  const socialTitle = preview.socialTitle ?? preview.title;
  const shared = {
    description: preview.description,
    images,
    locale: OPEN_GRAPH_LOCALE,
    siteName: SITE_NAME,
    title: socialTitle,
    url: preview.canonicalPath,
  } as const;

  return {
    alternates: { canonical: preview.canonicalPath },
    description: preview.description,
    metadataBase: origin,
    openGraph:
      kind === "article"
        ? {
            ...shared,
            type: "article",
            ...(preview.publishedAt === undefined
              ? {}
              : { publishedTime: preview.publishedAt }),
          }
        : { ...shared, type: "website" },
    robots: preview.indexable
      ? { follow: true, index: true }
      : { follow: false, index: false },
    title: preview.title,
    twitter: {
      card: "summary_large_image",
      description: preview.description,
      images: [preview.image.url],
      title: socialTitle,
    },
  };
}

/** Карточка ссылки на главную: у площадки нет обложки, поэтому картинка всегда сгенерированная. */
export function siteLinkPreview(): PublicPagePreview {
  return {
    canonicalPath: HOME_PATH,
    description: SITE_DESCRIPTION,
    image: {
      alt: SITE_NAME,
      height: SOCIAL_CARD_SIZE.height,
      url: socialCardPath(HOME_PATH),
      width: SOCIAL_CARD_SIZE.width,
    },
    indexable: true,
    socialTitle: SITE_NAME,
    title: "Главная",
  };
}

/**
 * Страница, которой нечего показать: ненайденное, снятое с публикации или временно недоступное.
 * Карточка не строится, адрес не объявляется каноническим, индексация закрыта.
 */
export function hiddenPageMetadata(title: string): Metadata {
  return { robots: { follow: false, index: false }, title };
}
