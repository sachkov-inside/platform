/** Размер карточки, который ждут мессенджеры и социальные сети. */
export const SOCIAL_CARD_SIZE = { height: 630, width: 1200 } as const;

/**
 * Что видно на сгенерированной карточке: короткая надпись сверху и название страницы.
 * У главной надписи нет: там название само говорит, что это за площадка.
 */
export interface SocialCardContent {
  readonly eyebrow?: string | undefined;
  readonly title: string;
}

const MAX_TITLE_LENGTH = 90;

/**
 * Название на карточке обрезается по символам, а не вёрсткой: в генераторе изображения нет
 * многострочного обрезания, а слишком длинная строка вытеснила бы подпись площадки.
 */
export function socialCardTitle(title: string): string {
  const normalized = title.replace(/\s+/gu, " ").trim();
  if (normalized.length <= MAX_TITLE_LENGTH) {
    return normalized;
  }
  const clipped = normalized.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = clipped.lastIndexOf(" ");
  const kept = lastSpace > MAX_TITLE_LENGTH / 2 ? clipped.slice(0, lastSpace) : clipped;
  return `${kept.trimEnd()}…`;
}

/** Чем длиннее название, тем мельче кегль: карточка держит три строки без переполнения. */
export function socialCardTitleFontSize(title: string): number {
  if (title.length <= 40) return 76;
  return title.length <= 70 ? 62 : 52;
}
