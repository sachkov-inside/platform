import "server-only";

import type { z } from "zod";

import {
  billingInvalidInput,
  executeBillingOperation,
} from "@/entities/subscription.server";
import {
  productSalesStatesSchema,
  type BillingOperation,
} from "@/entities/subscription";
import {
  requestManageBilling,
  requestProductSalesStates,
  type ManageBillingCommand,
} from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";

import { CATALOG_PRICES_PAGE_SIZE, ownerPriceOf } from "../model/product-sale";
import { archiveProductPriceOperation } from "./archive-product-price.operation";
import { listOwnerProductPricesOperation } from "./list-owner-product-prices.operation";
import { listProductSalesStatesOperation } from "./list-product-sales-states.operation";
import { readOwnerProductPriceOperation } from "./read-owner-product-price.operation";
import { readProductSalesStateOperation } from "./read-product-sales-state.operation";
import { saveProductPriceOperation } from "./save-product-price.operation";
import { saveProductSalesStateOperation } from "./save-product-sales-state.operation";

/** Одна владельческая команда billing за маршрут: дискриминатор не становится общим прокси. */
function ownerCommand<Input extends z.ZodType, Value extends z.ZodType>(
  request: Request,
  operation: BillingOperation<Input, Value>,
  toCommand: (input: z.output<Input>) => ManageBillingCommand,
): Promise<Response> {
  return handleMutationOperation(request, operation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(operation, command, (input) =>
        requestManageBilling(toCommand(input), accessToken),
      ),
  });
}

/**
 * Цена одного продукта: каталог владельца с отбором по продукту. У продукта одна действующая цена,
 * поэтому хватает одной записи; ответ с чужим продуктом читается как недоступность.
 */
export function handleReadOwnerProductPrice(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, readOwnerProductPriceOperation, {
    invalidInput: billingInvalidInput,
    execute: async (command, accessToken) => {
      const result = await executeBillingOperation(
        readOwnerProductPriceOperation,
        command,
        (input) =>
          requestManageBilling(
            {
              operation: "productPrices.list",
              operationId: input.operationId,
              productId: input.productId,
              limit: 1,
            },
            accessToken,
          ),
      );
      if (
        result.ok &&
        !ownerPriceOf(result.value.result.items, command.productId).ok
      )
        return { ok: false, code: "unavailable" };
      return result;
    },
  });
}

/** Состояние продажи одного продукта: публичное чтение backend без кеша, только для владельца. */
export function handleReadProductSalesState(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, readProductSalesStateOperation, {
    invalidInput: billingInvalidInput,
    execute: async ({ productId }) => {
      try {
        const result = await requestProductSalesStates(productId);
        if (!result.ok) return { ok: false, code: "unavailable" };
        const parsed = productSalesStatesSchema.safeParse(result.body);
        if (!parsed.success) return { ok: false, code: "unavailable" };
        return {
          ok: true,
          value: {
            salesState:
              parsed.data.items.find((item) => item.productId === productId) ??
              null,
          },
        };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },
  });
}

/** Страница цен всех продуктов владельца: одно чтение `productPrices.list` без продукта. */
export function handleListOwnerProductPrices(
  request: Request,
): Promise<Response> {
  return ownerCommand(request, listOwnerProductPricesOperation, (input) => ({
    operation: "productPrices.list",
    operationId: input.operationId,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    limit: CATALOG_PRICES_PAGE_SIZE,
  }));
}

/** Страница публичных состояний продажи всех продуктов: чтение backend без кеша, для владельца. */
export function handleListProductSalesStates(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, listProductSalesStatesOperation, {
    invalidInput: billingInvalidInput,
    execute: async ({ cursor }) => {
      try {
        const result = await requestProductSalesStates(undefined, cursor);
        if (!result.ok) return { ok: false, code: "unavailable" };
        const parsed = productSalesStatesSchema.safeParse(result.body);
        return parsed.success
          ? { ok: true, value: parsed.data }
          : { ok: false, code: "unavailable" };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },
  });
}

export function handleSaveProductPrice(request: Request): Promise<Response> {
  return ownerCommand(request, saveProductPriceOperation, (input) => ({
    operation: "productPrices.save",
    operationId: input.operationId,
    ...(input.expectedRevision === undefined
      ? {}
      : { expectedRevision: input.expectedRevision }),
    value: input.value,
  }));
}

export function handleArchiveProductPrice(request: Request): Promise<Response> {
  return ownerCommand(request, archiveProductPriceOperation, (input) => ({
    ...input,
    operation: "productPrices.archive",
  }));
}

export function handleSaveProductSalesState(
  request: Request,
): Promise<Response> {
  return ownerCommand(request, saveProductSalesStateOperation, (input) => ({
    operation: "productSalesState.save",
    operationId: input.operationId,
    ...(input.expectedRevision === undefined
      ? {}
      : { expectedRevision: input.expectedRevision }),
    value: input.value,
  }));
}
