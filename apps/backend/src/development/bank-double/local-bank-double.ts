import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { TbankConfig } from "../../config/tbank-config.js";
import { tbankToken } from "../../modules/billing/index.js";

/**
 * Двойник банка для локального стенда. Отвечает на тот же контракт, что настоящий терминал,
 * подписывает нотификации тем же алгоритмом и потому принимается приложением обычным путём:
 * выбор между ним и банком делает только конфигурация контура.
 *
 * Исход выбирает человек: платёж завершается на странице формы, а списание по сохранённой карте
 * и возврат — переключателем на главной странице, потому что у них нет формы. В отличие от банка
 * двойник отправляет нотификацию до ответа на действие: стенд остаётся предсказуемым и не требует
 * ожидания. Состояние живёт в памяти процесса, поэтому его перезапуск забывает прежние заказы;
 * незавершённые попытки самого приложения при этом сохраняются в базе.
 */
export interface LocalBankDouble {
  handle(request: Request): Promise<Response>;
}

type Notifier = (url: string, payload: Readonly<Record<string, unknown>>) => Promise<void>;

interface Dependencies {
  readonly config: TbankConfig;
  readonly notify?: Notifier;
}

interface RefundRecord {
  readonly status: string;
  readonly success: boolean;
  readonly errorCode: string;
  readonly newAmount: number;
}

interface OrderRecord {
  readonly orderId: string;
  readonly paymentId: string;
  readonly amount: number;
  readonly description: string;
  readonly email: string;
  readonly recurrent: boolean;
  readonly notificationUrl: string;
  readonly refunds: Map<string, RefundRecord>;
  status: string;
  success: boolean;
  errorCode: string;
  rebillId: string | undefined;
  refundedKopecks: number;
}

interface BindingRecord {
  readonly requestKey: string;
  readonly customerKey: string;
  status: string;
  success: boolean;
  errorCode: string;
  rebillId: string | undefined;
}

/** Исходы оплаты, которые стенд умеет воспроизвести по требованию владельца. */
const paymentOutcomes = {
  confirmed: { label: "Оплата прошла", status: "CONFIRMED", success: true, errorCode: "0" },
  rejected: { label: "Банк отказал", status: "REJECTED", success: false, errorCode: "1051" },
  canceled: { label: "Покупатель отменил", status: "CANCELED", success: false, errorCode: "0" },
  expired: { label: "Истёк срок оплаты", status: "DEADLINE_EXPIRED", success: false, errorCode: "0" },
  // Ответ без однозначного исхода: приложение обязано оставить попытку на сверку, а не списать снова.
  unknown: { label: "Непонятный ответ банка", status: "CONFIRMING", success: false, errorCode: "9999" },
} as const;
type PaymentOutcome = keyof typeof paymentOutcomes;
const bindingOutcomes = {
  completed: { label: "Карта привязана", status: "COMPLETED", success: true, errorCode: "0" },
  rejected: { label: "Привязка отклонена", status: "REJECTED", success: false, errorCode: "3000" },
} as const;
type BindingOutcome = keyof typeof bindingOutcomes;
// Списание по сохранённой карте и возврат идут без покупателя: их исход выбирается заранее.
const chargeOutcomes = ["confirmed", "rejected", "unknown"] as const satisfies readonly PaymentOutcome[];
type ChargeOutcome = typeof chargeOutcomes[number];
const refundOutcomes = { accepted: "Банк возвращает", declined: "Банк отказывает" } as const;
type RefundOutcome = keyof typeof refundOutcomes;
const isPaymentOutcome = (value: string): value is PaymentOutcome => Object.hasOwn(paymentOutcomes, value);
const isBindingOutcome = (value: string): value is BindingOutcome => Object.hasOwn(bindingOutcomes, value);
const isChargeOutcome = (value: string): value is ChargeOutcome => chargeOutcomes.some(outcome => outcome === value);
const isRefundOutcome = (value: string): value is RefundOutcome => Object.hasOwn(refundOutcomes, value);
const formValue = async (request: Request, name: string): Promise<string> =>
  new URLSearchParams(await request.text()).get(name) ?? "";

const requestSchema = z.object({ Token: z.string() }).loose();
const initSchema = z.object({
  OrderId: z.string().min(1), Amount: z.int().nonnegative(), Description: z.string().optional(),
  CustomerKey: z.string().optional(), NotificationURL: z.string().optional(), Recurrent: z.string().optional(),
  Receipt: z.object({ Email: z.string().optional() }).loose().optional(),
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
  const orders = new Map<string, OrderRecord>();
  const paymentIndex = new Map<string, string>();
  const bindings = new Map<string, BindingRecord>();
  let chargeOutcome: ChargeOutcome = "confirmed";
  let refundOutcome: RefundOutcome = "accepted";

  function event(order: OrderRecord): Record<string, unknown> {
    return {
      TerminalKey: config.terminalKey, OrderId: order.orderId, PaymentId: order.paymentId,
      Amount: order.amount, Status: order.status, Success: order.success, ErrorCode: order.errorCode,
      ...(order.rebillId === undefined ? {} : { RebillId: order.rebillId }),
    };
  }

  /** Один исход платежа: состояние заказа и подписанная нотификация тем же путём, что у банка. */
  async function settle(order: OrderRecord, outcome: PaymentOutcome): Promise<void> {
    const applied = paymentOutcomes[outcome];
    order.status = applied.status;
    order.success = applied.success;
    order.errorCode = applied.errorCode;
    // Привязку банк выдаёт только оплатившему заказу, который её просил.
    if (outcome === "confirmed" && order.recurrent && order.rebillId === undefined)
      order.rebillId = `${Math.floor(Math.random() * 900_000_000) + 100_000_000}`;
    await announce(order);
  }

  async function announce(order: OrderRecord): Promise<void> {
    const body = event(order);
    await notify(order.notificationUrl, { ...body, Token: tbankToken(body, config.password) });
  }

  function api(method: string, body: z.infer<typeof requestSchema>): Response {
    if (method === "Init") {
      const input = initSchema.parse(body);
      const known = orders.get(input.OrderId);
      if (known) return Response.json({ ...event(known), Success: true, ErrorCode: "0", PaymentURL: paymentForm(known) });
      const paymentId = `${Math.floor(Math.random() * 900_000_000_000) + 100_000_000_000}`;
      const order: OrderRecord = {
        orderId: input.OrderId, paymentId, amount: input.Amount, description: input.Description ?? "Покупка",
        email: input.Receipt?.Email ?? "", recurrent: input.Recurrent === "Y",
        notificationUrl: input.NotificationURL ?? config.notificationUrl,
        refunds: new Map(), status: "NEW", success: true, errorCode: "0", rebillId: undefined, refundedKopecks: 0,
      };
      orders.set(order.orderId, order);
      paymentIndex.set(paymentId, order.orderId);
      return Response.json({ ...event(order), PaymentURL: paymentForm(order) });
    }
    if (method === "GetState") return Response.json(event(order(paymentReferenceSchema.parse(body).PaymentId)));
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
      bindings.set(requestKey, { requestKey, customerKey: input.CustomerKey, status: "NEW", success: true, errorCode: "0", rebillId: undefined });
      return Response.json({
        TerminalKey: config.terminalKey, Success: true, ErrorCode: "0", RequestKey: requestKey,
        PaymentURL: `${formOrigin}/card/${requestKey}`,
      });
    }
    if (method === "GetAddCardState") {
      const requestKey = requestKeySchema.parse(body).RequestKey;
      const session = bindings.get(requestKey);
      if (!session) return Response.json({ Success: false, ErrorCode: "7", Message: "Unknown binding session" });
      return Response.json({
        TerminalKey: config.terminalKey, RequestKey: session.requestKey, Status: session.status,
        Success: session.success, ErrorCode: session.errorCode,
        ...(session.rebillId === undefined ? {} : { RebillId: session.rebillId }),
      });
    }
    throw new Error(`Unsupported bank method ${method}`);
  }

  /**
   * Возврат исполняется сразу и закреплён за `ExternalRequestId`: повтор той же попытки — тот же
   * ответ и та же сумма. Частичным возврат делает сама запрошенная сумма, как в банке.
   */
  function cancel(body: z.infer<typeof requestSchema>): Response {
    const input = cancelSchema.parse(body);
    const known = order(input.PaymentId);
    const replay = known.refunds.get(input.ExternalRequestId);
    const answer = (refund: RefundRecord) => Response.json({
      TerminalKey: config.terminalKey, OrderId: known.orderId, PaymentId: known.paymentId,
      Status: refund.status, Success: refund.success, ErrorCode: refund.errorCode,
      OriginalAmount: known.amount, NewAmount: refund.newAmount,
    });
    if (replay) return answer(replay);
    const remaining = known.amount - known.refundedKopecks;
    if (refundOutcome === "declined" || input.Amount > remaining || input.Amount === 0) {
      const refused: RefundRecord = { status: "REJECTED", success: false, errorCode: "3007", newAmount: remaining };
      known.refunds.set(input.ExternalRequestId, refused);
      return answer(refused);
    }
    known.refundedKopecks += input.Amount;
    const settled: RefundRecord = {
      status: known.refundedKopecks >= known.amount ? "REFUNDED" : "PARTIAL_REFUNDED",
      success: true, errorCode: "0", newAmount: known.amount - known.refundedKopecks,
    };
    known.refunds.set(input.ExternalRequestId, settled);
    known.status = settled.status;
    return answer(settled);
  }

  function order(paymentId: string | number): OrderRecord {
    const known = orders.get(paymentIndex.get(String(paymentId)) ?? "");
    if (!known) throw new Error(`Unknown payment ${String(paymentId)}`);
    return known;
  }
  const paymentForm = (value: OrderRecord) => `${formOrigin}/pay/${value.paymentId}`;

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "GET" && path === "/health")
      return Response.json({ process: "bank-double", status: "ready", terminal: config.terminalKey });
    if (request.method === "POST" && path.startsWith("/v2/")) {
      const body = requestSchema.parse(await request.json());
      if (tbankToken(body, config.password) !== body.Token)
        return Response.json({ Success: false, ErrorCode: "9999", Message: "Invalid token" });
      const method = path.slice("/v2/".length);
      if (method === "Charge") {
        const known = order(paymentReferenceSchema.parse(body).PaymentId);
        await settle(known, chargeOutcome);
        return Response.json(event(known));
      }
      if (method === "Cancel") return cancel(body);
      return api(method, body);
    }
    if (request.method === "GET" && path === "/") return html(indexPage());
    if (request.method === "POST" && path === "/control") {
      const form = new URLSearchParams(await request.text());
      const charge = form.get("chargeOutcome") ?? "";
      const refund = form.get("refundOutcome") ?? "";
      if (isChargeOutcome(charge)) chargeOutcome = charge;
      if (isRefundOutcome(refund)) refundOutcome = refund;
      return redirect("/");
    }
    if (path.startsWith("/pay/")) {
      const known = orders.get(paymentIndex.get(path.slice("/pay/".length)) ?? "");
      if (!known) return html(missingPage("Платёж не найден"), 404);
      if (request.method === "GET") return html(paymentPage(known));
      const outcome = await formValue(request, "outcome");
      if (outcome === "repeat") await announce(known);
      else if (isPaymentOutcome(outcome)) await settle(known, outcome);
      else return html(missingPage("Неизвестный исход"), 400);
      return redirect(config.returnUrl);
    }
    if (path.startsWith("/card/")) {
      const session = bindings.get(path.slice("/card/".length));
      if (!session) return html(missingPage("Сессия привязки не найдена"), 404);
      if (request.method === "GET") return html(bindingPage(session));
      const outcome = await formValue(request, "outcome");
      if (!isBindingOutcome(outcome)) return html(missingPage("Неизвестный исход"), 400);
      const applied = bindingOutcomes[outcome];
      session.status = applied.status;
      session.success = applied.success;
      session.errorCode = applied.errorCode;
      if (outcome === "completed") session.rebillId = `${Math.floor(Math.random() * 900_000_000) + 100_000_000}`;
      return redirect(config.returnUrl);
    }
    return html(missingPage("Такой страницы у двойника нет"), 404);
  }

  function indexPage(): string {
    const rows = [...orders.values()].map(value => `<tr><td><a href="/pay/${value.paymentId}">${escape(value.description)}</a></td>
      <td>${money(value.amount)}</td><td>${escape(value.status)}</td><td>${escape(value.email)}</td>
      <td>${value.refundedKopecks === 0 ? "—" : money(value.refundedKopecks)}</td></tr>`).join("");
    const sessions = [...bindings.values()].map(value => `<tr><td><a href="/card/${value.requestKey}">${value.requestKey}</a></td>
      <td>${escape(value.status)}</td></tr>`).join("");
    return `<h1>Двойник банка Inside</h1>
      <p class="note">Стенд без денег: терминал <b>${escape(config.terminalKey)}</b>, нотификации уходят на
      <code>${escape(config.notificationUrl)}</code>, возврат после формы — на <code>${escape(config.returnUrl)}</code>.</p>
      <form method="post" action="/control">
        <h2>Исход без формы</h2>
        <p>Списание по сохранённой карте (продление) и возврат происходят без участия покупателя,
        поэтому их исход выбирается заранее.</p>
        <label>Следующее списание
          <select name="chargeOutcome">${options(chargeOutcomes.map(key =>
            [key, paymentOutcomes[key].label] as const), chargeOutcome)}</select></label>
        <label>Возврат
          <select name="refundOutcome">${options(Object.entries(refundOutcomes), refundOutcome)}</select></label>
        <button type="submit">Сохранить</button>
      </form>
      <h2>Заказы</h2>
      ${rows ? `<table><tr><th>Заказ</th><th>Сумма</th><th>Статус</th><th>Чек</th><th>Возвращено</th></tr>${rows}</table>`
        : "<p class=\"note\">Пока ни одной оплаты.</p>"}
      <h2>Привязки карты</h2>
      ${sessions ? `<table><tr><th>Сессия</th><th>Статус</th></tr>${sessions}</table>`
        : "<p class=\"note\">Пока ни одной сессии привязки.</p>"}`;
  }

  function paymentPage(value: OrderRecord): string {
    const buttons = Object.entries(paymentOutcomes).map(([key, outcome]) =>
      `<button type="submit" name="outcome" value="${key}">${outcome.label}</button>`).join("");
    return `<h1>${escape(value.description)}</h1>
      <p class="amount">${money(value.amount)}</p>
      <p class="note">Заказ ${escape(value.orderId)} · платёж ${escape(value.paymentId)} · статус ${escape(value.status)}
      ${value.recurrent ? "· покупатель разрешил сохранить карту" : ""}</p>
      <form method="post">${buttons}
        <button type="submit" name="outcome" value="repeat">Повторить нотификацию</button></form>
      <p class="note"><a href="/">Ко всем заказам</a></p>`;
  }

  function bindingPage(value: BindingRecord): string {
    const buttons = Object.entries(bindingOutcomes).map(([key, outcome]) =>
      `<button type="submit" name="outcome" value="${key}">${outcome.label}</button>`).join("");
    return `<h1>Привязка карты</h1>
      <p class="note">Сессия ${escape(value.requestKey)} · покупатель ${escape(value.customerKey)} · статус ${escape(value.status)}</p>
      <form method="post">${buttons}</form>
      <p class="note"><a href="/">Ко всем заказам</a></p>`;
  }

  return { handle };
}

const missingPage = (message: string) => `<h1>${escape(message)}</h1><p class="note"><a href="/">Ко всем заказам</a></p>`;
const money = (kopecks: number) => `${(kopecks / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2 })} ₽`;
const options = (values: readonly (readonly [string, string])[], selected: string) => values
  .map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${escape(label)}</option>`).join("");

function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function html(body: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Двойник банка Inside</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:46rem;padding:1.5rem;color:#14213d}
h1{font-size:1.5rem}h2{font-size:1.1rem;margin-top:2rem}.note{color:#5b6478;font-size:.9rem}
.amount{font-size:2rem;font-weight:700;margin:.25rem 0}table{border-collapse:collapse;width:100%}
th,td{border-bottom:1px solid #dfe3ec;padding:.5rem;text-align:left;font-size:.95rem}
button{margin:.25rem .5rem .25rem 0;padding:.6rem 1rem;border:1px solid #14213d;border-radius:.4rem;
background:#fff;cursor:pointer;font:inherit}button:hover{background:#eef1f8}
label{display:block;margin:.5rem 0}select{font:inherit;padding:.3rem;margin-left:.5rem}
a{color:#1b4dc1}</style></head><body>${body}</body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

const redirect = (location: string) => new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });

/** Нотификация уходит тем же способом, что у банка: обычный POST на адрес приложения. */
async function postNotification(url: string, payload: Readonly<Record<string, unknown>>): Promise<void> {
  const response = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  console.log(JSON.stringify({ process: "bank-double", notification: payload.Status, order: payload.OrderId, accepted: response.ok }));
}
