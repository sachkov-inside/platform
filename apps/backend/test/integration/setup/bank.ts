import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Tbank, tbankToken } from "../../../src/modules/billing/infrastructure/tbank/tbank.js";

type TbankConfig = ConstructorParameters<typeof Tbank>[0];

const requestSchema = z.object({ OrderId: z.string().optional(), PaymentId: z.string().optional(), RequestKey: z.string().optional(),
  Amount: z.number().optional(), CustomerKey: z.string().optional(), Token: z.string() }).loose();

/**
 * Управляемый банк одного сценария: Init сам ничего не подтверждает, а исход Charge и привязки
 * задаёт тест. Держит порядки и сессии в памяти, поэтому не делает сетевых вызовов.
 */
export class BankFixture {
  constructor(private readonly config: TbankConfig) {}
  readonly orders = new Map<string, { paymentId: string; amount: number; status: string }>();
  readonly sessions = new Set<string>();
  private readonly scope = randomUUID();
  initCalls = 0; chargeCalls = 0; addCardCalls = 0;
  chargeOutcome = "CONFIRMED"; failCharge = false; failInit = false;
  binding: { status: string; success: boolean; rebillId: string | undefined } = { status: "COMPLETED", success: true, rebillId: "synthetic-new-card" };

  event(orderId: string, extra: Record<string, unknown> = {}) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error("Unknown synthetic order");
    return { TerminalKey: this.config.terminalKey, OrderId: orderId, PaymentId: order.paymentId, Amount: order.amount,
      Status: order.status, Success: true, ErrorCode: "0", ...extra };
  }
  notify(orderId: string, status: string, extra: Record<string, unknown> = {}) {
    const order = this.orders.get(orderId);
    if (order) order.status = status;
    const body = this.event(orderId, { Status: status, ...extra });
    return { ...body, Token: tbankToken(body, this.config.password) };
  }
  settle(orderId: string, status: string): void {
    const order = this.orders.get(orderId);
    if (!order) throw new Error("Unknown synthetic order");
    order.status = status;
  }
  client(): Tbank {
    return new Tbank(this.config, (url, init) => Promise.resolve(this.respond(url, init)));
  }
  private respond(url: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): Response {
    if (typeof url !== "string" || typeof init?.body !== "string") throw new Error("Unexpected bank request");
    const body = requestSchema.parse(JSON.parse(init.body));
    if (url.endsWith("/Init")) {
      this.initCalls += 1;
      const orderId = z.string().parse(body.OrderId);
      this.orders.set(orderId, { paymentId: `${this.scope}-${this.orders.size + 1}`, amount: z.number().parse(body.Amount), status: "NEW" });
      if (this.failInit) throw new Error("Synthetic Init timeout after bank acceptance");
      return Response.json({ ...this.event(orderId), PaymentURL: "https://securepay.tinkoff.ru/test" });
    }
    if (url.endsWith("/Charge")) {
      this.chargeCalls += 1;
      const entry = this.byPayment(z.string().parse(body.PaymentId));
      if (this.failCharge) throw new Error("Synthetic Charge timeout after bank acceptance");
      entry[1].status = this.chargeOutcome;
      return Response.json(this.event(entry[0]));
    }
    if (url.endsWith("/GetState")) return Response.json(this.event(this.byPayment(z.string().parse(body.PaymentId))[0]));
    if (url.endsWith("/CheckOrder")) {
      const orderId = z.string().parse(body.OrderId);
      const order = this.orders.get(orderId);
      return Response.json({ Success: true, ErrorCode: "0", TerminalKey: this.config.terminalKey, OrderId: orderId,
        Payments: order ? [{ PaymentId: order.paymentId, Status: order.status, Success: true }] : [] });
    }
    if (url.endsWith("/AddCard")) {
      this.addCardCalls += 1;
      const requestKey = `${this.scope}-binding-${this.addCardCalls}`;
      this.sessions.add(requestKey);
      return Response.json({ Success: true, ErrorCode: "0", TerminalKey: this.config.terminalKey, RequestKey: requestKey,
        PaymentURL: "https://securepay.tinkoff.ru/binding" });
    }
    if (url.endsWith("/GetAddCardState")) {
      const requestKey = z.string().parse(body.RequestKey);
      if (!this.sessions.has(requestKey)) throw new Error("Unknown synthetic binding session");
      return Response.json({ TerminalKey: this.config.terminalKey, RequestKey: requestKey, Status: this.binding.status,
        Success: this.binding.success, ErrorCode: this.binding.success ? "0" : "3000",
        ...(this.binding.rebillId === undefined ? {} : { RebillId: this.binding.rebillId }) });
    }
    throw new Error(`Unexpected bank method ${url}`);
  }
  private byPayment(paymentId: string): [string, { paymentId: string; amount: number; status: string }] {
    const entry = [...this.orders].find(([, order]) => order.paymentId === paymentId);
    if (!entry) throw new Error("Unknown synthetic payment");
    return entry;
  }
}

