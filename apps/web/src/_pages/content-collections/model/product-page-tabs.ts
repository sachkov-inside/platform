import { z } from "zod";

/**
 * Вкладки страницы продукта в адресе: `?tab=program` и т. д. Первая вкладка, «Обзор» (#1719), в
 * адрес не пишется; незнакомое значение открывает её же. Новая вкладка добавляется сюда, в
 * подписи `productPageTabLabels` и в панели страницы.
 *
 * «Обзор» открывается по умолчанию, как первая вкладка спецификации #1717. Web не знает прав
 * аккаунта заранее, поэтому автор только материалов видит на «Обзоре» отказ со ссылкой на
 * «Программу».
 */
export const productPageTabIds = [
  "overview",
  "program",
  "description",
  "sale",
  "learners",
  "community",
] as const;

export type ProductPageTabId = (typeof productPageTabIds)[number];

export const defaultProductPageTab: ProductPageTabId = "overview";

const productPageTabSchema = z.enum(productPageTabIds);

/**
 * Прежние вкладки (#1720) по-прежнему открываются по старым ссылкам: материалы продукта стали
 * дополнительными материалами программы, а закреп на главной переехал в описание и витрину.
 */
const legacyProductPageTabs: ReadonlyMap<string, ProductPageTabId> = new Map([
  ["artifacts", "program"],
  ["settings", "description"],
]);

export function parseProductPageTab(value: string | null): ProductPageTabId {
  const parsed = productPageTabSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return (
    (value === null ? undefined : legacyProductPageTabs.get(value)) ??
    defaultProductPageTab
  );
}

/** Строка запроса адреса с выбранной вкладкой; остальные параметры адреса сохраняются. */
export function productPageTabSearch(
  currentSearch: string,
  tab: ProductPageTabId,
): string {
  const params = new URLSearchParams(currentSearch);
  if (tab === defaultProductPageTab) params.delete("tab");
  else params.set("tab", tab);
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}
