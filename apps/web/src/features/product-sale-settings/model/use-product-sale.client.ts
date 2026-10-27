"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { BillingReadError } from "@/entities/subscription";

import { readOwnerProductPriceOperation } from "../api/read-owner-product-price.operation";
import { readProductSalesStates } from "../api/product-sales-states.browser";
import {
  productSaleChanged,
  productSaleQueryRoot,
} from "./product-sale-events";
import {
  ownerPriceOf,
  productSaleQueryKey,
  type ProductSaleSnapshot,
} from "./product-sale";

/** Цена владельца и состояние продажи одного продукта: один факт под одним ключом. */
export async function readProductSale(
  productId: string,
): Promise<ProductSaleSnapshot> {
  const [price, state] = await Promise.all([
    readOwnerProductPriceOperation.send({
      operationId: crypto.randomUUID(),
      productId,
    }),
    readProductSalesStates(productId),
  ]);
  if (!price.ok) throw new BillingReadError(price.code);
  const own = ownerPriceOf(
    price.value.result.items,
    productId,
    price.value.result.archivedProductIds,
  );
  if (!own.ok) throw new BillingReadError("unavailable");
  if (!state.ok) throw new BillingReadError(state.code);
  return {
    price: own.price,
    priceArchived: own.archived,
    salesState:
      state.value.find((item) => item.productId === productId) ?? null,
  };
}

/**
 * Продажа одного продукта. Запись продажи в любой поверхности браузера объявляет
 * `productSaleChanged`, и открытая вкладка «Продажа» перечитывает её.
 */
export function useProductSale(productId: string) {
  useProductSaleAnnouncements();
  return useQuery({
    queryKey: productSaleQueryKey(productId),
    queryFn: () => readProductSale(productId),
    retry: false,
  });
}

/** Подписка поверхности на записи продажи: сбрасывает все ключи `["product-sale", …]`. */
export function useProductSaleAnnouncements() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      productSaleChanged.subscribe(() => {
        void queryClient.invalidateQueries(
          { queryKey: productSaleQueryRoot },
          { cancelRefetch: false },
        );
      }),
    [queryClient],
  );
}
