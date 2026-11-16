import { productCapability } from "@inside/access-capabilities";
import {
  commerceScenario as facts,
  commerceFixtureFacts as preview,
} from "../../../../scenarios/commerce.mjs";
import { paymentsPageSchema } from "@/features/owner-payments/model/payment-contract";
import { peopleListStateSchema } from "@/_pages/authoring-people/model/people-list";
import { waitlistReadSchema } from "@/features/product-waitlist/model/product-waitlist-response";

/** BFF projection is independently checked at the actual browser contracts. */
export function commerceInterceptionPayments() {
  return {
    ok: true,
    value: paymentsPageSchema.parse({
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
    }),
  };
}
export function commerceInterceptionPeople() {
  return peopleListStateSchema.parse({
    kind: "ready",
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
  });
}
export function commerceInterceptionWaitlist() {
  return waitlistReadSchema.parse({
    kind: "ready",
    accountId: preview.buyerAccountId,
    intakeId: facts.waitlist.intakeId,
    name: facts.waitlist.name,
    active: true,
    continuation: false,
  });
}
