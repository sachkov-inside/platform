import "server-only";

import { z } from "zod";

import {
  billingFailureResponse,
  billingInvalidInput,
  executeBillingOperation,
  loadProductSalesState,
  loadProductSalesStates,
  ownerBillingCommand,
} from "@/entities/subscription.server";
import { requestManageBilling } from "@/shared/api/backend/index.server";
import {
  handleAuthenticatedRead,
  handleMutationOperation,
} from "@/shared/auth/index.server";

import { ownerPriceOf } from "../model/product-sale";
import { archiveProductPriceOperation } from "./archive-product-price.operation";
import { readOwnerProductPriceOperation } from "./read-owner-product-price.operation";
import { saveProductPriceOperation } from "./save-product-price.operation";
import { saveProductSalesStateOperation } from "./save-product-sales-state.operation";

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

const productSalesStatesQuerySchema = z.strictObject({
  productId: z.uuid().optional(),
});

/**
 * Публичные состояния продажи для владельца без общего кеша: все страницы каталога или, с
 * `?productId=`, запись одного продукта. Чтение требует сессии, ответ личный и не хранится.
 */
export function handleReadProductSalesStates(
  request: Request,
): Promise<Response> {
  return handleAuthenticatedRead(async () => {
    const query = productSalesStatesQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success) return billingFailureResponse("invalid_request", 400);
    const productId = query.data.productId;
    if (productId === undefined) {
      const result = await loadProductSalesStates();
      return result.kind === "ready"
        ? Response.json({ ok: true, value: result.cohorts })
        : billingFailureResponse("unavailable", 502);
    }
    const result = await loadProductSalesState(productId);
    return result.kind === "ready"
      ? Response.json({
          ok: true,
          value: result.cohort === null ? [] : [result.cohort],
        })
      : billingFailureResponse("unavailable", 502);
  });
}

export function handleSaveProductPrice(request: Request): Promise<Response> {
  return ownerBillingCommand(request, saveProductPriceOperation, (input) => ({
    operation: "productPrices.save",
    operationId: input.operationId,
    ...(input.expectedRevision === undefined
      ? {}
      : { expectedRevision: input.expectedRevision }),
    value: input.value,
  }));
}

export function handleArchiveProductPrice(request: Request): Promise<Response> {
  return ownerBillingCommand(
    request,
    archiveProductPriceOperation,
    (input) => ({
      ...input,
      operation: "productPrices.archive",
    }),
  );
}

export function handleSaveProductSalesState(
  request: Request,
): Promise<Response> {
  return ownerBillingCommand(
    request,
    saveProductSalesStateOperation,
    (input) => ({
      operation: "productSalesState.save",
      operationId: input.operationId,
      ...(input.expectedRevision === undefined
        ? {}
        : { expectedRevision: input.expectedRevision }),
      value: input.value,
    }),
  );
}
