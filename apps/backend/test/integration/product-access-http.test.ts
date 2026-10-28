import { grantProductFixture } from "./setup/product-access.js";
import { registerFixedClock } from "../support/fixed-clock.js";

import { randomUUID } from "node:crypto";
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

// Каждый источник права проверяет `access-scenarios.test.ts`; здесь — только адрес: личный ответ
// без кеша, основание из базы, чужой Account и граница ввода (#831).
describe("Product access HTTP", () => {
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
        IDENTITY_EMAIL_FINGERPRINT_KEY: "product-access-test-email-fingerprint",
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

  test("answers the current Account's grounds privately", async () => {
    const server = declaredServer(app.getHttpAdapter().getInstance());
    const holder = await signToken("product-holder", "holder@example.test");
    const stranger = await signToken("product-stranger", "other@example.test");
    for (const bearer of [holder, stranger])
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/accounts",
            headers: { authorization: `Bearer ${bearer}` },
          })
        ).statusCode,
      ).toBe(201);
    const productId = randomUUID();
    const holderAccount = await database.prisma.account.findFirstOrThrow({
      where: { logtoSubject: "product-holder" },
    });
    await database.prisma.product.create({
      data: { id: productId, slug: productId, name: "HTTP Product" },
    });
    await grantProductFixture(database.prisma, holderAccount.id, productId);
    const read = (bearer: string | null, id: string = productId) =>
      server.inject({
        method: "GET",
        url: `/accounts/current/products/${id}/access`,
        headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
      });

    const open = await read(holder);
    expect(open.statusCode).toBe(200);
    expect(open.json()).toEqual({ access: "open" });
    expect(open.headers["cache-control"]).toBe("private, no-store");
    expect((await read(stranger)).json()).toEqual({ access: "closed" });
    expect((await read(holder, randomUUID())).json()).toEqual({
      access: "closed",
    });
    expect((await read(holder, "not-a-product")).statusCode).toBe(400);
    expect((await read(null)).statusCode).toBe(401);
  });

  test("previews whether revoking one Product closes the community", async () => {
    const server = declaredServer(app.getHttpAdapter().getInstance());
    const ownerBearer = await signToken("access-owner", "owner@example.test");
    const holderBearer = await signToken(
      "preview-holder",
      "single@example.test",
    );
    const pairBearer = await signToken("preview-pair", "pair@example.test");
    const authorBearer = await signToken(
      "preview-author",
      "author@example.test",
    );
    for (const bearer of [ownerBearer, holderBearer, pairBearer, authorBearer])
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/accounts",
            headers: { authorization: `Bearer ${bearer}` },
          })
        ).statusCode,
      ).toBe(201);
    const account = (subject: string) =>
      database.prisma.account.findFirstOrThrow({
        where: { logtoSubject: subject },
      });
    const [ownerAccount, holder, pair, author] = await Promise.all(
      ["access-owner", "preview-holder", "preview-pair", "preview-author"].map(
        account,
      ),
    );
    if (
      ownerAccount === undefined ||
      holder === undefined ||
      pair === undefined ||
      author === undefined
    )
      throw new Error("missing preview Accounts");
    await database.prisma.accountPermission.create({
      data: { accountId: ownerAccount.id, permission: "billing:manage" },
    });
    await database.prisma.accountPermission.create({
      data: { accountId: author.id, permission: "materials:manage" },
    });
    const [single, paired] = [randomUUID(), randomUUID()];
    for (const id of [single, paired])
      await database.prisma.product.create({
        data: { id, slug: id, name: "Preview Product" },
      });
    await grantProductFixture(database.prisma, holder.id, single);
    await grantProductFixture(database.prisma, pair.id, single);
    await grantProductFixture(database.prisma, pair.id, paired);
    const preview = (bearer: string, accountId: string) =>
      server.inject({
        method: "POST",
        url: "/admin/access/products/preview-revoke",
        headers: { authorization: `Bearer ${bearer}` },
        payload: { accountId, productId: single },
      });

    const closes = await preview(ownerBearer, holder.id);
    expect(closes.statusCode).toBe(200);
    expect(closes.json()).toMatchObject({
      ok: true,
      value: { affectedCount: 1, community: "closes" },
    });
    const remains = await preview(ownerBearer, pair.id);
    expect(remains.statusCode).toBe(200);
    expect(remains.json()).toMatchObject({
      ok: true,
      value: { affectedCount: 1, community: "remains" },
    });
    expect((await preview(authorBearer, holder.id)).statusCode).toBe(403);
  });

  async function signToken(subject: string, email: string): Promise<string> {
    // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
    const now = Math.floor(Date.now() / 1_000);
    return new SignJWT({ inside_verified_email: email })
      .setProtectedHeader({ alg: "ES384", kid: "api-key-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
  }
});
