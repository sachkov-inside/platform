import { productCapability } from "@inside/access-capabilities";
import {
  commerceScenario as facts,
  commerceFixtureFacts as preview,
} from "../../../../scenarios/commerce.mjs";
import type { PaymentView } from "@/features/owner-payments/model/payment-contract";
import type {
  PeopleListState,
  PersonRow,
} from "@/_pages/authoring-people/model/people-list";

/** Presentation projection: no backend adapter or production mapper computes its values. */
export const commercePayment: PaymentView = {
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
};
export const commerceIdentity = {
  accountId: preview.buyerAccountId,
  displayName: facts.telegram.displayName,
  username: facts.telegram.username,
  email: preview.buyerEmail,
  contactsState: "complete" as const,
};
export const commercePerson: PersonRow = {
  ...commerceIdentity,
  telegram: "linked",
  registeredAt: preview.createdAt,
  lastActivityAt: preview.createdAt,
  products: [],
};
export const commercePeople: PeopleListState = {
  kind: "ready",
  items: [commercePerson],
  total: 1,
  nextCursor: null,
  nameSearch: "available",
};
