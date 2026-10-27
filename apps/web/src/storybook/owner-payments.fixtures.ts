import type { PriceSnapshot } from "@/entities/subscription";
import type {
  PaymentPage,
  PaymentProduct,
  PaymentView,
} from "@/features/owner-payments/model/payment-contract";

/** Детерминированные платежи владельца (#1718): без случайности и текущих часов. */

function uuid(group: string, index: number): string {
  return `${group}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export const paymentProducts: readonly PaymentProduct[] = [
  { id: uuid("71000000", 1), name: "AI Engineering: от промпта до продакшна" },
  { id: uuid("71000000", 2), name: "Разработка с агентами" },
  { id: uuid("71000000", 3), name: "Архитектура и проектирование систем" },
  { id: uuid("71000000", 4), name: "Тестирование через поведение" },
  { id: uuid("71000000", 5), name: "Код-ревью с агентом: практикум" },
];

function snapshot(
  product: PaymentProduct,
  priceKopecks: number,
): PriceSnapshot {
  return {
    product: { id: product.id, name: product.name, priceRevision: 3 },
    offer: {
      id: uuid("71000000", 101),
      revision: 1,
      name: product.name,
      benefits: ["materials"],
      archived: false,
      published: true,
    },
    paymentOption: {
      id: uuid("71000000", 201),
      revision: 1,
      offerId: uuid("71000000", 101),
      mode: "one_time",
      months: 12,
      priceKopecks,
      archived: false,
    },
    promotion: null,
    currency: "RUB",
    timezone: "Europe/Moscow",
    firstPriceKopecks: priceKopecks,
    renewalPriceKopecks: priceKopecks,
  };
}

const states = [
  "confirmed",
  "confirmed",
  "pending",
  "unknown",
  "failed",
  "confirmed",
  "authorized",
  "sent",
] as const;
const accesses = ["ready", "preparing", "review_required"] as const;
const prices = [1_990_000, 4_990_000, 990_000, 2_490_000] as const;

/** Платёж номер `index`: состояние, продукт и сумма меняются по кругу. */
export function ownerPayment(
  index: number,
  overrides: Partial<PaymentView> = {},
): PaymentView {
  const state = states[index % states.length] ?? "confirmed";
  const product =
    paymentProducts[index % paymentProducts.length] ?? paymentProducts[0];
  if (product === undefined) throw new Error("No fixture product");
  const amountKopecks = prices[index % prices.length] ?? 990_000;
  const createdAt = new Date(
    Date.UTC(2026, 9, 24, 11, 5) - index * 5 * 3_600_000,
  ).toISOString();
  return {
    purchaseRef: uuid("72000000", index + 1),
    accountId: `${String(3 + (index % 6)).repeat(8)}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    kind: "one_time",
    state,
    subscriptionRef: null,
    periodIndex: null,
    amountKopecks,
    environment: "production",
    terminalRef: "1700000000001",
    paymentId: String(7_100_000_000 + index),
    snapshot: snapshot(product, amountKopecks),
    fiscalization: state === "confirmed" ? "confirmed" : "pending",
    confirmedAt: state === "confirmed" ? createdAt : null,
    periodEndsAt: null,
    createdAt,
    updatedAt: createdAt,
    access:
      state === "confirmed"
        ? (accesses[index % accesses.length] ?? "ready")
        : "awaiting_payment",
    refundedKopecks: 0,
    refundableKopecks: state === "confirmed" ? amountKopecks : 0,
    ...overrides,
  };
}

export function ownerPayments(count: number): PaymentView[] {
  return Array.from({ length: count }, (_, index) => ownerPayment(index));
}

/** Оплаченный платёж с частичным возвратом, событиями банка и журналом владельца. */
export const refundedPaymentPage: PaymentPage = {
  value: ownerPayment(0, {
    refundedKopecks: 500_000,
    refundableKopecks: 1_490_000,
  }),
  events: [
    {
      kind: "payment_confirmed",
      occurredAt: "2026-10-24T11:06:00.000Z",
      recordedAt: "2026-10-24T11:06:01.000Z",
    },
    {
      kind: "fiscalization_confirmed",
      occurredAt: "2026-10-24T11:07:00.000Z",
      recordedAt: "2026-10-24T11:07:02.000Z",
    },
    {
      kind: `partial_refund_observed:${"b".repeat(64)}`,
      occurredAt: "2026-10-25T08:30:00.000Z",
      recordedAt: "2026-10-25T08:30:01.000Z",
    },
  ],
  decisions: [
    {
      decisionRef: uuid("73000000", 1),
      purchaseRef: uuid("72000000", 1),
      accountId: ownerPayment(0).accountId,
      actorId: uuid("74000000", 1),
      amountKopecks: 500_000,
      basis: "compensation",
      access: "keep",
      recurring: "keep",
      reason:
        "Покупатель не смог попасть на два созвона потока из-за переноса расписания.",
      state: "executed",
      revision: 2,
      createdAt: "2026-10-25T08:00:00.000Z",
      updatedAt: "2026-10-25T08:31:00.000Z",
      attempt: {
        refundRef: uuid("75000000", 1),
        state: "confirmed",
        amountKopecks: 500_000,
        observedStatus: "PARTIAL_REFUNDED",
        errorCode: "0",
        updatedAt: "2026-10-25T08:31:00.000Z",
      },
    },
  ],
  audit: [
    {
      actorId: uuid("74000000", 1),
      operationId: uuid("76000000", 1),
      operation: "refunds.decide",
      reason: "Компенсация за перенесённые созвоны",
      createdAt: "2026-10-25T08:00:00.000Z",
    },
    {
      actorId: uuid("74000000", 1),
      operationId: uuid("76000000", 2),
      operation: "payments.reconcile",
      reason: "",
      createdAt: "2026-10-25T09:15:00.000Z",
    },
  ],
  nextAuditAfter: null,
};

/** Банк не сообщил итог: платёж требует сверки, событий ещё нет. */
export const unknownPaymentPage: PaymentPage = {
  value: ownerPayment(3, {
    state: "unknown",
    access: "awaiting_payment",
    refundedKopecks: null,
    refundableKopecks: null,
    confirmedAt: null,
    paymentId: "7100000003",
  }),
  events: [],
  decisions: [],
  audit: [],
  nextAuditAfter: null,
};
