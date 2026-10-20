import { randomBytes, randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { bootstrapOwnerAccount } from "../../src/modules/accounts/index.js";
import { ProductWaitlists } from "../../src/modules/sales-funnel/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
const instant = new Date("2030-01-01T00:00:00Z");
const secret = "synthetic-authorization-secret";
let db: TestDatabase;
let app: NestFastifyApplication;
let ownerId: string;
const accountRef = "synthetic-owner-principal";
const identityRef = "synthetic-owner-identity";
const productId = randomUUID();
const intakeId = randomUUID();
let waitlists: ProductWaitlists;
beforeAll(async () => {
  db = await createMigratedTestDatabase();
  ownerId = (
    await bootstrapOwnerAccount(
      db.prisma,
      { issuer: "https://waitlist-communications.test", subject: "owner" },
      "communications:manage",
    )
  ).accountId;
  const linkRef = randomUUID();
  await db.prisma.telegramLinkTransaction.create({
    data: {
      linkRef,
      accountId: ownerId,
      principalRef: accountRef,
      providerIdentityRef: identityRef,
      providerTransactionRef: randomUUID(),
      returnCorrelation: randomUUID(),
      tokenDigest: randomBytes(32).toString("base64url"),
      status: "linked",
      createdAt: instant,
      updatedAt: instant,
      expiresAt: new Date("2030-01-01T00:01:00Z"),
    },
  });
  await db.prisma.product.create({
    data: {
      id: productId,
      slug: "waitlist-communications",
      name: "AI Engineering",
      summary: "",
    },
  });
  await db.prisma.productWaitlistIntake.create({
    data: { id: intakeId, productId, name: "Следующий набор", accepting: true },
  });
  waitlists = new ProductWaitlists({
    prisma: db.prisma,
    links: new TelegramAccountLinks(db.prisma),
    clock: () => instant,
  });
  app = await createApiApplication(
    parsePlatformConfig({
      NODE_ENV: "test",
      DATABASE_URL: db.url,
      TELEGRAM_COMMUNICATIONS_ENDPOINT:
        "http://127.0.0.1:9876/integrations/platform/v1/communications",
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
beforeEach(async () => {
  await db.prisma.productWaitlistConfirmation.deleteMany({});
  await db.prisma.productWaitlistOperation.deleteMany({});
  await db.prisma.productWaitlistEvent.deleteMany({});
  await db.prisma.productWaitlistMembership.deleteMany({});
  await waitlists.join(ownerId, {
    intakeId,
    operationId: randomUUID(),
    source: null,
  });
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
    url: "/integrations/telegram/v1/communications/waitlist",
    headers: { authorization },
    payload: {
      contractVersion: "inside-communications-v1",
      requestId: randomUUID(),
      actorAccountRef: accountRef,
      intakeId,
      ...body,
    },
  });
}
test("trusted author preview derives active audience and current purchase URL while closed sale stays closed", async () => {
  const response = await request({});
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    status: "ok",
    saleOpen: false,
    purchaseUrl: "https://inside.test/products/waitlist-communications/buy",
    active: 1,
    members: [{ accountRef, telegramIdentityRef: identityRef }],
  });
});

test("service credentials, author rights and closed schemas protect private audience", async () => {
  expect((await request({}, "Bearer foreign-secret")).statusCode).toBe(401);
  expect(
    (await request({ actorAccountRef: "foreign-author" })).statusCode,
  ).toBe(403);
  expect(
    (
      await request({
        members: [{ accountRef: "injected", telegramIdentityRef: "injected" }],
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await request({
        recipient: { accountRef, telegramIdentityRef: "foreign-identity" },
      })
    ).statusCode,
  ).toBe(403);
});
test("dispatch uses the active membership and current Account identity rather than the launch snapshot", async () => {
  const recipient = { accountRef, telegramIdentityRef: identityRef };
  expect((await request({ recipient })).json()).toMatchObject({
    status: "ok",
    active: 1,
    members: [recipient],
  });
  await waitlists.withdraw(ownerId, { intakeId });
  expect((await request({ recipient })).json()).toMatchObject({
    status: "ok",
    active: 0,
    members: [],
  });
});

test("service confirmation authorization checks the exact committed generation and binding", async () => {
  let confirmation: unknown;
  await waitlists.dispatchConfirmations((command) => {
    confirmation = command;
    return Promise.resolve("unavailable" as const);
  });
  // Use the real JSON transport shape rather than an author command.
  const invoke = (payload: unknown, authorization = `Bearer ${secret}`) =>
    app.inject({
      method: "POST",
      url: "/integrations/telegram/v1/communications/waitlist",
      headers: { authorization, "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });
  expect((await invoke(confirmation, "Bearer foreign-secret")).statusCode).toBe(
    401,
  );
  expect((await invoke(confirmation)).json()).toMatchObject({
    status: "accepted",
  });
  await waitlists.withdraw(ownerId, { intakeId });
  expect((await invoke(confirmation)).json()).toMatchObject({
    status: "suppressed",
  });
  await waitlists.join(ownerId, {
    intakeId,
    operationId: randomUUID(),
    source: null,
  });
  expect((await invoke(confirmation)).json()).toMatchObject({
    status: "suppressed",
  });
});
