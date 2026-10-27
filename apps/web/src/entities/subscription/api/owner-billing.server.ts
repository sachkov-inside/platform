import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";

import {
  requestManageBilling,
  type ManageBillingCommand,
} from "@/shared/api/backend/index.server";
import {
  handleAuthenticatedRead,
  handleMutationOperation,
} from "@/shared/auth/index.server";

import type { BillingOperation } from "./billing-operation";
import {
  billingFailureCode,
  billingFailureResponse,
  billingInvalidInput,
  executeBillingOperation,
} from "./billing-command.server";
import type {
  BillingFailureCode,
  PriceSnapshot,
} from "../model/billing-contract";
import { ownerPriceCatalogPageSchema } from "../model/owner-price-catalog";

/**
 * Одна владельческая операция billing за маршрут BFF: дискриминатор `operation` ставит сервер, и
 * он не становится общим прокси браузера. Право проверяет Nest (`billing:manage`).
 */
export function ownerBillingCommand<
  Input extends z.ZodType,
  Value extends z.ZodType,
>(
  request: Request,
  operation: BillingOperation<Input, Value>,
  toCommand: (input: z.output<Input>) => ManageBillingCommand,
  options: { readonly bankCommand?: boolean } = {},
): Promise<Response> {
  return handleMutationOperation(request, operation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(operation, command, (input) =>
        requestManageBilling(toCommand(input), accessToken, options),
      ),
  });
}

/**
 * Полный каталог цен продуктов для владельца: все страницы `productPrices.list`, включая снятые с
 * продажи цены. Список ограничен числом продуктов, поэтому читается целиком; выбор продукта
 * ограничивает отрисовку сам.
 */
export function handleOwnerPriceCatalogRead(): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const result = await readOwnerPriceCatalog(accessToken);
    return result.ok
      ? Response.json({ ok: true, value: result.items })
      : billingFailureResponse(result.code, result.status);
  });
}

async function readOwnerPriceCatalog(accessToken: string): Promise<
  | { readonly ok: true; readonly items: readonly PriceSnapshot[] }
  | {
      readonly ok: false;
      readonly code: BillingFailureCode;
      readonly status: number;
    }
> {
  const items: PriceSnapshot[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const result = await requestManageBilling(
      {
        operation: "productPrices.list",
        operationId: randomUUID(),
        limit: 100,
        ...(cursor === undefined ? {} : { cursor }),
      },
      accessToken,
    );
    if (!result.ok)
      return {
        ok: false,
        code: billingFailureCode(result),
        status: result.response.status,
      };
    const parsed = ownerPriceCatalogPageSchema.safeParse(result.body);
    if (!parsed.success) return { ok: false, code: "unavailable", status: 502 };
    items.push(...parsed.data.result.items);
    const nextCursor = parsed.data.result.nextCursor;
    if (nextCursor === null) return { ok: true, items };
    if (seen.has(nextCursor))
      return { ok: false, code: "unavailable", status: 502 };
    seen.add(nextCursor);
    cursor = nextCursor;
  }
}
