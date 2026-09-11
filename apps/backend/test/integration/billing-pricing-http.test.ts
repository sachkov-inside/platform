import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { migrateToLatest } from "../../src/migrations/index.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const issuer = "https://identity.example.test/oidc";
const audience = "https://api.example.test";

describe("Billing pricing HTTP", () => {
  let app: NestFastifyApplication;
  let privateKey: CryptoKey;
  let database: TestDatabase;
  let jwksServer: Server;

  beforeAll(async () => {
    const pair = await generateKeyPair("ES384");
    privateKey = pair.privateKey;
    const publicJwk = {
      ...(await exportJWK(pair.publicKey)),
      alg: "ES384",
      kid: "api-key-1",
    };
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
        IDENTITY_EMAIL_FINGERPRINT_KEY: "accounts-api-test-email-fingerprint-key",
      }),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await database.dispose();
    await new Promise<void>((resolve, reject) =>
      jwksServer.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  });

  test("public catalog, trusted quote identity, owner authorization and wire conflicts", async () => {
    const server = app.getHttpAdapter().getInstance();
    const token = await signToken();
    const headers = { authorization: `Bearer ${token}` };
    const offerId = randomUUID(); const optionId = randomUUID();
    const command = { operation: "offers.save", operationId: randomUUID(), value: { id: offerId, name: "Inside", benefits: ["materials"] } };
    expect((await server.inject({ method: "GET", url: "/billing/offers" })).json()).toEqual({ items: [], nextCursor: null });
    expect((await server.inject({ method: "POST", url: "/billing/admin", payload: command })).statusCode).toBe(401);
    expect((await server.inject({ method: "POST", url: "/accounts/current/billing/quote", payload: {} })).statusCode).toBe(401);
    expect((await server.inject({ method: "POST", url: "/accounts", headers })).statusCode).toBe(201);
    expect((await server.inject({ method: "POST", url: "/billing/admin", headers, payload: command })).statusCode).toBe(403);
    const account = await database.prisma.account.findUniqueOrThrow({ where: { logtoIssuer_logtoSubject: { logtoIssuer: issuer, logtoSubject: "human-api-001" } } });
    await database.prisma.accountPermission.create({ data: { accountId: account.id, permission: "platform:admin" } });
    const saved = await server.inject({ method: "POST", url: "/billing/admin", headers, payload: command });
    expect(saved.statusCode).toBe(200); expect(saved.headers["cache-control"]).toBe("private, no-store");
    expect(saved.json()).toEqual({ operationRef: command.operationId, result: { outcome: "catalog", value: { id: offerId, revision: 1, archived: false, published: false } } });
    expect((await server.inject({ method: "POST", url: "/billing/admin", headers, payload: { ...command, actor: account.id } })).statusCode).toBe(400);
    expect((await server.inject({ method: "POST", url: "/billing/admin", headers, payload: { operation: "paymentOptions.save", operationId: randomUUID(), value: { id: optionId, offerId, months: 5, priceKopecks: 500_000 } } })).statusCode).toBe(200);
    // По умолчанию предложение не продаётся: пока владелец не включит его, витрина пуста.
    const publishOperationId = randomUUID();
    const published = await server.inject({ method: "POST", url: "/billing/admin", headers, payload: { operation: "offers.publish", operationId: publishOperationId, expectedRevision: 1, id: offerId } });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toEqual({ operationRef: publishOperationId, result: { outcome: "catalog", value: { id: offerId, revision: 2, archived: false, published: true } } });
    const list = await server.inject({ method: "GET", url: "/billing/offers?limit=1" });
    expect(list.statusCode).toBe(200); expect(list.json()).toMatchObject({ items: [{ firstPriceKopecks: 500_000, renewalPriceKopecks: 500_000 }] });
    const quote = { operationId: randomUUID(), paymentOptionId: optionId, optionRevision: 1 };
    const response = await server.inject({ method: "POST", url: "/accounts/current/billing/quote", headers, payload: quote });
    expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toMatchObject({ snapshot: { firstPriceKopecks: 500_000, paymentOption: { months: 5 } } });
    const stored = await database.prisma.billingPriceQuote.findUniqueOrThrow({ where: { accountId_operationId: { accountId: account.id, operationId: quote.operationId } } });
    expect(stored.accountId).toBe(account.id);
    expect((await server.inject({ method: "POST", url: "/accounts/current/billing/quote", headers, payload: { ...quote, accountId: randomUUID() } })).statusCode).toBe(400);
    const stale = await server.inject({ method: "POST", url: "/accounts/current/billing/quote", headers, payload: { ...quote, operationId: randomUUID(), optionRevision: 99 } });
    expect(stale.statusCode).toBe(409); expect(stale.headers["content-type"]).toContain("application/problem+json"); expect(stale.json()).toMatchObject({ code: "quote_changed" });
    expect((await server.inject({ method: "POST", url: "/billing/reservations", headers, payload: {} })).statusCode).toBe(404);

    // Второй вариант включается отдельно: сначала продан только первый, затем оба.
    const secondOfferId = randomUUID(); const secondOptionId = randomUUID();
    await server.inject({ method: "POST", url: "/billing/admin", headers, payload: { operation: "offers.save", operationId: randomUUID(), value: { id: secondOfferId, name: "Сопровождение", benefits: ["support"] } } });
    await server.inject({ method: "POST", url: "/billing/admin", headers, payload: { operation: "paymentOptions.save", operationId: randomUUID(), value: { id: secondOptionId, offerId: secondOfferId, months: 1, priceKopecks: 350_000 } } });
    const one = await server.inject({ method: "GET", url: "/billing/offers?limit=100" });
    expect(one.json<{ items: readonly unknown[] }>().items).toHaveLength(1);
    await server.inject({ method: "POST", url: "/billing/admin", headers, payload: { operation: "offers.publish", operationId: randomUUID(), expectedRevision: 1, id: secondOfferId } });
    const both = await server.inject({ method: "GET", url: "/billing/offers?limit=100" });
    expect(both.json<{ items: readonly unknown[] }>().items).toHaveLength(2);
    // Выключение первого варианта убирает только его; выключенный не покупается даже напрямую.
    expect((await server.inject({ method: "POST", url: "/billing/admin", headers, payload: { operation: "offers.unpublish", operationId: randomUUID(), expectedRevision: 2, id: offerId } })).statusCode).toBe(200);
    const onlySecond = await server.inject({ method: "GET", url: "/billing/offers?limit=100" });
    expect(onlySecond.json<{ items: readonly { readonly offer: { readonly id: string } }[] }>().items.map((item) => item.offer.id)).toEqual([secondOfferId]);
    expect((await server.inject({ method: "POST", url: "/accounts/current/billing/quote", headers, payload: { operationId: randomUUID(), paymentOptionId: optionId, optionRevision: 1 } })).statusCode).toBe(404);
  });

  test("scoped billing permission opens the owner surface and maps its result codes", async () => {
    const server = app.getHttpAdapter().getInstance();
    const headers = { authorization: `Bearer ${await signToken({ subject: "billing-manager-001", email: "manager@example.test" })}` };
    expect((await server.inject({ method: "POST", url: "/accounts", headers })).statusCode).toBe(201);
    const manager = await database.prisma.account.findUniqueOrThrow({ where: { logtoIssuer_logtoSubject: { logtoIssuer: issuer, logtoSubject: "billing-manager-001" } } });
    const payments = { operation: "payments.list", operationId: randomUUID() };
    expect((await server.inject({ method: "POST", url: "/billing/admin", headers, payload: payments })).statusCode).toBe(403);
    // Владельческая поверхность открывается отдельным правом billing:manage, без platform:admin.
    await database.prisma.accountPermission.create({ data: { accountId: manager.id, permission: "billing:manage" } });
    const list = await server.inject({ method: "POST", url: "/billing/admin", headers, payload: payments });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ operationRef: payments.operationId, result: { outcome: "payments", items: [], nextCursor: null } });
    const missing = await server.inject({ method: "POST", url: "/billing/admin", headers, payload: { operation: "refunds.read", operationId: randomUUID(), purchaseRef: randomUUID() } });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers["content-type"]).toContain("application/problem+json");
    expect(missing.json()).toMatchObject({ code: "not_found" });
    const decision = { operation: "refunds.decide", operationId: randomUUID(), purchaseRef: randomUUID(), amountKopecks: 0, access: "keep", recurring: "keep", reason: "Недопустимая сумма" };
    expect((await server.inject({ method: "POST", url: "/billing/admin", headers, payload: decision })).statusCode).toBe(400);
    const grant = { operation: "grants.revoke", operationId: randomUUID(), grantRef: randomUUID(), expectedRevision: 1, reason: "Неизвестное основание" };
    expect((await server.inject({ method: "POST", url: "/billing/admin", headers, payload: grant })).statusCode).toBe(404);
    // Чтение не занимает operationId, поэтому повторяется свободно и с другой нагрузкой.
    const repeated = await server.inject({ method: "POST", url: "/billing/admin", headers, payload: { ...payments, limit: 5 } });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toEqual({ operationRef: payments.operationId, result: { outcome: "payments", items: [], nextCursor: null } });
  });

  async function signToken(
    overrides: {
      readonly subject?: string;
      readonly clientId?: string;
      readonly email?: string;
    } = {},
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1_000);
    return new SignJWT({
      inside_verified_email: overrides.email ?? "member@example.test",
      ...(overrides.clientId === undefined ? {} : { client_id: overrides.clientId }),
    })
      .setProtectedHeader({ alg: "ES384", kid: "api-key-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(overrides.subject ?? "human-api-001")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
  }
});
