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
    recurringCardConfirmed: false,
    cardOnlyHostedConfirmed: false,
    minimumKopecks: 100,
    maximumKopecks: 1_000_000,
    returnUrl: "https://inside.example.test/account",
    notificationUrl: "https://inside.example.test/billing/tbank/notification",
    receipt: { taxation: "usn_income", tax: "none" },
  });
  function setupFacets() {
    const accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "product-buyer-test-fingerprint-key-000000",
    });
    const grants = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
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
    const document = syntheticConsentDocument("terms", {
      appliesTo: ["one_time"],
    });
    const contact = new BillingContact({
      prisma: db.prisma,
      protection: billingContactProtection(
        Buffer.alloc(32, 42).toString("base64"),
      ),
      documents: [document],
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
    const facets = setupFacets();
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
            offerIds: [productId],
            paymentOptionIds: [],
            usageLimit: options.usageLimit ?? null,
          },
        }),
      );
    const quote = value(
      await facets.pricing.quote(buyer, {
        operationId: randomUUID(),
        productId,
        priceRevision: 1,
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
      stateCalls = 0;
    const paymentId = String(Math.floor(Math.random() * 1000000000));
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
        .object({ OrderId: z.string().optional() })
        .loose()
        .parse(JSON.parse(String(init.body)));
      if (String(url).endsWith("/Init")) {
        initCalls++;
        orderId = z.string().parse(body.OrderId);
        expect(body).toMatchObject({
          Amount: quote.snapshot.firstPriceKopecks,
        });
        expect(body).not.toHaveProperty("Recurrent");
        if (timeout) throw new Error("Synthetic lost Init answer");
        return Response.json({
          ...event(),
          PaymentURL: "https://securepay.tinkoff.ru/test",
        });
      }
      if (String(url).endsWith("/CheckOrder"))
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
      if (String(url).endsWith("/GetState")) {
        stateCalls++;
        return Response.json(event());
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
      loseInit: () => {
        timeout = true;
      },
      bank,
      event,
      config,
      setStatus: (next: string) => {
        status = next;
      },
    };
  }

  return {
    scenario,
    config,
    setTime: (time: Date) => {
      now = time;
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
