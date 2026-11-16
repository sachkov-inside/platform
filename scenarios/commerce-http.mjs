// @ts-check
import { productCapability } from "@inside/access-capabilities";
import {
  commerceScenario as facts,
  commerceFixtureFacts as preview,
} from "./commerce.mjs";
/** Backend wire projection. The isolated DB seed goes through real domain interfaces instead. */
export function commerceHttpPayments() {
  return {
    operationRef: preview.operationRef,
    result: {
      outcome: "payments",
      items: [
        {
          purchaseRef: preview.purchaseRef,
          accountId: preview.buyerAccountId,
          kind: preview.kind,
          state: facts.paymentState,
          subscriptionRef: null,
          periodIndex: null,
          amountKopecks: facts.priceKopecks,
          environment: preview.environment,
          terminalRef: preview.terminalRef,
          paymentId: preview.paymentId,
          snapshot: {
            product: {
              id: facts.product.id,
              name: facts.product.name,
              priceRevision: preview.priceRevision,
            },
            supportMonths: preview.supportMonths,
            communityPolicy: preview.communityPolicy,
            offer: {
              id: facts.product.id,
              revision: preview.priceRevision,
              name: facts.product.name,
              benefits: [productCapability(facts.product.id)],
              coverage: { productIds: [facts.product.id], materialIds: [] },
              archived: false,
              published: true,
            },
            paymentOption: {
              id: facts.product.id,
              offerId: facts.product.id,
              revision: preview.priceRevision,
              mode: preview.kind,
              months: preview.supportMonths,
              priceKopecks: facts.priceKopecks,
              archived: false,
            },
            promotion: null,
            currency: preview.currency,
            timezone: preview.timezone,
            firstPriceKopecks: facts.priceKopecks,
            renewalPriceKopecks: facts.priceKopecks,
          },
          fiscalization: preview.fiscalization,
          confirmedAt: null,
          periodEndsAt: null,
          createdAt: preview.createdAt,
          updatedAt: preview.createdAt,
          access: preview.access,
          refundedKopecks: preview.refundedKopecks,
          refundableKopecks: preview.refundableKopecks,
        },
      ],
      nextCursor: null,
    },
  };
}
export function commerceHttpPeople() {
  return {
    items: [
      {
        accountId: preview.buyerAccountId,
        displayName: facts.telegram.displayName,
        username: facts.telegram.username,
        email: preview.buyerEmail,
        contactsState: "complete",
        telegram: "linked",
        registeredAt: preview.createdAt,
        lastActivityAt: preview.createdAt,
        products: [],
      },
    ],
    total: 1,
    nextCursor: null,
    nameSearch: "available",
  };
}
