import "server-only";

import { randomUUID } from "node:crypto";

import type { z } from "zod";

import {
  billingFailureCode,
  billingFailureResponse,
  privateBillingHeaders,
} from "@/entities/subscription.server";
import {
  requestManageBilling,
  type BackendTransportResult,
  type ManageBillingCommand,
} from "@/shared/api/backend/index.server";
import { handleAuthenticatedRead } from "@/shared/auth/index.server";

import {
  contentOutcomeSchema,
  paymentOutcomeSchema,
  paymentsOutcomeSchema,
  type PaymentPage,
  type PaymentProduct,
  type PaymentsPage,
} from "../model/payment-contract";
import { parsePaymentsListRequest } from "../model/payment-filters";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const sequencePattern = /^[1-9][0-9]{0,18}$/u;

/**
 * Одно чтение владельца billing: тело backend проверяется схемой операции и сводится к виду, который
 * нужен странице. Отказ сохраняет код и статус backend: другая роль получает отказ, а не пустой список.
 */
async function ownerRead<Schema extends z.ZodType>(
  accessToken: string,
  command: ManageBillingCommand,
  schema: Schema,
  toValue: (body: z.output<Schema>) => unknown,
): Promise<Response> {
  let result: BackendTransportResult;
  try {
    result = await requestManageBilling(command, accessToken);
  } catch {
    return billingFailureResponse("unavailable", 503);
  }
  if (!result.ok)
    return billingFailureResponse(
      billingFailureCode(result),
      result.response.status,
    );
  const parsed = schema.safeParse(result.body);
  return parsed.success
    ? Response.json(
        { ok: true, value: toValue(parsed.data) },
        { headers: privateBillingHeaders },
      )
    : billingFailureResponse("unavailable", 502);
}

/** `GET /api/authoring/billing/owner-payments`: страница списка платежей по фильтрам адреса. */
export function handleOwnerPaymentsRequest(
  request: Request,
): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const input = parsePaymentsListRequest(new URL(request.url).searchParams);
    if (input === null) return billingFailureResponse("invalid_request", 400);
    // Поля фильтра уходят в backend как есть: правила отбора и курсора принадлежат billing.
    const { states, ...filters } = input;
    const command: ManageBillingCommand = {
      operation: "payments.list",
      operationId: randomUUID(),
      ...filters,
      ...(states === undefined ? {} : { states: [...states] }),
    };
    return ownerRead(
      accessToken,
      command,
      paymentsOutcomeSchema,
      (body): PaymentsPage => ({
        items: body.result.items,
        nextCursor: body.result.nextCursor,
      }),
    );
  });
}

/**
 * `GET /api/authoring/billing/owner-payments/products`: продукты для фильтра по названию. Тот же
 * владелец и то же право, что у самих платежей, поэтому фильтр не требует прав на материалы.
 */
export function handleOwnerPaymentProductsRequest(): Promise<Response> {
  return handleAuthenticatedRead((accessToken) =>
    ownerRead(
      accessToken,
      { operation: "content.list", operationId: randomUUID() },
      contentOutcomeSchema,
      (body): PaymentProduct[] =>
        body.result.items
          .filter((item) => item.kind === "product" && item.title.trim() !== "")
          .map((item) => ({ id: item.id, name: item.title.trim() }))
          .toSorted((left, right) => left.name.localeCompare(right.name, "ru")),
    ),
  );
}

/**
 * `GET /api/authoring/billing/owner-payments/:purchaseRef?auditAfter=`: платёж и одна страница
 * журнала операций. Продолжение журнала привязано к тому же платежу.
 */
export function handleOwnerPaymentRequest(
  request: Request,
  purchaseRef: string,
): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const auditAfter = new URL(request.url).searchParams.get("auditAfter");
    if (
      !uuidPattern.test(purchaseRef) ||
      (auditAfter !== null && !sequencePattern.test(auditAfter))
    )
      return billingFailureResponse("invalid_request", 400);
    const ref = purchaseRef.toLowerCase();
    return ownerRead(
      accessToken,
      {
        operation: "payments.read",
        operationId: randomUUID(),
        purchaseRef: ref,
        ...(auditAfter === null
          ? {}
          : { auditCursor: { purchaseRef: ref, afterSequence: auditAfter } }),
      },
      paymentOutcomeSchema,
      (body): PaymentPage => ({
        value: body.result.value,
        events: body.result.events,
        decisions: body.result.decisions,
        audit: body.result.audit,
        nextAuditAfter: body.result.nextAuditCursor?.afterSequence ?? null,
      }),
    );
  });
}
