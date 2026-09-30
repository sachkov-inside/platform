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

const issuer = "https://identity.example.test/oidc";
const audience = "https://api.example.test";

// Каждый источник права проверяет `access-scenarios.test.ts`; здесь — только адрес: личный ответ
// без кеша, основание из базы, чужой Account и граница ввода (#831).
describe("Guide access HTTP", () => {
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
        IDENTITY_EMAIL_FINGERPRINT_KEY: "guide-access-test-email-fingerprint",
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
    const holder = await signToken("guide-holder", "holder@example.test");
    const stranger = await signToken("guide-stranger", "other@example.test");
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
    const guideId = randomUUID();
    const holderAccount = await database.prisma.account.findFirstOrThrow({
      where: { logtoSubject: "guide-holder" },
    });
    await database.prisma.accessGrant.create({
      data: {
        id: randomUUID(),
        accountId: holderAccount.id,
        source: "paid",
        sourceRef: randomUUID(),
        capabilities: [`guide:${guideId}`],
        startsAt: new Date(Date.now() - 60_000),
        validUntil: null,
        revision: 1,
        reason: "Synthetic #831 product right",
      },
    });
    const read = (bearer: string | null, id: string = guideId) =>
      server.inject({
        method: "GET",
        url: `/accounts/current/guides/${id}/access`,
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
    expect((await read(holder, "not-a-guide")).statusCode).toBe(400);
    expect((await read(null)).statusCode).toBe(401);
  });

  async function signToken(subject: string, email: string): Promise<string> {
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
