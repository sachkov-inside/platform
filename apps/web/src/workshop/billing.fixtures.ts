import type {
  AccessGround,
  BillingQuote,
  ChangeQuote,
  LegalDocument,
  NoticeView,
  OwnPayment,
  PriceSnapshot,
  PurchaseStatus,
  SubscriptionView,
  VerifiedContact,
} from "@/entities/subscription";

const uuid = (value: string) => `00000000-0000-4000-8000-${value.padStart(12, "0")}`;

export const materialsOffer: PriceSnapshot = {
  offer: {
    id: uuid("101"),
    revision: 3,
    name: "Материалы",
    benefits: ["materials"],
    archived: false,
  },
  paymentOption: {
    id: uuid("201"),
    revision: 2,
    offerId: uuid("101"),
    mode: "subscription",
    months: 1,
    priceKopecks: 100_000,
    archived: false,
  },
  promotion: null,
  currency: "RUB",
  timezone: "Europe/Moscow",
  firstPriceKopecks: 100_000,
  renewalPriceKopecks: 100_000,
};

export const supportOffer: PriceSnapshot = {
  offer: {
    id: uuid("102"),
    revision: 4,
    name: "Материалы + сопровождение",
    benefits: ["materials", "support", "community"],
    benefitPeriods: [{ capability: "community", months: null }],
    archived: false,
  },
  paymentOption: {
    id: uuid("202"),
    revision: 5,
    offerId: uuid("102"),
    mode: "subscription",
    months: 1,
    priceKopecks: 350_000,
    archived: false,
  },
  promotion: { id: uuid("301"), revision: 1, name: "Старт", percent: 20 },
  currency: "RUB",
  timezone: "Europe/Moscow",
  firstPriceKopecks: 280_000,
  renewalPriceKopecks: 350_000,
};

/** Отдельное право на одно руководство: срок может пережить период списания. */
export const guideOnlyOffer: PriceSnapshot = {
  offer: {
    id: uuid("103"),
    revision: 1,
    name: "Руководство «Создание Platform Inside»",
    benefits: [`guide:${uuid("f01")}`],
    benefitPeriods: [{ capability: `guide:${uuid("f01")}`, months: null }],
    archived: false,
  },
  paymentOption: {
    id: uuid("203"),
    revision: 1,
    offerId: uuid("103"),
    mode: "subscription",
    months: 1,
    priceKopecks: 250_000,
    archived: false,
  },
  promotion: null,
  currency: "RUB",
  timezone: "Europe/Moscow",
  firstPriceKopecks: 250_000,
  renewalPriceKopecks: 250_000,
};

export const billingOffers: readonly PriceSnapshot[] = [
  materialsOffer,
  supportOffer,
];

export const verifiedContact: VerifiedContact = {
  email: "buyer@example.test",
  revision: 2,
  verifiedAt: "2026-09-01T09:00:00.000Z",
};

export const legalDocuments: readonly LegalDocument[] = [
  {
    kind: "terms",
    documentId: "offer",
    version: "2026-09-01",
    digest: "a".repeat(64),
    url: "https://inside.example.test/legal/offer",
    text: "",
  },
  {
    kind: "recurring",
    documentId: "recurring",
    version: "2026-09-01",
    digest: "b".repeat(64),
    url: "https://inside.example.test/legal/recurring",
    text: "",
  },
  {
    kind: "personal_data",
    documentId: "personal-data",
    version: "2026-09-01",
    digest: "c".repeat(64),
    url: "https://inside.example.test/legal/personal-data",
    text: "",
  },
];

export const savedQuote: BillingQuote = {
  quoteRef: uuid("401"),
  createdAt: "2026-09-10T10:00:00.000Z",
  expiresAt: "2026-09-10T10:15:00.000Z",
  snapshot: supportOffer,
};

export const activeSubscription: SubscriptionView = {
  subscriptionRef: uuid("501"),
  revision: 7,
  state: "active",
  snapshot: {
    offer: supportOffer.offer,
    paymentOption: supportOffer.paymentOption,
    currency: "RUB",
    timezone: "Europe/Moscow",
    renewalPriceKopecks: 350_000,
  },
  periodStartsAt: "2026-09-01T00:00:00.000Z",
  paidUntil: "2026-10-01T00:00:00.000Z",
  periodAmountKopecks: 280_000,
  periodIndex: 1,
  paymentMethod: { methodRef: uuid("601"), revoked: false },
  pendingChange: null,
  pendingMethodChange: null,
  inFlightPayment: null,
};

export const canceledSubscription: SubscriptionView = {
  ...activeSubscription,
  revision: 8,
  state: "canceled",
};

export const subscriptionWithPendingChange: SubscriptionView = {
  ...activeSubscription,
  revision: 9,
  pendingChange: {
    snapshot: materialsOffer,
    acceptedAt: "2026-09-09T12:00:00.000Z",
    changeQuoteRef: uuid("701"),
  },
  inFlightPayment: {
    attemptRef: uuid("801"),
    kind: "renewal",
    state: "unknown",
  },
};

export const billingNotices: readonly NoticeView[] = [
  {
    noticeRef: uuid("901"),
    kind: "payment_succeeded",
    state: "current",
    occurredAt: "2026-09-01T09:05:00.000Z",
    amountKopecks: 280_000,
    dueAt: null,
  },
  {
    noticeRef: uuid("902"),
    kind: "renewal_reminder",
    state: "superseded",
    occurredAt: "2026-09-28T09:00:00.000Z",
    amountKopecks: 350_000,
    dueAt: "2026-10-01T00:00:00.000Z",
  },
];

/** Оплаченная подписка и независимое бессрочное право на руководство живут рядом. */
export const accessGrounds: readonly AccessGround[] = [
  {
    source: "paid",
    capabilities: ["materials", "support", "community"],
    startsAt: "2026-09-01T00:00:00.000Z",
    validUntil: "2026-10-01T00:00:00.000Z",
    active: true,
  },
  {
    source: "manual",
    capabilities: [`guide:${uuid("f01")}`],
    startsAt: "2026-05-01T00:00:00.000Z",
    validUntil: null,
    active: true,
  },
];

export const ownPayments: readonly OwnPayment[] = [
  {
    purchaseRef: uuid("b01"),
    kind: "initial",
    state: "confirmed",
    amountKopecks: 280_000,
    offerName: "Материалы + сопровождение",
    months: 1,
    fiscalization: "confirmed",
    confirmedAt: "2026-09-01T09:05:00.000Z",
    periodEndsAt: "2026-10-01T09:05:00.000Z",
    createdAt: "2026-09-01T09:00:00.000Z",
  },
  {
    purchaseRef: uuid("b02"),
    kind: "renewal",
    state: "failed",
    amountKopecks: 350_000,
    offerName: "Материалы + сопровождение",
    months: 1,
    fiscalization: "not_configured",
    confirmedAt: null,
    periodEndsAt: null,
    createdAt: "2026-10-01T09:00:00.000Z",
  },
];

export const upgradeChangeQuote: ChangeQuote = {
  changeQuoteRef: uuid("a01"),
  baseRevision: 7,
  plan: {
    kind: "upgrade",
    snapshot: supportOffer,
    topUpKopecks: 125_000,
    effectiveAt: "2026-09-10T10:00:00.000Z",
  },
  expiresAt: "2026-09-10T10:15:00.000Z",
};

export const scheduledChangeQuote: ChangeQuote = {
  changeQuoteRef: uuid("a02"),
  baseRevision: 7,
  plan: {
    kind: "scheduled",
    snapshot: materialsOffer,
    nextPriceKopecks: 100_000,
    effectiveAt: "2026-10-01T00:00:00.000Z",
  },
  expiresAt: "2026-09-10T10:15:00.000Z",
};

export const pendingPurchase: PurchaseStatus = {
  purchaseRef: uuid("b01"),
  state: "pending",
  paymentUrl: "https://securepay.example.test/pay/1",
  snapshot: supportOffer,
  access: "awaiting_payment",
  fiscalization: "pending",
  confirmedAt: null,
  periodEndsAt: null,
};

export const confirmedPurchase: PurchaseStatus = {
  ...pendingPurchase,
  state: "confirmed",
  paymentUrl: null,
  access: "ready",
  fiscalization: "confirmed",
  confirmedAt: "2026-09-10T10:05:00.000Z",
  periodEndsAt: "2026-10-10T10:05:00.000Z",
};

export const failedPurchase: PurchaseStatus = {
  ...pendingPurchase,
  state: "failed",
  paymentUrl: null,
  access: "awaiting_payment",
  fiscalization: "not_configured",
};

export const unknownPurchase: PurchaseStatus = {
  ...pendingPurchase,
  state: "unknown",
  paymentUrl: null,
};
