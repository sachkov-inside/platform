import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";
import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import {
  ownSubscriptionAccessResponseSchema,
  bindingLookupResponseSchema,
} from "../../src/modules/telegram-membership/domain/subscription-activation-wire.js";
import { CommunityEntitlements } from "../../src/modules/telegram-membership/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import {
  grantProductFixture,
  revokeProductFixture,
} from "./setup/product-access.js";
import { linkTelegramAccount } from "./setup/telegram-link.js";

registerFixedClock();

let db: TestDatabase;
let app: NestFastifyApplication;
const version = "inside.subscription-activation.v1";
const secret = "synthetic-product-community-course-authority";
beforeAll(async () => {
  db = await createMigratedTestDatabase();
  app = await createApiApplication(
    parsePlatformConfig({
      NODE_ENV: "test",
      DATABASE_URL: db.url,
      TELEGRAM_ACTIVATION_INGRESS_SECRET: secret,
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
async function send(path: string, payload: object) {
  const response = await app.inject({
    method: "POST",
    url: `/integrations/telegram/v1/subscription-activation/${path}`,
    headers: {
      authorization: `Bearer ${secret}`,
      "x-inside-domain-names": "products.v1",
    },
    payload,
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  return response;
}
async function holder() {
  const accountId = randomUUID();
  const identityRef = `telegram:${randomUUID()}`;
  await db.prisma.account.create({
    data: {
      id: accountId,
      logtoIssuer: "https://fixture.invalid",
      logtoSubject: accountId,
    },
  });
  await linkTelegramAccount(db.prisma, {
    accountId,
    identityRef,
    now: new Date(fixedTestInstant()),
  });
  const binding = bindingLookupResponseSchema.parse(
    (await send("binding", { contractVersion: version, identityRef })).json(),
  );
  if (!binding.ok || binding.value.state !== "linked")
    throw new Error("Fixture binding missing");
  return { accountId, ...binding.value.binding };
}
async function product(accountId: string, nullMapping = false) {
  const id = randomUUID();
  await db.prisma.product.create({
    data: { id, name: "Current Product", slug: id },
  });
  const grant = await grantProductFixture(db.prisma, accountId, id);
  if (nullMapping)
    await db.prisma.productCommunity.create({
      data: {
        productId: id,
        groupRef: null,
        updatedBy: accountId,
        updatedAt: new Date(fixedTestInstant()),
      },
    });
  return { id, grant };
}
async function own(binding: Awaited<ReturnType<typeof holder>>) {
  const { accountId: _accountId, ...query } = binding;
  return ownSubscriptionAccessResponseSchema.parse(
    (
      await send("own-access", {
        contractVersion: version,
        ...query,
        includeProducts: true,
      })
    ).json(),
  );
}
test("production own-access assembly exposes every Product community without optional mapping, preserving union, revocation and exact Account binding", async () => {
  const account = await holder();
  const stranger = await holder();
  const missing = await product(account.accountId);
  const nullable = await product(account.accountId, true);
  const foreign = await product(stranger.accountId);
  const read = await own(account);
  if (!read.ok) throw new Error("Expected holder own-access");
  expect(
    read.value.products?.find((p) => p.id === missing.id)?.community,
  ).toEqual({ state: "available" });
  expect(
    read.value.products?.find((p) => p.id === nullable.id)?.community,
  ).toEqual({ state: "available" });
  expect(read.value.products?.map((p) => p.id).sort()).toEqual(
    [missing.id, nullable.id].sort(),
  );
  expect(read.value.products?.some((p) => p.id === foreign.id)).toBe(false);
  expect(
    await own({ ...account, linkRevision: account.linkRevision + 1 }),
  ).toMatchObject({ ok: false, error: { code: "identity_conflict" } });
  expect(
    await own({ ...account, accountRef: stranger.accountRef }),
  ).toMatchObject({ ok: false, error: { code: "identity_conflict" } });
  await revokeProductFixture(db.prisma, missing.grant);
  const revoked = await own(account);
  if (!revoked.ok) throw new Error("Expected revoked Product history");
  expect(
    revoked.value.products?.find((p) => p.id === missing.id)?.community,
  ).toEqual({ state: "revoked" });
  expect(
    revoked.value.products?.find((p) => p.id === nullable.id)?.community,
  ).toEqual({ state: "available" });
  const community = app.get(CommunityEntitlements);
  await community.project(account.accountId);
  expect(await community.readOwnCommunityEntry(account.accountId)).toEqual({
    kind: "preparing",
  });
  await revokeProductFixture(db.prisma, nullable.grant);
  await community.project(account.accountId);
  expect(await community.readOwnCommunityEntry(account.accountId)).toEqual({
    kind: "none",
  });
  const other = await own(stranger);
  if (!other.ok) throw new Error("Expected separate Account own-access");
  expect(other.value.products?.map((p) => p.id)).toEqual([foreign.id]);
});
