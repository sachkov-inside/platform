import { z } from "zod";

/**
 * Вкладки страницы продукта в адресе: `?tab=description` и т. д. Первая вкладка, программа, в
 * адрес не пишется; незнакомое значение открывает её же.
 */
export const productPageTabIds = [
  "program",
  "description",
  "artifacts",
  "settings",
] as const;

export type ProductPageTabId = (typeof productPageTabIds)[number];

export const defaultProductPageTab: ProductPageTabId = "program";

const productPageTabSchema = z.enum(productPageTabIds);

export function parseProductPageTab(value: string | null): ProductPageTabId {
  const parsed = productPageTabSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultProductPageTab;
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
