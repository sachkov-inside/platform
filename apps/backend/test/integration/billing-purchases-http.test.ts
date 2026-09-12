import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { migrateToLatest } from "../../src/migrations/index.js";
import { assembleAccounts, BillingContact } from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleAccessGrants } from "../../src/modules/membership-entitlements/index.js";
import { BillingPayments, BillingPricing } from "../../src/modules/billing/index.js";
import { syntheticTbankConfig } from "../support/bank-terminal.js";
import { declaredServer, type DeclaredServer } from "../support/declared-api.js";
import { BankFixture } from "./setup/bank.js";
import { syntheticConsentDocuments } from "./setup/consent-documents.js";
import { createTestDatabase, type TestDatabase } from "./setup/test-database.js";

const issuer = "https://identity.example.test/oidc";
const audience = "https://api.example.test";
const emailFingerprintKey = "billing-purchases-test-email-fingerprint-key";
const terminal = syntheticTbankConfig({
  environment: "demo", terminalKey: "SYNTHETICPURCHASES", password: "synthetic-test-password",
  bindingEncryptionKey: Buffer.alloc(32, 43).toString("base64"),
  recurringCardConfirmed: true, cardOnlyHostedConfirmed: true,
  minimumKopecks: 100, maximumKopecks: 1_000_000,
  returnUrl: "https://inside.example.test/account",
  notificationUrl: "https://inside.example.test/billing/tbank/notification",
  receipt: { taxation: "usn_income", tax: "none" },
});

/**
 * У этого адреса не было ни одной проверки на уровне HTTP, поэтому форма его ответа ничем не
 * удерживалась: утечка служебного поля обнулила бы раздел кабинета целиком. Покупка создаётся
 * настоящими гранями с синтетическим банком, а читается через `declaredServer` — тело сверяется с
 * описанием, которое API объявляет сам.
 */
describe("Billing purchases HTTP", () => {
  let app: NestFastifyApplication;
  let server: DeclaredServer;
  let privateKey: CryptoKey;
  let database: TestDatabase;
  let jwksServer: Server;

  beforeAll(async () => {
    const pair = await generateKeyPair("ES384");
    privateKey = pair.privateKey;
    const publicJwk = { ...(await exportJWK(pair.publicKey)), alg: "ES384", kid: "api-key-1" };
    jwksServer = createServer((request, response) => {
      if (request.url !== "/jwks") return void response.writeHead(404).end();
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
    const address = jwksServer.address();
    if (address === null || typeof address === "string") throw new Error("missing JWKS port");

    database = await createTestDatabase();
    await migrateToLatest(database.url);
    app = await createApiApplication(
      parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: database.url,
        LOGTO_ISSUER: issuer,
        LOGTO_AUDIENCE: audience,
        LOGTO_JWKS_URL: `http://127.0.0.1:${String(address.port)}/jwks`,
        IDENTITY_EMAIL_FINGERPRINT_KEY: emailFingerprintKey,
      }),
      { logger: false },
    );
    await app.init();
    server = declaredServer(app.getHttpAdapter().getInstance());
    await server.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.dispose();
    await new Promise<void>((resolve, reject) =>
      jwksServer.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  });

  test("a buyer reads the payment they started, and nobody else's", async () => {
    const buyerToken = await signToken("purchase-buyer-001", "buyer@example.test");
    const strangerToken = await signToken("purchase-stranger-001", "stranger@example.test");
    const headers = { authorization: `Bearer ${buyerToken}` };
    const strangerHeaders = { authorization: `Bearer ${strangerToken}` };
    expect((await server.inject({ method: "POST", url: "/accounts", headers })).statusCode).toBe(201);
    expect((await server.inject({ method: "POST", url: "/accounts", headers: strangerHeaders })).statusCode).toBe(201);
    const ownerToken = await signToken("purchase-owner-001", "owner@example.test");
    expect((await server.inject({ method: "POST", url: "/accounts", headers: { authorization: `Bearer ${ownerToken}` } })).statusCode).toBe(201);
    const buyer = await accountIdOf("purchase-buyer-001");
    const owner = await accountIdOf("purchase-owner-001");
    await database.prisma.accountPermission.create({ data: { accountId: owner, permission: "platform:admin" } });
    const purchaseRef = await startedPurchase(buyer, owner);

    const read = await server.inject({ method: "GET", url: `/accounts/current/billing/purchases/${purchaseRef}`, headers });
    expect(read.statusCode).toBe(200);
    expect(read.headers["cache-control"]).toBe("private, no-store");
    const body = read.json<{ readonly paymentUrl: string | null }>();
    expect(body).toMatchObject({
      purchaseRef,
      state: "pending",
      access: "awaiting_payment",
      fiscalization: "pending",
      confirmedAt: null,
      periodEndsAt: null,
      snapshot: { firstPriceKopecks: 200_000, paymentOption: { months: 1 } },
    });
    expect(body.paymentUrl).toBe("https://securepay.tinkoff.ru/test");

    // Платёж принадлежит своему покупателю: чужому он не отличается от несуществующего — ни
    // состоянием, ни телом, иначе отказ сам подтверждал бы, что такой платёж есть.
    const stranger = await server.inject({ method: "GET", url: `/accounts/current/billing/purchases/${purchaseRef}`, headers: strangerHeaders });
    const unknown = await server.inject({ method: "GET", url: `/accounts/current/billing/purchases/${randomUUID()}`, headers });
    expect(stranger.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(stranger.json()).toEqual(unknown.json());
    expect((await server.inject({ method: "GET", url: `/accounts/current/billing/purchases/not-a-uuid`, headers })).statusCode).toBe(404);
    expect((await server.inject({ method: "GET", url: `/accounts/current/billing/purchases/${purchaseRef}` })).statusCode).toBe(401);
  });

  /** Настоящая покупка: те же грани, что в приложении, и синтетический банк вместо настоящего. */
  async function startedPurchase(buyer: string, owner: string): Promise<string> {
    const now = new Date("2030-01-31T10:00:00Z");
    const accounts = assembleAccounts({ prisma: database.prisma, emailFingerprintKey });
    const grants = assembleAccessGrants({ prisma: database.prisma, accounts, clock: () => now });
    const pricing = new BillingPricing({ prisma: database.prisma, accounts, clock: () => now });
    const codes = new Map<string, string>();
    const contact = new BillingContact({
      prisma: database.prisma,
      protection: billingContactProtection(Buffer.alloc(32, 42).toString("base64")),
      documents: syntheticConsentDocuments,
      now: () => now,
      sendCode: (message) => { codes.set(message.challengeRef, message.code); return Promise.resolve(); },
    });
    succeeds(await grants.classifyLegacy(owner, { operationId: randomUUID(), accountId: buyer, expectedRevision: 0,
      classification: "confirmed_new", sourceRef: buyer, reason: "Synthetic new buyer", bridgeEnabled: false, tributeStopped: false }));
    const start = await contact.start(buyer, { operationId: randomUUID(), email: "buyer@example.test", expectedRevision: 0 });
    if (!start.ok) throw new Error(start.error.code);
    const code = codes.get(start.challengeRef);
    if (code === undefined) throw new Error("the synthetic contact never received its code");
    succeeds(await contact.confirm(buyer, { operationId: randomUUID(), challengeRef: start.challengeRef, code }));
    const offerId = randomUUID(); const optionId = randomUUID();
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.save", value: { id: offerId, name: "Synthetic subscription", benefits: ["materials"] } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "paymentOptions.save", value: { id: optionId, offerId, months: 1, priceKopecks: 200_000 } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.publish", expectedRevision: 1, id: offerId }));
    const quote = value(await pricing.quote(buyer, { operationId: randomUUID(), paymentOptionId: optionId, optionRevision: 1 }));
    const consent = await contact.acceptConsents(buyer, { operationId: randomUUID(), contextRef: quote.quoteRef,
      documents: syntheticConsentDocuments.map((document) => ({ kind: document.kind, documentId: document.documentId, version: document.version, digest: document.digest, accepted: true })) });
    if (!consent.ok) throw new Error(consent.error.code);
    const payments = new BillingPayments({ prisma: database.prisma, bank: new BankFixture(terminal).client(), contact, grants, clock: () => now });
    const started = value(await payments.purchase(buyer, { operationId: randomUUID(), quoteRef: quote.quoteRef,
      contactRevision: 1, consentEvidenceRefs: consent.evidenceRefs, acknowledgeExistingAccess: false }));
    return started.purchaseRef;
  }

  function accountIdOf(subject: string): Promise<string> {
    return database.prisma.account
      .findUniqueOrThrow({ where: { logtoIssuer_logtoSubject: { logtoIssuer: issuer, logtoSubject: subject } } })
      .then((account) => account.id);
  }

  function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
    if (!result.ok) throw new Error(result.error.code);
    return result.value;
  }

  /** Шаг подготовки, у которого нет собственного результата: важно лишь, что он состоялся. */
  function succeeds(result: { readonly ok: boolean; readonly error?: { readonly code: string } }): void {
    if (!result.ok) throw new Error(result.error?.code ?? "unknown");
  }

  function signToken(subject: string, email: string): Promise<string> {
    return new SignJWT({ inside_verified_email: email })
      .setProtectedHeader({ alg: "ES384", kid: "api-key-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  }
});
