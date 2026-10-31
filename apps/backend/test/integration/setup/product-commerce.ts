import type { LegalDocument } from "../../../src/modules/accounts/facets/billing-contact/billing-contact.contract.js";
import { CoverageCatalog } from "../../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { ProductDiscovery } from "../../../src/modules/products/index.js";
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { z } from "zod";
import {
  assembleAccounts,
  BillingContact,
} from "../../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleAccessGrants } from "../../../src/modules/account-rights/index.js";
import {
  BillingPayments,
  BillingPricing,
} from "../../../src/modules/billing/index.js";
import {
  Tbank,
  tbankToken,
} from "../../../src/modules/billing/infrastructure/tbank/tbank.js";
import { syntheticTbankConfig } from "../../support/bank-terminal.js";
import {
  syntheticConsentDocument,
  pressedPaymentButton,
} from "./consent-documents.js";
import { type TestDatabase } from "./test-database.js";
export function commerceValue<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

const value = commerceValue;
export function createProductCommerceFixture(db: TestDatabase, owner: string) {
  let now = new Date("2030-01-31T10:00:00Z");
  const config = syntheticTbankConfig({
    environment: "demo",
    terminalKey: "PRODUCTDEMO",
    password: "synthetic-password",
    bindingEncryptionKey: Buffer.alloc(32, 43).toString("base64"),
    minimumKopecks: 100,
    maximumKopecks: 1_000_000,
    returnUrl: "https://inside.example.test/account",
    notificationUrl: "https://inside.example.test/billing/tbank/notification",
    receipt: { taxation: "usn_income", tax: "none" },
  });
  function setupFacets(legalDocuments?: readonly LegalDocument[]) {
    const accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "product-buyer-test-fingerprint-key-000000",
    });
    const grants = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
      contentCatalog: new CoverageCatalog(
        db.prisma,
        new ProductDiscovery(db.prisma),
      ),
      clock: () => now,
    });
    const pricing = new BillingPricing({
      contentCatalog: new CoverageCatalog(
        db.prisma,
        new ProductDiscovery(db.prisma),
      ),
      prisma: db.prisma,
      accounts,
      sale: { payments: true },
      clock: () => now,
    });
    const document = legalDocuments?.find(
      (document) => document.kind === "terms",
    ) ?? {
      ...syntheticConsentDocument("terms", { appliesTo: ["one_time"] }),
      commercialModel: "product-lifetime-v1" as const,
    };
    const contact = new BillingContact({
      prisma: db.prisma,
      emailFingerprintKey: "product-buyer-test-fingerprint-key-000000",
      protection: billingContactProtection(
        Buffer.alloc(32, 42).toString("base64"),
      ),
      documents: legalDocuments ?? [document],
      now: () => now,
      sendCode: () => Promise.resolve(),
    });
    return { accounts, grants, pricing, document, contact };
  }
  async function scenario(
    options: {
      productId?: string;
      discount?: number;
      usageLimit?: number;
      legalDocuments?: readonly LegalDocument[];
      /** The quote is priced by this individual Payment Link. */
      paymentLinkId?: string;
    } = {},
  ) {
    const buyer = randomUUID(),
      productId = options.productId ?? randomUUID();
    await db.prisma.account.create({
      data: {
        id: buyer,
        logtoIssuer: "https://identity.invalid",
        logtoSubject: buyer,
      },
    });
    if (options.productId === undefined)
      await db.prisma.product.create({
        data: { id: productId, name: "Курс", slug: productId },
      });
    const facets = setupFacets(options.legalDocuments);
    if (options.productId === undefined)
      value(
        await facets.pricing.manage(owner, {
          operation: "productPrices.save",
          operationId: randomUUID(),
          value: {
            productId,
            name: "Курс",
            priceKopecks: 200000,
            published: true,
          },
        }),
      );
    if (options.discount !== undefined)
      value(
        await facets.pricing.manage(owner, {
          operation: "promotions.save",
          operationId: randomUUID(),
          value: {
            id: randomUUID(),
            name: "Скидка",
            percent: options.discount,
            code: null,
            startsAt: "2020-01-01T00:00:00.000Z",
            endsAt: "2040-01-01T00:00:00.000Z",
            productIds: [productId],
            usageLimit: options.usageLimit ?? null,
          },
        }),
      );
    const quote = value(
      await facets.pricing.quote(buyer, {
        operationId: randomUUID(),
        productId,
        priceRevision: 1,
        ...(options.paymentLinkId === undefined
          ? {}
          : { paymentLinkId: options.paymentLinkId }),
      }),
    );
    const consent = await facets.contact.acceptConsents(
      buyer,
      pressedPaymentButton({
        operationId: randomUUID(),
        contextRef: quote.quoteRef,
        documents: [
          {
            kind: "terms",
            documentId: facets.document.documentId,
            version: facets.document.version,
            digest: facets.document.digest,
            accepted: true,
          },
        ],
      }),
    );
    if (!consent.ok) throw new Error(consent.error.code);
    const command = {
      operationId: randomUUID(),
      quoteRef: quote.quoteRef,
      email: "order@example.test",
      consentEvidenceRefs: consent.evidenceRefs,
    };
    let orderId = "",
      status = "NEW",
      initCalls = 0,
      timeout = false,
      stateCalls = 0,
      cancelFailures = 0,
      initGate: BankGate | undefined,
      stateGate: BankGate | undefined,
      afterState: ((paymentId: string) => void) | undefined;
    // Каждый Init получает свой PaymentId, как в банке: повторная покупка не делит платёж с прежней.
    const nextPaymentId = () => String(Math.floor(Math.random() * 1000000000));
    let paymentId = nextPaymentId();
    /** Платежи, созданные Init: GetState и Cancel отвечают о запрошенном платеже, а не о последнем. */
    const bankPayments = new Map<
      string,
      { orderId: string; status?: string }
    >();
    const cancelRequests: Record<string, unknown>[] = [];
    const paymentStatus = (id: string) =>
      bankPayments.get(id)?.status ?? status;
    const event = (nextStatus = status, extra = {}) => ({
      TerminalKey: config.terminalKey,
      OrderId: orderId,
      PaymentId: paymentId,
      Amount: quote.snapshot.firstPriceKopecks,
      Status: nextStatus,
      Success: true,
      ErrorCode: "0",
      ...extra,
    });
    const bank = new Tbank(config, async (url, init) => {
      const body = z
        .object({
          OrderId: z.string().optional(),
          PaymentId: z.string().optional(),
        })
        .loose()
        .parse(JSON.parse(init.body));
      if (url.endsWith("/Init")) {
        if (initCalls > 0) paymentId = nextPaymentId();
        initCalls++;
        orderId = z.string().parse(body.OrderId);
        const created = { orderId, paymentId };
        bankPayments.set(paymentId, { orderId });
        expect(body).toMatchObject({
          Amount: quote.snapshot.firstPriceKopecks,
        });
        expect(body).not.toHaveProperty("Recurrent");
        if (timeout) throw new Error("Synthetic lost Init answer");
        if (initGate !== undefined) {
          initGate.arrived();
          await initGate.released;
        }
        return Response.json({
          ...event(paymentStatus(created.paymentId), {
            OrderId: created.orderId,
            PaymentId: created.paymentId,
          }),
          PaymentURL: "https://securepay.tinkoff.ru/test",
        });
      }
      if (url.endsWith("/CheckOrder"))
        return Response.json({
          Success: true,
          ErrorCode: "0",
          TerminalKey: config.terminalKey,
          OrderId: body.OrderId,
          Payments: [
            {
              PaymentId: paymentId,
              Status: status,
              Success: true,
              ErrorCode: 0,
            },
          ],
        });
      if (url.endsWith("/GetState")) {
        stateCalls++;
        if (stateGate !== undefined) {
          stateGate.arrived();
          await stateGate.released;
        }
        const requested = z.string().parse(body.PaymentId);
        const known = bankPayments.get(requested);
        const answer =
          known === undefined
            ? event()
            : event(paymentStatus(requested), {
                OrderId: known.orderId,
                PaymentId: requested,
              });
        afterState?.(requested);
        return Response.json(answer);
      }
      // Cancel без Amount отменяет полную сумму. Неоплаченная форма закрывается со статусом
      // CANCELED; оплаченный платёж банк бы вернул, поэтому тесты проверяют, что такой Cancel не уходит.
      if (url.endsWith("/Cancel")) {
        cancelRequests.push(body);
        if (cancelFailures > 0) {
          cancelFailures--;
          throw new Error("Synthetic unavailable Cancel");
        }
        const requested = z.string().parse(body.PaymentId);
        const known = bankPayments.get(requested);
        if (known === undefined) throw new Error("Unknown bank payment");
        const before = paymentStatus(requested);
        const after =
          before === "NEW" || before === "FORM_SHOWED"
            ? "CANCELED"
            : before === "AUTHORIZED"
              ? "REVERSED"
              : before === "CONFIRMED"
                ? "REFUNDED"
                : before;
        known.status = after;
        return Response.json({
          TerminalKey: config.terminalKey,
          OrderId: known.orderId,
          PaymentId: requested,
          Status: after,
          Success: after !== before,
          ErrorCode: after !== before ? "0" : "4",
          OriginalAmount: quote.snapshot.firstPriceKopecks,
          NewAmount: 0,
        });
      }
      throw new Error("Recurring or unsupported bank operation");
    });
    const payments = new BillingPayments({
      contentCatalog: new CoverageCatalog(
        db.prisma,
        new ProductDiscovery(db.prisma),
      ),
      prisma: db.prisma,
      bank,
      contact: facets.contact,
      grants: facets.grants,
      clock: () => now,
    });
    const notify = (nextStatus: string, extra = {}) => {
      const body = event(nextStatus, extra);
      return payments.notification({
        ...body,
        Token: tbankToken(body, config.password),
      });
    };
    return {
      ...facets,
      buyer,
      productId,
      quote,
      command,
      payments,
      notify,
      initCalls: () => initCalls,
      stateCalls: () => stateCalls,
      paymentId: () => paymentId,
      loseInit: () => {
        timeout = true;
      },
      bank,
      event,
      config,
      setStatus: (next: string) => {
        status = next;
      },
      /** Состояние одного платежа в банке; остальные платежи следуют общему `setStatus`. */
      setPaymentStatus: (id: string, next: string) => {
        const known = bankPayments.get(id);
        if (known === undefined) throw new Error("Unknown bank payment");
        known.status = next;
      },
      cancelRequests: () => [...cancelRequests],
      /** Следующие `count` запросов Cancel не доходят до банка. */
      failCancel: (count = 1) => {
        cancelFailures = count;
      },
      /** Действие после ответа GetState: так покупатель платит между двумя запросами приложения. */
      afterState: (action: ((paymentId: string) => void) | undefined) => {
        afterState = action;
      },
      /**
       * Ответ на следующий Init ждёт `release`: тем временем приложение может снять попытку.
       * `arrived` завершается, когда Init дошёл до банка и платёж уже создан.
       */
      holdInit: () => {
        const gate = bankGate(() => {
          initGate = undefined;
        });
        initGate = gate.gate;
        return gate.control;
      },
      /** Ответ на следующий GetState ждёт `release`; `arrived` завершается, когда запрос дошёл до банка. */
      holdState: () => {
        const gate = bankGate(() => {
          stateGate = undefined;
        });
        stateGate = gate.gate;
        return gate.control;
      },
      /** Покупатель снова нажимает «Оплатить»: новый расчёт, новое согласие и новая команда покупки. */
      repeatCommand: async () => {
        const repeatQuote = value(
          await facets.pricing.quote(buyer, {
            operationId: randomUUID(),
            productId,
            priceRevision: 1,
          }),
        );
        const repeatConsent = await facets.contact.acceptConsents(
          buyer,
          pressedPaymentButton({
            operationId: randomUUID(),
            contextRef: repeatQuote.quoteRef,
            documents: [
              {
                kind: "terms",
                documentId: facets.document.documentId,
                version: facets.document.version,
                digest: facets.document.digest,
                accepted: true,
              },
            ],
          }),
        );
        if (!repeatConsent.ok) throw new Error(repeatConsent.error.code);
        return {
          ...command,
          operationId: randomUUID(),
          quoteRef: repeatQuote.quoteRef,
          consentEvidenceRefs: repeatConsent.evidenceRefs,
        };
      },
    };
  }

  return {
    scenario,
    config,
    setTime: (time: Date) => {
      now = time;
    },
    time: () => now,
  };
}

/** Запрос к двойнику банка ждёт `release`; `arrived` сообщает, что запрос уже дошёл. */
interface BankGate {
  readonly arrived: () => void;
  readonly released: Promise<void>;
}

function bankGate(clear: () => void): {
  readonly gate: BankGate;
  readonly control: {
    readonly arrived: Promise<void>;
    readonly release: () => void;
  };
} {
  const signals: { arrived?: () => void; release?: () => void } = {};
  const arrived = new Promise<void>((resolve) => {
    signals.arrived = resolve;
  });
  const released = new Promise<void>((resolve) => {
    signals.release = resolve;
  });
  return {
    gate: { arrived: () => signals.arrived?.(), released },
    control: {
      arrived,
      release: () => {
        clear();
        signals.release?.();
      },
    },
  };
}

/** A session-owned migrated PostgreSQL database and a real owner for integration suites. */
export async function createProductCommerceWorld() {
  const { createMigratedTestDatabase } = await import("./test-database.js");
  const db = await createMigratedTestDatabase();
  const owner = randomUUID();
  await db.prisma.account.create({
    data: {
      id: owner,
      logtoIssuer: "https://identity.invalid",
      logtoSubject: owner,
    },
  });
  await db.prisma.accountPermission.create({
    data: { accountId: owner, permission: "platform:admin" },
  });
  return {
    db,
    owner,
    ...createProductCommerceFixture(db, owner),
    dispose: () => db.dispose(),
  };
}
