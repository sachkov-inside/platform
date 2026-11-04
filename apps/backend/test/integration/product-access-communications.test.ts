import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import {
  grantProductFixture,
  revokeProductFixture,
} from "./setup/product-access.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const instant = new Date("2030-01-01T00:00:00Z");
const secret = "synthetic-authorization-secret";
const productId = randomUUID();
const buyer = randomUUID();
const reader = randomUUID();
let db: TestDatabase;
let app: NestFastifyApplication;

async function linkTelegram(accountId: string) {
  await db.prisma.account.upsert({
    where: { id: accountId },
    create: {
      id: accountId,
      logtoIssuer: "https://product-access.test",
      logtoSubject: accountId,
    },
    update: {},
  });
  await db.prisma.telegramAccountLinkState.create({
    data: {
      accountId,
      linkRef: randomUUID(),
      revision: 1,
      principalRef: `principal-${accountId}`,
      identityRef: `identity-${accountId}`,
      updatedAt: instant,
    },
  });
}

beforeAll(async () => {
  db = await createMigratedTestDatabase();
  await db.prisma.product.create({
    data: { id: productId, slug: "product-access", name: "AI Engineering" },
  });
  await linkTelegram(buyer);
  await linkTelegram(reader);
  await grantProductFixture(db.prisma, buyer, productId);
  app = await createApiApplication(
    parsePlatformConfig({
      NODE_ENV: "test",
      DATABASE_URL: db.url,
      TELEGRAM_COMMUNICATIONS_ENDPOINT:
        "http://127.0.0.1:9876/integrations/platform/v2/communications",
      TELEGRAM_COMMUNICATIONS_SECRET: "synthetic-communications-secret",
      TELEGRAM_COMMUNICATIONS_PUBLIC_ORIGIN: "https://inside.test",
      TELEGRAM_AUTHOR_AUTHORIZATION_SECRET: secret,
      TELEGRAM_COMMUNICATIONS_BOT_IDENTITY: "synthetic-bot",
    }),
    { logger: false },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  try {
    await app.close();
  } finally {
    await db.dispose();
  }
});

function request(body: object, authorization = `Bearer ${secret}`) {
  return app.inject({
    method: "POST",
    url: "/integrations/telegram/v2/communications/product-access",
    headers: { authorization },
    payload: {
      contractVersion: "inside-communications-v2",
      requestId: randomUUID(),
      ...body,
    },
  });
}

test("reports only the identities whose Account has Product Access", async () => {
  const requestId = randomUUID();
  const response = await request({
    requestId,
    telegramIdentityRefs: [
      `identity-${buyer}`,
      `identity-${reader}`,
      "identity-without-account",
    ],
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    contractVersion: "inside-communications-v2",
    requestId,
    withAccess: [`identity-${buyer}`],
  });
});

test("a revoked access stops counting", async () => {
  const other = randomUUID();
  await linkTelegram(other);
  const grant = await grantProductFixture(db.prisma, other, productId);
  const refs = { telegramIdentityRefs: [`identity-${other}`] };
  expect((await request(refs)).json()).toMatchObject({
    withAccess: [`identity-${other}`],
  });
  await revokeProductFixture(db.prisma, grant);
  expect((await request(refs)).json()).toMatchObject({ withAccess: [] });
});

test("service credentials and the closed schema protect the access read", async () => {
  const refs = { telegramIdentityRefs: [`identity-${buyer}`] };
  expect((await request(refs, "Bearer foreign-secret")).statusCode).toBe(401);
  expect((await request({ telegramIdentityRefs: [] })).statusCode).toBe(400);
  expect((await request({ ...refs, accountIds: [buyer] })).statusCode).toBe(
    400,
  );
});
