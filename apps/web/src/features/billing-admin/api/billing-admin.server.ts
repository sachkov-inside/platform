import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";

import { executeBillingCommand } from "@/entities/subscription.server";
import type { PriceSnapshot } from "@/entities/subscription";
import {
  requestManageBilling,
  type ManageBillingCommand,
} from "@/shared/api/backend/index.server";
import {
  getPlatformAccessToken,
  handleAuthenticatedMutation,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import {
  applyBatchInputSchema,
  archiveInputSchema,
  cancelSubscriptionInputSchema,
  catalogOffersOutcomeSchema,
  catalogOutcomeSchema,
  decideRefundInputSchema,
  executeRefundInputSchema,
  extendGrantInputSchema,
  grantBatchOutcomeSchema,
  grantOutcomeSchema,
  grantPreviewOutcomeSchema,
  grantsOutcomeSchema,
  listPaymentsInputSchema,
  paymentOutcomeSchema,
  paymentsOutcomeSchema,
  previewBatchInputSchema,
  purchaseInputSchema,
  readGrantsInputSchema,
  reconciledOutcomeSchema,
  refundDecisionOutcomeSchema,
  refundsOutcomeSchema,
  revokeGrantInputSchema,
  savePaymentOptionInputSchema,
  saveOfferInputSchema,
  savePromotionInputSchema,
  subscriptionOutcomeSchema,
} from "../model/admin-operations";

/** Одна владельческая операция за маршрут: дискриминатор не становится общим прокси браузера. */
function ownerCommand<Input extends z.ZodType>(
  request: Request,
  inputSchema: Input,
  valueSchema: z.ZodType,
  toCommand: (input: z.infer<Input>) => ManageBillingCommand,
  options: { readonly bankCommand?: boolean } = {},
): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, accessToken) =>
    executeBillingCommand(form, inputSchema, valueSchema, (input) =>
      requestManageBilling(toCommand(input), accessToken, options),
    ),
  );
}

export function handleSaveOffer(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    saveOfferInputSchema,
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
    archiveInputSchema,
    catalogOutcomeSchema,
    (input) => ({ ...input, operation: "offers.archive" }),
  );
}

export function handlePublishOffer(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    archiveInputSchema,
    catalogOutcomeSchema,
    (input) => ({ ...input, operation: "offers.publish" }),
  );
}

export function handleUnpublishOffer(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    archiveInputSchema,
    catalogOutcomeSchema,
    (input) => ({ ...input, operation: "offers.unpublish" }),
  );
}

export function handleSavePaymentOption(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    savePaymentOptionInputSchema,
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

export function handleArchivePaymentOption(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    archiveInputSchema,
    catalogOutcomeSchema,
    (input) => ({ ...input, operation: "paymentOptions.archive" }),
  );
}

export function handleSavePromotion(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    savePromotionInputSchema,
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

export function handleArchivePromotion(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    archiveInputSchema,
    catalogOutcomeSchema,
    (input) => ({ ...input, operation: "promotions.archive" }),
  );
}

export function handleListPayments(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    listPaymentsInputSchema,
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
    purchaseInputSchema,
    paymentOutcomeSchema,
    (input) => ({ ...input, operation: "payments.read" }),
  );
}

export function handleReconcilePayment(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    purchaseInputSchema,
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
    cancelSubscriptionInputSchema,
    subscriptionOutcomeSchema,
    (input) => ({ ...input, operation: "subscriptions.cancel" }),
  );
}

export function handleDecideRefund(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    decideRefundInputSchema,
    refundDecisionOutcomeSchema,
    (input) => ({ ...input, operation: "refunds.decide" }),
  );
}

export function handleExecuteRefund(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    executeRefundInputSchema,
    refundDecisionOutcomeSchema,
    (input) => ({ ...input, operation: "refunds.execute" }),
    { bankCommand: true },
  );
}

export function handleReadRefunds(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    purchaseInputSchema,
    refundsOutcomeSchema,
    (input) => ({ ...input, operation: "refunds.read" }),
  );
}

export function handleReadGrants(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    readGrantsInputSchema,
    grantsOutcomeSchema,
    (input) => ({ ...input, operation: "grants.read" }),
  );
}

export function handlePreviewGrantBatch(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    previewBatchInputSchema,
    grantPreviewOutcomeSchema,
    (input) => ({
      operation: "grants.previewBatch",
      operationId: input.operationId,
      rows: input.rows.map((row) => ({
        ...row,
        terms: {
          ...row.terms,
          capabilities: [...row.terms.capabilities],
        },
      })),
    }),
  );
}

export function handleApplyGrantBatch(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    applyBatchInputSchema,
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
    extendGrantInputSchema,
    grantOutcomeSchema,
    (input) => ({ ...input, operation: "grants.extend" }),
  );
}

export function handleRevokeGrant(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    revokeGrantInputSchema,
    grantOutcomeSchema,
    (input) => ({ ...input, operation: "grants.revoke" }),
  );
}

/**
 * Владельческий каталог для серверного рендера `/authoring/billing`: он видит и выключенные
 * из продажи предложения, поэтому не может опираться на публичную витрину.
 */
export async function loadBillingOffersForOwner(): Promise<readonly PriceSnapshot[]> {
  try {
    const accessToken = await getPlatformAccessToken(readLogtoBffConfig());
    const result = await requestManageBilling(
      { operation: "offers.list", operationId: randomUUID(), limit: 100 },
      accessToken,
    );
    if (!result.ok) return [];
    const parsed = catalogOffersOutcomeSchema.safeParse(result.body);
    if (!parsed.success || parsed.data.result.outcome !== "catalogOffers") return [];
    return parsed.data.result.items;
  } catch {
    return [];
  }
}
