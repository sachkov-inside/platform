import { describe, expect, test } from "vitest";

import { localTbankConfig } from "../../src/config/tbank-config.js";
import { createLocalBankDouble } from "../../src/development/bank-double/local-bank-double.js";
import {
  Tbank,
  tbankToken,
  type BankRequest,
} from "../../src/modules/billing/infrastructure/tbank/tbank.js";

const config = localTbankConfig({});
const origin = config.endpoints.formOrigins[0] ?? "";

/** Двойник и приложение соединяются ровно тем адаптером, который работает с настоящим банком. */
function stand() {
  const notifications: Record<string, unknown>[] = [];
  const double = createLocalBankDouble({
    config,
    notify: (_url, payload) => {
      notifications.push({ ...payload });
      return Promise.resolve();
    },
  });
  const request: BankRequest = (url, init) =>
    double.handle(
      new Request(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
      }),
    );
  const outcome = async (url: string, value: string) =>
    double.handle(
      new Request(url, {
        method: "POST",
        body: new URLSearchParams({ outcome: value }),
      }),
    );
  return { bank: new Tbank(config, request), double, notifications, outcome };
}

const purchase = {
  orderId: "0f2f7c0e-6d9e-4d23-9c0e-1f3c6f1c2f01",
  accountId: "buyer-1",
  amount: 290_000,
  name: "Руководство «Стенд»",
  email: "buyer@example.test",
  formExpiresAt: new Date("2030-01-31T11:00:00Z"),
};

describe("local bank double", () => {
  test("оплата на форме подтверждает платёж подписанной нотификацией", async () => {
    const { bank, notifications, outcome } = stand();
    const started = await bank.init(purchase);
    expect(started).toMatchObject({
      OrderId: purchase.orderId,
      Amount: purchase.amount,
      Status: "NEW",
      Success: true,
    });
    expect(started.PaymentURL.startsWith(`${origin}/pay/`)).toBe(true);

    const redirect = await outcome(started.PaymentURL, "confirmed");
    expect(redirect.status).toBe(303);
    const returned = new URL(config.returnUrl);
    returned.searchParams.set("purchaseRef", purchase.orderId);
    expect(redirect.headers.get("location")).toBe(returned.href);
    // Нотификация принимается обычным путём приложения: подпись двойника совпадает с банковской.
    const accepted = bank.notification(notifications[0]);
    expect(accepted).toMatchObject({
      OrderId: purchase.orderId,
      Status: "CONFIRMED",
      Success: true,
      ErrorCode: "0",
    });
    // One-time Product payment never stores a recurring card binding.
    expect(accepted?.RebillId).toBeUndefined();
    expect(await bank.state(started.PaymentId)).toMatchObject({
      Status: "CONFIRMED",
    });
    expect(await bank.order(purchase.orderId)).toEqual([started.PaymentId]);

    // Повтор нотификации — то же событие, а не новый платёж.
    await outcome(started.PaymentURL, "repeat");
    expect(notifications).toHaveLength(2);
    expect(notifications[1]).toEqual(notifications[0]);
  });

  test("Cancel закрывает неоплаченную форму, а оплаченный платёж адаптер не отменяет", async () => {
    const { bank, notifications, outcome } = stand();
    const unpaid = await bank.init(purchase);
    const cancelled = await bank.cancel({
      orderId: purchase.orderId,
      paymentId: unpaid.PaymentId,
    });
    expect(cancelled).toMatchObject({
      sent: true,
      result: { Status: "CANCELED", Success: true, ErrorCode: "0" },
    });
    expect(bank.notification(notifications[0])).toMatchObject({
      Status: "CANCELED",
    });
    expect(await bank.state(unpaid.PaymentId)).toMatchObject({
      Status: "CANCELED",
    });

    const paidOrder = {
      ...purchase,
      orderId: "0f2f7c0e-6d9e-4d23-9c0e-1f3c6f1c2f02",
    };
    const paid = await bank.init(paidOrder);
    await outcome(paid.PaymentURL, "confirmed");
    expect(
      await bank.cancel({
        orderId: paidOrder.orderId,
        paymentId: paid.PaymentId,
      }),
    ).toMatchObject({ sent: false, payment: { Status: "CONFIRMED" } });
    expect(await bank.state(paid.PaymentId)).toMatchObject({
      Status: "CONFIRMED",
    });
    // Платёж другого заказа адаптер не отменяет, даже если его форма открыта.
    const other = await bank.init({
      ...purchase,
      orderId: "0f2f7c0e-6d9e-4d23-9c0e-1f3c6f1c2f03",
    });
    await expect(
      bank.cancel({ orderId: purchase.orderId, paymentId: other.PaymentId }),
    ).rejects.toThrow("Bank payment mismatch");
    expect(await bank.state(other.PaymentId)).toMatchObject({ Status: "NEW" });
  });

  test("returns to the purchase-specific bank URL", async () => {
    const { bank, outcome } = stand();
    const started = await bank.init({
      ...purchase,
      returnPath: "/products/stand/buy",
    });
    const answer = await outcome(started.PaymentURL, "confirmed");
    const expected = new URL("/products/stand/buy", config.returnUrl);
    expected.searchParams.set("purchaseRef", purchase.orderId);
    expect(answer.headers.get("location")).toBe(expected.href);
  });

  test("повторять нечего, пока исход не выбран", async () => {
    const { bank, double, notifications } = stand();
    const started = await bank.init(purchase);
    expect(
      await (await double.handle(new Request(started.PaymentURL))).text(),
    ).not.toContain("Повторить нотификацию");
    const answer = await double.handle(
      new Request(started.PaymentURL, {
        method: "POST",
        body: new URLSearchParams({ outcome: "repeat" }),
      }),
    );
    expect(answer.status).toBe(400);
    expect(notifications).toHaveLength(0);
  });

  test("каждый управляемый исход приходит своим статусом", async () => {
    for (const [choice, status] of [
      ["rejected", "REJECTED"],
      ["canceled", "CANCELED"],
      ["expired", "DEADLINE_EXPIRED"],
      ["unknown", "CONFIRMING"],
    ] as const) {
      const { bank, notifications, outcome } = stand();
      const started = await bank.init({ ...purchase });
      await outcome(started.PaymentURL, choice);
      expect(bank.notification(notifications[0])).toMatchObject({
        Status: status,
        Success: false,
      });
      // Разовая покупка не просит привязку, поэтому её не получает ни при каком исходе.
      expect(notifications[0]?.["RebillId"]).toBeUndefined();
    }
  });

  test("незнакомый платёж банк называет незнакомым, а не падает", async () => {
    const { bank, double } = stand();
    const answer = async (
      method: string,
      body: Record<string, unknown>,
    ): Promise<unknown> => {
      const payload = { ...body, TerminalKey: config.terminalKey };
      const response = await double.handle(
        new Request(`${config.endpoints.apiBaseUrl}/${method}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...payload,
            Token: tbankToken(payload, config.password),
          }),
        }),
      );
      return response.json();
    };
    expect(
      await answer("GetState", { PaymentId: "404404404404" }),
    ).toMatchObject({ Success: false, ErrorCode: "7" });
    expect(
      await answer("Charge", { PaymentId: "404404404404", RebillId: "1" }),
    ).toMatchObject({ Success: false, ErrorCode: "7" });
    expect(
      await answer("Cancel", {
        PaymentId: "404404404404",
        Amount: 100,
        ExternalRequestId: "refund-x",
      }),
    ).toMatchObject({ Success: false, ErrorCode: "7" });
    // Приложение видит это как невозможность сверки, а не как отказ платежа.
    await expect(bank.state("404404404404")).rejects.toThrow();
  });

  test("подпись запроса проверяется, а страницы стенда открываются человеком", async () => {
    const { double } = stand();
    const forged = await double.handle(
      new Request(`${config.endpoints.apiBaseUrl}/GetState`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          TerminalKey: config.terminalKey,
          PaymentId: "1",
          Token: "forged",
        }),
      }),
    );
    expect(await forged.json()).toMatchObject({
      Success: false,
      ErrorCode: "9999",
    });

    const index = await double.handle(new Request(`${origin}/`));
    expect(index.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await index.text()).toContain(config.terminalKey);
    expect(
      (await double.handle(new Request(`${origin}/pay/unknown`))).status,
    ).toBe(404);
  });
});
