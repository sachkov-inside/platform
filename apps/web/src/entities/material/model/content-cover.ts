import { z } from "zod";

import { SOCIAL_CARD_SIZE, type LinkPreviewImage } from "@/shared/link-preview";

export const contentCoverSchema = z
  .object({
    coverId: z.uuid(),
    renditions: z.array(
      z
        .object({
          height: z.number().int().positive(),
          width: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict();

export type ContentCover = z.infer<typeof contentCoverSchema>;

export function contentCoverUrl(coverId: string, width: number): string {
  return `/api/content-covers/${encodeURIComponent(coverId)}/${String(width)}`;
}

/**
 * Картинка предпросмотра ссылки: обложка материала, руководства или темы, а когда обложки нет —
 * сгенерированная карточка страницы. Пустой карточки ссылка не получает никогда.
 */
export function coverLinkPreviewImage(
  cover: ContentCover | null | undefined,
  alt: string,
  socialCardPath: string,
): LinkPreviewImage {
  const rendition =
    cover == null ? undefined : previewRendition(cover, SOCIAL_CARD_SIZE.width);
  return cover == null || rendition === undefined
    ? { alt, height: SOCIAL_CARD_SIZE.height, url: socialCardPath, width: SOCIAL_CARD_SIZE.width }
    : {
        alt,
        height: rendition.height,
        url: contentCoverUrl(cover.coverId, rendition.width),
        width: rendition.width,
      };
}

/** Ближайшая версия не уже карточки, иначе самая крупная: мессенджеру нужен один готовый файл. */
function previewRendition(
  cover: ContentCover,
  minimumWidth: number,
): ContentCover["renditions"][number] | undefined {
  const ascending = [...cover.renditions].sort(
    (left, right) => left.width - right.width,
  );
  return ascending.find(({ width }) => width >= minimumWidth) ?? ascending.at(-1);
}
