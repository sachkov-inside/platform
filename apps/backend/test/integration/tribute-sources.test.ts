import { eventually } from "./setup/eventually.js";
import { lockAccountEntitlementChanges } from "../../src/infrastructure/prisma/index.js";
import { changeEnrollmentInTransaction } from "../../src/modules/membership-entitlements/features/change-enrollment/change-enrollment.js";
import { z } from "zod";
import { activationResponseSchema } from "../../src/modules/telegram-membership/domain/subscription-activation-wire.js";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  accountId,
  assembleAccounts,
  bootstrapOwnerAccount,
} from "../../src/modules/accounts/index.js";
import {
  assembleAccessGrants,
  assembleMembershipEntitlements,
  TributeSources,
} from "../../src/modules/membership-entitlements/index.js";
import { SubscriptionActivationController } from "../../src/modules/telegram-membership/features/activate-subscription/subscription-activation.controller.js";
import {
  SubscriptionActivation,
  TributeConvergence,
} from "../../src/modules/billing/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { assembleWorkshopEntitlements } from "../../src/modules/workshop/index.js";
import { ReceiveTributeController } from "../../src/modules/billing/features/receive-tribute/receive-tribute.controller.js";
import {
  PLATFORM_CONFIG,
  parsePlatformConfig,
} from "../../src/config/platform-config.js";
import { HttpCachePolicyInterceptor } from "../../src/infrastructure/http/http-cache-policy.js";
import { ProblemDetailsFilter } from "../../src/infrastructure/http/problem-details.filter.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { linkTelegramAccount } from "./setup/telegram-link.js";

function deferredValue<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
function value<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
describe("Tribute source production facets and signed HTTP with PostgreSQL", () => {
  let db: TestDatabase;
  let owner: string;
  let sources: TributeSources;
  let convergence: TributeConvergence;
  let grants: ReturnType<typeof assembleAccessGrants>;
  let membership: ReturnType<typeof assembleMembershipEntitlements>;
  let http: NestFastifyApplication;
  let now = new Date("2030-01-01T00:00:00.000Z");
  let subscriptionSequence = 625000;
  const key = "synthetic-tribute-key-local-625";
  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    owner = (
      await bootstrapOwnerAccount(
        db.prisma,
        { issuer: "https://tribute.example.test", subject: "owner" },
        "platform:admin",
      )
    ).accountId;
    const accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "synthetic-tribute-account-fingerprint-key-625",
    });
    const links = new TelegramAccountLinks(db.prisma);
    sources = new TributeSources({
      prisma: db.prisma,
      accounts,
      links,
      clock: () => now,
    });
    convergence = new TributeConvergence(db.prisma, sources);
    grants = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
      recipientLinks: links,
      clock: () => now,
    });
    membership = assembleMembershipEntitlements({
      prisma: db.prisma,
      recipientLinks: links,
      clock: () => now,
      workshopEntitlements: assembleWorkshopEntitlements({
        prisma: db.prisma,
        clock: () => now,
      }),
    });
    @Module({
      controllers: [ReceiveTributeController, SubscriptionActivationController],
      providers: [
        { provide: TributeConvergence, useValue: convergence },
        {
          provide: SubscriptionActivation,
          useValue: new SubscriptionActivation({
            prisma: db.prisma,
            grants,
            bindings: links,
            readAdmission: () =>
              Promise.resolve({
                state: "checking",
                admissionRestriction: null,
              }),
          }),
        },
        {
          provide: PLATFORM_CONFIG,
          useValue: parsePlatformConfig({
            NODE_ENV: "test",
            TRIBUTE_API_KEY: key,
            TRIBUTE_SIGNATURE_ENCODING: "hex",
            TELEGRAM_ACTIVATION_INGRESS_SECRET: "synthetic-activation-625",
          }),
        },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: APP_INTERCEPTOR, useClass: HttpCachePolicyInterceptor },
      ],
    })
    // oxlint-disable-next-line typescript/no-extraneous-class -- Nest fixture uses real facets and external identity/provider doubles only.
    class FixtureModule {}
    http = await NestFactory.create<NestFastifyApplication>(
      FixtureModule,
      new FastifyAdapter(),
      { logger: false, rawBody: true },
    );
    await http.init();
    await http.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await http?.close();
    await db?.dispose();
  });
  async function setup(
    mode: "confirmed_period" | "temporary_membership" = "confirmed_period",
  ) {
    now = new Date("2030-01-01T00:00:00.000Z");
    const policyRef = randomUUID(),
      identityRef = randomUUID(),
      guideId = randomUUID();
    const tier = await db.prisma.billingOffer.create({
      data: {
        id: randomUUID(),
        name: "Подписка Inside",
        benefits: ["materials", "community"],
        contentScope: { guideIds: [guideId], materialIds: [] },
        availableForAssignment: true,
        revision: 1,
      },
    });
    const subscriptionId = ++subscriptionSequence;
    value(
      await convergence.savePolicy(owner, {
        operationId: randomUUID(),
        expectedRevision: 0,
        id: policyRef,
        subscriptionId,
        enabled: true,
        tierId: tier.id,
        tierRevision: 1,
        temporaryUntil:
          mode === "temporary_membership" ? "2030-02-01T00:00:00.000Z" : null,
        reason: "Подтверждённый источник",
      }),
    );
    const row = {
      rowRef: randomUUID(),
      policyRef,
      subscriptionId,
      identityRef,
      telegramUserId: String(subscriptionId),
      verificationRef: randomUUID(),
      checkedAt: now.toISOString(),
      mode,
      startsAt: now.toISOString(),
      endsAt: "2030-02-01T00:00:00.000Z",
      renewal: "enabled" as const,
      expectedRevision: 0,
      reason: "Подтверждённые даты и identity",
    };
    return { row, tier, guideId };
  }
  async function link(identityRef: string) {
    const id = randomUUID();
    await db.prisma.account.create({
      data: {
        id,
        logtoIssuer: "https://tribute.example.test",
        logtoSubject: id,
      },
    });
    const principal = await linkTelegramAccount(db.prisma, {
      accountId: id,
      identityRef,
      now,
    });
    expect(
      await membership.bindPrincipal({
        accountId: accountId(id),
        principalRef: principal,
      }),
    ).toMatchObject({ ok: true });
    return { id, principal };
  }
  async function apply(row: Awaited<ReturnType<typeof setup>>["row"]) {
    const preview = value(
      await convergence.preview(owner, {
        operationId: randomUUID(),
        batchRef: row.rowRef,
        rows: [row],
      }),
    );
    const command = {
      operationId: randomUUID(),
      previewRef: preview.previewRef,
      selectedRows: [row.rowRef],
    };
    return { command, result: value(await convergence.apply(owner, command)) };
  }
  function event(
    row: Awaited<ReturnType<typeof setup>>["row"],
    name = "renewed_subscription",
    expiresAt = "2030-03-01T00:00:00.000Z",
  ) {
    return {
      name,
      created_at: now.toISOString(),
      sent_at: now.toISOString(),
      payload: {
        subscription_name: "Подписка",
        subscription_id: row.subscriptionId,
        period_id: 1,
        period: "monthly",
        price: 10000,
        amount: 9000,
        currency: "rub",
        user_id: 1,
        trb_user_id: `T-${row.telegramUserId}`,
        telegram_user_id: Number(row.telegramUserId),
        channel_id: 10,
        channel_name: "Источник",
        expires_at: expiresAt,
        type: "regular",
        ...(name === "cancelled_subscription" ? { cancel_reason: "" } : {}),
      },
    };
  }
  async function send(input: unknown, signature?: string) {
    const raw = JSON.stringify(input, null, 2);
    const response = await http.inject({
      method: "POST",
      url: "/integrations/tribute/v1/webhook",
      payload: raw,
      headers: {
        "content-type": "application/json",
        "trbt-signature":
          signature ?? createHmac("sha256", key).update(raw).digest("hex"),
      },
    });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    return response;
  }
  test("legacy unconfirmed source is visible and imported into the same record; generic Tribute registration is closed", async () => {
    const context = await setup();
    expect(
      await grants.registerSourceEntitlement(owner, {
        operationId: randomUUID(),
        origin: "tribute",
        sourcePolicyRef: context.row.policyRef,
        identityRef: context.row.identityRef,
        checkedAt: now.toISOString(),
        startsAt: context.row.startsAt,
        endsAt: context.row.endsAt,
        reason: "Must use registry import",
      }),
    ).toMatchObject({ ok: false });
    const sourceRef = createHash("sha256")
      .update(
        JSON.stringify([
          "tribute",
          context.row.policyRef,
          context.row.identityRef,
        ]),
      )
      .digest("hex");
    const legacy = await db.prisma.sourceEntitlement.create({
      data: {
        id: randomUUID(),
        origin: "tribute",
        sourceRef,
        sourcePolicyRef: context.row.policyRef,
        identityRef: context.row.identityRef,
        revision: 1,
        evidence: {},
        checkedAt: now,
      },
    });
    expect(
      value(await convergence.status(owner)).unconfirmedSources,
    ).toContainEqual({
      id: legacy.id,
      sourceRef,
      policyRef: context.row.policyRef,
      identityRef: context.row.identityRef,
      revision: 1,
    });
    const imported = await apply({ ...context.row, expectedRevision: 1 });
    expect(imported.result.sources[0]?.id).toBe(legacy.id);
    expect(
      value(await convergence.status(owner)).unconfirmedSources.some(
        (item) => item.id === legacy.id,
      ),
    ).toBe(false);
    expect(
      await db.prisma.subscriptionEnrollment.count({ where: { sourceRef } }),
    ).toBe(0);
  });
  test("temporary owner assignment is rejected and expansion preserves pending grant suspension", async () => {
    const context = await setup("temporary_membership");
    const customer = await link(context.row.identityRef);
    const tier = {
      id: context.tier.id,
      revision: 1,
      name: context.tier.name,
      benefits: ["materials", "community"],
      contentScope: { guideIds: [context.guideId], materialIds: [] },
    };
    expect(
      await grants.assignEnrollment(
        owner,
        {
          operationId: randomUUID(),
          accountId: customer.id,
          origin: "tribute",
          sourceRef: randomUUID(),
          tierId: tier.id,
          tierRevision: 1,
          terms: {
            startsAt: context.row.startsAt,
            endsAt: context.row.endsAt,
            endPolicy: "temporary_membership",
          },
          billingRef: null,
          reason: "Cannot bypass source registry",
        },
        tier,
      ),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(
      await db.prisma.accessGrant.count({ where: { accountId: customer.id } }),
    ).toBe(0);
    const imported = await apply(context.row);
    const source = imported.result.sources[0];
    if (!source?.enrollmentId) throw new Error("Expected pending enrollment");
    const row = await db.prisma.subscriptionEnrollment.findUniqueOrThrow({
      where: { id: source.enrollmentId },
    });
    const expanded = {
      ...tier,
      revision: 2,
      benefits: [...tier.benefits, "support"],
    };
    const preview = value(
      await grants.previewEnrollmentExpansion(
        owner,
        {
          operationId: randomUUID(),
          tierId: tier.id,
          tierRevision: 2,
          targets: [
            {
              enrollmentId: row.id,
              expectedRevision: row.revision,
              tierRevision: 1,
            },
          ],
          reason: "Expand without source evidence",
        },
        expanded,
      ),
    );
    expect(
      await grants.applyEnrollmentExpansion(owner, {
        operationId: randomUUID(),
        previewRef: preview.previewRef,
      }),
    ).toMatchObject({ ok: true });
    const added = await db.prisma.accessGrant.findFirstOrThrow({
      where: { accountId: customer.id, capabilities: { has: "support" } },
    });
    expect(added.revokedAt).not.toBeNull();
    expect(
      await db.prisma.accessGrant.count({
        where: { accountId: customer.id, revokedAt: null },
      }),
    ).toBe(0);
    expect(value(await grants.readOwnEnrollments(customer.id))[0]?.state).toBe(
      "pending_verification",
    );
  });
  test("9/11 pending import, verified linking and recoverable sweep preserve one source and exact receipt", async () => {
    const context = await setup();
    const imported = await apply(context.row);
    expect(imported.result.sources[0]).toMatchObject({
      accountId: null,
      status: "pending_identity",
    });
    expect(
      await db.prisma.subscriptionEnrollment.count({
        where: {
          sourceRef: imported.result.sources[0]?.sourceRef ?? "missing",
        },
      }),
    ).toBe(0);
    const customer = await link(context.row.identityRef);
    expect(await convergence.sweep()).toMatchObject({ attached: 1 });
    expect(
      await membership.resolveForAccess(accountId(customer.id), [
        context.guideId,
      ]),
    ).toMatchObject({ kind: "active" });
    expect(value(await convergence.apply(owner, imported.command))).toEqual(
      imported.result,
    );
    expect(
      await db.prisma.subscriptionEnrollment.count({
        where: { accountId: customer.id },
      }),
    ).toBe(1);
    expect(
      await db.prisma.billingPurchase.count({
        where: { accountId: customer.id },
      }),
    ).toBe(0);
    expect(
      await sources.preview(customer.id, {
        operationId: randomUUID(),
        batchRef: "forbidden",
        rows: [context.row],
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });
  test("24/26 full enrollment snapshot survives catalog edit and offset periods resolve at exact UTC bounds", async () => {
    const context = await setup();
    const customer = await link(context.row.identityRef);
    await apply({
      ...context.row,
      startsAt: "2030-01-01T03:00:00.000+03:00",
      endsAt: "2030-02-01T03:00:00.000+03:00",
    });
    const before = await db.prisma.subscriptionEnrollment.findFirstOrThrow({
      where: { accountId: customer.id },
    });
    const beforeGrants = await db.prisma.accessGrant.findMany({
      where: { accountId: customer.id },
      orderBy: { id: "asc" },
    });
    await db.prisma.billingOffer.update({
      where: { id: context.tier.id },
      data: {
        name: "Changed next cohort",
        revision: 2,
        benefits: ["materials", "reviews"],
        contentScope: { guideIds: [randomUUID()], materialIds: [] },
      },
    });
    expect(
      await db.prisma.subscriptionEnrollment.findUniqueOrThrow({
        where: { id: before.id },
      }),
    ).toEqual(before);
    expect(
      await db.prisma.accessGrant.findMany({
        where: { accountId: customer.id },
        orderBy: { id: "asc" },
      }),
    ).toEqual(beforeGrants);
    expect(before.startsAt.toISOString()).toBe("2030-01-01T00:00:00.000Z");
    expect(before.endsAt?.toISOString()).toBe("2030-02-01T00:00:00.000Z");
    now = new Date("2029-12-31T23:59:59.999Z");
    expect(
      await membership.resolveForAccess(accountId(customer.id), [
        context.guideId,
      ]),
    ).not.toMatchObject({ kind: "active" });
    now = new Date("2030-01-01T00:00:00.000Z");
    expect(
      await membership.resolveForAccess(accountId(customer.id), [
        context.guideId,
      ]),
    ).toMatchObject({ kind: "active" });
    now = new Date("2030-01-31T23:59:59.999Z");
    expect(
      await membership.resolveForAccess(accountId(customer.id), [
        context.guideId,
      ]),
    ).toMatchObject({ kind: "active" });
    now = new Date("2030-02-01T00:00:00.000Z");
    expect(
      await membership.resolveForAccess(accountId(customer.id), [
        context.guideId,
      ]),
    ).not.toMatchObject({ kind: "active" });
  });
  test.each(["change_term", "revoke"] as const)(
    "multirow import and generic %s use account locks before source mutations",
    async (action) => {
      const first = await setup();
      const firstAccount = await link(first.row.identityRef);
      await apply(first.row);
      const second = await setup();
      const secondAccount = await link(second.row.identityRef);
      await apply(second.row);
      const ordered = [
        { context: first, account: firstAccount },
        { context: second, account: secondAccount },
      ].sort((left, right) => left.account.id.localeCompare(right.account.id));
      const [target, untouched] = ordered;
      if (!target || !untouched)
        throw new Error("Expected two independent Accounts");
      const original = await db.prisma.subscriptionEnrollment.findFirstOrThrow({
        where: { accountId: target.account.id },
      });
      const otherBefore =
        await db.prisma.subscriptionEnrollment.findFirstOrThrow({
          where: { accountId: untouched.account.id },
        });
      const rows = await Promise.all(
        [...ordered].reverse().map(async ({ context }) => ({
          ...context.row,
          expectedRevision: (
            await db.prisma.sourceEntitlement.findFirstOrThrow({
              where: { identityRef: context.row.identityRef },
            })
          ).revision,
          endsAt: "2030-03-01T00:00:00.000Z",
        })),
      );
      const preview = value(
        await convergence.preview(owner, {
          operationId: randomUUID(),
          batchRef: randomUUID(),
          rows,
        }),
      );
      const command = {
        operationId: randomUUID(),
        previewRef: preview.previewRef,
        selectedRows: rows.map((row) => row.rowRef),
      };
      const locked = deferredValue<number>();
      const proceed = deferredValue<boolean>();
      const change = {
        operationId: randomUUID(),
        enrollmentId: original.id,
        expectedRevision: original.revision,
        action,
        terms: {
          startsAt: original.startsAt.toISOString(),
          endsAt: "2030-01-20T00:00:00.000Z",
          endPolicy: "confirmed_external" as const,
        },
        reason: "Concurrent generic owner decision",
      };
      // Pause the real owner transaction after its account lock. PostgreSQL's wait graph, not a delay,
      // proves the real import reached the conflicting account before the owner updates the source row.
      const ownerChange = db.prisma.$transaction(
        async (tx) => {
          await lockAccountEntitlementChanges(tx, target.account.id);
          const [backend] = z
            .array(z.object({ pid: z.int().positive() }))
            .parse(await tx.$queryRaw`SELECT pg_backend_pid() AS pid`);
          if (!backend) throw new Error("Missing transaction PID");
          locked.resolve(backend.pid);
          await proceed.promise;
          return changeEnrollmentInTransaction(tx, owner, change, now);
        },
        { timeout: 15_000 },
      );
      const ownerPid = await locked.promise;
      const importing = convergence.apply(owner, command);
      const results = Promise.allSettled([ownerChange, importing]);
      try {
        await eventually(async () => {
          const rows = z.array(z.object({ waiting: z.boolean() })).parse(
            await db.prisma.$queryRaw`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE '%pg_advisory_xact_lock%' AND ${ownerPid} = ANY(pg_blocking_pids(pid))
        ) AS waiting`,
          );
          expect(rows[0]?.waiting).toBe(true);
        }, 5_000);
      } finally {
        proceed.resolve(true);
      }
      const [changed, imported] = await results;
      if (changed.status === "rejected") throw changed.reason;
      if (imported.status === "rejected") throw imported.reason;
      expect(changed).toMatchObject({
        status: "fulfilled",
        value: { ok: true },
      });
      expect(imported).toMatchObject({
        status: "fulfilled",
        value: { ok: false, error: { code: "revision_conflict" } },
      });
      expect(
        await db.prisma.subscriptionEnrollment.findUniqueOrThrow({
          where: { id: otherBefore.id },
        }),
      ).toEqual(otherBefore);
      const current = await db.prisma.subscriptionEnrollment.findUniqueOrThrow({
        where: { id: original.id },
      });
      expect(current.revision).toBe(original.revision + 1);
      expect(current.revokedAt !== null).toBe(action === "revoke");
      expect(
        await db.prisma.accessReceipt.count({
          where: { scope: owner, operationId: command.operationId },
        }),
      ).toBe(0);
      expect(await grants.changeEnrollment(owner, change)).toMatchObject({
        ok: true,
        value: { id: original.id, revision: current.revision },
      });
      expect(await convergence.apply(owner, command)).toMatchObject({
        ok: false,
        error: { code: "revision_conflict" },
      });
    },
    20_000,
  );
  test("preview flags every period reduction and confirmed-to-temporary downgrade before apply", async () => {
    const context = await setup();
    const customer = await link(context.row.identityRef);
    await apply(context.row);
    const source = await db.prisma.sourceEntitlement.findFirstOrThrow({
      where: { identityRef: context.row.identityRef },
    });
    value(
      await convergence.savePolicy(owner, {
        operationId: randomUUID(),
        expectedRevision: 1,
        id: context.row.policyRef,
        subscriptionId: context.row.subscriptionId,
        enabled: true,
        tierId: context.tier.id,
        tierRevision: 1,
        temporaryUntil: context.row.endsAt,
        reason: "Explicit synthetic temporary-policy boundary",
      }),
    );
    for (const patch of [
      { startsAt: "2030-01-02T00:00:00.000Z" },
      { endsAt: "2030-01-31T00:00:00.000Z" },
      { mode: "temporary_membership" as const },
    ]) {
      const preview = value(
        await convergence.preview(owner, {
          operationId: randomUUID(),
          batchRef: randomUUID(),
          rows: [
            { ...context.row, ...patch, expectedRevision: source.revision },
          ],
        }),
      );
      expect(preview.rows[0]).toMatchObject({
        status: "matched",
        shortens: true,
      });
      expect(
        await membership.resolveForAccess(accountId(customer.id), [
          context.guideId,
        ]),
      ).toMatchObject({ kind: "active" });
    }
    const extension = value(
      await convergence.preview(owner, {
        operationId: randomUUID(),
        batchRef: randomUUID(),
        rows: [
          {
            ...context.row,
            startsAt: "2029-12-31T00:00:00.000Z",
            endsAt: "2030-03-01T00:00:00.000Z",
            expectedRevision: source.revision,
          },
        ],
      }),
    );
    expect(extension.rows[0]).toMatchObject({
      status: "matched",
      shortens: false,
    });
  });
  test("10 preview never infers identity or periods; changed revisions and archived catalog fail closed", async () => {
    const context = await setup();
    const unknown = value(
      await convergence.preview(owner, {
        operationId: randomUUID(),
        batchRef: randomUUID(),
        rows: [{ ...context.row, endsAt: null }],
      }),
    );
    expect(unknown.rows[0]?.status).toBe("unknown_term");
    expect(
      await convergence.apply(owner, {
        operationId: randomUUID(),
        previewRef: unknown.previewRef,
        selectedRows: [context.row.rowRef],
      }),
    ).toMatchObject({ ok: false });
    const ambiguous = value(
      await convergence.preview(owner, {
        operationId: randomUUID(),
        batchRef: randomUUID(),
        rows: [{ ...context.row, identityRef: null, verificationRef: null }],
      }),
    );
    expect(ambiguous.rows[0]?.status).toBe("ambiguous");
    const duplicate = value(
      await convergence.preview(owner, {
        operationId: randomUUID(),
        batchRef: randomUUID(),
        rows: [context.row, { ...context.row, rowRef: randomUUID() }],
      }),
    );
    expect(duplicate.rows.every((row) => row.status === "conflict")).toBe(true);
    const preview = value(
      await convergence.preview(owner, {
        operationId: randomUUID(),
        batchRef: randomUUID(),
        rows: [context.row],
      }),
    );
    await db.prisma.billingOffer.update({
      where: { id: context.tier.id },
      data: { archived: true },
    });
    expect(
      await convergence.apply(owner, {
        operationId: randomUUID(),
        previewRef: preview.previewRef,
        selectedRows: [context.row.rowRef],
      }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
  test("12/13/14 official signed inbox deduplicates transport retries, preserves cancel remainder and holds unordered facts", async () => {
    const context = await setup();
    const customer = await link(context.row.identityRef);
    await apply(context.row);
    now = new Date("2030-01-02T00:00:00.000Z");
    const renewal = event(context.row);
    expect((await send(renewal, "bad")).statusCode).toBe(401);
    expect(
      (
        await send(
          renewal,
          createHmac("sha256", "other-key")
            .update(JSON.stringify(renewal, null, 2))
            .digest("hex"),
        )
      ).statusCode,
    ).toBe(401);
    const missing = await http.inject({
      method: "POST",
      url: "/integrations/tribute/v1/webhook",
      payload: renewal,
    });
    expect(missing.statusCode).toBe(401);
    const signatureBeforeTamper = createHmac("sha256", key)
      .update(JSON.stringify(renewal, null, 2))
      .digest("hex");
    expect(
      (
        await send(
          { ...renewal, sent_at: "2030-01-02T00:00:01.000Z" },
          signatureBeforeTamper,
        )
      ).statusCode,
    ).toBe(401);
    const accepted = await send(renewal);
    expect(accepted.json()).toMatchObject({ ok: true, status: "applied" });
    now = new Date("2030-01-03T00:00:00.000Z");
    expect(
      (await send({ ...renewal, sent_at: now.toISOString() })).json(),
    ).toMatchObject({
      status: "duplicate",
      receiptRef: z.object({ receiptRef: z.uuid() }).parse(accepted.json())
        .receiptRef,
    });
    expect(
      (await send(event(context.row, "cancelled_subscription"))).json(),
    ).toMatchObject({ status: "applied" });
    expect(
      (
        await send({
          ...renewal,
          payload: {
            ...renewal.payload,
            expires_at: "2030-04-01T00:00:00.000Z",
          },
        })
      ).json(),
    ).toMatchObject({ status: "pending_reconciliation" });
    expect(
      (
        await send({
          ...event(context.row),
          created_at: "2030-01-01T12:00:00.000Z",
        })
      ).json(),
    ).toMatchObject({ status: "pending_reconciliation" });
    for (const type of ["trial", "gift", undefined]) {
      const draft = event(context.row, "new_subscription");
      expect(
        (await send({ ...draft, payload: { ...draft.payload, type } })).json(),
      ).toMatchObject({ status: "pending_reconciliation" });
    }
    expect(
      (
        await send({
          ...event(context.row),
          payload: { ...event(context.row).payload, subscription_id: 999999 },
        })
      ).json(),
    ).toMatchObject({ status: "pending_reconciliation" });
    const enrollment = await db.prisma.subscriptionEnrollment.findFirstOrThrow({
      where: { accountId: customer.id },
    });
    expect(enrollment.endsAt?.toISOString()).toBe("2030-03-01T00:00:00.000Z");
    expect(
      await db.prisma.subscriptionEnrollment.count({
        where: { accountId: customer.id },
      }),
    ).toBe(1);
  });
  test("35 explicit revoke survives import and renewal; owner restore changes the same source", async () => {
    const context = await setup();
    const customer = await link(context.row.identityRef);
    const imported = await apply(context.row);
    const source = imported.result.sources[0];
    if (!source?.enrollmentId) throw new Error("Expected linked source");
    value(
      await grants.changeEnrollment(owner, {
        operationId: randomUUID(),
        enrollmentId: source.enrollmentId,
        expectedRevision: 1,
        action: "revoke",
        terms: {
          startsAt: context.row.startsAt,
          endsAt: context.row.endsAt,
          endPolicy: "confirmed_external",
        },
        reason: "Owner revoked exact source",
      }),
    );
    now = new Date("2030-01-02T00:00:00.000Z");
    expect((await send(event(context.row))).json()).toMatchObject({
      status: "pending_reconciliation",
    });
    const current = await db.prisma.sourceEntitlement.findUniqueOrThrow({
      where: { id: source.id },
    });
    const preview = value(
      await convergence.preview(owner, {
        operationId: randomUUID(),
        batchRef: randomUUID(),
        rows: [{ ...context.row, expectedRevision: current.revision }],
      }),
    );
    expect(preview.rows[0]?.status).toBe("conflict");
    expect(
      await membership.resolveForAccess(accountId(customer.id), [
        context.guideId,
      ]),
    ).not.toMatchObject({ kind: "active" });
    const restored = value(
      await convergence.reconcile(owner, {
        operationId: randomUUID(),
        sourceId: source.id,
        expectedRevision: current.revision,
        action: "restore",
        confirmedTerms: {
          startsAt: context.row.startsAt,
          endsAt: context.row.endsAt,
          verificationRef: "owner-confirmed-period",
        },
        reason: "Explicit confirmed restoration",
      }),
    );
    expect(restored).toMatchObject({
      id: source.id,
      enrollmentId: source.enrollmentId,
      status: "active",
      revoked: false,
    });
    expect(
      await membership.resolveForAccess(accountId(customer.id), [
        context.guideId,
      ]),
    ).toMatchObject({ kind: "active" });
    expect(
      await db.prisma.subscriptionEnrollment.count({
        where: { accountId: customer.id },
      }),
    ).toBe(1);
  });
  test("36 temporary TTL restores only stale source; accepted left is latched across subsequent member", async () => {
    const context = await setup("temporary_membership");
    const customer = await link(context.row.identityRef);
    const imported = await apply(context.row);
    const source = imported.result.sources[0];
    if (!source) throw new Error("Expected temporary source");
    expect(source.status).toBe("pending_verification");
    expect(
      await membership.resolveForAccess(accountId(customer.id), [
        context.guideId,
      ]),
    ).not.toMatchObject({ kind: "active" });
    async function observe(decision: "member" | "not_member", version: number) {
      return membership.acceptEvidence({
        accountId: accountId(customer.id),
        deliveryId: randomUUID(),
        source: "member_status_event",
        evidence: {
          contractVersion: "inside.membership-evidence.v1",
          principalRef: customer.principal,
          telegramIdentityRef: context.row.identityRef,
          evidenceRef: randomUUID(),
          evidenceVersion: version,
          checkedAt: now.toISOString(),
          validUntil: new Date(now.getTime() + 240_000).toISOString(),
          decision,
          reasonCode: decision === "member" ? "chat_member" : "chat_not_member",
        },
      });
    }
    expect(await observe("member", 1)).toMatchObject({
      ok: true,
      outcome: "applied",
    });
    expect(
      await membership.resolveForAccess(accountId(customer.id), [
        context.guideId,
      ]),
    ).toMatchObject({ kind: "active" });
    now = new Date(now.getTime() + 300_000);
    expect(
      await membership.resolveForAccess(accountId(customer.id), [
        context.guideId,
      ]),
    ).not.toMatchObject({ kind: "active" });
    expect(value(await grants.readOwnEnrollments(customer.id))[0]?.state).toBe(
      "pending_verification",
    );
    expect(await observe("member", 2)).toMatchObject({ ok: true });
    expect(
      await membership.resolveForAccess(accountId(customer.id), [
        context.guideId,
      ]),
    ).toMatchObject({ kind: "active" });
    now = new Date(now.getTime() + 1_000);
    expect(await observe("not_member", 3)).toMatchObject({ ok: true });
    now = new Date(now.getTime() + 1_000);
    expect(await observe("member", 4)).toMatchObject({ ok: true });
    expect(value(await grants.readOwnEnrollments(customer.id))[0]?.state).toBe(
      "suspended_source",
    );
    expect(
      await membership.resolveForAccess(accountId(customer.id), [
        context.guideId,
      ]),
    ).not.toMatchObject({ kind: "active" });
    const enrollment = await db.prisma.subscriptionEnrollment.findUniqueOrThrow(
      { where: { id: source.enrollmentId ?? "" } },
    );
    const changed = value(
      await grants.changeEnrollment(owner, {
        operationId: randomUUID(),
        enrollmentId: enrollment.id,
        expectedRevision: enrollment.revision,
        action: "change_term",
        reason: "Temporary term correction is not membership evidence",
        terms: {
          startsAt: context.row.startsAt,
          endsAt: context.row.endsAt,
          endPolicy: "temporary_membership",
        },
      }),
    );
    expect(changed.state).toBe("suspended_source");
    expect(
      await membership.resolveForAccess(accountId(customer.id), [
        context.guideId,
      ]),
    ).not.toMatchObject({ kind: "active" });
    const current = await db.prisma.sourceEntitlement.findUniqueOrThrow({
      where: { id: source.id },
    });
    const confirmed = {
      ...context.row,
      mode: "confirmed_period" as const,
      expectedRevision: current.revision,
      checkedAt: now.toISOString(),
    };
    await apply(confirmed);
    expect(
      await membership.resolveForAccess(accountId(customer.id), [
        context.guideId,
      ]),
    ).toMatchObject({ kind: "active" });
    expect(
      value(await grants.readOwnEnrollments(customer.id))[0]?.endPolicy,
    ).toBe("confirmed_external");
  });

  test("preview rejects same-account relinking and parallel apply cannot duplicate a source", async () => {
    const context = await setup();
    const customer = await link(context.row.identityRef);
    const preview = value(
      await convergence.preview(owner, {
        operationId: randomUUID(),
        batchRef: randomUUID(),
        rows: [context.row],
      }),
    );
    await db.prisma.telegramLinkTransaction.updateMany({
      where: { accountId: customer.id },
      data: { status: "expired" },
    });
    await linkTelegramAccount(db.prisma, {
      accountId: customer.id,
      identityRef: context.row.identityRef,
      now,
    });
    expect(
      await convergence.apply(owner, {
        operationId: randomUUID(),
        previewRef: preview.previewRef,
        selectedRows: [context.row.rowRef],
      }),
    ).toMatchObject({ ok: false, error: { code: "revision_conflict" } });
    const fresh = value(
      await convergence.preview(owner, {
        operationId: randomUUID(),
        batchRef: randomUUID(),
        rows: [context.row],
      }),
    );
    const command = {
      operationId: randomUUID(),
      previewRef: fresh.previewRef,
      selectedRows: [context.row.rowRef],
    };
    const results = await Promise.all([
      convergence.apply(owner, command),
      convergence.apply(owner, command),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ ok: true });
    expect(
      await db.prisma.subscriptionEnrollment.count({
        where: { accountId: customer.id },
      }),
    ).toBe(1);
  });
  test("23 Tribute activation uses only registry, exact binding and finite source; forwarded links and member proof grant nothing", async () => {
    const context = await setup();
    const imported = await apply(context.row);
    const rule = {
      id: randomUUID(),
      code: randomUUID(),
      name: "Tribute",
      tierId: context.tier.id,
      tierRevision: 1,
      sourceRef: context.row.policyRef,
      verificationMode: "tribute_registry",
      published: true,
      startsAt: now.toISOString(),
      endsAt: null,
    };
    expect(
      await grants.manageActivationRule(owner, {
        operationId: randomUUID(),
        value: rule,
        reason: "Verified registry rule",
      }),
    ).toMatchObject({ ok: true });
    async function request(
      path: string,
      payload: object,
      credential = "synthetic-activation-625",
    ) {
      const response = await http.inject({
        method: "POST",
        url: `/integrations/telegram/v1/subscription-activation/${path}`,
        headers: { authorization: `Bearer ${credential}` },
        payload,
      });
      expect(response.headers["cache-control"]).toBe("private, no-store");
      return response;
    }
    const attemptId = randomUUID();
    const contractVersion = "inside.subscription-activation.v1";
    const begin = {
      contractVersion,
      attemptId,
      code: rule.code,
      identityRef: context.row.identityRef,
    };
    expect((await request("attempts", begin)).json()).toMatchObject({
      ok: true,
      value: {
        state: "needs_account",
        rule: { verificationMode: "tribute_registry" },
      },
    });
    expect(
      await db.prisma.sourceEntitlement.findUnique({
        where: { id: imported.result.sources[0]?.id ?? "" },
      }),
    ).toMatchObject({ accountId: null });
    const customer = await link(context.row.identityRef);
    const snapshot = await new TelegramAccountLinks(db.prisma).readBinding({
      accountId: customer.id,
    });
    if (!snapshot.ok || !snapshot.binding) throw new Error("Missing binding");
    const evidence = {
      contractVersion,
      audience: "inside.platform.subscription-activation",
      evidenceRef: randomUUID(),
      attemptId,
      sourceRef: context.row.policyRef,
      identityRef: context.row.identityRef,
      accountRef: customer.principal,
      linkRef: snapshot.binding.linkRef,
      linkRevision: snapshot.binding.linkRevision,
      ruleId: rule.id,
      ruleRevision: 1,
      checkedAt: now.toISOString(),
      validUntil: "2030-01-01T00:04:00.000Z",
      decision: "registry_lookup",
    };
    expect(
      (await request("evidence", evidence, "other-source-key")).statusCode,
    ).toBe(401);
    expect(
      (await request("evidence", { ...evidence, decision: "member" })).json(),
    ).toMatchObject({ ok: false, error: { code: "source_not_confirmed" } });
    await db.prisma
      .$executeRaw`ALTER TABLE membership_entitlements.tribute_policies RENAME TO tribute_policies_fault625`;
    try {
      const unavailable = await request("evidence", evidence);
      expect(unavailable.statusCode).toBe(200);
      expect(unavailable.json()).toEqual({
        ok: false,
        error: { code: "unavailable" },
      });
      expect(
        await db.prisma.accessReceipt.count({
          where: {
            scope: "source-evidence",
            operationId: evidence.evidenceRef,
          },
        }),
      ).toBe(0);
    } finally {
      await db.prisma
        .$executeRaw`ALTER TABLE membership_entitlements.tribute_policies_fault625 RENAME TO tribute_policies`;
    }
    const accepted = activationResponseSchema.parse(
      (await request("evidence", evidence)).json(),
    );
    expect(accepted).toMatchObject({
      ok: true,
      value: {
        state: "active",
        enrollment: {
          origin: "tribute",
          endsAt: context.row.endsAt,
          endPolicy: "confirmed_external",
        },
      },
    });
    expect((await request("evidence", evidence)).json()).toEqual(accepted);
    const second = activationResponseSchema.parse(
      (
        await request("evidence", { ...evidence, evidenceRef: randomUUID() })
      ).json(),
    );
    if (!accepted.ok || accepted.value.enrollment === null)
      throw new Error("Expected active receipt");
    expect(second).toMatchObject({
      ok: true,
      value: {
        state: "already_active",
        enrollment: {
          id: accepted.value.enrollment.id,
          revision: accepted.value.enrollment.revision,
        },
      },
    });
    const strangerIdentity = randomUUID();
    const stranger = await link(strangerIdentity);
    const strangerAttempt = randomUUID();
    await request("attempts", {
      ...begin,
      identityRef: strangerIdentity,
      attemptId: strangerAttempt,
    });
    const strangerBinding = await new TelegramAccountLinks(
      db.prisma,
    ).readBinding({ accountId: stranger.id });
    if (!strangerBinding.ok || !strangerBinding.binding)
      throw new Error("Missing stranger binding");
    expect(
      (
        await request("evidence", {
          ...evidence,
          evidenceRef: randomUUID(),
          attemptId: strangerAttempt,
          identityRef: strangerIdentity,
          accountRef: stranger.principal,
          linkRef: strangerBinding.binding.linkRef,
          linkRevision: strangerBinding.binding.linkRevision,
        })
      ).json(),
    ).toMatchObject({
      ok: true,
      value: { state: "pending_review", enrollment: null },
    });
    expect(
      await db.prisma.accessGrant.count({ where: { accountId: stranger.id } }),
    ).toBe(0);
    expect(
      await db.prisma.billingPurchase.count({
        where: { accountId: customer.id },
      }),
    ).toBe(0);
  });
  test("unknown import rows survive preview expiry until an audited owner disposition", async () => {
    const context = await setup();
    const before = value(await convergence.status(owner)).metrics
      .unresolvedImports;
    const preview = value(
      await convergence.preview(owner, {
        operationId: randomUUID(),
        batchRef: "unknown-period-review",
        rows: [{ ...context.row, endsAt: null }],
      }),
    );
    now = new Date(now.getTime() + 900_000);
    expect(
      value(await convergence.status(owner)).metrics.unresolvedImports,
    ).toBe(before + 1);
    expect(
      await convergence.apply(owner, {
        operationId: randomUUID(),
        previewRef: preview.previewRef,
        selectedRows: [context.row.rowRef],
      }),
    ).toMatchObject({ ok: false, error: { code: "preview_expired" } });
    const command = {
      operationId: randomUUID(),
      previewRef: preview.previewRef,
      expectedRevision: 1,
      reason: "Confirmed excluded row; no verified entitlement",
    };
    expect(value(await convergence.dismissImport(owner, command)).state).toBe(
      "dismissed",
    );
    expect(
      value(await convergence.dismissImport(owner, command)).revision,
    ).toBe(2);
    expect(
      value(await convergence.status(owner)).metrics.unresolvedImports,
    ).toBe(before);
    const collision = value(
      await convergence.preview(owner, {
        operationId: randomUUID(),
        batchRef: randomUUID(),
        rows: [
          context.row,
          {
            ...context.row,
            rowRef: randomUUID(),
            telegramUserId: String(Number(context.row.telegramUserId) + 90000),
          },
        ],
      }),
    );
    expect(collision.rows.map((row) => row.status)).toEqual([
      "conflict",
      "conflict",
    ]);
  });
  test("audited inbox rejection resolves a conflict without inventing a period or reviving rejected events", async () => {
    const context = await setup();
    now = new Date("2030-01-02T00:00:00.000Z");
    const first = z
      .object({ receiptRef: z.uuid() })
      .parse((await send(event(context.row))).json());
    const second = z
      .object({ receiptRef: z.uuid() })
      .parse(
        (
          await send(
            event(
              context.row,
              "renewed_subscription",
              "2030-04-01T00:00:00.000Z",
            ),
          )
        ).json(),
      );
    await apply(context.row);
    const rejected = await db.prisma.tributeInbox.findUniqueOrThrow({
      where: { id: second.receiptRef },
    });
    const command = {
      operationId: randomUUID(),
      inboxId: rejected.id,
      expectedRevision: rejected.revision,
      action: "reject",
      reason: "Provider confirmed this conflicting delivery is incorrect",
    };
    expect(value(await convergence.retryEvent(owner, command)).state).toBe(
      "rejected",
    );
    expect(value(await convergence.retryEvent(owner, command)).state).toBe(
      "rejected",
    );
    const remaining = await db.prisma.tributeInbox.findUniqueOrThrow({
      where: { id: first.receiptRef },
    });
    expect(
      value(
        await convergence.retryEvent(owner, {
          operationId: randomUUID(),
          inboxId: remaining.id,
          expectedRevision: remaining.revision,
          action: "retry",
          reason: "Verified retained provider event",
        }),
      ).state,
    ).toBe("applied");
    expect(
      value(
        await convergence.retryEvent(owner, {
          operationId: randomUUID(),
          inboxId: rejected.id,
          expectedRevision: rejected.revision + 1,
          action: "retry",
          reason: "Rejected event stays terminal",
        }),
      ).state,
    ).toBe("rejected");
    const source = await db.prisma.sourceEntitlement.findFirstOrThrow({
      where: { identityRef: context.row.identityRef },
    });
    expect(
      z.object({ endsAt: z.string() }).parse(source.tributeState).endsAt,
    ).toBe("2030-03-01T00:00:00.000Z");
  });
  test("pending source keeps its promised tier; changing policy cannot bypass archive, while existing terms remain updateable", async () => {
    const context = await setup();
    const imported = await apply(context.row);
    await db.prisma.billingOffer.update({
      where: { id: context.tier.id },
      data: { archived: true },
    });
    const replacement = await db.prisma.billingOffer.create({
      data: {
        id: randomUUID(),
        name: "Replacement",
        benefits: ["materials"],
        contentScope: { guideIds: [randomUUID()], materialIds: [] },
        availableForAssignment: true,
        revision: 1,
      },
    });
    value(
      await convergence.savePolicy(owner, {
        operationId: randomUUID(),
        expectedRevision: 1,
        id: context.row.policyRef,
        subscriptionId: context.row.subscriptionId,
        enabled: true,
        tierId: replacement.id,
        tierRevision: 1,
        temporaryUntil: null,
        reason: "New policy for future sources",
      }),
    );
    const source = imported.result.sources[0];
    if (!source) throw new Error("Missing pending source");
    const currentRow = { ...context.row, expectedRevision: source.revision };
    const preview = value(
      await convergence.preview(owner, {
        operationId: randomUUID(),
        batchRef: randomUUID(),
        rows: [currentRow],
      }),
    );
    expect(preview.rows[0]?.tier?.id).toBe(context.tier.id);
    expect(
      await convergence.apply(owner, {
        operationId: randomUUID(),
        previewRef: preview.previewRef,
        selectedRows: [currentRow.rowRef],
      }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    await db.prisma.billingOffer.update({
      where: { id: context.tier.id },
      data: { archived: false },
    });
    const customer = await link(context.row.identityRef);
    await convergence.sweep();
    await db.prisma.billingOffer.update({
      where: { id: context.tier.id },
      data: { archived: true },
    });
    const attached = await db.prisma.sourceEntitlement.findUniqueOrThrow({
      where: { id: source.id },
    });
    await apply({
      ...context.row,
      expectedRevision: attached.revision,
      endsAt: "2030-03-01T00:00:00.000Z",
    });
    expect(
      value(await grants.readOwnEnrollments(customer.id))[0],
    ).toMatchObject({
      tier: { id: context.tier.id },
      endsAt: "2030-03-01T00:00:00.000Z",
    });
  });
});
