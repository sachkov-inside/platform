import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";
import { Tbank, tbankToken, validatedPaymentUrl } from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import { bankRequest } from "../../src/modules/billing/infrastructure/tbank/bank-request.js";
import { syntheticTbankConfig } from "../support/bank-terminal.js";
import { subscriptionPeriodEnd } from "../../src/modules/billing/domain/subscription-period.js";

const config = syntheticTbankConfig({ environment: "demo", terminalKey: "SYNTHETIC", password: "synthetic-password",
  bindingEncryptionKey: Buffer.alloc(32, 42).toString("base64"), recurringCardConfirmed: true, cardOnlyHostedConfirmed: true,
  minimumKopecks: 100, maximumKopecks: 1000000, returnUrl: "https://example.test/account", notificationUrl: "https://example.test/billing/tbank/notification",
  receipt: { taxation: "usn_income", tax: "none" } });

const bankRootFingerprint =
  "D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31";

describe("concrete bank boundary", () => {
  test("signature excludes nested receipt/DATA and Token, but binds all scalar fields", () => {
    const payload = { Amount: 100, OrderId: "test", Success: true, Receipt: { Email: "a@example.test" }, DATA: { value: 1 } };
    const token = tbankToken(payload, "password");
    expect(token).toBe(tbankToken({ ...payload, Token: "ignored", Receipt: { Email: "b@example.test" }, DATA: [] }, "password"));
    expect(token).not.toBe(tbankToken({ ...payload, Amount: 101 }, "password"));
    expect(token).not.toBe(tbankToken({ ...payload, Success: false }, "password"));
  });
  test("hosted redirects reject hostile hosts, credentials, fragments and non-HTTPS", () => {
    const origins = config.endpoints.formOrigins;
    expect(origins).toEqual(["https://securepay.tinkoff.ru", "https://pay.tbank.ru"]);
    expect(validatedPaymentUrl("https://pay.tbank.ru/new/test", origins)).toBe("https://pay.tbank.ru/new/test");
    expect(validatedPaymentUrl("https://securepay.tinkoff.ru/order/test", origins)).toBe("https://securepay.tinkoff.ru/order/test");
    for (const url of ["https://securepay.tinkoff.ru.evil.test/a", "https://evil.test/", "http://securepay.tinkoff.ru/", "https://user@securepay.tinkoff.ru/", "https://securepay.tinkoff.ru/#fake", "https://securepay.tinkoff.ru:8443/"])
      expect(() => validatedPaymentUrl(url, origins)).toThrow();
    // Контур двойника принимает только свой origin: боевая форма остаётся у боевого терминала.
    expect(() => validatedPaymentUrl("https://securepay.tinkoff.ru/order/test", ["http://127.0.0.1:8090"])).toThrow();
  });
  test("binding ciphertext is scoped to its order, environment, terminal and key", () => {
    const bank = new Tbank(config);
    const ciphertext = bank.sealBinding("order-a", "saved-method");
    expect(bank.openBinding("order-a", ciphertext)).toBe("saved-method");
    expect(() => bank.openBinding("order-b", ciphertext)).toThrow();
    expect(() => new Tbank({ ...config, environment: "production" }).openBinding("order-a", ciphertext)).toThrow();
    expect(() => new Tbank({ ...config, terminalKey: "another" }).openBinding("order-a", ciphertext)).toThrow();
    expect(() => new Tbank({ ...config, bindingEncryptionKey: Buffer.alloc(32, 1).toString("base64") }).openBinding("order-a", ciphertext)).toThrow();
  });
  test("pinned bank root matches the documented fingerprint and a missing file fails loudly", () => {
    // Без собственного корня клиент остаётся встроенным: доверие приложения не меняется.
    expect(bankRequest(undefined)).toBe(globalThis.fetch);
    const root = fileURLToPath(new URL("../../../../infra/tls/russian-trusted-root-ca.pem", import.meta.url));
    // Отпечаток записан в docs/runbooks/runtime-configuration.md; подмена корня ломает этот тест.
    expect(new X509Certificate(readFileSync(root)).fingerprint256).toBe(bankRootFingerprint);
    expect(bankRequest(root)).not.toBe(globalThis.fetch);
    // Отсутствующий корень — отказ, а не молчаливое соединение без проверки сертификата.
    expect(() => bankRequest(`${root}.missing`)).toThrow();
  });
  test("months clamp the Moscow local date while preserving the original anchor", () => {
    const anchor = new Date("2032-01-30T22:15:12.345Z"); // Jan 31 in Moscow, leap year.
    expect(subscriptionPeriodEnd(anchor, 1).toISOString()).toBe("2032-02-28T22:15:12.345Z");
    expect(subscriptionPeriodEnd(anchor, 2).toISOString()).toBe("2032-03-30T22:15:12.345Z");
    expect(() => subscriptionPeriodEnd(anchor, 0)).toThrow();
  });
});
