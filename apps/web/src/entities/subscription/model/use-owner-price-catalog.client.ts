"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { readOwnerPriceCatalog } from "../api/owner-price-catalog.browser";
import type { BillingFailureCode } from "./billing-contract";
import { ownerPriceCatalogChanged } from "./owner-price-catalog-events";
import { ownerPriceCatalogQueryKey } from "./owner-price-catalog";

/** Каталог цен не прочитан: код отказа остаётся, чтобы отличить запрет от недоступности. */
export class OwnerPriceCatalogReadError extends Error {
  constructor(readonly code: BillingFailureCode) {
    super(`Owner price catalog read failed: ${code}`);
  }
}

/**
 * Единственное чтение полного каталога цен владельца в браузере: один ключ на все поверхности
 * админки (список продуктов, ссылки на оплату, скидки). Запись цены любой поверхности объявляет
 * `ownerPriceCatalogChanged`, и каждая открытая поверхность перечитывает каталог. Отказ и
 * недоступность видны сразу: чтение не повторяется молча.
 */
export function useOwnerPriceCatalog({
  enabled = true,
}: {
  /** `false`, пока поверхность скрыта и каталог ей не нужен. */
  readonly enabled?: boolean;
} = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ownerPriceCatalogQueryKey,
    queryFn: async () => {
      const result = await readOwnerPriceCatalog();
      if (!result.ok) throw new OwnerPriceCatalogReadError(result.code);
      return result.value;
    },
    retry: false,
    enabled,
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
