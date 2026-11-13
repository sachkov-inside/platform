import { expect, test } from "vitest";
import { assembleBillingNoticeSource } from "../../src/modules/notifications/assemble-billing-notice-source.js";
import type { NotificationSource } from "../../src/modules/notifications/ports/notification-sources.js";

const buyer = "11111111-1111-4111-8111-111111111111";
const event = {
  contractVersion: "inside.notification-event.v1" as const,
  messageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  eventType: "billing.notice-ready" as const,
  accountRef: buyer,
  kind: "sale_recorded",
  occurrenceRef: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  sourceRef: "sale:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  sourceRevision: 1,
  occurredAt: "2026-11-13T08:00:00.000Z",
  notAfter: "2026-11-14T08:00:00.000Z",
};
const sale: NotificationSource = {
  status: "current",
  event,
  content: { category: "subscription", kind: "sale_recorded" },
  accountId: null,
  audience: "sales_managers",
  title: "AI Engineering",
  readerPath: "/authoring/sales/payments/cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  amountMinor: 2_000_000,
  sale: { promotion: null },
};
const notices = (source: NotificationSource) => ({
  resolveNotice: () => Promise.resolve(source),
});
const contact = {
  telegramIdentityRef: "identity",
  displayName: "Анна Петрова",
  telegramUsername: "anna_petrova",
  telegramUrl: "https://t.me/anna_petrova",
  telegramContactState: "available" as const,
};

test("продажа получает текущий Telegram покупателя из его привязки", async () => {
  const asked: (readonly string[])[] = [];
  const source = await assembleBillingNoticeSource(notices(sale), {
    readContacts: (accountIds) => {
      asked.push(accountIds);
      return Promise.resolve({
        ok: true,
        contacts: new Map([[buyer, contact]]),
      });
    },
  })(event);
  expect(asked).toEqual([[buyer]]);
  expect(source).toMatchObject({
    status: "current",
    sale: {
      promotion: null,
      buyer: {
        state: "available",
        displayName: "Анна Петрова",
        username: "anna_petrova",
      },
    },
  });
});

test("без привязки и без профиля продажа называет это состояние", async () => {
  for (const state of ["not_linked", "unavailable"] as const) {
    const source = await assembleBillingNoticeSource(notices(sale), {
      readContacts: () =>
        Promise.resolve({
          ok: true,
          contacts: new Map([
            [buyer, { ...contact, telegramContactState: state }],
          ]),
        }),
    })(event);
    expect(source).toMatchObject({ sale: { buyer: { state } } });
  }
});

test("нечитаемая привязка — временное состояние: повод ждёт, а не уходит без покупателя", async () => {
  for (const readContacts of [
    () => Promise.resolve({ ok: false as const }),
    () => Promise.reject(new Error("telegram down")),
  ]) {
    expect(
      await assembleBillingNoticeSource(notices(sale), { readContacts })(event),
    ).toEqual({ status: "unavailable" });
  }
});

test("другие поводы Billing не читают Telegram", async () => {
  const payment: NotificationSource = {
    ...sale,
    content: { category: "subscription", kind: "payment_succeeded" },
    accountId: buyer,
  };
  const { audience: _audience, sale: _sale, ...withoutSale } = payment;
  const source = await assembleBillingNoticeSource(notices(withoutSale), {
    readContacts: () => Promise.reject(new Error("must not be read")),
  })(event);
  expect(source).toEqual(withoutSale);
});
