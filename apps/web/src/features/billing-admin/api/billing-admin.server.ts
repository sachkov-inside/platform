import "server-only";
import {
  readBillingPaymentOperation,
  applyAccessGrantBatchOperation,
  archiveBillingOfferOperation,
  archiveBillingPaymentOptionOperation,
  archiveBillingPromotionOperation,
  cancelOwnerSubscriptionOperation,
  classifyAccountOperation,
  extendAccessGrantOperation,
  listBillingPaymentsOperation,
  previewAccessGrantBatchOperation,
  publishBillingOfferOperation,
  readAccessGrantsOperation,
  readAccountClassificationOperation,
  readBillingRefundsOperation,
  reconcileBillingPaymentOperation,
  revokeAccessGrantOperation,
  saveBillingCohortOperation,
  saveBillingOfferOperation,
  saveBillingPaymentOptionOperation,
  saveBillingPromotionOperation,
  unpublishBillingOfferOperation,
  decideBillingRefundOperation,
  executeBillingRefundOperation,
} from "./billing-admin.operation";
import { randomUUID } from "node:crypto";
import type { z } from "zod";

import type { MutationOperation } from "@/shared/api/mutation-operation";

import {
  billingFailureCode,
  billingFailureResponse,
  billingInvalidInput,
  executeBillingOperation,
} from "@/entities/subscription.server";
import type {
  BillingFailureCode,
  BillingOperationResult,
  PriceSnapshot,
} from "@/entities/subscription";
import {
  requestManageBilling,
  type ManageBillingCommand,
} from "@/shared/api/backend/index.server";
import {
  readAuthenticatedSession,
  handleAuthenticatedRead,
  handleMutationOperation,
} from "@/shared/auth/index.server";

import {
  catalogOffersOutcomeSchema,
  catalogOutcomeSchema,
  classificationOutcomeSchema,
  grantBatchOutcomeSchema,
  grantOutcomeSchema,
  grantPreviewOutcomeSchema,
  grantsOutcomeSchema,
  paymentOutcomeSchema,
  paymentsOutcomeSchema,
  reconciledOutcomeSchema,
  refundsOutcomeSchema,
  subscriptionOutcomeSchema,
} from "../model/admin-operations";

/** Одна владельческая операция за маршрут: дискриминатор не становится общим прокси браузера. */
export function ownerCommand<Input extends z.ZodType>(
  request: Request,
  operation: MutationOperation<Input, BillingOperationResult>,
  valueSchema: z.ZodType,
  toCommand: (input: z.output<Input>) => ManageBillingCommand,
  options: { readonly bankCommand?: boolean } = {},
): Promise<Response> {
  return handleMutationOperation(request, operation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(command, valueSchema, (input) =>
        requestManageBilling(toCommand(input), accessToken, options),
      ),
  });
}

export function handleSaveOffer(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    saveBillingOfferOperation,
    catalogOutcomeSchema,
    (input) => ({
      operation: "offers.save",
      operationId: input.operationId,
      ...(input.expectedRevision === undefined
        ? {}
        : { expectedRevision: input.expectedRevision }),
      value: {
        id: input.value.id,
        name: input.value.name,
        benefits: [...input.value.benefits],
        ...(input.value.availableForAssignment === undefined
          ? {}
          : { availableForAssignment: input.value.availableForAssignment }),
        ...(input.value.coverage === undefined
          ? {}
          : { coverage: input.value.coverage }),
        ...(input.value.eligibility === undefined
          ? {}
          : { eligibility: input.value.eligibility }),
        ...(input.value.benefitPeriods === undefined
          ? {}
          : { benefitPeriods: [...input.value.benefitPeriods] }),
      },
    }),
  );
}

export function handleArchiveOffer(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    archiveBillingOfferOperation,
    catalogOutcomeSchema,
    (input) => ({ ...input, operation: "offers.archive" }),
  );
}

export function handlePublishOffer(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    publishBillingOfferOperation,
    catalogOutcomeSchema,
    (input) => ({ ...input, operation: "offers.publish" }),
  );
}

export function handleUnpublishOffer(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    unpublishBillingOfferOperation,
    catalogOutcomeSchema,
    (input) => ({ ...input, operation: "offers.unpublish" }),
  );
}

export function handleSavePaymentOption(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    saveBillingPaymentOptionOperation,
    catalogOutcomeSchema,
    (input) => ({
      operation: "paymentOptions.save",
      operationId: input.operationId,
      ...(input.expectedRevision === undefined
        ? {}
        : { expectedRevision: input.expectedRevision }),
      value: {
        id: input.value.id,
        offerId: input.value.offerId,
        months: input.value.months,
        priceKopecks: input.value.priceKopecks,
        ...(input.value.mode === undefined ? {} : { mode: input.value.mode }),
      },
    }),
  );
}

export function handleArchivePaymentOption(
  request: Request,
): Promise<Response> {
  return ownerCommand(
    request,
    archiveBillingPaymentOptionOperation,
    catalogOutcomeSchema,
    (input) => ({ ...input, operation: "paymentOptions.archive" }),
  );
}

export function handleSavePromotion(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    saveBillingPromotionOperation,
    catalogOutcomeSchema,
    (input) => ({
      operation: "promotions.save",
      operationId: input.operationId,
      ...(input.expectedRevision === undefined
        ? {}
        : { expectedRevision: input.expectedRevision }),
      value: {
        ...input.value,
        offerIds: [...input.value.offerIds],
        paymentOptionIds: [...input.value.paymentOptionIds],
      },
    }),
  );
}

/** Поток продукта: запись каталога, которую страница курса читает без кеша. */
export function handleSaveCohort(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    saveBillingCohortOperation,
    catalogOutcomeSchema,
    (input) => ({
      operation: "cohorts.save",
      operationId: input.operationId,
      ...(input.expectedRevision === undefined
        ? {}
        : { expectedRevision: input.expectedRevision }),
      value: input.value,
    }),
  );
}

export function handleArchivePromotion(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    archiveBillingPromotionOperation,
    catalogOutcomeSchema,
    (input) => ({ ...input, operation: "promotions.archive" }),
  );
}

export function handleListPayments(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    listBillingPaymentsOperation,
    paymentsOutcomeSchema,
    (input) => ({
      operation: "payments.list",
      operationId: input.operationId,
      limit: input.limit,
      ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
      ...(input.state === undefined ? {} : { state: input.state }),
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    }),
  );
}

export function handleReadPayment(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    readBillingPaymentOperation,
    paymentOutcomeSchema,
    (input) => ({
      operation: "payments.read",
      operationId: input.operationId,
      purchaseRef: input.purchaseRef,
      ...(input.auditCursor === undefined
        ? {}
        : { auditCursor: input.auditCursor }),
    }),
  );
}

export function handleReconcilePayment(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    reconcileBillingPaymentOperation,
    reconciledOutcomeSchema,
    (input) => ({ ...input, operation: "payments.reconcile" }),
    { bankCommand: true },
  );
}

export function handleCancelOwnerSubscription(
  request: Request,
): Promise<Response> {
  return ownerCommand(
    request,
    cancelOwnerSubscriptionOperation,
    subscriptionOutcomeSchema,
    (input) => ({ ...input, operation: "subscriptions.cancel" }),
  );
}

/** Исторические маршруты сохраняют проверку сессии и Origin, но больше не обращаются к backend. */
function disabledRefund<Input extends z.ZodType>(
  request: Request,
  operation: MutationOperation<Input, BillingOperationResult>,
): Promise<Response> {
  return handleMutationOperation(request, operation, {
    invalidInput: billingInvalidInput,
    execute: () =>
      Promise.resolve({ ok: false, code: "method_unavailable" } as const),
  });
}

export function handleDecideRefund(request: Request): Promise<Response> {
  return disabledRefund(request, decideBillingRefundOperation);
}

export function handleExecuteRefund(request: Request): Promise<Response> {
  return disabledRefund(request, executeBillingRefundOperation);
}

export function handleReadRefunds(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    readBillingRefundsOperation,
    refundsOutcomeSchema,
    (input) => ({ ...input, operation: "refunds.read" }),
  );
}

export function handleReadGrants(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    readAccessGrantsOperation,
    grantsOutcomeSchema,
    (input) => ({ ...input, operation: "grants.read" }),
  );
}

export function handleReadAccountClassification(
  request: Request,
): Promise<Response> {
  return ownerCommand(
    request,
    readAccountClassificationOperation,
    classificationOutcomeSchema,
    (input) => ({ ...input, operation: "grants.readClassification" }),
  );
}

export function handleClassifyAccount(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    classifyAccountOperation,
    classificationOutcomeSchema,
    (input) => ({ ...input, operation: "grants.classify" }),
  );
}

export function handlePreviewGrantBatch(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    previewAccessGrantBatchOperation,
    grantPreviewOutcomeSchema,
    (input) => ({
      operation: "grants.previewBatch",
      // Строка выдачи несёт условия права, строка классификации — решение о покупателе.
      rows: input.rows.map((row) =>
        "terms" in row
          ? {
              ...row,
              terms: {
                ...row.terms,
                capabilities: [...row.terms.capabilities],
              },
            }
          : { ...row },
      ),
      operationId: input.operationId,
    }),
  );
}

export function handleApplyGrantBatch(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    applyAccessGrantBatchOperation,
    grantBatchOutcomeSchema,
    (input) => ({
      operation: "grants.applyBatch",
      operationId: input.operationId,
      previewRef: input.previewRef,
      expectedRevision: input.expectedRevision,
      confirmedRows: [...input.confirmedRows],
    }),
  );
}

export function handleExtendGrant(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    extendAccessGrantOperation,
    grantOutcomeSchema,
    (input) => ({ ...input, operation: "grants.extend" }),
  );
}

export function handleRevokeGrant(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    revokeAccessGrantOperation,
    grantOutcomeSchema,
    (input) => ({ ...input, operation: "grants.revoke" }),
  );
}

/**
 * Владельческий каталог для серверного рендера `/authoring/billing`: он видит и выключенные
 * из продажи предложения, поэтому не может опираться на публичную витрину.
 */
export async function loadBillingOffersForOwner(): Promise<
  readonly PriceSnapshot[]
> {
  const session = await readAuthenticatedSession("rsc");
  if (session.kind !== "ready") return [];
  const result = await readOwnerCatalog(session.value);
  if (!result.ok) throw new Error("Owner billing catalog unavailable");
  return result.items;
}

export function handleOwnerCatalogRead(): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const result = await readOwnerCatalog(accessToken);
    return result.ok
      ? Response.json({ ok: true, value: result.items })
      : billingFailureResponse(result.code, result.status);
  });
}

async function readOwnerCatalog(accessToken: string): Promise<
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
        operation: "offers.list",
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
    const parsed = catalogOffersOutcomeSchema.safeParse(result.body);
    if (!parsed.success)
      throw new Error("Owner billing catalog response invalid");
    items.push(...parsed.data.result.items);
    const nextCursor = parsed.data.result.nextCursor;
    if (nextCursor === null) return { ok: true, items };
    if (seen.has(nextCursor))
      throw new Error("Owner billing catalog continuation invalid");
    seen.add(nextCursor);
    cursor = nextCursor;
  }
}
