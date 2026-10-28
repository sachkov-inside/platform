import { factAnnouncement } from "@/shared/api/fact-announcement";

/**
 * Цены продуктов владельца изменились (сохранение, открытие или закрытие продаж, архив цены):
 * каждая открытая поверхность перечитывает каталог цен и то, что от него зависит.
 */
export const ownerPriceCatalogChanged = factAnnouncement(
  "inside.owner.price-catalog.changed",
);
