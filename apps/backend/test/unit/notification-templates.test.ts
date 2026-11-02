import { expect, test } from "vitest";
import { renderNotification } from "../../src/modules/notifications/domain/templates.js";
import type { NotificationSource } from "../../src/modules/notifications/ports/notification-sources.js";

const event = {
  contractVersion: "inside.notification-event.v1" as const,
  messageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  occurrenceRef: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  sourceRef: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  sourceRevision: 1,
  occurredAt: "2026-09-12T12:00:00.000Z",
  notAfter: "2026-09-13T12:00:00.000Z",
  eventType: "billing.notice-ready" as const,
  accountRef: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  kind: "payment_succeeded" as const,
};
const source: Extract<NotificationSource, { status: "current" }> = {
  status: "current",
  event,
  content: { category: "subscription", kind: "payment_succeeded" },
  accountId: event.accountRef,
  title: "Руководство",
  readerPath: "/account/purchases",
};

test("ссылка читателя ведёт только на сам Platform и только под TLS или по петле", () => {
  expect(
    renderNotification(source, "https://inside.example.test").text,
  ).toContain("https://inside.example.test/account/purchases");
  // Стенд отвечает по петле и сертификата не имеет: письмо на нём должно оставаться проверяемым.
  for (const origin of [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://[::1]:3000",
  ]) {
    expect(renderNotification(source, origin).text).toContain(
      `${origin}/account/purchases`,
    );
  }
  // Любой другой узел без TLS — отказ, а не письмо с небезопасной ссылкой.
  expect(() =>
    renderNotification(source, "http://inside.example.test"),
  ).toThrow("notification_link_invalid");
  expect(() =>
    renderNotification(source, "https://user:secret@inside.example.test"),
  ).toThrow("notification_link_invalid");
  expect(() =>
    renderNotification(
      { ...source, readerPath: "https://evil.example/path" },
      "https://inside.example.test",
    ),
  ).toThrow("notification_link_invalid");
  expect(() =>
    renderNotification(
      { ...source, readerPath: "//evil.example/path" },
      "https://inside.example.test",
    ),
  ).toThrow("notification_link_invalid");
});

const saleEvent = {
  ...event,
  kind: "sale_recorded" as const,
  occurredAt: "2026-11-02T11:05:00.000Z",
  notAfter: "2026-11-03T11:05:00.000Z",
};
const sale: Extract<NotificationSource, { status: "current" }> = {
  status: "current",
  event: saleEvent,
  content: { category: "subscription", kind: "sale_recorded" },
  accountId: null,
  audience: "sales_managers",
  title: "AI Engineering",
  readerPath: "/authoring/sales/payments/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  purchaseRef: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  amountMinor: 2_000_000,
  sale: {
    promotion: { name: "Осенняя скидка", code: "AUTUMN", percent: 20 },
  },
};

test("продажа: автор видит продукт, сумму, промокод, московское время и карточку оплаты", () => {
  expect(renderNotification(sale, "https://inside.example.test")).toEqual({
    templateRef: "inside.sale_recorded",
    templateRevision: 1,
    subject: "Новая покупка",
    text: [
      "Новая покупка",
      "",
      "Продукт: AI Engineering",
      "Сумма: 20000.00 ₽",
      "Промокод: AUTUMN (скидка 20%)",
      "Время: 02.11.2026, 14:05 по Москве",
      "",
      "https://inside.example.test/authoring/sales/payments/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    ].join("\n"),
  });
});

test("продажа без кода: автоматическая скидка по названию; без скидки строки нет", () => {
  expect(
    renderNotification(
      {
        ...sale,
        sale: {
          promotion: { name: "Осенняя скидка", code: null, percent: 20 },
        },
      },
      "https://inside.example.test",
    ).text,
  ).toContain("Скидка: Осенняя скидка (20%)");
  expect(
    renderNotification(
      { ...sale, sale: { promotion: null } },
      "https://inside.example.test",
    ).text,
  ).not.toMatch(/Промокод|Скидка/u);
});
