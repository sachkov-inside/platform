import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { TbankConfig } from "../../config/tbank-config.js";
import { tbankToken } from "../../modules/billing/index.js";
import { bindingPage, html, indexPage, missingPage, paymentPage } from "./bank-double-pages.js";
import {
  bankReference, bindingOutcomes, declinedBindingOutcome, isChargeOutcome, isKnownOutcome,
  loadBankLedger, paymentOutcomes, refundOutcomes, saveBankLedger, operationNotFoundOutcome,
  type BankLedger, type BankOutcome, type BindingRecord, type ChargeOutcome, type OrderRecord,
  type PaymentOutcome, type RefundOutcome, type RefundRecord,
} from "./bank-double-state.js";

/**
 * Двойник банка для локального стенда. Отвечает на тот же контракт, что настоящий терминал,
 * подписывает нотификации тем же алгоритмом и потому принимается приложением обычным путём:
 * выбор между ним и банком делает только конфигурация контура.
 *
 * Исход выбирает человек: платёж завершается на странице формы, а списание по сохранённой карте
 * и возврат — переключателем на главной странице, потому что у них нет формы. В отличие от банка
 * двойник отправляет нотификацию до ответа на действие: стенд остаётся предсказуемым и не требует
 * ожидания.
 */
export interface LocalBankDouble {
  handle(request: Request): Promise<Response>;
}

type Notifier = (url: string, payload: Readonly<Record<string, unknown>>) => Promise<void>;

interface Dependencies {
  readonly config: TbankConfig;
  readonly notify?: Notifier;
  /** Файл журнала стенда. Без него двойник живёт только в памяти процесса. */
  readonly ledgerPath?: string;
}

// Одна честная попытка дойти до приложения; повтор нотификации остаётся действием человека.
const notificationTimeoutMs = 10_000;
const paymentReferenceDigits = 12;
const savedMethodDigits = 9;

const requestSchema = z.object({ Token: z.string() }).loose();
const initSchema = z.object({
  OrderId: z.string().min(1), Amount: z.int().nonnegative(), Description: z.string().optional(),
  CustomerKey: z.string().optional(), NotificationURL: z.string().optional(), Recurrent: z.string().optional(),
  Receipt: z.object({ Email: z.string().optional() }).loose().optional(),
}).loose();
const chargeSchema = z.object({
  PaymentId: z.union([z.string(), z.number()]), RebillId: z.union([z.string(), z.number()]),
}).loose();
const paymentReferenceSchema = z.object({ PaymentId: z.union([z.string(), z.number()]) }).loose();
const cancelSchema = z.object({
  PaymentId: z.union([z.string(), z.number()]), Amount: z.int().nonnegative(), ExternalRequestId: z.string().min(1),
}).loose();
const orderReferenceSchema = z.object({ OrderId: z.string().min(1) }).loose();
const addCardSchema = z.object({ CustomerKey: z.string().min(1), CheckType: z.string().min(1) }).loose();
const requestKeySchema = z.object({ RequestKey: z.string().min(1) }).loose();

export function createLocalBankDouble(dependencies: Dependencies): LocalBankDouble {
  const { config } = dependencies;
  const notify = dependencies.notify ?? postNotification;
  const formOrigin = config.endpoints.formOrigins[0] ?? "";
  const stored = loadBankLedger(dependencies.ledgerPath);
  const orders = new Map<string, OrderRecord>(stored.orders.map(order =>
    [order.orderId, { ...order, refunds: new Map(order.refunds) }]));
  const paymentIndex = new Map<string, string>([...orders.values()].map(order => [order.paymentId, order.orderId]));
  const bindings = new Map<string, BindingRecord>(stored.bindings.map(session => [session.requestKey, session]));
  // Банк знает, какие привязки он выдал: списание по чужому `RebillId` он не исполняет.
  const savedMethods = new Set<string>(stored.savedMethods);
  let chargeOutcome: ChargeOutcome = stored.chargeOutcome;
  let refundOutcome: RefundOutcome = stored.refundOutcome;

  function persist(): void {
    const ledger: BankLedger = {
      orders: [...orders.values()].map(order => ({ ...order, refunds: [...order.refunds] })),
      bindings: [...bindings.values()], savedMethods: [...savedMethods], chargeOutcome, refundOutcome,
    };
    saveBankLedger(dependencies.ledgerPath, ledger);
  }

  const event = (order: OrderRecord, outcome: BankOutcome = order): Record<string, unknown> => ({
    TerminalKey: config.terminalKey, OrderId: order.orderId, PaymentId: order.paymentId,
    Amount: order.amount, Status: outcome.status, Success: outcome.success, ErrorCode: outcome.errorCode,
    ...(order.rebillId === undefined ? {} : { RebillId: order.rebillId }),
  });

  /** Один исход платежа: состояние заказа и подписанная нотификация тем же путём, что у банка. */
  async function settle(order: OrderRecord, outcome: PaymentOutcome): Promise<void> {
    apply(order, paymentOutcomes[outcome]);
    // Привязку банк выдаёт только оплатившему заказу, который её просил.
    if (outcome === "confirmed" && order.recurrent && order.rebillId === undefined) {
      order.rebillId = bankReference(savedMethodDigits);
      savedMethods.add(order.rebillId);
    }
    persist();
    await announce(order);
  }

  function apply(order: OrderRecord, outcome: BankOutcome): void {
    order.status = outcome.status;
    order.success = outcome.success;
    order.errorCode = outcome.errorCode;
  }

  async function announce(order: OrderRecord, outcome: BankOutcome = order): Promise<void> {
    const body = event(order, outcome);
    await notify(order.notificationUrl, { ...body, Token: tbankToken(body, config.password) });
  }

  async function api(method: string, body: z.infer<typeof requestSchema>): Promise<Response> {
    if (method === "Charge") return await charge(body);
    if (method === "Cancel") return await cancel(body);
    if (method === "Init") {
      const input = initSchema.parse(body);
      const known = orders.get(input.OrderId);
      if (known) return Response.json({ ...event(known), Success: true, ErrorCode: "0", PaymentURL: paymentForm(known) });
      const paymentId = bankReference(paymentReferenceDigits);
      const order: OrderRecord = {
        orderId: input.OrderId, paymentId, amount: input.Amount, description: input.Description ?? "Покупка",
        email: input.Receipt?.Email ?? "", recurrent: input.Recurrent === "Y",
        notificationUrl: input.NotificationURL ?? config.notificationUrl,
        refunds: new Map(), status: "NEW", success: true, errorCode: "0", refundedKopecks: 0,
      };
      orders.set(order.orderId, order);
      paymentIndex.set(paymentId, order.orderId);
      persist();
      return Response.json({ ...event(order), PaymentURL: paymentForm(order) });
    }
    if (method === "GetState") {
      const paymentId = paymentReferenceSchema.parse(body).PaymentId;
      const known = orderByPayment(paymentId);
      return Response.json(known ? event(known) : notFound(paymentId));
    }
    if (method === "CheckOrder") {
      const orderId = orderReferenceSchema.parse(body).OrderId;
      const known = orders.get(orderId);
      return Response.json({
        TerminalKey: config.terminalKey, OrderId: orderId, Success: true, ErrorCode: "0",
        Payments: known ? [{ PaymentId: known.paymentId, Status: known.status, Success: known.success }] : [],
      });
    }
    if (method === "AddCard") {
      const input = addCardSchema.parse(body);
      const requestKey = randomUUID();
      bindings.set(requestKey, { requestKey, customerKey: input.CustomerKey, status: "NEW", success: true, errorCode: "0" });
      persist();
      return Response.json({
        TerminalKey: config.terminalKey, Success: true, ErrorCode: "0", RequestKey: requestKey,
        PaymentURL: `${formOrigin}/card/${requestKey}`,
      });
    }
    if (method === "GetAddCardState") {
      const requestKey = requestKeySchema.parse(body).RequestKey;
      const session = bindings.get(requestKey);
      if (!session) return Response.json({
        Success: operationNotFoundOutcome.success, ErrorCode: operationNotFoundOutcome.errorCode,
        Message: "Binding session is unknown to the stand",
      });
      return Response.json({
        TerminalKey: config.terminalKey, RequestKey: session.requestKey, Status: session.status,
        Success: session.success, ErrorCode: session.errorCode,
        ...(session.rebillId === undefined ? {} : { RebillId: session.rebillId }),
      });
    }
    throw new Error(`Unsupported bank method ${method}`);
  }

  /** Списание по сохранённой карте: чужая или забытая привязка отклоняется, как в банке. */
  async function charge(body: z.infer<typeof requestSchema>): Promise<Response> {
    const input = chargeSchema.parse(body);
    const known = orderByPayment(input.PaymentId);
    if (!known) return Response.json(notFound(input.PaymentId));
    if (!savedMethods.has(String(input.RebillId))) {
      apply(known, declinedBindingOutcome);
      persist();
      await announce(known);
      return Response.json(event(known));
    }
    await settle(known, chargeOutcome);
    return Response.json(event(known));
  }

  /**
   * Возврат исполняется сразу и закреплён за `ExternalRequestId`: повтор той же попытки не
   * возвращает деньги второй раз. Запомнен только состоявшийся возврат — отказ банка не становится
   * вечным ответом на эту попытку. Частичным возврат делает сама запрошенная сумма, как в банке.
   */
  async function cancel(body: z.infer<typeof requestSchema>): Promise<Response> {
    const input = cancelSchema.parse(body);
    const known = orderByPayment(input.PaymentId);
    if (!known) return Response.json(notFound(input.PaymentId));
    const answer = (refund: RefundRecord) => Response.json({
      TerminalKey: config.terminalKey, OrderId: known.orderId, PaymentId: known.paymentId,
      Status: refund.status, Success: refund.success, ErrorCode: refund.errorCode,
      OriginalAmount: known.amount, NewAmount: refund.newAmount,
    });
    const replay = known.refunds.get(input.ExternalRequestId);
    if (replay) return answer(replay);
    const remaining = known.amount - known.refundedKopecks;
    if (refundOutcome === "declined" || input.Amount > remaining || input.Amount === 0) {
      return answer({ status: "REJECTED", success: false, errorCode: "3007", newAmount: remaining });
    }
    known.refundedKopecks += input.Amount;
    const settled: RefundRecord = {
      status: known.refundedKopecks >= known.amount ? "REFUNDED" : "PARTIAL_REFUNDED",
      success: true, errorCode: "0", newAmount: known.amount - known.refundedKopecks,
    };
    known.refunds.set(input.ExternalRequestId, settled);
    apply(known, settled);
    persist();
    // Возврат банк сообщает так же, как оплату: приложение принимает его обычным путём.
    await announce(known);
    return answer(settled);
  }

  const notFound = (paymentId: string | number): Record<string, unknown> => ({
    TerminalKey: config.terminalKey, PaymentId: String(paymentId), Status: operationNotFoundOutcome.status,
    Success: operationNotFoundOutcome.success, ErrorCode: operationNotFoundOutcome.errorCode,
    Message: "Payment is unknown to the stand",
  });
  const orderByPayment = (paymentId: string | number): OrderRecord | undefined =>
    orders.get(paymentIndex.get(String(paymentId)) ?? "");
  const paymentForm = (order: OrderRecord) => `${formOrigin}/pay/${order.paymentId}`;

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "GET" && path === "/health")
      return Response.json({ process: "bank-double", status: "ready", terminal: config.terminalKey });
    if (request.method === "POST" && path.startsWith("/v2/")) {
      const body = requestSchema.parse(await request.json());
      if (tbankToken(body, config.password) !== body.Token)
        return Response.json({ Success: false, ErrorCode: "9999", Message: "Invalid token" });
      return await api(path.slice("/v2/".length), body);
    }
    if (request.method === "GET" && path === "/") return html(indexPage({
      terminalKey: config.terminalKey, notificationUrl: config.notificationUrl, returnUrl: config.returnUrl,
      orders: [...orders.values()], bindings: [...bindings.values()], chargeOutcome, refundOutcome,
    }));
    if (request.method === "POST" && path === "/control") {
      const form = new URLSearchParams(await request.text());
      const chosenCharge = form.get("chargeOutcome") ?? "";
      const chosenRefund = form.get("refundOutcome") ?? "";
      if (isChargeOutcome(chosenCharge)) chargeOutcome = chosenCharge;
      if (isKnownOutcome(refundOutcomes, chosenRefund)) refundOutcome = chosenRefund;
      persist();
      return redirect("/");
    }
    if (path.startsWith("/pay/")) {
      const known = orderByPayment(path.slice("/pay/".length));
      if (!known) return html(missingPage("Платёж не найден"), 404);
      if (request.method === "GET") return html(paymentPage(known));
      const outcome = await formValue(request, "outcome");
      if (outcome === "repeat" && known.status !== "NEW") await announce(known);
      else if (isKnownOutcome(paymentOutcomes, outcome)) await settle(known, outcome);
      else return html(missingPage("Неизвестный исход"), 400);
      return redirect(config.returnUrl);
    }
    if (path.startsWith("/card/")) {
      const session = bindings.get(path.slice("/card/".length));
      if (!session) return html(missingPage("Сессия привязки не найдена"), 404);
      if (request.method === "GET") return html(bindingPage(session));
      const outcome = await formValue(request, "outcome");
      if (!isKnownOutcome(bindingOutcomes, outcome)) return html(missingPage("Неизвестный исход"), 400);
      const applied = bindingOutcomes[outcome];
      session.status = applied.status;
      session.success = applied.success;
      session.errorCode = applied.errorCode;
      if (outcome === "completed") {
        session.rebillId = bankReference(savedMethodDigits);
        savedMethods.add(session.rebillId);
      }
      persist();
      return redirect(config.returnUrl);
    }
    return html(missingPage("Такой страницы у двойника нет"), 404);
  }

  return { handle };
}

const formValue = async (request: Request, name: string): Promise<string> =>
  new URLSearchParams(await request.text()).get(name) ?? "";

const redirect = (location: string) => new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });

/** Нотификация уходит тем же способом, что у банка: обычный POST на адрес приложения. */
async function postNotification(url: string, payload: Readonly<Record<string, unknown>>): Promise<void> {
  const response = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(notificationTimeoutMs),
  });
  console.log(JSON.stringify({ process: "bank-double", notification: payload.Status, order: payload.OrderId, accepted: response.ok }));
}
