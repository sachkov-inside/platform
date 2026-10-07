import { productCapability } from "@inside/access-capabilities";

import type { CommunityEntry } from "@/features/community-entry";
import type {
  AccessGround,
  BillingFailureCode,
  BillingQuote,
  ChangeQuote,
  CurrentBilling,
  Enrollment,
  LegalDocument,
  NoticeView,
  OwnPayment,
  PriceSnapshot,
  PurchaseStatus,
  SubscriptionView,
  VerifiedContact,
} from "@/entities/subscription";

const uuid = (value: string) =>
  `00000000-0000-4000-8000-${value.padStart(12, "0")}`;

export const materialsOffer: PriceSnapshot = {
  offer: {
    id: uuid("101"),
    revision: 3,
    name: "Материалы",
    benefits: ["materials"],
    archived: false,
    published: true,
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
    published: true,
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

/** Руководство, которому владелец завёл цену: покупается один раз, право выдаётся без даты окончания. */
export const productOnlyOffer: PriceSnapshot = {
  offer: {
    id: uuid("103"),
    revision: 1,
    name: "Руководство «Создание Platform Inside»",
    benefits: [productCapability(uuid("f01"))],
    benefitPeriods: [
      { capability: productCapability(uuid("f01")), months: null },
    ],
    archived: false,
    published: false,
  },
  paymentOption: {
    id: uuid("203"),
    revision: 1,
    offerId: uuid("103"),
    mode: "one_time",
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

/** Второй разовый вариант того же руководства: он и даёт странице оплаты выбор. */
export const productWithSupportOffer: PriceSnapshot = {
  offer: {
    id: uuid("104"),
    revision: 1,
    name: "Руководство «Создание Platform Inside» с сопровождением",
    benefits: [productCapability(uuid("f01")), "support"],
    benefitPeriods: [
      { capability: productCapability(uuid("f01")), months: null },
      { capability: "support", months: 3 },
    ],
    archived: false,
    published: false,
  },
  paymentOption: {
    id: uuid("204"),
    revision: 1,
    offerId: uuid("104"),
    mode: "one_time",
    months: 1,
    priceKopecks: 490_000,
    archived: false,
  },
  promotion: null,
  currency: "RUB",
  timezone: "Europe/Moscow",
  firstPriceKopecks: 490_000,
  renewalPriceKopecks: 490_000,
};

/**
 * То же руководство с названными сроками: материалы и чат на 2 года, сопровождение на год. По
 * нему видно, что оплата называет сроки предложения, а не одни и те же числа.
 */
export const fixedTermProductOffer: PriceSnapshot = {
  ...productWithSupportOffer,
  offer: {
    ...productWithSupportOffer.offer,
    id: uuid("105"),
    name: "Руководство «Создание Platform Inside» на два года",
    benefitPeriods: [
      { capability: productCapability(uuid("f01")), months: 24 },
      { capability: "support", months: 12 },
    ],
  },
  paymentOption: {
    ...productWithSupportOffer.paymentOption,
    id: uuid("205"),
    offerId: uuid("105"),
  },
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
    appliesTo: ["subscription"],
    documentId: "subscription",
    version: "1",
    digest: "a".repeat(64),
    url: "https://inside.example.test/legal/subscription",
    text: "",
  },
  {
    kind: "terms",
    appliesTo: ["one_time"],
    documentId: "purchase",
    version: "5",
    digest: "d".repeat(64),
    url: "https://inside.example.test/legal/purchase/v5",
    text: "",
  },
  {
    kind: "recurring",
    appliesTo: ["subscription"],
    documentId: "recurring-consent",
    version: "1",
    digest: "b".repeat(64),
    url: "https://inside.example.test/legal/recurring-consent",
    text: "",
  },
  {
    kind: "personal_data",
    appliesTo: ["one_time", "subscription"],
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

/** Расчёт разовой покупки руководства: того же вида, но без следующего периода. */
export const productQuote: BillingQuote = {
  quoteRef: uuid("402"),
  createdAt: "2026-09-10T10:00:00.000Z",
  expiresAt: "2026-09-10T10:15:00.000Z",
  snapshot: productOnlyOffer,
};

/** Расчёт покупки с сопровождением: сводка условий читает сроки из его снимка. */
export const productWithSupportQuote: BillingQuote = {
  ...productQuote,
  quoteRef: uuid("403"),
  snapshot: productWithSupportOffer,
};

export const fixedTermProductQuote: BillingQuote = {
  ...productQuote,
  quoteRef: uuid("404"),
  snapshot: fixedTermProductOffer,
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

/** Ответ собственного BFF о состоянии billing: конверт принадлежит фикстурам, а не сторис. */
export function currentBillingResponse(
  subscription: SubscriptionView | null,
  {
    grounds = [],
    notices = [],
    payments = [],
  }: {
    readonly grounds?: readonly AccessGround[];
    readonly notices?: readonly NoticeView[];
    readonly payments?: readonly OwnPayment[];
  } = {},
): Response {
  const value: CurrentBilling = {
    subscription,
    notices: [...notices],
    grounds: [...grounds],
    payments: [...payments],
  };
  return Response.json({ ok: true, value });
}

/** Отказ собственного billing BFF тем же конвертом, что и успех. */
export function billingFailureResponse(code: BillingFailureCode): Response {
  return Response.json(
    { ok: false, code },
    { status: code === "unauthorized" ? 401 : 503 },
  );
}

/** Назначение тарифа за курс: раздел «Подписка» показывает его в «Ваших тарифах». */
export const courseEnrollment: Enrollment = {
  id: uuid("c01"),
  accountId: uuid("c02"),
  origin: "course",
  startsAt: "2026-09-14T10:00:00.000Z",
  endsAt: null,
  endPolicy: "fixed",
  revision: 1,
  state: "active",
  renewal: "not_applicable",
  nextChargeAt: null,
  tier: {
    id: uuid("c03"),
    revision: 1,
    name: "Подписка Inside",
    benefits: ["materials", "community"],
    coverage: { productIds: [uuid("f01")], materialIds: [] },
  },
  content: [
    {
      kind: "product",
      id: uuid("f01"),
      title: "Создание Platform Inside",
      slug: "platform-inside",
      available: true,
    },
  ],
};

export function enrollmentsResponse(items: readonly Enrollment[]): Response {
  return Response.json({ ok: true, value: { items } });
}

/** Проверка права на сообщество, которую раздел «Подписка» показывает над тарифами. */
export function communityAdmissionResponse(
  state: "checking" | "no_access" | "moderation_blocked" | "ready",
): Response {
  return Response.json({
    ok: true,
    value: { admissionRestriction: null, state },
  });
}

/** Переход в сообщество рядом с покупками: состояние выбирает сервер. */
export function communityEntryResponse(entry: CommunityEntry): Response {
  return Response.json({ ok: true, value: entry });
}

/** Подтверждённый контакт для чеков и действующие редакции документов покупки. */
export function billingContactResponse(
  contact: VerifiedContact | null = verifiedContact,
): Response {
  return Response.json({ ok: true, contact, documents: legalDocuments });
}

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

/** Оплаченный доступ и независимое право на руководство без даты окончания живут рядом. */
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
    capabilities: [productCapability(uuid("f01"))],
    startsAt: "2026-05-01T00:00:00.000Z",
    validUntil: null,
    active: true,
  },
  {
    // Купленное руководство переживает подписку и не зависит от того, включена ли она.
    source: "paid",
    capabilities: [productCapability(uuid("f02"))],
    startsAt: "2026-08-20T12:00:00.000Z",
    validUntil: null,
    active: true,
  },
];

export const ownPayments: readonly OwnPayment[] = [
  {
    purchaseRef: uuid("b03"),
    kind: "one_time",
    state: "confirmed",
    amountKopecks: 250_000,
    offerName: "Руководство «Создание Platform Inside»",
    months: 1,
    fiscalization: "confirmed",
    confirmedAt: "2026-08-20T12:00:00.000Z",
    // У разовой покупки оплаченного срока нет: право живёт своим сроком.
    periodEndsAt: null,
    createdAt: "2026-08-20T11:58:00.000Z",
    refundedKopecks: 0,
    refundedAt: null,
  },
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
    refundedKopecks: 0,
    refundedAt: null,
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
    refundedKopecks: 0,
    refundedAt: null,
  },
];

/** Разовая покупка, по которой банк подтвердил полный возврат: доступ снят, в истории видна сумма. */
export const refundedOwnPayments: readonly OwnPayment[] = ownPayments.map(
  (payment) =>
    payment.kind === "one_time"
      ? {
          ...payment,
          refundedKopecks: payment.amountKopecks,
          refundedAt: "2026-08-25T10:00:00.000Z",
        }
      : payment,
);

export const refundNotices: readonly NoticeView[] = [
  {
    noticeRef: uuid("903"),
    kind: "refund_resolved",
    state: "current",
    occurredAt: "2026-08-25T10:00:00.000Z",
    amountKopecks: 250_000,
    dueAt: null,
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

/** Оплаченное руководство: доступ открыт, оплаченного срока у покупки нет. */
export const confirmedProductPurchase: PurchaseStatus = {
  purchaseRef: uuid("b03"),
  state: "confirmed",
  paymentUrl: null,
  snapshot: productOnlyOffer,
  access: "ready",
  fiscalization: "confirmed",
  confirmedAt: "2026-08-20T12:00:00.000Z",
  periodEndsAt: null,
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
