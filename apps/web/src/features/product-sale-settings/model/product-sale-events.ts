import { factAnnouncement } from "@/shared/api/fact-announcement";

/**
 * Цена или состояние продажи какого-то продукта изменились: каждая открытая поверхность
 * перечитывает продажу своего продукта и состояния продажи каталога (ключи `["product-sale", …]`).
 */
export const productSaleChanged = factAnnouncement(
  "inside.owner.product-sale.changed",
);

/** Корень ключей продажи продуктов: продажа одного продукта и состояния продажи каталога. */
export const productSaleQueryRoot = ["product-sale"] as const;
