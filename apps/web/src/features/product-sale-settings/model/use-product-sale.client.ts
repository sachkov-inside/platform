"use client";

import { useQuery } from "@tanstack/react-query";

import type { BillingFailureCode } from "@/entities/subscription";

import { readOwnerProductPriceOperation } from "../api/read-owner-product-price.operation";
import { readProductSalesStateOperation } from "../api/read-product-sales-state.operation";
import {
  ownerPriceOf,
  productSaleQueryKey,
  type ProductSaleSnapshot,
} from "./product-sale";

/** Чтение продажи не удалось: код отказа остаётся, чтобы отличить запрет от недоступности. */
export class ProductSaleReadError extends Error {
  constructor(readonly code: BillingFailureCode) {
    super(`Product sale read failed: ${code}`);
  }
}

/** Цена владельца и состояние продажи одного продукта: один факт под одним ключом. */
export async function readProductSale(
  productId: string,
): Promise<ProductSaleSnapshot> {
  const [price, state] = await Promise.all([
    readOwnerProductPriceOperation.send({
      operationId: crypto.randomUUID(),
      productId,
    }),
    readProductSalesStateOperation.send({ productId }),
  ]);
  if (!price.ok) throw new ProductSaleReadError(price.code);
  const own = ownerPriceOf(price.value.result.items, productId);
  if (!own.ok) throw new ProductSaleReadError("unavailable");
  if (!state.ok) throw new ProductSaleReadError(state.code);
  return { price: own.price, salesState: state.value.salesState };
}

export function useProductSale(productId: string) {
  return useQuery({
    queryKey: productSaleQueryKey(productId),
    queryFn: () => readProductSale(productId),
    retry: false,
  });
}
