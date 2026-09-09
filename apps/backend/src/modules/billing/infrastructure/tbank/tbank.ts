import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { TbankConfig } from "../../../../config/tbank-config.js";

export const bankTimeoutMs = 10_000;
const reference = z.union([z.string().min(1).max(64), z.int().nonnegative()]);
const success = z.union([z.boolean(), z.enum(["true", "false"])]);
const bankPaymentInputSchema = z.object({
  TerminalKey: z.string().min(1).max(64), OrderId: z.string().min(1).max(50),
  PaymentId: reference, Amount: z.int().nonnegative(),
  Status: z.enum(["RECEIPT", "NEW", "FORM_SHOWED", "DEADLINE_EXPIRED", "CANCELED", "PREAUTHORIZING", "AUTHORIZING", "AUTHORIZED", "AUTH_FAIL", "REJECTED", "CONFIRMING", "CONFIRMED", "REVERSING", "REVERSED", "REFUNDING", "PARTIAL_REFUNDED", "REFUNDED"]),
  Success: success, ErrorCode: z.string(),
  RebillId: reference.optional(),
});
export const bankNotificationSchema = bankPaymentInputSchema.extend({ Token: z.string().regex(/^[a-f0-9]{64}$/u) }).loose();
export const bankPaymentSchema = bankPaymentInputSchema.transform(({ PaymentId, Success, RebillId, ...value }) => ({ ...value,
  PaymentId: String(PaymentId), Success: Success === true || Success === "true",
  ...(RebillId === undefined ? {} : { RebillId: String(RebillId) }),
}));
export type BankPayment = z.infer<typeof bankPaymentSchema>;
const notificationSchema = z.record(z.string(), z.unknown());

export function tbankToken(payload: Readonly<Record<string, unknown>>, password: string): string {
  const values: Record<string, unknown> = { ...payload, Password: password };
  return createHash("sha256").update(Object.keys(values).filter(key => key !== "Token" &&
    (typeof values[key] === "string" || typeof values[key] === "number" || typeof values[key] === "boolean"))
    .sort().map(key => String(values[key])).join("")).digest("hex");
}
export function validatedPaymentUrl(value: unknown): string {
  const url = new URL(z.url().parse(value));
  if (url.protocol !== "https:" || !["securepay.tinkoff.ru", "pay.tbank.ru"].includes(url.hostname) || url.port || url.username || url.password || url.hash)
    throw new Error("Invalid bank payment URL");
  return url.toString();
}

// Concrete T-Bank adapter. No automatic retries, caller persists sent/unknown before I/O.
export class Tbank {
  constructor(readonly config: TbankConfig, private readonly request: typeof fetch = fetch) {}
  async init(input: { orderId: string; accountId: string; amount: number; name: string; email: string }): Promise<BankPayment & { PaymentURL: string }> {
    const result = await this.call("Init", {
      Amount: input.amount, OrderId: input.orderId, Description: input.name.slice(0, 140),
      CustomerKey: input.accountId, Recurrent: "Y", PayType: "O",
      DATA: { OperationInitiatorType: "1" },
      SuccessURL: this.config.returnUrl, FailURL: this.config.returnUrl,
      NotificationURL: this.config.notificationUrl,
      Receipt: { Email: input.email, Taxation: this.config.receipt.taxation,
        Items: [{ Name: input.name.slice(0, 128), Price: input.amount, Quantity: 1, Amount: input.amount,
          PaymentMethod: "full_payment", PaymentObject: "service", Tax: this.config.receipt.tax }] },
    });
    const payment = bankPaymentSchema.parse(result);
    return { ...payment, PaymentURL: validatedPaymentUrl(notificationSchema.parse(result).PaymentURL) };
  }
  async state(paymentId: string): Promise<BankPayment> {
    return bankPaymentSchema.parse(await this.call("GetState", { PaymentId: paymentId }));
  }
  async order(orderId: string): Promise<readonly string[]> {
    // CheckOrder locates an attempt; its optional amount/error fields are not payment proof.
    const result = z.object({ TerminalKey: z.string(), OrderId: z.string(),
      Success: success.transform(value => value === true || value === "true").pipe(z.literal(true)),
      ErrorCode: z.union([z.literal("0"), z.literal(0)]),
      Payments: z.array(z.object({ PaymentId: reference, Status: z.string(), Success: success })).max(100),
    }).parse(await this.call("CheckOrder", { OrderId: orderId }));
    if (result.TerminalKey !== this.config.terminalKey || result.OrderId !== orderId) throw new Error("Bank order mismatch");
    return result.Payments.map(payment => String(payment.PaymentId));
  }
  notification(input: unknown): BankPayment | undefined {
    const parsed = notificationSchema.safeParse(input);
    if (!parsed.success || typeof parsed.data.Token !== "string" || !/^[a-f0-9]{64}$/u.test(parsed.data.Token)) return undefined;
    const expected = tbankToken(parsed.data, this.config.password);
    if (!timingSafeEqual(Buffer.from(parsed.data.Token, "hex"), Buffer.from(expected, "hex"))) return undefined;
    const payment = bankPaymentSchema.safeParse(parsed.data);
    return payment.success && payment.data.TerminalKey === this.config.terminalKey ? payment.data : undefined;
  }
  sealBinding(orderId: string, rebillId: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(this.config.bindingEncryptionKey, "base64"), nonce);
    cipher.setAAD(Buffer.from(`${this.config.environment}:${this.config.terminalKey}:${orderId}`));
    const data = Buffer.concat([cipher.update(rebillId, "utf8"), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString("base64");
  }
  openBinding(orderId: string, ciphertext: string): string {
    const data = Buffer.from(ciphertext, "base64");
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(this.config.bindingEncryptionKey, "base64"), data.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${this.config.environment}:${this.config.terminalKey}:${orderId}`));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
  }
  private async call(method: "Init" | "GetState" | "CheckOrder", values: Readonly<Record<string, unknown>>): Promise<unknown> {
    const body = { ...values, TerminalKey: this.config.terminalKey };
    const response = await this.request(`https://securepay.tinkoff.ru/v2/${method}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, Token: tbankToken(body, this.config.password) }),
      signal: AbortSignal.timeout(bankTimeoutMs), redirect: "error",
    });
    if (!response.ok) throw new Error("Bank response unavailable");
    return response.json();
  }
}
