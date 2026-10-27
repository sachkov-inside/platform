import {
  ACCESS_GRANTS,
  type AccessGrants,
} from "../../src/modules/account-rights/index.js";
import { grantProductFixture } from "./setup/product-access.js";
import { registerFixedClock } from "../support/fixed-clock.js";

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

describe("Owner Product Access inventory pagination", () => {
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

  test("binds cursor scope to normalized Account/Product filters while preserving every tuple continuation", async () => {
    const server = declaredServer(app.getHttpAdapter().getInstance());
    const bearer = await signToken("pagination-owner", "owner@example.test");
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/accounts",
          headers: { authorization: `Bearer ${bearer}` },
        })
      ).statusCode,
    ).toBe(201);
    const owner = await database.prisma.account.findFirstOrThrow({
      where: { logtoSubject: "pagination-owner" },
    });
    await database.prisma.accountPermission.create({
      data: { accountId: owner.id, permission: "platform:admin" },
    });
    const accounts = [
      "aa000000-0000-4000-8000-000000000001",
      "bb000000-0000-4000-8000-000000000002",
    ];
    const products = [
      "cc000000-0000-4000-8000-000000000001",
      "dd000000-0000-4000-8000-000000000002",
    ];
    for (const id of products)
      await database.prisma.product.create({
        data: { id, slug: id, name: "Pagination Product" },
      });
    for (const id of accounts)
      for (const product of products)
        await grantProductFixture(database.prisma, id, product);
    const post = (payload: Record<string, unknown>) =>
      server.inject({
        method: "POST",
        url: "/admin/access/products/list",
        headers: { authorization: `Bearer ${bearer}` },
        payload,
      });
    type Page = {
      ok: true;
      value: { accountId: string; productId: string }[];
      nextCursor: string | null;
    };
    const page = async (payload: Record<string, unknown>) => {
      const response = await post(payload);
      expect(response.statusCode).toBe(200);
      return response.json<Page>();
    };
    for (const scope of [
      {},
      { accountId: accounts[0] },
      { productId: products[0] },
      { accountId: accounts[0], productId: products[0] },
    ]) {
      const expected = accounts
        .flatMap((accountId) =>
          products.map((productId) => ({ accountId, productId })),
        )
        .filter(
          (row) =>
            (scope.accountId === undefined ||
              row.accountId === scope.accountId) &&
            (scope.productId === undefined ||
              row.productId === scope.productId),
        );
      const rows: Page["value"] = [];
      let cursor: string | null = null;
      do {
        const result = await page({
          ...scope,
          limit: 1,
          ...(cursor === null ? {} : { cursor }),
        });
        rows.push(...result.value);
        cursor = result.nextCursor;
        expect(rows.length).toBeLessThanOrEqual(expected.length);
      } while (cursor !== null);
      expect(
        rows.map(({ accountId, productId }) => ({ accountId, productId })),
      ).toEqual(expected);
    }
    const filtered = await page({ accountId: accounts[1], limit: 1 });
    expect(filtered.nextCursor).not.toBeNull();
    const grants = app.get<AccessGrants>(ACCESS_GRANTS);
    expect(
      await grants.listProductAccess(owner.id, {
        accountId: accounts[0],
        cursor: filtered.nextCursor,
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(
      (await post({ accountId: accounts[0], cursor: filtered.nextCursor }))
        .statusCode,
    ).toBe(400);
    expect((await post({ cursor: filtered.nextCursor })).statusCode).toBe(400);
    const canonical = await page({
      accountId: accounts[1]?.toUpperCase(),
      cursor: filtered.nextCursor,
      limit: 2,
    });
    expect(
      canonical.value.map(({ accountId, productId }) => ({
        accountId,
        productId,
      })),
    ).toEqual([{ accountId: accounts[1], productId: products[1] }]);
    expect(canonical.nextCursor).toBeNull();
    const product = await page({ productId: products[0], limit: 1 });
    expect(
      (await post({ productId: products[1], cursor: product.nextCursor }))
        .statusCode,
    ).toBe(400);
    const all = await page({ limit: 1 });
    expect(
      (await post({ accountId: accounts[0], cursor: all.nextCursor }))
        .statusCode,
    ).toBe(400);
    expect((await post({ cursor: "malformed:cursor" })).statusCode).toBe(400);
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
