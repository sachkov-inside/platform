import { grantProductFixture } from "./setup/product-access.js";
import {
  createProductCommerceFixture,
  commerceValue,
} from "./setup/product-commerce.js";

import { registerFixedClock } from "../support/fixed-clock.js";

import { randomUUID } from "node:crypto";
import { acceptCurrentTerms } from "../support/accept-terms.js";
import { createServer, type Server } from "node:http";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { declaredServer } from "../support/declared-api.js";

registerFixedClock();

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
    await new Promise<void>((resolve) =>
      jwksServer.listen(0, "127.0.0.1", resolve),
    );
    const address = jwksServer.address();
    if (address === null || typeof address === "string")
      throw new Error("missing JWKS port");

    database = await createMigratedTestDatabase();
    app = await createApiApplication(
      parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: database.url,
        LOGTO_ISSUER: issuer,
        LOGTO_AUDIENCE: audience,
        LOGTO_JWKS_URL: `http://127.0.0.1:${String(address.port)}/jwks`,
        IDENTITY_EMAIL_FINGERPRINT_KEY:
          "accounts-api-test-email-fingerprint-key",
        // Каталог включает продажу только в процессе с терминалом и адресом для чека.
        TBANK_PROVIDER_MODE: "test",
        BILLING_CONTACT_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
        BILLING_CONTACT_SMTP_HOST: "127.0.0.1",
        BILLING_CONTACT_FROM: "inside@example.test",
      }),
      { logger: false },
    );
    await app.init();
    await declaredServer(app.getHttpAdapter().getInstance()).ready();
  });

  afterAll(async () => {
    await app.close();
    await database.dispose();
    await new Promise<void>((resolve, reject) =>
      jwksServer.close((error) =>
        error === undefined ? resolve() : reject(error),
      ),
    );
  });

  async function actor(
    subject: string,
    permission?: "billing:manage" | "materials:manage",
  ) {
    const headers = {
      authorization: `Bearer ${await signToken({ subject, email: `${subject}@example.test` })}`,
    };
    const server = declaredServer(app.getHttpAdapter().getInstance());
    expect(
      (await server.inject({ method: "POST", url: "/accounts", headers }))
        .statusCode,
    ).toBe(201);
    await acceptCurrentTerms(server, headers);
    const account = await database.prisma.account.findUniqueOrThrow({
      where: {
        logtoIssuer_logtoSubject: {
          logtoIssuer: issuer,
          logtoSubject: subject,
        },
      },
    });
    if (permission !== undefined)
      await database.prisma.accountPermission.create({
        data: { accountId: account.id, permission },
      });
    return { headers, account, server };
  }

  test("public Product catalogue stays closed under current legal terms; owner price commands use trusted identity", async () => {
    const { headers, account, server } = await actor(
      "product-price-owner",
      "billing:manage",
    );
    const productId = randomUUID();
    await database.prisma.product.create({
      data: { id: productId, slug: productId, name: "HTTP Product" },
    });
    const command = {
      operation: "productPrices.save",
      operationId: randomUUID(),
      value: {
        productId,
        name: "HTTP Product",
        priceKopecks: 200000,
        published: false,
      },
    };
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/billing/admin",
          payload: command,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/billing/admin",
          headers,
          payload: { ...command, actor: account.id },
        })
      ).statusCode,
    ).toBe(400);
    const saved = await server.inject({
      method: "POST",
      url: "/billing/admin",
      headers,
      payload: command,
    });
    expect(saved.statusCode, JSON.stringify(saved.json())).toBe(200);
    expect(
      (
        await server.inject({ method: "GET", url: "/billing/product-prices" })
      ).json(),
    ).toEqual({ items: [], nextCursor: null });
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/accounts/current/billing/quote",
          headers,
          payload: { operationId: randomUUID(), productId, priceRevision: 1 },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/billing/admin",
          headers,
          payload: command,
        })
      ).json(),
    ).toEqual(saved.json());
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/billing/admin",
          headers,
          payload: {
            ...command,
            value: { ...command.value, priceKopecks: 300000 },
          },
        })
      ).statusCode,
    ).toBe(409);
  });

  test("scoped billing permission opens the owner surface and maps its result codes", async () => {
    const { headers, server } = await actor("scoped-billing", "billing:manage");
    const payload = { operation: "payments.list", operationId: randomUUID() };
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/billing/admin",
          headers,
          payload,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/billing/admin",
          headers,
          payload: {
            operation: "refunds.read",
            operationId: randomUUID(),
            purchaseRef: randomUUID(),
          },
        })
      ).statusCode,
    ).toBe(404);
    const materials = await actor("scoped-materials", "materials:manage");
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/billing/admin",
          headers: materials.headers,
          payload,
        })
      ).statusCode,
    ).toBe(403);
    for (const operation of [
      "refunds.decide",
      "refunds.execute",
      "grants.revoke",
      "invitations.issue",
      "tribute.savePolicy",
      "subscriptions.cancel",
    ])
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/billing/admin",
            headers,
            payload: { operation, operationId: randomUUID() },
          })
        ).statusCode,
      ).toBe(400);
  });

  test("own Billing requires authentication, returns its holder's Product and never reveals another Account's Products or payments", async () => {
    const { headers, account, server } = await actor("product-cabinet");
    expect(
      (await server.inject({ method: "GET", url: "/accounts/current/billing" }))
        .statusCode,
    ).toBe(401);
    const productId = randomUUID();
    await database.prisma.product.create({
      data: { id: productId, slug: productId, name: "Own cabinet Product" },
    });
    await grantProductFixture(database.prisma, account.id, productId);
    const owner = await actor("foreign-payment-owner", "billing:manage");
    const foreign = await createProductCommerceFixture(
      database,
      owner.account.id,
    ).scenario();
    const payment = commerceValue(
      await foreign.payments.purchase(foreign.buyer, foreign.command),
    );
    await grantProductFixture(
      database.prisma,
      foreign.buyer,
      foreign.productId,
    );
    const response = await server.inject({
      method: "GET",
      url: "/accounts/current/billing",
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      products: [
        {
          id: productId,
          name: "Own cabinet Product",
          materials: { state: "available" },
        },
      ],
      payments: [],
      notices: [],
    });
    const text = response.body;
    expect(text).not.toContain(foreign.productId);
    expect(text).not.toContain(payment.purchaseRef);
    expect(text).not.toContain(foreign.buyer);
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });

  async function signToken(
    overrides: {
      readonly subject?: string;
      readonly clientId?: string;
      readonly email?: string;
    } = {},
  ): Promise<string> {
    // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
    const now = Math.floor(Date.now() / 1_000);
    return new SignJWT({
      inside_verified_email: overrides.email ?? "member@example.test",
      ...(overrides.clientId === undefined
        ? {}
        : { client_id: overrides.clientId }),
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
