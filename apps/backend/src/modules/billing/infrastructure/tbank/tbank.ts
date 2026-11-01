import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type { TbankConfig } from "../../../../config/tbank-config.js";
import { writeLog } from "../../../../infrastructure/observability/index.js";
import { bankStatusSchema, unpaidFormStatuses } from "./bank-statuses.js";

export const bankTimeoutMs = 10_000;
/** Ответ CheckOrder на заказ без единого платежа у этого терминала. */
const orderNotFoundSchema = z.object({
  Success: z.union([z.literal(false), z.literal("false")]),
  ErrorCode: z.union([z.literal("335"), z.literal(335)]),
});
const reference = z.union([z.string().min(1).max(64), z.int().nonnegative()]);
const success = z.union([z.boolean(), z.enum(["true", "false"])]);
const bankPaymentInputSchema = z.object({
  TerminalKey: z.string().min(1).max(64),
  OrderId: z.string().min(1).max(50),
  PaymentId: reference,
  Amount: z.int().nonnegative(),
  Status: bankStatusSchema,
  Success: success,
  ErrorCode: z.string(),
  RebillId: reference.optional(),
});
export const bankNotificationSchema = bankPaymentInputSchema
  .extend({ Token: z.string().regex(/^[a-f0-9]{64}$/u) })
  .loose();
export const bankPaymentSchema = bankPaymentInputSchema.transform(
  ({ PaymentId, Success, RebillId, ...value }) => ({
    ...value,
    PaymentId: String(PaymentId),
    Success: Success === true || Success === "true",
    ...(RebillId === undefined ? {} : { RebillId: String(RebillId) }),
  }),
);
export type BankPayment = z.infer<typeof bankPaymentSchema>;
const bankCancelSchema = z
  .object({
    TerminalKey: z.string().min(1).max(64),
    OrderId: z.string().min(1).max(50),
    PaymentId: reference,
    Status: bankStatusSchema,
    Success: success,
    ErrorCode: z.string(),
    OriginalAmount: z.int().nonnegative().optional(),
    NewAmount: z.int().nonnegative().optional(),
  })
  .transform(({ PaymentId, Success, ...value }) => ({
    ...value,
    PaymentId: String(PaymentId),
    Success: Success === true || Success === "true",
  }));
export type BankCancel = z.infer<typeof bankCancelSchema>;
/** Отказ банка на Init: `Success:false`, ненулевой код ошибки и нет PaymentId. */
const bankInitDeclinedSchema = z
  .object({
    TerminalKey: z.string(),
    OrderId: z.string().optional(),
    Success: success
      .transform((value) => value === true || value === "true")
      .pipe(z.literal(false)),
    ErrorCode: z
      .union([z.string().min(1), z.int()])
      .pipe(
        z.coerce.number<string | number>().int().positive().max(999_999_999),
      )
      .transform(String),
    Message: z
      .string()
      .transform((value) => value.slice(0, 255))
      .optional(),
    PaymentId: z.never().optional(),
  })
  .loose();
/**
 * Init определённо не создал платёж в банке. `request_invalid`: запрос не собран и не ушёл.
 * `declined`: банк ответил `Success:false` с кодом ошибки и без PaymentId. Любой другой сбой
 * Init, в том числе сеть, таймаут, HTTP-ошибка и ответ не по схеме, оставляет исход неизвестным.
 */
export class BankInitRefused extends Error {
  constructor(
    readonly refusal:
      | { readonly reason: "request_invalid" }
      | {
          readonly reason: "declined";
          readonly errorCode: string;
          readonly message: string | null;
        },
    message: string,
  ) {
    super(message);
    this.name = "BankInitRefused";
  }
}
/**
 * `OperationInitiatorType` банка: `0` — разовая оплата покупателем без сохранения карты,
 * `1` — оплата покупателем с сохранением привязки, `2` — оплата сохранённой картой по его
 * действию, `R` — списание по расписанию продавца.
 */
export type PaymentInitiator = "0" | "1" | "2" | "R";
const notificationSchema = z.record(z.string(), z.unknown());

export function tbankToken(
  payload: Readonly<Record<string, unknown>>,
  password: string,
): string {
  const values: Record<string, unknown> = { ...payload, Password: password };
  return createHash("sha256")
    .update(
      Object.keys(values)
        .filter(
          (key) =>
            key !== "Token" &&
            (typeof values[key] === "string" ||
              typeof values[key] === "number" ||
              typeof values[key] === "boolean"),
        )
        .sort()
        .map((key) => String(values[key]))
        .join(""),
    )
    .digest("hex");
}
/**
 * Форма оплаты открывается в браузере, поэтому её origin сверяется с контуром терминала. Адрес
 * отклоняется, если его нельзя разобрать, его origin не входит в `formOrigins` или в нём есть
 * логин, пароль или фрагмент. Тогда покупатель не откроет форму, и строка журнала зовёт
 * оператора (#1926). Она называет только origin (`null` для неразобранного адреса): в пути и
 * параметрах адреса может быть ключ формы.
 */
export function validatedPaymentUrl(
  value: unknown,
  origins: readonly string[],
  purchaseRef?: string,
): string {
  const parsed = z.url().safeParse(value);
  const url = parsed.success ? new URL(parsed.data) : null;
  if (
    url === null ||
    !origins.includes(url.origin) ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    writeLog("warn", "bank_payment_url_rejected", {
      module: "billing",
      status: "operator_attention",
      ...(purchaseRef === undefined ? {} : { purchaseRef }),
      origin: url?.origin ?? null,
    });
    throw new Error("Invalid bank payment URL");
  }
  return url.toString();
}

const moscowOffsetMilliseconds = 3 * 60 * 60_000;
/**
 * Срок формы оплаты для Init в формате T-Bank `YYYY-MM-DDTHH24:MI:SS+GMT`. Банк принимает срок
 * от 1 минуты до 90 дней от текущей даты: https://developer.tbank.ru/eacq/api/init
 * Смещение `+03:00` повторяет пример документации: у Москвы постоянное смещение от UTC. Доли
 * секунды отбрасываются, поэтому форма закрывается не позже переданного мгновения.
 */
export function redirectDueDate(at: Date): string {
  const moscow = new Date(at.getTime() + moscowOffsetMilliseconds);
  return `${moscow.toISOString().slice(0, 19)}+03:00`;
}

/**
 * Узкий шов исходящего запроса к банку. Он описывает ровно то, что нужно адаптеру, поэтому
 * подходит и встроенный `fetch`, и клиент с собственным корневым сертификатом.
 */
export type BankResponse = { readonly ok: boolean; json(): Promise<unknown> };
export type BankRequest = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    redirect: "error";
  },
) => Promise<BankResponse>;

// Concrete T-Bank adapter. No automatic retries, caller persists sent/unknown before I/O.
export class Tbank {
  constructor(
    readonly config: TbankConfig,
    private readonly request: BankRequest = fetch,
  ) {}
  async init(input: {
    orderId: string;
    accountId: string;
    amount: number;
    name: string;
    email: string;
    returnPath?: string;
    /** Когда банк закроет форму оплаты: `RedirectDueDate`. */
    formExpiresAt: Date;
  }): Promise<BankPayment & { PaymentURL: string }> {
    const base = new URL(this.config.returnUrl);
    const returnUrl =
      input.returnPath === undefined ? base : new URL(input.returnPath, base);
    if (
      returnUrl.origin !== base.origin ||
      returnUrl.username !== "" ||
      returnUrl.password !== "" ||
      returnUrl.hash !== ""
    )
      throw new BankInitRefused(
        { reason: "request_invalid" },
        "Invalid purchase return path",
      );
    returnUrl.searchParams.set("purchaseRef", input.orderId);
    const result = await this.call("Init", {
      Amount: input.amount,
      OrderId: input.orderId,
      Description: input.name.slice(0, 140),
      CustomerKey: input.accountId,
      PayType: "O",
      DATA: { OperationInitiatorType: "0" },
      RedirectDueDate: redirectDueDate(input.formExpiresAt),
      SuccessURL: returnUrl.toString(),
      FailURL: returnUrl.toString(),
      NotificationURL: this.config.notificationUrl,
      Receipt: {
        Email: input.email,
        Taxation: this.config.receipt.taxation,
        Items: [
          {
            Name: input.name.slice(0, 128),
            Price: input.amount,
            Quantity: 1,
            Amount: input.amount,
            PaymentMethod: "full_payment",
            PaymentObject: "service",
            Tax: this.config.receipt.tax,
          },
        ],
      },
    });
    const declined = bankInitDeclinedSchema.safeParse(result);
    if (
      declined.success &&
      declined.data.TerminalKey === this.config.terminalKey &&
      (declined.data.OrderId ?? input.orderId) === input.orderId
    )
      throw new BankInitRefused(
        {
          reason: "declined",
          errorCode: declined.data.ErrorCode,
          message: declined.data.Message ?? null,
        },
        `Bank declined Init with error ${declined.data.ErrorCode}`,
      );
    const payment = bankPaymentSchema.parse(result);
    return {
      ...payment,
      PaymentURL: validatedPaymentUrl(
        notificationSchema.parse(result)["PaymentURL"],
        this.config.endpoints.formOrigins,
        input.orderId,
      ),
    };
  }
  async state(paymentId: string): Promise<BankPayment> {
    return bankPaymentSchema.parse(
      await this.call("GetState", { PaymentId: paymentId }),
    );
  }
  /**
   * Отменяет неоплаченную форму заказа. Адаптер сам читает GetState прямо перед Cancel и шлёт
   * Cancel, только если платёж этого заказа на этом терминале ещё `NEW` или `FORM_SHOWED`.
   * Cancel без Amount отменяет полную сумму. Оплаченный платёж Cancel вернул бы покупателю,
   * а возвраты идут только через кабинет банка (#1420): такой платёж возвращается без Cancel.
   */
  async cancel(input: { orderId: string; paymentId: string }): Promise<
    | { readonly sent: false; readonly payment: BankPayment }
    | {
        readonly sent: true;
        readonly payment: BankPayment;
        readonly result: BankCancel;
      }
  > {
    const payment = await this.state(input.paymentId);
    if (
      payment.TerminalKey !== this.config.terminalKey ||
      payment.OrderId !== input.orderId ||
      payment.PaymentId !== input.paymentId
    )
      throw new Error("Bank payment mismatch");
    if (
      !payment.Success ||
      payment.ErrorCode !== "0" ||
      !unpaidFormStatuses.includes(payment.Status)
    )
      return { sent: false, payment };
    const result = bankCancelSchema.parse(
      await this.call("Cancel", { PaymentId: input.paymentId }),
    );
    if (
      result.TerminalKey !== this.config.terminalKey ||
      result.OrderId !== input.orderId ||
      result.PaymentId !== input.paymentId
    )
      throw new Error("Bank cancel mismatch");
    return { sent: true, payment, result };
  }
  async order(orderId: string): Promise<readonly string[]> {
    const answer = await this.call("CheckOrder", { OrderId: orderId });
    // Заказ, по которому Init не создал платежа, банк не знает: боевой T-Bank 31.10.2026 ответил
    // Success:false, ErrorCode "335" («OrderId … не найден для TerminalKey …»). Это пустой список
    // платежей, а не сбой; любой другой отказ остаётся неизвестностью.
    if (orderNotFoundSchema.safeParse(answer).success) return [];
    // CheckOrder locates an attempt; its optional amount/error fields are not payment proof.
    const result = z
      .object({
        TerminalKey: z.string(),
        OrderId: z.string(),
        Success: success
          .transform((value) => value === true || value === "true")
          .pipe(z.literal(true)),
        ErrorCode: z.union([z.literal("0"), z.literal(0)]),
        Payments: z
          .array(
            z.object({
              PaymentId: reference,
              Status: z.string(),
              Success: success,
            }),
          )
          .max(100),
      })
      .parse(answer);
    if (
      result.TerminalKey !== this.config.terminalKey ||
      result.OrderId !== orderId
    )
      throw new Error("Bank order mismatch");
    return result.Payments.map((payment) => String(payment.PaymentId));
  }
  notification(input: unknown): BankPayment | undefined {
    const parsed = notificationSchema.safeParse(input);
    if (
      !parsed.success ||
      typeof parsed.data["Token"] !== "string" ||
      !/^[a-f0-9]{64}$/u.test(parsed.data["Token"])
    )
      return undefined;
    const expected = tbankToken(parsed.data, this.config.password);
    if (
      !timingSafeEqual(
        Buffer.from(parsed.data["Token"], "hex"),
        Buffer.from(expected, "hex"),
      )
    )
      return undefined;
    const payment = bankPaymentSchema.safeParse(parsed.data);
    return payment.success &&
      payment.data.TerminalKey === this.config.terminalKey
      ? payment.data
      : undefined;
  }
  sealBinding(orderId: string, rebillId: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(this.config.bindingEncryptionKey, "base64"),
      nonce,
    );
    cipher.setAAD(
      Buffer.from(
        `${this.config.environment}:${this.config.terminalKey}:${orderId}`,
      ),
    );
    const data = Buffer.concat([
      cipher.update(rebillId, "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString("base64");
  }
  openBinding(orderId: string, ciphertext: string): string {
    const data = Buffer.from(ciphertext, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(this.config.bindingEncryptionKey, "base64"),
      data.subarray(0, 12),
    );
    decipher.setAAD(
      Buffer.from(
        `${this.config.environment}:${this.config.terminalKey}:${orderId}`,
      ),
    );
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([
      decipher.update(data.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  }
  private async call(
    method:
      | "Init"
      | "GetState"
      | "CheckOrder"
      | "Charge"
      | "Cancel"
      | "AddCard"
      | "GetAddCardState",
    values: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const body = { ...values, TerminalKey: this.config.terminalKey };
    const response = await this.request(
      `${this.config.endpoints.apiBaseUrl}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...body,
          Token: tbankToken(body, this.config.password),
        }),
        signal: AbortSignal.timeout(bankTimeoutMs),
        redirect: "error",
      },
    );
    if (!response.ok) throw new Error("Bank response unavailable");
    return response.json();
  }
}
