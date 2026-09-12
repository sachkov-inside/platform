import { createHash, randomUUID } from "node:crypto";

import { Module } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import schema from "../../../../docs/contracts/billing-v1/schema.json" with { type: "json" };
import { contractDigest } from "../../src/infrastructure/contracts/canonical-digest.js";
import {
  accountId,
  assembleAccounts,
  bootstrapOwnerAccount,
  type Accounts,
} from "../../src/modules/accounts/index.js";
import { verifiedAccountSignIn } from "../../src/modules/accounts/facets/accounts/verified-logto-identity.js";
import {
  assembleAccessGrants,
  assembleMembershipEntitlements,
  type AccessGrants,
} from "../../src/modules/membership-entitlements/index.js";
import { assembleWorkshopEntitlements } from "../../src/modules/workshop/index.js";
import {
  CommunityEntitlements,
  TelegramAccountLinks,
  type CommunitySetCommand,
} from "../../src/modules/telegram-membership/index.js";
import {
  DISPATCH_CONTRACT_VERSION,
  communitySetSchema,
  type CommunityDeliveryStatus,
  type DispatchAuthorizeRequest,
  type ObservedMembership,
} from "../../src/modules/telegram-membership/domain/community-entitlement.js";
import type {
  CommunityDeliveryOutcome,
  CommunityEntitlementProvider,
} from "../../src/modules/telegram-membership/ports/community-entitlement-provider.js";
import { parsePlatformConfig, PLATFORM_CONFIG } from "../../src/config/platform-config.js";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { HttpCachePolicyInterceptor } from "../../src/infrastructure/http/http-cache-policy.js";
import { CommunityDispatchController } from "../../src/modules/telegram-membership/adapters/nest/community-dispatch.controller.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const ajv = new Ajv({ strict: true, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(schema);
const validateWire = ajv.compile({ $ref: `${schema.$id}#` });

const issuer = "https://identity.community.test/oidc";
const start = "2030-01-01T00:00:00.000Z";
const finish = "2030-02-01T00:00:00.000Z";

/**
 * Stands in for the Telegram provider. It records the exact wire payload, checks it
 * against the vendored contract, and lets a test choose a lost answer, a refusal or an
 * observation. It never invents an effect the real provider would have to perform.
 */
class ProviderDouble implements CommunityEntitlementProvider {
  readonly sent: CommunitySetCommand[] = [];
  readonly polled: string[] = [];
  answer: "accept" | "unavailable" | "operation_conflict" = "accept";
  private readonly observations = new Map<
    string,
    { status: CommunityDeliveryStatus; observed: ObservedMembership }
  >();

  observe(
    operationId: string,
    status: CommunityDeliveryStatus,
    observed: ObservedMembership,
  ): void {
    this.observations.set(operationId, { observed, status });
  }

  set(command: CommunitySetCommand): Promise<CommunityDeliveryOutcome> {
    expect(validateWire(command), JSON.stringify(validateWire.errors)).toBe(true);
    this.sent.push(command);
    if (this.answer === "unavailable") {
      return Promise.resolve({ kind: "unavailable" });
    }
    if (this.answer === "operation_conflict") {
      return Promise.resolve({ error: "operation_conflict", kind: "error" });
    }
    this.observations.set(command.operationId, {
      observed: "unknown",
      status: "accepted",
    });
    return Promise.resolve(this.result(command));
  }

  status(command: CommunitySetCommand): Promise<CommunityDeliveryOutcome> {
    this.polled.push(command.operationId);
    if (this.answer === "unavailable") {
      return Promise.resolve({ kind: "unavailable" });
    }
    return Promise.resolve(this.result(command));
  }

  private result(command: CommunitySetCommand): CommunityDeliveryOutcome {
    const observation = this.observations.get(command.operationId) ?? {
      observed: "unknown" as ObservedMembership,
      status: "accepted" as CommunityDeliveryStatus,
    };
    const result = {
      access: command.access,
      binding: command.binding,
      contractVersion: command.contractVersion,
      entitlementRevision: command.entitlementRevision,
      observedMembership: observation.observed,
      operation: "entitlement.result" as const,
      operationId: command.operationId,
      status: observation.status,
      updatedAt: command.issuedAt,
    };
    expect(validateWire(result), JSON.stringify(validateWire.errors)).toBe(true);
    return { kind: "result", result };
  }
}

describe("community entitlement delivery (real PostgreSQL and real facets; synthetic provider only)", () => {
  let database: TestDatabase;
  let accounts: Accounts;
  let grants: AccessGrants;
  let links: TelegramAccountLinks;
  let owner: string;
  let now = new Date(start);

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    accounts = assembleAccounts({
      prisma: database.prisma,
      emailFingerprintKey: "community-entitlement-test-fingerprint-key",
    });
    owner = (
      await bootstrapOwnerAccount(
        database.prisma,
        { issuer, subject: "community-owner" },
        "platform:admin",
      )
    ).accountId;
    grants = assembleAccessGrants({
      accounts,
      prisma: database.prisma,
      clock: () => now,
    });
    links = new TelegramAccountLinks(database.prisma);
  });
  afterAll(async () => database.dispose());

  function community(provider: ProviderDouble): CommunityEntitlements {
    return new CommunityEntitlements({
      accounts,
      clock: () => now,
      grants,
      links,
      prisma: database.prisma,
      provider,
    });
  }

  function membership() {
    return assembleMembershipEntitlements({
      prisma: database.prisma,
      clock: () => now,
      workshopEntitlements: assembleWorkshopEntitlements({
        prisma: database.prisma,
        clock: () => now,
      }),
    });
  }

  async function member(): Promise<string> {
    const subject = randomUUID();
    const result = await accounts.establishAccount({
      identity: verifiedAccountSignIn({
        issuer,
        subject,
        verifiedEmail: `${subject}@example.test`,
      }).identity,
    });
    if (!result.ok) throw new Error("Account fixture failed");
    return result.account.accountId;
  }

  /** Records a confirmed link exactly as the linking protocol does: one linked row. */
  async function link(accountId: string, identityRef: string): Promise<string> {
    const principalRef = randomUUID();
    await database.prisma.telegramLinkTransaction.create({
      data: {
        accountId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 300_000),
        linkRef: randomUUID(),
        principalRef,
        providerIdentityRef: identityRef,
        providerTransactionRef: randomUUID(),
        returnCorrelation: randomUUID(),
        status: "linked",
        tokenDigest: createHash("sha256")
          .update(principalRef)
          .digest("base64url"),
        updatedAt: now,
      },
    });
    return principalRef;
  }

  async function unlink(accountId: string): Promise<void> {
    await database.prisma.telegramLinkTransaction.updateMany({
      where: { accountId, status: "linked" },
      data: { status: "expired", updatedAt: now },
    });
  }

  async function grantCommunity(
    accountId: string,
    validUntil: string | null,
  ): Promise<{ grantRef: string; revision: number }> {
    const preview = await grants.previewBatch(owner, {
      operationId: randomUUID(),
      rows: [
        {
          rowKey: "community",
          accountId,
          source: "manual",
          sourceRef: randomUUID(),
          terms: {
            capabilities: ["materials", "community"],
            reason: "Synthetic community right",
            startsAt: start,
            validUntil,
          },
        },
      ],
    });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    const applied = await grants.applyBatch(owner, {
      operationId: randomUUID(),
      previewRef: preview.previewRef,
      expectedRevision: preview.revision,
      confirmedRows: ["community"],
    });
    const row = applied.ok ? applied.rows[0]?.result : undefined;
    if (row === undefined || !row.ok) throw new Error(JSON.stringify(applied));
    return { grantRef: row.grantRef, revision: row.revision };
  }

  async function operations(accountId: string) {
    return database.prisma.telegramCommunityOperation.findMany({
      where: { accountId },
      orderBy: { entitlementRevision: "asc" },
    });
  }

  function authorization(
    dispatchId: string,
    payloadDigest: string,
    effect: DispatchAuthorizeRequest["effect"],
  ): DispatchAuthorizeRequest {
    return {
      attemptId: randomUUID(),
      contractVersion: DISPATCH_CONTRACT_VERSION,
      dispatchContractVersion: "inside.community-entitlement.v1",
      dispatchId,
      effect,
      effectRef: randomUUID(),
      operation: "dispatch.authorize",
      operationId: randomUUID(),
      payloadDigest,
    };
  }

  test("a granted right is delivered once, a revoke supersedes it, and a replay never resurrects it", async () => {
    now = new Date(start);
    const account = await member();
    await link(account, `identity-${account}`);
    await grantCommunity(account, finish);
    const provider = new ProviderDouble();
    const app = community(provider);

    expect(await app.project(account)).toMatchObject({
      ok: true,
      entitlementRevision: 1,
    });
    // A second projection of unchanged facts issues no second command.
    expect(await app.project(account)).toMatchObject({ issued: [] });
    const [granted] = await operations(account);
    expect(granted).toMatchObject({
      delivery: "pending",
      entitlementRevision: 1,
      purpose: "apply",
    });
    expect(granted?.access).toEqual({ kind: "finite", validUntil: finish });

    expect(await app.sweep()).toMatchObject({ accepted: 1, sent: 1 });
    expect(provider.sent).toHaveLength(1);
    const first = provider.sent[0];
    if (first === undefined) throw new Error("Missing delivered command");
    expect(contractDigest(first)).toBe(granted?.payloadDigest);

    const revoked = await grants.changeGrant(owner, {
      action: "revoke",
      grantRef: (await grantsOf(account))[0] ?? "",
      expectedRevision: 1,
      operationId: randomUUID(),
      reason: "Owner revoked the community right",
    });
    expect(revoked.ok).toBe(true);
    await app.project(account);
    const [, denial] = await operations(account);
    expect(denial).toMatchObject({ entitlementRevision: 2, purpose: "apply" });
    expect(denial?.access).toEqual({ kind: "denied" });

    // The already delivered older command is never sent again, and cannot be authorised.
    await app.sweep();
    expect(provider.sent).toHaveLength(2);
    expect(
      await app.authorizeDispatch(
        authorization(
          granted?.operationId ?? "",
          granted?.payloadDigest ?? "",
          "community.ensure_admission",
        ),
      ),
    ).toMatchObject({
      ok: true,
      result: { decision: { reason: "superseded", status: "denied" } },
    });
  });

  async function grantsOf(accountId: string): Promise<string[]> {
    const rows = await database.prisma.accessGrant.findMany({
      where: { accountId, capabilities: { has: "community" } },
      orderBy: { revision: "asc" },
    });
    return rows.map((row) => row.id);
  }

  test("a lost answer is retried under the original operation and payload", async () => {
    now = new Date(start);
    const account = await member();
    await link(account, `identity-${account}`);
    await grantCommunity(account, finish);
    const provider = new ProviderDouble();
    provider.answer = "unavailable";
    const app = community(provider);
    await app.project(account);

    expect(await app.sweep()).toMatchObject({ accepted: 0, sent: 1 });
    const [pending] = await operations(account);
    expect(pending).toMatchObject({ attempts: 1, delivery: "pending" });
    expect(pending?.errorCode).toBe("no_answer");

    now = new Date(new Date(start).getTime() + 60_000);
    provider.answer = "accept";
    expect(await app.sweep()).toMatchObject({ accepted: 1, sent: 1 });
    expect(provider.sent).toHaveLength(2);
    expect(provider.sent[0]).toEqual(provider.sent[1]);
    expect(await operations(account)).toHaveLength(1);
    const [settled] = await operations(account);
    expect(settled).toMatchObject({
      delivery: "accepted",
      observedMembership: "unknown",
      resultStatus: "accepted",
    });
  });

  test("a refused command is operator work, and accepted intent is not applied membership", async () => {
    now = new Date(start);
    const account = await member();
    await link(account, `identity-${account}`);
    await grantCommunity(account, null);
    const provider = new ProviderDouble();
    provider.answer = "operation_conflict";
    const app = community(provider);
    await app.project(account);
    const report = await app.sweep();
    expect(report).toMatchObject({ rejected: 1 });
    expect(report.backlog.rejected).toBeGreaterThan(0);
    const [refused] = await operations(account);
    expect(refused).toMatchObject({
      delivery: "rejected",
      errorCode: "operation_conflict",
    });

    // Materials never wait for the community provider.
    await expect(membership().resolveForAccess(accountId(account))).resolves.toEqual({
      kind: "active",
      validUntil: null,
    });
  });

  test("a reached expiry boundary denies the right without any user request", async () => {
    now = new Date(start);
    const account = await member();
    await link(account, `identity-${account}`);
    await grantCommunity(account, finish);
    const provider = new ProviderDouble();
    const app = community(provider);
    await app.sweep();
    expect(await operations(account)).toHaveLength(1);

    now = new Date(finish);
    // No access change and no user action: only the stored boundary drives this pass.
    await app.sweep();
    const rows = await operations(account);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ entitlementRevision: 2 });
    expect(rows[1]?.access).toEqual({ kind: "denied" });
  });

  test("a queued grant cannot admit after an unlink, and the old identity is closed by its own history", async () => {
    now = new Date(start);
    const account = await member();
    const identity = `identity-${account}`;
    await link(account, identity);
    await grantCommunity(account, null);
    const provider = new ProviderDouble();
    const app = community(provider);
    await app.sweep();
    const [queued] = await operations(account);

    await unlink(account);
    // The projector has not run yet: the stale command still fails its binding check.
    expect(
      await app.authorizeDispatch(
        authorization(
          queued?.operationId ?? "",
          queued?.payloadDigest ?? "",
          "community.ensure_admission",
        ),
      ),
    ).toMatchObject({
      ok: true,
      result: { decision: { reason: "binding_conflict", status: "denied" } },
    });

    await app.project(account);
    // Still a binding conflict once the cleanup command exists: the recipient moved.
    expect(
      await app.authorizeDispatch(
        authorization(
          queued?.operationId ?? "",
          queued?.payloadDigest ?? "",
          "community.ensure_admission",
        ),
      ),
    ).toMatchObject({
      ok: true,
      result: { decision: { reason: "binding_conflict", status: "denied" } },
    });
    const rows = await operations(account);
    expect(rows[1]).toMatchObject({
      identityRef: identity,
      purpose: "cleanup",
    });
    expect(rows[1]?.access).toEqual({ kind: "denied" });
    const cleanup = rows[1];
    expect(
      await app.authorizeDispatch(
        authorization(
          cleanup?.operationId ?? "",
          cleanup?.payloadDigest ?? "",
          "community.ensure_absence",
        ),
      ),
    ).toMatchObject({
      ok: true,
      result: { decision: { status: "allowed" } },
    });
    // Removing a chat member never touches the paid or manual material right.
    await expect(membership().resolveForAccess(accountId(account))).resolves.toEqual({
      kind: "active",
      validUntil: null,
    });

    const other = await member();
    await link(other, identity);
    expect(
      await app.authorizeDispatch(
        authorization(
          cleanup?.operationId ?? "",
          cleanup?.payloadDigest ?? "",
          "community.ensure_absence",
        ),
      ),
    ).toMatchObject({
      ok: true,
      result: { decision: { reason: "binding_conflict", status: "denied" } },
    });
  });

  test("relinking moves admission to the new identity and keeps the old one closed", async () => {
    now = new Date(start);
    const account = await member();
    await link(account, `first-${account}`);
    await grantCommunity(account, null);
    const provider = new ProviderDouble();
    const app = community(provider);
    await app.sweep();

    await unlink(account);
    await link(account, `second-${account}`);
    await app.project(account);
    const rows = await operations(account);
    expect(rows.map((row) => row.purpose)).toEqual([
      "apply",
      "cleanup",
      "apply",
    ]);
    expect(rows[1]?.identityRef).toBe(`first-${account}`);
    expect(rows[2]?.identityRef).toBe(`second-${account}`);
    expect(rows[2]?.access).toEqual({ kind: "lifetime" });
    // Two distinct recipients, never one command retargeted at another identity.
    expect(rows[1]?.accountRef).not.toBe(rows[2]?.accountRef);
  });

  test("an expired command is refused, and an expired reason cannot remove a live member", async () => {
    now = new Date(start);
    const account = await member();
    await link(account, `identity-${account}`);
    await grantCommunity(account, finish);
    const provider = new ProviderDouble();
    const app = community(provider);
    await app.sweep();
    const [finite] = await operations(account);

    now = new Date(finish);
    expect(
      await app.authorizeDispatch(
        authorization(
          finite?.operationId ?? "",
          finite?.payloadDigest ?? "",
          "community.ensure_admission",
        ),
      ),
    ).toMatchObject({
      ok: true,
      result: { decision: { reason: "expired", status: "denied" } },
    });

    // A second independent reason keeps the member in place.
    await grantCommunity(account, null);
    expect(
      await app.authorizeDispatch(
        authorization(
          finite?.operationId ?? "",
          finite?.payloadDigest ?? "",
          "community.ensure_absence",
        ),
      ),
    ).toMatchObject({
      ok: true,
      result: { decision: { reason: "superseded", status: "denied" } },
    });
  });

  test("authorization is correlated, replayable and refuses foreign work", async () => {
    now = new Date(start);
    const account = await member();
    await link(account, `identity-${account}`);
    await grantCommunity(account, null);
    const provider = new ProviderDouble();
    const app = community(provider);
    await app.sweep();
    const [live] = await operations(account);
    const request = authorization(
      live?.operationId ?? "",
      live?.payloadDigest ?? "",
      "community.approve_join",
    );

    const allowed = await app.authorizeDispatch(request);
    expect(allowed).toMatchObject({
      ok: true,
      result: {
        attemptId: request.attemptId,
        dispatchId: request.dispatchId,
        operationId: request.operationId,
        decision: { status: "allowed" },
      },
    });
    if (!allowed.ok || allowed.result.decision.status !== "allowed") {
      throw new Error("Expected an allowed permit");
    }
    expect(Date.parse(allowed.result.decision.validUntil)).toBe(
      now.getTime() + 5_000,
    );
    // The permit is a check, not a reservation: a replay repeats its original deadline.
    now = new Date(new Date(start).getTime() + 4_000);
    expect(await app.authorizeDispatch(request)).toEqual(allowed);
    expect(
      await app.authorizeDispatch({ ...request, attemptId: randomUUID() }),
    ).toMatchObject({ ok: false, error: { error: "operation_conflict" } });

    now = new Date(start);
    expect(
      await app.authorizeDispatch({
        ...authorization(
          live?.operationId ?? "",
          "f".repeat(64),
          "community.approve_join",
        ),
      }),
    ).toMatchObject({
      ok: true,
      result: { decision: { reason: "payload_conflict", status: "denied" } },
    });
    expect(
      await app.authorizeDispatch(
        authorization(randomUUID(), live?.payloadDigest ?? "", "community.approve_join"),
      ),
    ).toMatchObject({
      ok: true,
      result: { decision: { reason: "not_found", status: "denied" } },
    });
    expect(
      await app.authorizeDispatch({
        ...authorization(
          live?.operationId ?? "",
          live?.payloadDigest ?? "",
          "notice.send",
        ),
        dispatchContractVersion: "inside.billing-notification.v1",
      }),
    ).toMatchObject({
      ok: true,
      result: { decision: { reason: "effect_conflict", status: "denied" } },
    });
  });

  test("reconciliation finds a missed change and turns an accepted intent into an observed one", async () => {
    now = new Date(start);
    const account = await member();
    await link(account, `identity-${account}`);
    await grantCommunity(account, null);
    const provider = new ProviderDouble();
    const app = community(provider);

    // No explicit projection call: the audit cursor alone must find this Account.
    await app.sweep();
    const [queued] = await operations(account);
    expect(queued).toMatchObject({ delivery: "accepted", resultStatus: "accepted" });

    provider.observe(queued?.operationId ?? "", "applied", "member");
    now = new Date(new Date(start).getTime() + 61_000);
    await app.sweep();
    expect(provider.polled).toContain(queued?.operationId);
    const view = await app.readDelivery(owner, account);
    expect(view).toMatchObject({
      ok: true,
      value: {
        desired: { entitlementRevision: 1 },
        operations: [
          {
            appliedState: "applied",
            delivery: "accepted",
            observedMembership: "member",
          },
        ],
      },
    });

    // A member who left is noticed by the same reconciliation, without a new revision.
    provider.observe(queued?.operationId ?? "", "waiting_for_join", "not_member");
    now = new Date(new Date(start).getTime() + 122_000);
    await app.sweep();
    const after = await app.readDelivery(owner, account);
    expect(after).toMatchObject({
      ok: true,
      value: {
        desired: { entitlementRevision: 1 },
        operations: [
          { appliedState: "waiting_for_join", observedMembership: "not_member" },
        ],
      },
    });

    expect(await app.readDelivery(account, account)).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
  });

  test("a rejoin under the same right is approved without a new entitlement revision", async () => {
    now = new Date(start);
    const account = await member();
    await link(account, `identity-${account}`);
    await grantCommunity(account, finish);
    const provider = new ProviderDouble();
    const app = community(provider);
    await app.sweep();
    const [granted] = await operations(account);
    provider.observe(granted?.operationId ?? "", "applied", "member");
    now = new Date(new Date(start).getTime() + 61_000);
    await app.sweep();

    // The member leaves the chat; the right itself did not change.
    provider.observe(granted?.operationId ?? "", "waiting_for_join", "not_member");
    now = new Date(new Date(start).getTime() + 122_000);
    await app.sweep();
    expect(await operations(account)).toHaveLength(1);

    // A new verified join request arrives under its own effect reference.
    expect(
      await app.authorizeDispatch(
        authorization(
          granted?.operationId ?? "",
          granted?.payloadDigest ?? "",
          "community.approve_join",
        ),
      ),
    ).toMatchObject({
      ok: true,
      result: { decision: { status: "allowed" } },
    });
    expect(await app.readDelivery(owner, account)).toMatchObject({
      ok: true,
      value: { desired: { entitlementRevision: 1 } },
    });
  });

  test("a crash after sending repeats the same command and settles it once", async () => {
    now = new Date(start);
    const account = await member();
    await link(account, `identity-${account}`);
    await grantCommunity(account, null);
    const provider = new ProviderDouble();
    const app = community(provider);
    await app.project(account);
    const [queued] = await operations(account);

    // The provider accepted the command and the process died before the durable write.
    await provider.set(communitySetSchema.parse(queued?.command));
    expect(await operations(account)).toMatchObject([{ delivery: "pending" }]);

    await app.sweep();
    expect(provider.sent).toHaveLength(2);
    expect(provider.sent[0]).toEqual(provider.sent[1]);
    const rows = await operations(account);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delivery: "accepted", entitlementRevision: 1 });
  });

  test("an unavailable check is never remembered as the permit answer", async () => {
    now = new Date(start);
    const account = await member();
    await link(account, `identity-${account}`);
    await grantCommunity(account, null);
    const provider = new ProviderDouble();
    const app = community(provider);
    await app.sweep();
    const [live] = await operations(account);
    const request = authorization(
      live?.operationId ?? "",
      live?.payloadDigest ?? "",
      "community.approve_join",
    );

    const degraded = new CommunityEntitlements({
      accounts,
      clock: () => now,
      grants: {
        readChangedAccounts: (query) => grants.readChangedAccounts(query),
        resolveCapabilities: () =>
          Promise.resolve({ ok: false as const, error: { code: "unavailable" as const } }),
      },
      links,
      prisma: database.prisma,
      provider,
    });
    expect(await degraded.authorizeDispatch(request)).toMatchObject({
      ok: true,
      result: { decision: { status: "unavailable" } },
    });
    // The same authorization must still be able to reach a real decision.
    expect(await app.authorizeDispatch(request)).toMatchObject({
      ok: true,
      result: { decision: { status: "allowed" } },
    });
  });

  test("an unknown provider outcome stays unapplied and visible to the operator", async () => {
    now = new Date(start);
    const account = await member();
    await link(account, `identity-${account}`);
    await grantCommunity(account, null);
    const provider = new ProviderDouble();
    const app = community(provider);
    await app.sweep();
    const [queued] = await operations(account);

    provider.observe(queued?.operationId ?? "", "unknown", "unknown");
    now = new Date(new Date(start).getTime() + 61_000);
    const report = await app.sweep();
    expect(report.backlog.unapplied).toBeGreaterThan(0);
    const [row] = await operations(account);
    // An unknown external outcome is never presented as a decided one.
    expect(row).toMatchObject({
      delivery: "accepted",
      observedMembership: "unknown",
      resultStatus: "unknown",
    });
  });

  test("relinking to the same Telegram identity still closes the previous recipient", async () => {
    now = new Date(start);
    const account = await member();
    const identity = `stable-${account}`;
    await link(account, identity);
    const { grantRef, revision } = await grantCommunity(account, null);
    const provider = new ProviderDouble();
    const app = community(provider);
    await app.sweep();
    const [first] = await operations(account);

    // A new link transaction to the same identity produces a new opaque recipient.
    await unlink(account);
    await link(account, identity);
    expect(
      await grants.changeGrant(owner, {
        action: "revoke",
        grantRef,
        expectedRevision: revision,
        operationId: randomUUID(),
        reason: "Owner revoked while the link was being replaced",
      }),
    ).toMatchObject({ ok: true });
    await app.project(account);

    const rows = await operations(account);
    const closing = rows.find(
      (row) => row.accountRef === first?.accountRef && row.purpose === "cleanup",
    );
    // The recipient that was told to admit is told to stop, even though the
    // Telegram identity behind it never changed.
    expect(closing?.access).toEqual({ kind: "denied" });
  });

  test("the dispatch endpoint maps every protocol answer to its exact status", async () => {
    now = new Date(start);
    const account = await member();
    await link(account, `identity-${account}`);
    await grantCommunity(account, null);
    const provider = new ProviderDouble();
    const app = community(provider);
    await app.sweep();
    const [live] = await operations(account);

    const dispatchSecret = "community-dispatch-http-test-secret";
    const config = parsePlatformConfig({
      NODE_ENV: "test",
      TELEGRAM_COMMUNITY_DISPATCH_SECRET: dispatchSecret,
      TELEGRAM_COMMUNITY_ENTITLEMENT_ENDPOINT:
        "https://telegram.example.test/integrations/platform/v1/community-entitlements",
      TELEGRAM_COMMUNITY_ENTITLEMENT_SECRET: "community-provider-http-test-secret",
    });
    @Module({
      controllers: [CommunityDispatchController],
      providers: [
        { provide: CommunityEntitlements, useValue: app },
        { provide: PLATFORM_CONFIG, useValue: config },
      ],
    })
    // oxlint-disable-next-line typescript/no-extraneous-class -- Nest requires a concrete module class for the HTTP fixture.
    class DispatchFixtureModule {}
    const http = await NestFactory.create<NestFastifyApplication>(
      DispatchFixtureModule,
      new FastifyAdapter(),
      { logger: false },
    );
    http.useGlobalInterceptors(new HttpCachePolicyInterceptor(new Reflector()));
    await http.init();
    await http.getHttpAdapter().getInstance().ready();
    const url = "/internal/billing-dispatch/authorize";
    const send = (payload: object, secret = dispatchSecret) =>
      http.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${secret}` },
        payload,
      });
    try {
      const request = authorization(
        live?.operationId ?? "",
        live?.payloadDigest ?? "",
        "community.approve_join",
      );

      const unauthorized = await send(request, "wrong-secret");
      expect(unauthorized.statusCode).toBe(401);
      expect(unauthorized.json()).toEqual({ code: "unauthorized" });
      expect(unauthorized.headers["cache-control"]).toBe("private, no-store");

      const allowed = await send(request);
      expect(allowed.statusCode).toBe(200);
      expect(allowed.json()).toMatchObject({
        operation: "dispatch.result",
        operationId: request.operationId,
        decision: { status: "allowed" },
      });

      // The same identifier with another payload is a conflict, not a second permit.
      const conflict = await send({ ...request, attemptId: randomUUID() });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toMatchObject({
        operation: "dispatch.error",
        error: "operation_conflict",
      });

      const wrongVersion = await send({
        ...authorization(
          live?.operationId ?? "",
          live?.payloadDigest ?? "",
          "community.approve_join",
        ),
        contractVersion: "inside.community-entitlement.v1",
      });
      expect(wrongVersion.statusCode).toBe(422);
      expect(wrongVersion.json()).toMatchObject({
        operation: "dispatch.error",
        error: "unsupported_contract",
      });

      // Without a parseable operationId there is no correlation to invent.
      const malformed = await send({ contractVersion: "inside.billing-dispatch.v1" });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json()).toEqual({ code: "malformed" });

      const denied = await send(
        authorization(randomUUID(), live?.payloadDigest ?? "", "community.approve_join"),
      );
      expect(denied.statusCode).toBe(200);
      expect(denied.json()).toMatchObject({
        decision: { reason: "not_found", status: "denied" },
      });
    } finally {
      await http.close();
    }
  });

  test("one revision addresses one desired state, so two cannot disagree", async () => {
    now = new Date(start);
    const account = await member();
    await link(account, `identity-${account}`);
    await grantCommunity(account, null);
    const app = community(new ProviderDouble());
    await app.project(account);
    const [issued] = await operations(account);
    if (issued === undefined) throw new Error("Missing issued command");
    const command = communitySetSchema.parse(issued.command);

    // The producer can never emit a second, different state at the same revision.
    await expect(
      database.prisma.telegramCommunityOperation.create({
        data: {
          ...issued,
          operationId: randomUUID(),
          access: { kind: "denied" },
          command: { ...command, access: { kind: "denied" } },
          result: Prisma.JsonNull,
        },
      }),
    ).rejects.toThrow();
  });

  test("an Account without a verified link keeps its material right and queues nothing", async () => {
    now = new Date(start);
    const account = await member();
    await grantCommunity(account, null);
    const provider = new ProviderDouble();
    const app = community(provider);

    expect(await app.project(account)).toMatchObject({ issued: [] });
    expect(await operations(account)).toHaveLength(0);
    await expect(membership().resolveForAccess(accountId(account))).resolves.toEqual({
      kind: "active",
      validUntil: null,
    });
  });

  /** One bought Guide is a reason of its own: the chat right follows that right's own term. */
  async function grantGuide(
    accountId: string,
    validUntil: string | null,
  ): Promise<{ grantRef: string; revision: number }> {
    const preview = await grants.previewBatch(owner, {
      operationId: randomUUID(),
      rows: [
        {
          rowKey: "guide",
          accountId,
          source: "manual",
          sourceRef: randomUUID(),
          terms: {
            capabilities: [`guide:${randomUUID()}`],
            reason: "Synthetic guide right",
            startsAt: start,
            validUntil,
          },
        },
      ],
    });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    const applied = await grants.applyBatch(owner, {
      operationId: randomUUID(),
      previewRef: preview.previewRef,
      expectedRevision: preview.revision,
      confirmedRows: ["guide"],
    });
    const row = applied.ok ? applied.rows[0]?.result : undefined;
    if (row === undefined || !row.ok || !("grantRef" in row))
      throw new Error(JSON.stringify(applied));
    return { grantRef: row.grantRef, revision: row.revision };
  }

  test("a Guide right alone admits to the one shared chat, and its revocation closes it", async () => {
    now = new Date(start);
    const account = await member();
    await link(account, `identity-${account}`);
    const guide = await grantGuide(account, null);
    const app = community(new ProviderDouble());

    expect(await app.project(account)).toMatchObject({
      ok: true,
      entitlementRevision: 1,
    });
    const desired =
      await database.prisma.telegramCommunityDesiredState.findUniqueOrThrow({
        where: { accountId: account },
      });
    // The Guide right carries no end, so participation carries none either.
    expect(desired.access).toEqual({ kind: "lifetime" });
    expect(desired.nextBoundary).toBeNull();
    const [admitted] = await operations(account);
    expect(admitted).toMatchObject({
      delivery: "pending",
      entitlementRevision: 1,
      purpose: "apply",
    });
    expect(communitySetSchema.parse(admitted?.command).access).toEqual({
      kind: "lifetime",
    });

    expect(
      await grants.changeGrant(owner, {
        action: "revoke",
        grantRef: guide.grantRef,
        expectedRevision: guide.revision,
        operationId: randomUUID(),
        reason: "Owner revoked the guide right",
      }),
    ).toMatchObject({ ok: true });
    await app.project(account);
    const [, denial] = await operations(account);
    // The last reason is gone, so the same recipient is told to close participation.
    expect(denial).toMatchObject({ entitlementRevision: 2, purpose: "apply" });
    expect(denial?.access).toEqual({ kind: "denied" });
  });

  test("a finite Guide right ends participation exactly at its own boundary", async () => {
    now = new Date(start);
    const account = await member();
    await link(account, `identity-${account}`);
    await grantGuide(account, finish);
    const app = community(new ProviderDouble());

    await app.project(account);
    const [admitted] = await operations(account);
    expect(admitted?.access).toEqual({ kind: "finite", validUntil: finish });

    now = new Date(finish);
    await app.project(account);
    const [, denial] = await operations(account);
    expect(denial?.access).toEqual({ kind: "denied" });
  });
});
