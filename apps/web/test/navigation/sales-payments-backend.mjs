// @ts-check
import { z } from "zod";

/**
 * Платежи владельца в навигационном наборе (#1718): изолированный HTTP-стенд в форме контракта Nest
 * (`POST /billing/admin` и `GET /billing/admin/payments/:purchaseRef/order-email`), а не проверка
 * прав. Токены выбирают заранее заданные исходы; правила отбора, курсора и прав доказывают
 * интеграционные тесты backend.
 */

const operationRef = "78000000-0000-4000-8000-000000000001";
const salesPaymentsFixture = Object.freeze({
  products: [
    {
      id: "78000000-0000-4000-8000-0000000000f1",
      title: "Разработка с агентами",
    },
    {
      id: "78000000-0000-4000-8000-0000000000f2",
      title: "Архитектура и проектирование систем",
    },
    { id: "78000000-0000-4000-8000-0000000000f3", title: "AI Engineering" },
  ],
  /** Платёж, итог которого банк не сообщил: его сверяет набор. */
  unknownRef: "78000000-0000-4000-8000-000000000101",
  orderEmail: "buyer.order@example.test",
});
const states = /** @type {const} */ ([
  "confirmed",
  "pending",
  "failed",
  "confirmed",
  "sent",
]);
const pageLimit = 100;

/** @param {number} index */
function ref(index) {
  return `78000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/**
 * @param {number} index
 * @param {string} state
 * @param {string} createdAt
 */
function payment(index, state, createdAt) {
  const product =
    salesPaymentsFixture.products[
      index % salesPaymentsFixture.products.length
    ] ?? salesPaymentsFixture.products[0];
  if (product === undefined) throw new Error("No fixture product");
  const amountKopecks = 990_000 + (index % 4) * 500_000;
  return {
    purchaseRef:
      index === 0 ? salesPaymentsFixture.unknownRef : ref(index + 200),
    accountId: `${String((index % 6) + 3).repeat(8)}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    kind: "one_time",
    state,
    subscriptionRef: null,
    periodIndex: null,
    amountKopecks,
    environment: "demo",
    terminalRef: "1700000000001DEMO",
    paymentId: String(7_200_000_000 + index),
    snapshot: {
      product: { id: product.id, name: product.title, priceRevision: 2 },
      offer: {
        id: ref(900),
        revision: 1,
        name: product.title,
        benefits: ["materials"],
        archived: false,
        published: true,
      },
      paymentOption: {
        id: ref(901),
        revision: 1,
        offerId: ref(900),
        mode: "one_time",
        months: 12,
        priceKopecks: amountKopecks,
        archived: false,
      },
      promotion: null,
      currency: "RUB",
      timezone: "Europe/Moscow",
      firstPriceKopecks: amountKopecks,
      renewalPriceKopecks: amountKopecks,
    },
    fiscalization: state === "confirmed" ? "confirmed" : "pending",
    confirmedAt: state === "confirmed" ? createdAt : null,
    periodEndsAt: null,
    createdAt,
    updatedAt: createdAt,
    access: state === "confirmed" ? "ready" : "awaiting_payment",
    refundedKopecks: state === "unknown" ? null : 0,
    refundableKopecks:
      state === "confirmed" ? amountKopecks : state === "unknown" ? null : 0,
  };
}

/** 60 платежей, по одному в шесть часов с 24.10.2026 14:00 МСК назад; первый ждёт сверки. */
function initialPayments() {
  return Array.from({ length: 60 }, (_, index) =>
    payment(
      index,
      index === 0 ? "unknown" : (states[index % states.length] ?? "confirmed"),
      new Date(
        Date.parse("2026-10-24T11:00:00.000Z") - index * 6 * 3_600_000,
      ).toISOString(),
    ),
  );
}

let payments = initialPayments();
/** @type {unknown[]} */
let commands = [];

/** @param {number} status @param {string} code */
function problem(status, code) {
  return {
    status,
    value: { code, status, title: code, type: `urn:inside:problem:${code}` },
  };
}

/** @param {unknown} result */
function outcome(result) {
  return { status: 200, value: { operationRef, result } };
}

/**
 * @param {Record<string, unknown>} command
 */
function listPayments(command) {
  const chosen = Array.isArray(command["states"])
    ? command["states"]
    : undefined;
  const from =
    typeof command["from"] === "string" ? Date.parse(command["from"]) : null;
  const to =
    typeof command["to"] === "string" ? Date.parse(command["to"]) : null;
  const rows = payments
    .filter(
      (row) =>
        (chosen === undefined || chosen.includes(row.state)) &&
        (command["productId"] === undefined ||
          row.snapshot.product.id === command["productId"]) &&
        (command["accountId"] === undefined ||
          row.accountId === command["accountId"]) &&
        (from === null || Date.parse(row.createdAt) >= from) &&
        (to === null || Date.parse(row.createdAt) < to),
    )
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  const start =
    typeof command["cursor"] === "string"
      ? rows.findIndex((row) => row.purchaseRef === command["cursor"]) + 1
      : 0;
  const limit = Math.min(Number(command["limit"] ?? 50), pageLimit);
  const items = rows.slice(start, start + limit);
  const last = items.at(-1);
  return outcome({
    outcome: "payments",
    items,
    nextCursor:
      start + limit < rows.length && last !== undefined
        ? last.purchaseRef
        : null,
  });
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {URL} url
 * @param {(request: import("node:http").IncomingMessage) => Promise<string>} readBody
 * @returns {Promise<{status: number, value: unknown} | null>}
 */
export async function salesPaymentsRoute(request, url, readBody) {
  if (url.pathname === "/__sales-payments/reset") {
    payments = initialPayments();
    commands = [];
    return { status: 200, value: { reset: true } };
  }
  if (url.pathname === "/__sales-payments/commands")
    return { status: 200, value: { commands } };
  const orderEmail = /^\/billing\/admin\/payments\/([^/]+)\/order-email$/u.exec(
    url.pathname,
  );
  const isOwnerCommand =
    url.pathname === "/billing/admin" && request.method === "POST";
  if (orderEmail === null && !isOwnerCommand) return null;

  const token = request.headers.authorization;
  if (token === undefined) return problem(401, "invalid_proof");
  if (token === "Bearer sales-forbidden") return problem(403, "forbidden");
  if (token === "Bearer sales-unavailable")
    return problem(503, "dependency_unavailable");

  if (orderEmail !== null) {
    if (request.method !== "GET") return null;
    const row = payments.find((item) => item.purchaseRef === orderEmail[1]);
    if (row === undefined) return problem(404, "not_found");
    return {
      status: 200,
      value: {
        email:
          row.purchaseRef === salesPaymentsFixture.unknownRef
            ? salesPaymentsFixture.orderEmail
            : null,
      },
    };
  }

  const command = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(await readBody(request)));
  commands.push(command);
  switch (command["operation"]) {
    case "payments.list":
      return listPayments(command);
    case "content.list":
      return outcome({
        outcome: "content",
        items: [
          ...salesPaymentsFixture.products.map((product) => ({
            kind: "product",
            id: product.id,
            title: product.title,
            slug: null,
            available: true,
          })),
          {
            kind: "material",
            id: ref(950),
            title: "Ревью кода с агентом",
            slug: null,
            available: true,
          },
        ],
      });
    case "payments.read": {
      const row = payments.find(
        (item) => item.purchaseRef === command["purchaseRef"],
      );
      if (row === undefined) return problem(404, "not_found");
      return outcome({
        outcome: "payment",
        value: row,
        events:
          row.state === "confirmed"
            ? [
                {
                  kind: "payment_confirmed",
                  occurredAt: row.createdAt,
                  recordedAt: row.createdAt,
                },
              ]
            : [],
        decisions: [],
        audit: [],
        nextAuditCursor: null,
      });
    }
    case "payments.reconcile": {
      const row = payments.find(
        (item) => item.purchaseRef === command["purchaseRef"],
      );
      if (row === undefined) return problem(404, "not_found");
      // Банк подтвердил оплату: сверка переводит неизвестный итог в оплаченный.
      if (row.state === "unknown") {
        row.state = "confirmed";
        row.access = "ready";
        row.confirmedAt = row.createdAt;
        row.refundedKopecks = 0;
        row.refundableKopecks = row.amountKopecks;
      }
      return outcome({ outcome: "reconciled", value: row });
    }
    default:
      return null;
  }
}
