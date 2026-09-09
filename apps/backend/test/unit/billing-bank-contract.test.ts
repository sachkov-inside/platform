import { describe, expect, test } from "vitest";
import { Tbank, tbankToken, validatedPaymentUrl } from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import { tbankConfigSchema } from "../../src/config/tbank-config.js";
import { subscriptionPeriodEnd } from "../../src/modules/billing/domain/subscription-period.js";

const config = tbankConfigSchema.parse({ environment: "demo", terminalKey: "SYNTHETIC", password: "synthetic-password",
  bindingEncryptionKey: Buffer.alloc(32, 42).toString("base64"), recurringCardConfirmed: true, cardOnlyHostedConfirmed: true,
  minimumKopecks: 100, maximumKopecks: 1000000, returnUrl: "https://example.test/account", notificationUrl: "https://example.test/billing/tbank/notification",
  receipt: { taxation: "usn_income", tax: "none" } });

describe("concrete bank boundary", () => {
  test("signature excludes nested receipt/DATA and Token, but binds all scalar fields", () => {
    const payload = { Amount: 100, OrderId: "test", Success: true, Receipt: { Email: "a@example.test" }, DATA: { value: 1 } };
    const token = tbankToken(payload, "password");
    expect(token).toBe(tbankToken({ ...payload, Token: "ignored", Receipt: { Email: "b@example.test" }, DATA: [] }, "password"));
    expect(token).not.toBe(tbankToken({ ...payload, Amount: 101 }, "password"));
    expect(token).not.toBe(tbankToken({ ...payload, Success: false }, "password"));
  });
  test("hosted redirects reject hostile hosts, credentials, fragments and non-HTTPS", () => {
    expect(validatedPaymentUrl("https://pay.tbank.ru/new/test")).toBe("https://pay.tbank.ru/new/test");
    expect(validatedPaymentUrl("https://securepay.tinkoff.ru/order/test")).toBe("https://securepay.tinkoff.ru/order/test");
    for (const url of ["https://securepay.tinkoff.ru.evil.test/a", "https://evil.test/", "http://securepay.tinkoff.ru/", "https://user@securepay.tinkoff.ru/", "https://securepay.tinkoff.ru/#fake", "https://securepay.tinkoff.ru:8443/"])
      expect(() => validatedPaymentUrl(url)).toThrow();
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
  test("months clamp the Moscow local date while preserving the original anchor", () => {
    const anchor = new Date("2032-01-30T22:15:12.345Z"); // Jan 31 in Moscow, leap year.
    expect(subscriptionPeriodEnd(anchor, 1).toISOString()).toBe("2032-02-28T22:15:12.345Z");
    expect(subscriptionPeriodEnd(anchor, 2).toISOString()).toBe("2032-03-30T22:15:12.345Z");
    expect(() => subscriptionPeriodEnd(anchor, 0)).toThrow();
  });
});
