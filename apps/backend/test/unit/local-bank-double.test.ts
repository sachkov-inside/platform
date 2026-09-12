import { fork } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { localTbankConfig } from "../../src/config/tbank-config.js";
import { createLocalBankDouble } from "../../src/development/bank-double/local-bank-double.js";
import { startLocalBankDouble } from "../../src/development/bank-double/start-local-bank-double.js";
import { Tbank, tbankToken, type BankRequest } from "../../src/modules/billing/infrastructure/tbank/tbank.js";

const config = localTbankConfig({});
const origin = config.endpoints.formOrigins[0] ?? "";

/** Двойник и приложение соединяются ровно тем адаптером, который работает с настоящим банком. */
function stand(ledgerPath?: string) {
  const notifications: Record<string, unknown>[] = [];
  const double = createLocalBankDouble({
    config,
    notify: (_url, payload) => { notifications.push({ ...payload }); return Promise.resolve(); },
    ...(ledgerPath === undefined ? {} : { ledgerPath }),
  });
  const request: BankRequest = (url, init) =>
    double.handle(new Request(url, { method: init.method, headers: init.headers, body: init.body }));
  const outcome = async (url: string, value: string) =>
    double.handle(new Request(url, { method: "POST", body: new URLSearchParams({ outcome: value }) }));
  return { bank: new Tbank(config, request), double, notifications, outcome };
}

const purchase = { orderId: "0f2f7c0e-6d9e-4d23-9c0e-1f3c6f1c2f01", accountId: "buyer-1", amount: 290_000,
  name: "Руководство «Стенд»", email: "buyer@example.test" };

describe("local bank double", () => {
  test("оплата на форме подтверждает платёж подписанной нотификацией", async () => {
    const { bank, notifications, outcome } = stand();
    const started = await bank.init(purchase);
    expect(started).toMatchObject({ OrderId: purchase.orderId, Amount: purchase.amount, Status: "NEW", Success: true });
    expect(started.PaymentURL.startsWith(`${origin}/pay/`)).toBe(true);

    const redirect = await outcome(started.PaymentURL, "confirmed");
    expect(redirect.status).toBe(303);
    expect(redirect.headers.get("location")).toBe(config.returnUrl);
    // Нотификация принимается обычным путём приложения: подпись двойника совпадает с банковской.
    const accepted = bank.notification(notifications[0]);
    expect(accepted).toMatchObject({ OrderId: purchase.orderId, Status: "CONFIRMED", Success: true, ErrorCode: "0" });
    // Привязка выдана: покупка просила сохранить карту.
    expect(accepted?.RebillId).toMatch(/^\d+$/u);
    expect(await bank.state(started.PaymentId)).toMatchObject({ Status: "CONFIRMED" });
    expect(await bank.order(purchase.orderId)).toEqual([started.PaymentId]);

    // Повтор нотификации — то же событие, а не новый платёж.
    await outcome(started.PaymentURL, "repeat");
    expect(notifications).toHaveLength(2);
    expect(notifications[1]).toEqual(notifications[0]);
  });

  test("повторять нечего, пока исход не выбран", async () => {
    const { bank, double, notifications } = stand();
    const started = await bank.init(purchase);
    expect(await (await double.handle(new Request(started.PaymentURL))).text()).not.toContain("Повторить нотификацию");
    const answer = await double.handle(new Request(started.PaymentURL, { method: "POST",
      body: new URLSearchParams({ outcome: "repeat" }) }));
    expect(answer.status).toBe(400);
    expect(notifications).toHaveLength(0);
  });

  test("каждый управляемый исход приходит своим статусом", async () => {
    for (const [choice, status] of [["rejected", "REJECTED"], ["canceled", "CANCELED"],
      ["expired", "DEADLINE_EXPIRED"], ["unknown", "CONFIRMING"]] as const) {
      const { bank, notifications, outcome } = stand();
      const started = await bank.init({ ...purchase, initiator: "0" });
      await outcome(started.PaymentURL, choice);
      expect(bank.notification(notifications[0])).toMatchObject({ Status: status, Success: false });
      // Разовая покупка не просит привязку, поэтому её не получает ни при каком исходе.
      expect(notifications[0]?.RebillId).toBeUndefined();
    }
  });

  test("списание по сохранённой карте следует выбранному исходу", async () => {
    const { bank, double, notifications, outcome } = stand();
    const first = await bank.init(purchase);
    await outcome(first.PaymentURL, "confirmed");
    const saved = bank.notification(notifications[0])?.RebillId ?? "";

    const renewal = await bank.init({ ...purchase, orderId: "0f2f7c0e-6d9e-4d23-9c0e-1f3c6f1c2f02", initiator: "R" });
    expect(await bank.charge({ paymentId: renewal.PaymentId, rebillId: saved })).toMatchObject({ Status: "CONFIRMED", Success: true });

    await double.handle(new Request(`${origin}/control`, { method: "POST",
      body: new URLSearchParams({ chargeOutcome: "rejected", refundOutcome: "accepted" }) }));
    const declined = await bank.init({ ...purchase, orderId: "0f2f7c0e-6d9e-4d23-9c0e-1f3c6f1c2f03", initiator: "R" });
    expect(await bank.charge({ paymentId: declined.PaymentId, rebillId: saved })).toMatchObject({ Status: "REJECTED", Success: false });
  });

  test("списание по чужой привязке банк не исполняет", async () => {
    const { bank, notifications, outcome } = stand();
    const first = await bank.init(purchase);
    await outcome(first.PaymentURL, "confirmed");
    const renewal = await bank.init({ ...purchase, orderId: "0f2f7c0e-6d9e-4d23-9c0e-1f3c6f1c2f04", initiator: "R" });
    // Привязку выдаёт сам банк: подставленный `RebillId` не является способом оплаты.
    expect(await bank.charge({ paymentId: renewal.PaymentId, rebillId: "999999999" }))
      .toMatchObject({ Status: "REJECTED", Success: false, ErrorCode: "3005" });
    expect(notifications.at(-1)).toMatchObject({ Status: "REJECTED", ErrorCode: "3005" });
  });

  test("незнакомый платёж банк называет незнакомым, а не падает", async () => {
    const { bank, double } = stand();
    const answer = async (method: string, body: Record<string, unknown>): Promise<unknown> => {
      const payload = { ...body, TerminalKey: config.terminalKey };
      const response = await double.handle(new Request(`${config.endpoints.apiBaseUrl}/${method}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, Token: tbankToken(payload, config.password) }),
      }));
      return response.json();
    };
    expect(await answer("GetState", { PaymentId: "404404404404" })).toMatchObject({ Success: false, ErrorCode: "7" });
    expect(await answer("Charge", { PaymentId: "404404404404", RebillId: "1" })).toMatchObject({ Success: false, ErrorCode: "7" });
    expect(await answer("Cancel", { PaymentId: "404404404404", Amount: 100, ExternalRequestId: "refund-x" }))
      .toMatchObject({ Success: false, ErrorCode: "7" });
    // Приложение видит это как невозможность сверки, а не как отказ платежа.
    await expect(bank.state("404404404404")).rejects.toThrow();
  });

  test("журнал переживает перезапуск двойника", async () => {
    const ledgerPath = join(mkdtempSync(join(tmpdir(), "inside-bank-double-")), "ledger.json");
    const first = stand(ledgerPath);
    const started = await first.bank.init(purchase);
    await first.outcome(started.PaymentURL, "confirmed");

    // Новый процесс с тем же журналом: банк помнит платёж, поэтому сверка приложения возможна.
    const restarted = stand(ledgerPath);
    expect(await restarted.bank.order(purchase.orderId)).toEqual([started.PaymentId]);
    expect(await restarted.bank.state(started.PaymentId)).toMatchObject({ Status: "CONFIRMED", Success: true });
  });

  test("возврат частями и целиком следует запрошенной сумме, повтор не возвращает дважды", async () => {
    const { bank, notifications, outcome } = stand();
    const started = await bank.init(purchase);
    await outcome(started.PaymentURL, "confirmed");
    expect(notifications).toHaveLength(1);
    const refund = { paymentId: started.PaymentId, name: purchase.name, email: purchase.email };
    const partial = await bank.cancel({ ...refund, amount: 90_000, externalRequestId: "refund-1" });
    expect(partial).toMatchObject({ Status: "PARTIAL_REFUNDED", Success: true, ErrorCode: "0", NewAmount: 200_000 });
    // Тот же ExternalRequestId — тот же ответ: сверка не создаёт второй возврат.
    expect(await bank.cancel({ ...refund, amount: 90_000, externalRequestId: "refund-1" })).toEqual(partial);
    expect(await bank.cancel({ ...refund, amount: 200_000, externalRequestId: "refund-2" }))
      .toMatchObject({ Status: "REFUNDED", Success: true, NewAmount: 0 });
    expect(await bank.cancel({ ...refund, amount: 100, externalRequestId: "refund-3" }))
      .toMatchObject({ Success: false, ErrorCode: "3007" });
    // О возврате банк сообщает так же, как об оплате: приложение получает подписанное событие.
    expect(notifications.map(item => item.Status)).toEqual(["CONFIRMED", "PARTIAL_REFUNDED", "REFUNDED"]);
    expect(bank.notification(notifications.at(-1))).toMatchObject({ Status: "REFUNDED" });
  });

  test("отказ банка в возврате не запоминается за попыткой", async () => {
    const { bank, double, outcome } = stand();
    const started = await bank.init(purchase);
    await outcome(started.PaymentURL, "confirmed");
    await double.handle(new Request(`${origin}/control`, { method: "POST",
      body: new URLSearchParams({ chargeOutcome: "confirmed", refundOutcome: "declined" }) }));
    const refund = { paymentId: started.PaymentId, name: purchase.name, email: purchase.email, amount: 290_000, externalRequestId: "refund-1" };
    expect(await bank.cancel(refund)).toMatchObject({ Success: false, ErrorCode: "3007" });
    await double.handle(new Request(`${origin}/control`, { method: "POST",
      body: new URLSearchParams({ chargeOutcome: "confirmed", refundOutcome: "accepted" }) }));
    // Владелец вернул переключатель: та же попытка возврата теперь проходит.
    expect(await bank.cancel(refund)).toMatchObject({ Status: "REFUNDED", Success: true });
  });

  test("привязка карты подтверждается человеком и только тогда выдаёт способ оплаты", async () => {
    const { bank, outcome } = stand();
    const session = await bank.addCard(purchase.accountId);
    expect(session.formUrl.startsWith(`${origin}/card/`)).toBe(true);
    expect(await bank.addCardState(session.requestKey)).toMatchObject({ status: "NEW", success: true });
    expect(await bank.addCardState(session.requestKey)).not.toHaveProperty("rebillId");
    await outcome(session.formUrl, "completed");
    const completed = await bank.addCardState(session.requestKey);
    expect(completed).toMatchObject({ status: "COMPLETED", success: true, errorCode: "0" });
    expect(completed.rebillId).toMatch(/^\d+$/u);

    const refused = await bank.addCard(purchase.accountId);
    await outcome(refused.formUrl, "rejected");
    expect(await bank.addCardState(refused.requestKey)).toMatchObject({ status: "REJECTED", success: false });
    expect(await bank.addCardState(refused.requestKey)).not.toHaveProperty("rebillId");
  });

  test("подпись запроса проверяется, а страницы стенда открываются человеком", async () => {
    const { double } = stand();
    const forged = await double.handle(new Request(`${config.endpoints.apiBaseUrl}/GetState`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ TerminalKey: config.terminalKey, PaymentId: "1", Token: "forged" }) }));
    expect(await forged.json()).toMatchObject({ Success: false, ErrorCode: "9999" });

    const index = await double.handle(new Request(`${origin}/`));
    expect(index.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await index.text()).toContain(config.terminalKey);
    expect((await double.handle(new Request(`${origin}/pay/unknown`))).status).toBe(404);
  });

  test("вне стенда двойник не запускается и говорит об этом", async () => {
    const child = fork(new URL("../../src/development/bank-double.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: { ...process.env, NODE_ENV: "production", TBANK_PROVIDER_MODE: "test" },
    });
    let reported = "";
    child.stderr?.on("data", (chunk: Buffer) => { reported += chunk.toString("utf8"); });
    const code = await new Promise<number | null>(resolve => child.once("exit", resolve));
    expect(code).toBe(1);
    expect(reported).toContain("The local bank double runs only with NODE_ENV=development");
  });

  test("сетевая оболочка отвечает тем же двойником", async () => {
    const running = await startLocalBankDouble({ config, host: "127.0.0.1", port: 0 });
    try {
      const health = await fetch(`http://127.0.0.1:${running.port}/health`);
      expect(await health.json()).toMatchObject({ process: "bank-double", status: "ready", terminal: config.terminalKey });
      const page = await fetch(`http://127.0.0.1:${running.port}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("Двойник банка Inside");
    } finally {
      await running.close();
    }
  });
});
