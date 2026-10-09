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
  /** Название в строке «вы принимаете …», когда падеж отличается от `navLabel`. */
  readonly consentLabel?: string;
  readonly group: LegalGroup;
}

/** Название документа без места в навигации: годится и для снятых с неё документов. */
export type LegalDocumentLabel = Pick<
  LegalNavigationEntry,
  "consentLabel" | "key" | "navLabel"
>;

export type LegalGroup = "agreement" | "data" | "seller";

export const LEGAL_GROUP_TITLES: Readonly<Record<LegalGroup, string>> = {
  agreement: "Условия и оферты",
  data: "Данные и браузер",
  seller: "Продавец и обращения",
};

export const LEGAL_GROUP_ORDER: readonly LegalGroup[] = [
  "agreement",
  "data",
  "seller",
];

export const LEGAL_NAVIGATION: readonly LegalNavigationEntry[] = [
  { key: "terms", navLabel: "Условия использования", group: "agreement" },
  {
    key: "purchase",
    navLabel: "Оферта разовой покупки",
    consentLabel: "оферту разовой покупки",
    group: "agreement",
  },
  {
    key: "subscription",
    navLabel: "Оферта подписки",
    consentLabel: "оферту подписки",
    group: "agreement",
  },
  {
    key: "recurring-consent",
    navLabel: "Согласие на автопродление",
    consentLabel: "согласие на автопродление",
    group: "agreement",
  },
  { key: "privacy", navLabel: "Политика данных", group: "data" },
  { key: "cookies", navLabel: "Cookies и хранение", group: "data" },
  { key: "contacts", navLabel: "Реквизиты и обращения", group: "seller" },
];

/**
 * Действующие документы, которых нет в навигации. Условия покупок через Tribute сняты с футера и
 * списка: Tribute больше не продаёт (решение владельца 09.10.2026). Редакция остаётся по прямому
 * адресу для прежних покупателей.
 */
export const LEGAL_HIDDEN_FROM_NAVIGATION: readonly LegalDocumentLabel[] = [
  { key: "tribute", navLabel: "Покупки через Tribute" },
];

/**
 * Как документ называется в навигации; `null` для ключа вне раздела. Снятый с навигации документ
 * сохраняет название: прежний покупатель видит его в своих принятых документах.
 */
export function legalNavigationEntry(key: string): LegalDocumentLabel | null {
  return (
    LEGAL_NAVIGATION.find((entry) => entry.key === key) ??
    LEGAL_HIDDEN_FROM_NAVIGATION.find((entry) => entry.key === key) ??
    null
  );
}
