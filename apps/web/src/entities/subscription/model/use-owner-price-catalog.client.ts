"use client";

import { useQuery } from "@tanstack/react-query";

import { useAnnouncedRefresh } from "@/shared/api/use-announced-refresh.client";

import { readOwnerPriceCatalog } from "../api/owner-price-catalog.browser";
import { BillingReadError } from "./billing-read-error";
import { ownerPriceCatalogChanged } from "./owner-price-catalog-events";
import { ownerPriceCatalogQueryKey } from "./owner-price-catalog";

/**
 * Единственное чтение полного каталога цен владельца в браузере: один ключ на все поверхности
 * админки (список продуктов, ссылки на оплату, скидки). Запись цены любой поверхности объявляет
 * `ownerPriceCatalogChanged`, и каждая открытая поверхность перечитывает каталог. Отказ и
 * недоступность видны сразу: чтение не повторяется молча.
 */
export function useOwnerPriceCatalog() {
  useAnnouncedRefresh(ownerPriceCatalogChanged, ownerPriceCatalogQueryKey);
  return useQuery({
    queryKey: ownerPriceCatalogQueryKey,
    queryFn: async () => {
      const result = await readOwnerPriceCatalog();
      if (!result.ok) throw new BillingReadError(result.code);
      return result.value;
    },
    retry: false,
  });
}
