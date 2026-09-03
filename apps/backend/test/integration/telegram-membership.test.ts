import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";

import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { accountId } from "../../src/modules/accounts/index.js";
import { assembleMembershipEntitlements } from "../../src/modules/membership-entitlements/index.js";
import type { MembershipEntitlements } from "../../src/modules/membership-entitlements/index.js";
import {
  assembleTelegramMembership,
  type TelegramMembership,
} from "../../src/modules/telegram-membership/index.js";
import type {
  ConfirmTelegramLinkRequest,
  RegisterTelegramLinkRequest,
  TelegramLinkProvider,
  TelegramLinkProviderConfirmation,
  TelegramLinkProviderRegistration,
} from "../../src/modules/telegram-membership/ports/telegram-link-provider.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const firstAccountId = accountId("10000000-0000-4000-8000-000000000001");
const otherAccountId = accountId("10000000-0000-4000-8000-000000000002");
const persistedLinkRowsSchema = z.array(
  z
    .object({
      account_id: z.uuid(),
      principal_ref: z.string().min(1).max(256),
      serialized: z.string(),
    })
    .strict(),
);

describe("TelegramMembership", () => {
  let clock: MutableClock;
  let database: TestDatabase;
  let entitlements: MembershipEntitlements;
  let membership: TelegramMembership;
  let provider: ControlledTelegramLinkProvider;

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
  });

  afterEach(async () => {
    await database.dispose();
  });

  test("binds begin and final confirmation to one authenticated Account without granting access", async () => {
    ({ clock, entitlements, membership, provider } = fixture(database));

    await expect(
      membership.readAccountPresentation({ accountId: firstAccountId }),
    ).resolves.toEqual({
      ok: true,
      presentation: {
        link: { kind: "unlinked" },
        membership: {
          acquisitionUrl: "https://t.me/tribute/inside",
          kind: "inactive",
        },
      },
    });

    const begun = await membership.beginLink({ accountId: firstAccountId });
    expect(begun).toMatchObject({
      ok: true,
      state: {
        expiresAt: "2030-01-01T00:05:00.000Z",
        status: "pending",
      },
    });
    if (!begun.ok || begun.state.status !== "pending") {
      throw new Error("Expected a pending Telegram link");
    }
    if (begun.state.deepLink === undefined) {
      throw new Error("Pending Telegram link has no deep link");
    }
    const deepLink = new URL(begun.state.deepLink);
    const rawToken = deepLink.searchParams.get("start");
    expect(deepLink.origin + deepLink.pathname).toBe(
      "https://t.me/inside_test_bot",
    );
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(provider.registerRequests).toHaveLength(1);
    await expect(
      membership.beginLink({ accountId: firstAccountId }),
    ).resolves.toMatchObject({
      ok: true,
      state: { linkRef: begun.state.linkRef, status: "pending" },
    });
    expect(provider.registerRequests).toHaveLength(1);
    await expect(
      membership.readAccountPresentation({ accountId: firstAccountId }),
    ).resolves.toEqual({
      ok: true,
      presentation: {
        link: {
          expiresAt: "2030-01-01T00:05:00.000Z",
          kind: "linking",
          linkRef: begun.state.linkRef,
        },
        membership: {
          acquisitionUrl: "https://t.me/tribute/inside",
          kind: "inactive",
        },
      },
    });
    const registration = provider.registerRequests[0];
    expect(registration).toMatchObject({
      expiresAt: new Date("2030-01-01T00:05:00.000Z"),
    });
    expect(registration?.accountRef).not.toBe(firstAccountId);
    expect(registration?.tokenDigest).toBe(
      createHash("sha256").update(rawToken ?? "").digest("base64url"),
    );

    const persisted = persistedLinkRowsSchema.parse(
      await database.prisma.$queryRaw(Prisma.sql`
        select
          account_id::text,
          principal_ref,
          row_to_json(link_transaction)::text as serialized
        from telegram_membership.link_transactions as link_transaction
        where link_ref = ${begun.state.linkRef}::uuid
      `),
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      account_id: firstAccountId,
      principal_ref: registration?.accountRef,
    });
    expect(persisted[0]?.serialized).not.toContain(rawToken ?? "missing-token");

    await expect(
      membership.confirmLink({
        accountId: otherAccountId,
        linkRef: begun.state.linkRef,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "link_not_found" } });
    expect(provider.confirmRequests).toHaveLength(0);

    const beforeEvidence = await entitlements.resolveForAccess(firstAccountId);
    expect(beforeEvidence).toEqual({ kind: "required" });

    const confirmed = await membership.confirmLink({
      accountId: firstAccountId,
      linkRef: begun.state.linkRef,
    });
    expect(confirmed).toMatchObject({
      ok: true,
      state: { linkRef: begun.state.linkRef, status: "linked" },
    });
    expect(provider.confirmRequests).toHaveLength(1);
    await expect(entitlements.resolveForAccess(firstAccountId)).resolves.toEqual({
      kind: "unavailable",
    });
    await expect(
      membership.readAccountPresentation({ accountId: firstAccountId }),
    ).resolves.toEqual({
      ok: true,
      presentation: {
        link: { kind: "linked" },
        membership: { kind: "unavailable" },
      },
    });
  });

  test("makes initial evidence retryable until final Account confirmation", async () => {
    ({ clock, membership, provider } = fixture(database));
    const begun = await membership.beginLink({ accountId: firstAccountId });
    if (!begun.ok || begun.state.status !== "pending") {
      throw new Error("Expected a pending Telegram link");
    }
    const principalRef = provider.registerRequests[0]?.accountRef ?? "";
    const command = {
      deliveryId: "delivery-before-confirm",
      source: "link_time" as const,
      evidence: evidence(principalRef, "member", 1, clock.now()),
    };

    await expect(membership.acceptEvidence(command)).resolves.toEqual({
      ok: false,
      error: { code: "unavailable" },
    });
    await expect(
      database.prisma.membershipEvidenceReceipt.count(),
    ).resolves.toBe(0);

    await membership.confirmLink({
      accountId: firstAccountId,
      linkRef: begun.state.linkRef,
    });
    await expect(membership.acceptEvidence(command)).resolves.toMatchObject({
      ok: true,
      outcome: "applied",
      state: "active",
    });
  });

  test("routes durable evidence monotonically and keeps access local through outage and expiry", async () => {
    ({ clock, entitlements, membership, provider } = fixture(database));
    const begun = await membership.beginLink({ accountId: firstAccountId });
    if (!begun.ok || begun.state.status !== "pending") {
      throw new Error("Expected a pending Telegram link");
    }
    await membership.confirmLink({
      accountId: firstAccountId,
      linkRef: begun.state.linkRef,
    });
    const principalRef = provider.registerRequests[0]?.accountRef ?? "";

    await expect(
      membership.acceptEvidence({
        deliveryId: "delivery-member-v1",
        source: "reconciliation",
        evidence: evidence(principalRef, "member", 1, clock.now()),
      }),
    ).resolves.toMatchObject({
      ok: true,
      outcome: "applied",
      state: "active",
    });
    await expect(entitlements.resolveForAccess(firstAccountId)).resolves.toEqual({
      kind: "active",
      validUntil: "2030-01-01T00:05:00.000Z",
    });
    await expect(
      membership.readAccountPresentation({ accountId: firstAccountId }),
    ).resolves.toEqual({
      ok: true,
      presentation: {
        link: { kind: "linked" },
        membership: { kind: "active" },
      },
    });

    clock.set(new Date("2030-01-01T00:01:00.000Z"));
    await expect(
      membership.acceptEvidence({
        deliveryId: "delivery-removal-v2",
        source: "member_status_event",
        evidence: evidence(principalRef, "not_member", 2, clock.now()),
      }),
    ).resolves.toMatchObject({
      ok: true,
      outcome: "applied",
      state: "non_member",
    });
    await expect(entitlements.resolveForAccess(firstAccountId)).resolves.toEqual({
      kind: "expired",
    });

    await expect(
      membership.acceptEvidence({
        deliveryId: "delivery-replayed-v1",
        source: "reconciliation",
        evidence: evidence(principalRef, "member", 1, clock.now()),
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "replayed_evidence" },
    });
    clock.set(new Date("2030-01-01T00:02:00.000Z"));
    await membership.acceptEvidence({
      deliveryId: "delivery-rejoin-v3",
      source: "reconciliation",
      evidence: evidence(principalRef, "member", 3, clock.now()),
    });
    await expect(entitlements.resolveForAccess(firstAccountId)).resolves.toEqual({
      kind: "active",
      validUntil: "2030-01-01T00:07:00.000Z",
    });

    provider.confirmation = { kind: "unavailable" };
    clock.set(new Date("2030-01-01T00:07:00.001Z"));
    await expect(entitlements.resolveForAccess(firstAccountId)).resolves.toEqual({
      kind: "stale",
    });
    expect(provider.confirmRequests).toHaveLength(1);
  });

  test("persists typed provider failure states without silent transfer", async () => {
    ({ clock, membership, provider } = fixture(database));
    provider.confirmation = { kind: "conflict" };
    const conflict = await membership.beginLink({ accountId: firstAccountId });
    if (!conflict.ok || conflict.state.status !== "pending") {
      throw new Error("Expected a pending Telegram link");
    }
    await expect(
      membership.confirmLink({
        accountId: firstAccountId,
        linkRef: conflict.state.linkRef,
      }),
    ).resolves.toMatchObject({ ok: true, state: { status: "conflict" } });
    await expect(
      membership.readAccountPresentation({ accountId: firstAccountId }),
    ).resolves.toEqual({
      ok: true,
      presentation: {
        link: {
          kind: "conflict",
          supportUrl: "https://t.me/inside_support",
        },
        membership: {
          acquisitionUrl: "https://t.me/tribute/inside",
          kind: "inactive",
        },
      },
    });
    clock.set(new Date("2030-01-01T00:06:00.000Z"));
    await expect(
      membership.beginLink({ accountId: firstAccountId }),
    ).resolves.toMatchObject({ ok: true, state: { status: "conflict" } });
    expect(provider.registerRequests).toHaveLength(1);

    provider.registration = { kind: "unavailable" };
    const unavailable = await membership.beginLink({ accountId: otherAccountId });
    expect(unavailable).toMatchObject({
      ok: true,
      state: { status: "unavailable" },
    });
    if (!unavailable.ok) throw new Error("Expected an unavailable link state");
    await expect(
      membership.beginLink({ accountId: otherAccountId }),
    ).resolves.toMatchObject({
      ok: true,
      state: {
        linkRef: unavailable.state.linkRef,
        status: "unavailable",
      },
    });
    await expect(
      membership.readAccountPresentation({ accountId: otherAccountId }),
    ).resolves.toMatchObject({
      ok: true,
      presentation: {
        link: { kind: "unavailable", retry: { kind: "refresh" } },
      },
    });
    expect(provider.registerRequests).toHaveLength(2);

    clock.set(new Date("2030-01-01T00:12:00.000Z"));
    await expect(
      membership.readAccountPresentation({ accountId: otherAccountId }),
    ).resolves.toMatchObject({
      ok: true,
      presentation: { link: { kind: "retryable", reason: "expired" } },
    });
    provider.registration = {
      expiresAt: new Date("2030-01-01T00:17:00.000Z"),
      kind: "registered",
      linkTransactionRef: "telegram-link-transaction-b",
      returnCorrelation: "return-correlation-b",
    };
    await expect(
      membership.beginLink({ accountId: otherAccountId }),
    ).resolves.toMatchObject({ ok: true, state: { status: "pending" } });
    expect(provider.registerRequests).toHaveLength(3);
  });

  test.each(["expired", "replayed"] as const)(
    "presents a provider %s outcome as a safe new attempt, not recovery",
    async (status) => {
      ({ membership, provider } = fixture(database));
      provider.confirmation = { kind: status };
      const begun = await membership.beginLink({ accountId: firstAccountId });
      if (!begun.ok || begun.state.status !== "pending") {
        throw new Error("Expected a pending Telegram link");
      }

      await membership.confirmLink({
        accountId: firstAccountId,
        linkRef: begun.state.linkRef,
      });
      await expect(
        membership.readAccountPresentation({ accountId: firstAccountId }),
      ).resolves.toMatchObject({
        ok: true,
        presentation: { link: { kind: "retryable", reason: status } },
      });

      provider.registration = {
        expiresAt: new Date("2030-01-01T00:05:00.000Z"),
        kind: "registered",
        linkTransactionRef: "telegram-link-transaction-b",
        returnCorrelation: "return-correlation-b",
      };
      await expect(
        membership.beginLink({ accountId: firstAccountId }),
      ).resolves.toMatchObject({ ok: true, state: { status: "pending" } });
      expect(provider.registerRequests).toHaveLength(2);
    },
  );

  test("retries a confirmed provider link after a temporary outage", async () => {
    ({ entitlements, membership, provider } = fixture(database));
    const begun = await membership.beginLink({ accountId: firstAccountId });
    if (!begun.ok || begun.state.status !== "pending") {
      throw new Error("Expected a pending Telegram link");
    }
    provider.confirmation = { kind: "unavailable" };
    await expect(
      membership.confirmLink({
        accountId: firstAccountId,
        linkRef: begun.state.linkRef,
      }),
    ).resolves.toMatchObject({ ok: true, state: { status: "unavailable" } });

    provider.confirmation = {
      kind: "linked",
      linkTransactionRef: "telegram-link-transaction-a",
      returnCorrelation: "return-correlation-a",
      telegramIdentityRef: "telegram-identity-ref-a",
    };
    await expect(
      membership.confirmLink({
        accountId: firstAccountId,
        linkRef: begun.state.linkRef,
      }),
    ).resolves.toMatchObject({ ok: true, state: { status: "linked" } });
    expect(provider.confirmRequests).toHaveLength(2);
    await expect(entitlements.resolveForAccess(firstAccountId)).resolves.toEqual({
      kind: "unavailable",
    });
  });

  test("keeps concurrent Account link attempts from creating duplicate bindings", async () => {
    ({ membership, provider } = fixture(database));
    const attempts = await Promise.all([
      membership.beginLink({ accountId: firstAccountId }),
      membership.beginLink({ accountId: firstAccountId }),
    ]);
    const linkRefs = attempts.map((attempt) => {
      if (
        !attempt.ok ||
        (attempt.state.status !== "pending" && attempt.state.status !== "unavailable")
      ) {
        throw new Error("Expected resumable concurrent Telegram links");
      }
      return attempt.state.linkRef;
    });
    const confirmations = await Promise.all(
      linkRefs.map((linkRef) =>
        membership.confirmLink({ accountId: firstAccountId, linkRef }),
      ),
    );
    const statuses = confirmations.map((confirmation) =>
      confirmation.ok ? confirmation.state.status : confirmation.error.code,
    );
    expect(statuses).toContain("linked");
    expect(statuses.every((status) => status === "linked" || status === "conflict")).toBe(true);
    await expect(
      database.prisma.membershipBinding.count({
        where: { accountId: firstAccountId },
      }),
    ).resolves.toBe(1);
    await expect(
      membership.readAccountPresentation({ accountId: firstAccountId }),
    ).resolves.toMatchObject({
      ok: true,
      presentation: { link: { kind: "linked" } },
    });
    expect(provider.registerRequests).toHaveLength(1);
  });
});

class ControlledTelegramLinkProvider implements TelegramLinkProvider {
  readonly confirmRequests: ConfirmTelegramLinkRequest[] = [];
  readonly registerRequests: RegisterTelegramLinkRequest[] = [];
  confirmation: TelegramLinkProviderConfirmation = {
    kind: "linked",
    linkTransactionRef: "telegram-link-transaction-a",
    returnCorrelation: "return-correlation-a",
    telegramIdentityRef: "telegram-identity-ref-a",
  };
  registration: TelegramLinkProviderRegistration = {
    expiresAt: new Date("2030-01-01T00:05:00.000Z"),
    kind: "registered",
    linkTransactionRef: "telegram-link-transaction-a",
    returnCorrelation: "return-correlation-a",
  };

  register(
    request: RegisterTelegramLinkRequest,
  ): Promise<TelegramLinkProviderRegistration> {
    this.registerRequests.push(request);
    return Promise.resolve(
      this.registration.kind === "registered"
        ? {
            ...this.registration,
            expiresAt: request.expiresAt,
            returnCorrelation: request.returnCorrelation,
          }
        : this.registration,
    );
  }

  confirm(
    request: ConfirmTelegramLinkRequest,
  ): Promise<TelegramLinkProviderConfirmation> {
    this.confirmRequests.push(request);
    return Promise.resolve(
      this.confirmation.kind === "linked"
        ? {
            ...this.confirmation,
            linkTransactionRef: request.linkTransactionRef,
            returnCorrelation: request.returnCorrelation,
          }
        : this.confirmation,
    );
  }
}

function fixture(database: TestDatabase): {
  readonly clock: MutableClock;
  readonly entitlements: MembershipEntitlements;
  readonly membership: TelegramMembership;
  readonly provider: ControlledTelegramLinkProvider;
} {
  const provider = new ControlledTelegramLinkProvider();
  const clock = new MutableClock(new Date("2030-01-01T00:00:00.000Z"));
  const entitlements = assembleMembershipEntitlements({
    prisma: database.prisma,
    clock: () => clock.now(),
  });
  const membership = assembleTelegramMembership({
    prisma: database.prisma,
    membershipEntitlements: entitlements,
    provider,
    botStartUrl: "https://t.me/inside_test_bot",
    clock: () => clock.now(),
    linkLifetimeMs: 5 * 60_000,
    membershipAcquisitionUrl: "https://t.me/tribute/inside",
    membershipSupportUrl: "https://t.me/inside_support",
  });
  return { clock, entitlements, membership, provider };
}

class MutableClock {
  constructor(private value: Date) {}

  now(): Date {
    return new Date(this.value);
  }

  set(value: Date): void {
    this.value = value;
  }
}

function evidence(
  principalRef: string,
  decision: "member" | "not_member",
  evidenceVersion: number,
  checkedAt: Date,
) {
  return {
    contractVersion: "inside.membership-evidence.v1",
    principalRef,
    decision,
    reasonCode:
      decision === "member" ? "chat_member" : "chat_not_member",
    checkedAt: checkedAt.toISOString(),
    validUntil: new Date(checkedAt.getTime() + 5 * 60_000).toISOString(),
    telegramIdentityRef: "telegram-identity-ref-a",
    evidenceRef: `evidence-${String(evidenceVersion)}`,
    evidenceVersion,
  };
}
