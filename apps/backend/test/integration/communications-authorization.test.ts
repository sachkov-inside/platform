import { randomBytes, randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { assembleAccounts, bootstrapOwnerAccount } from "../../src/modules/accounts/index.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";

const issuer = "https://communications.test/oidc";
const secret = "synthetic-authorization-secret";
const accountRef = randomUUID();
const telegramIdentityRef = "synthetic-telegram-identity";
const botIdentity = "synthetic-bot";

describe("communications permission and confirmed author HTTP authorization", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let ownerId: string;
  const linkRef = randomUUID();
  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    ownerId = (await bootstrapOwnerAccount(database.prisma, { issuer, subject: "owner" })).accountId;
    const now = new Date();
    await database.prisma.telegramLinkTransaction.create({ data: {
      linkRef, accountId: ownerId, principalRef: accountRef, providerIdentityRef: telegramIdentityRef,
      providerTransactionRef: randomUUID(), returnCorrelation: randomUUID(), tokenDigest: randomBytes(32).toString("base64url"),
      status: "linked", createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 60_000),
    } });
    app = await createApiApplication(parsePlatformConfig({
      NODE_ENV: "test", DATABASE_URL: database.url,
      TELEGRAM_COMMUNICATIONS_ENDPOINT: "http://127.0.0.1:9876/integrations/platform/v1/communications",
      TELEGRAM_COMMUNICATIONS_SECRET: "synthetic-communications-secret",
      TELEGRAM_AUTHOR_AUTHORIZATION_SECRET: secret, TELEGRAM_COMMUNICATIONS_BOT_IDENTITY: botIdentity,
    }), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => { await app?.close(); await database?.dispose(); });

  function request(subject: unknown = { kind: "telegram", accountRef, telegramIdentityRef, botIdentity }, authorization = `Bearer ${secret}`) {
    return app.inject({ method: "POST", url: "/integrations/telegram/v1/communications/authorize", headers: { authorization }, payload: {
      contractVersion: "inside-communications-v1", permission: "communications:manage", requestId: randomUUID(), subject,
    } });
  }

  test("materials permission never expands; explicit owner bootstrap is auditable and idempotent", async () => {
    expect((await request()).json()).toMatchObject({ status: "denied" });
    const accounts = assembleAccounts({ prisma: database.prisma, emailFingerprintKey: "synthetic-accounts-fingerprint-key" });
    expect(await accounts.checkPermission({ accountId: ownerId, permission: "communications:manage" })).toEqual({ ok: true, allowed: false });
    const results = await Promise.all(Array.from({ length: 3 }, () => bootstrapOwnerAccount(database.prisma, { issuer, subject: "owner" }, "communications:manage")));
    expect(results.filter(result => result.permissionGranted)).toHaveLength(1);
    expect(await database.prisma.accountAuditEvent.count({ where: { accountId: ownerId, event: "permission_granted", permission: "communications:manage" } })).toBe(1);
    expect(await accounts.checkPermission({ accountId: ownerId, permission: "communications:manage" })).toEqual({ ok: true, allowed: true });
    expect((await request()).json()).toMatchObject({ status: "allowed", accountRef });
    expect((await request({ kind: "account", accountRef })).json()).toMatchObject({ status: "allowed", accountRef });
    const communicationsOnly = await bootstrapOwnerAccount(database.prisma, { issuer, subject: "communications-only" }, "communications:manage");
    expect(await accounts.checkPermission({ accountId: communicationsOnly.accountId, permission: "materials:manage" })).toEqual({ ok: true, allowed: false });
  });

  test("service authentication and proven current association are mandatory", async () => {
    expect((await request(undefined, "Bearer forged-secret")).statusCode).toBe(401);
    expect((await request(undefined, "")).statusCode).toBe(401);
    for (const subject of [
      { kind: "account", accountRef: ownerId },
      { kind: "account", accountRef: "unknown" },
      { kind: "telegram", accountRef, telegramIdentityRef: "foreign", botIdentity },
      { kind: "telegram", accountRef, telegramIdentityRef, botIdentity: "foreign" },
    ]) expect((await request(subject)).json()).toMatchObject({ status: "denied" });
    expect((await request({ kind: "telegram", accountRef, telegramIdentityRef, botIdentity, username: "owner" })).statusCode).toBe(400);
    await database.prisma.telegramLinkTransaction.update({ where: { linkRef }, data: { status: "pending" } });
    expect((await request()).json()).toMatchObject({ status: "denied" });
    await database.prisma.telegramLinkTransaction.update({ where: { linkRef }, data: { status: "linked" } });
  });

  test("revocation affects the next check without caching", async () => {
    await database.prisma.accountPermission.delete({ where: { accountId_permission: { accountId: ownerId, permission: "communications:manage" } } });
    const response = await request();
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toMatchObject({ status: "denied" });
  });
});
