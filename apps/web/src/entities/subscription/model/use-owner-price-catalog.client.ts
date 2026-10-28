"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

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
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ownerPriceCatalogQueryKey,
    queryFn: async () => {
      const result = await readOwnerPriceCatalog();
      if (!result.ok) throw new BillingReadError(result.code);
      return result.value;
    },
    retry: false,
  });

  useEffect(
    () =>
      ownerPriceCatalogChanged.subscribe(() => {
        void queryClient.invalidateQueries(
          { queryKey: ownerPriceCatalogQueryKey },
          { cancelRefetch: false },
        );
      }),
    [queryClient],
  );

  return query;
}
