const EFFECTIVE_DATE = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

/** День начала действия словами: он же записан в тексте редакции. */
export function legalEffectiveDate(effectiveFrom: string): string {
  return EFFECTIVE_DATE.format(new Date(`${effectiveFrom}T00:00:00Z`));
}

/**
 * С какого дня документ применяется. Дата приходит из самой редакции: она же записана в её тексте
 * и сохраняется вместе с согласием покупателя.
 */
export function legalEffectiveNote(effectiveFrom: string): string {
  return `Действует с ${legalEffectiveDate(effectiveFrom)}`;
}
