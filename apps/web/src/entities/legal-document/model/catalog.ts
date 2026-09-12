import type { LegalDocumentKey } from "@inside/legal/document";

/**
 * Как раздел называет документы в навигации и в каком порядке их показывает. Тексты, версии и
 * даты действия принадлежат пакету `@inside/legal`; здесь только представление, поэтому футер и
 * список раздела не тянут в браузер сами редакции.
 */
export interface LegalNavigationEntry {
  readonly key: LegalDocumentKey;
  /** Короткое название для футера и списка: полное живёт в заголовке самой редакции. */
  readonly navLabel: string;
  readonly group: LegalGroup;
}

export type LegalGroup = "agreement" | "data" | "seller" | "legacy";

export const LEGAL_GROUP_TITLES: Readonly<Record<LegalGroup, string>> = {
  agreement: "Условия и оферты",
  data: "Данные и браузер",
  seller: "Продавец и обращения",
  legacy: "Прежние покупки",
};

export const LEGAL_GROUP_ORDER: readonly LegalGroup[] = [
  "agreement",
  "data",
  "seller",
  "legacy",
];

export const LEGAL_NAVIGATION: readonly LegalNavigationEntry[] = [
  { key: "terms", navLabel: "Условия использования", group: "agreement" },
  { key: "purchase", navLabel: "Оферта разовой покупки", group: "agreement" },
  { key: "subscription", navLabel: "Оферта подписки", group: "agreement" },
  { key: "recurring-consent", navLabel: "Согласие на автопродление", group: "agreement" },
  { key: "privacy", navLabel: "Политика данных", group: "data" },
  { key: "cookies", navLabel: "Cookies и хранение", group: "data" },
  { key: "contacts", navLabel: "Реквизиты и обращения", group: "seller" },
  { key: "tribute", navLabel: "Покупки через Tribute", group: "legacy" },
];

export function legalNavigationEntry(
  key: LegalDocumentKey,
): LegalNavigationEntry | null {
  return LEGAL_NAVIGATION.find((entry) => entry.key === key) ?? null;
}
