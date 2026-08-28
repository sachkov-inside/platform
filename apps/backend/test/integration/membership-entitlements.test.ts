import { readFile } from "node:fs/promises";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { z } from "zod";

import { accountId, type AccountId } from "../../src/modules/accounts/index.js";
import {
  assembleMembershipEntitlements,
  type MembershipEntitlements,
  type MembershipEvidenceSource,
} from "../../src/modules/membership-entitlements/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const fixtureSchema = z
  .object({
    name: z.string().min(1),
    evidence: z.record(z.string(), z.unknown()),
    expected: z.string().min(1),
    currentEvidenceVersion: z.number().int().positive().optional(),
    requestPrincipalRef: z.string().min(1).optional(),
  })
  .strict();
const fixtureCorpusSchema = z
  .object({
    fixtureVersion: z.literal("inside.membership-evidence-fixtures.v1"),
    clock: z.iso.datetime(),
    fixtures: z.array(fixtureSchema),
  })
  .strict();
const columnRowsSchema = z.array(
  z.object({ column_name: z.string().min(1) }).strict(),
);

const snapshotRoot = new URL(
  "../../src/modules/membership-entitlements/contracts/inside-membership-evidence-v1/",
  import.meta.url,
);
const corpus = fixtureCorpusSchema.parse(
  JSON.parse(await readFile(new URL("fixtures.json", snapshotRoot), "utf8")),
);

describe("MembershipEntitlements", () => {
  let testDatabase: TestDatabase;
  let currentTime = new Date(corpus.clock);
  let membershipEntitlements: MembershipEntitlements;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    membershipEntitlements = assembleMembershipEntitlements({
      prisma: testDatabase.prisma,
      clock: () => currentTime,
    });
  });

  beforeEach(async () => {
    currentTime = new Date(corpus.clock);
    await testDatabase.prisma.membershipEvidenceReceipt.deleteMany();
    await testDatabase.prisma.membershipProjection.deleteMany();
    await testDatabase.prisma.membershipBinding.deleteMany();
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test.each(corpus.fixtures)(
    "converges the vendored $name contract fixture",
    async (fixture) => {
      const fixtureIndex = corpus.fixtures.findIndex(
        ({ name }) => name === fixture.name,
      );
      const targetAccountId = corpusAccountId(fixtureIndex);
      const observed = await exerciseFixture(
        membershipEntitlements,
        targetAccountId,
        fixture,
      );

      expect(observed).toBe(fixture.expected);
    },
  );

  test("keeps fresh negative on provider outage and fails a stale positive closed", async () => {
    const negativeAccount = accountId("91000000-0000-4000-8000-000000000001");
    await expect(
      accept(
        membershipEntitlements,
        negativeAccount,
        "negative-link",
        "link_time",
        observedEvidence("negative-principal", "not_member", 1),
      ),
    ).resolves.toMatchObject({ ok: true, outcome: "applied" });
    await expect(
      accept(
        membershipEntitlements,
        negativeAccount,
        "negative-outage",
        "reconciliation",
        {
          contractVersion: "inside.membership-evidence.v1",
          principalRef: "negative-principal",
          decision: "unavailable",
          reasonCode: "provider_unavailable",
        },
      ),
    ).resolves.toEqual({
      ok: true,
      outcome: "accepted_without_entitlement",
      decision: "unavailable",
    });
    await expect(
      membershipEntitlements.resolveForAccess(negativeAccount),
    ).resolves.toEqual({ kind: "expired" });

    const positiveAccount = accountId("91000000-0000-4000-8000-000000000002");
    await accept(
      membershipEntitlements,
      positiveAccount,
      "positive-link",
      "link_time",
      observedEvidence("positive-principal", "member", 1),
    );
    currentTime = new Date("2030-01-01T00:05:00Z");
    await expect(
      membershipEntitlements.resolveForAccess(positiveAccount),
    ).resolves.toEqual({ kind: "stale" });
  });

  test("deduplicates concurrent delivery and converges out of order to the newest version", async () => {
    currentTime = new Date(corpus.clock);
    const racingAccountId = accountId("92000000-0000-4000-8000-000000000000");
    const racingEvent = {
      accountId: racingAccountId,
      deliveryId: "racing-event",
      source: "member_status_event" as const,
      evidence: observedEvidence("racing-principal", "not_member", 2),
    };
    await Promise.all([
      accept(
        membershipEntitlements,
        racingAccountId,
        "racing-link",
        "link_time",
        observedEvidence("racing-principal", "member", 1),
      ),
      membershipEntitlements.acceptEvidence(racingEvent),
    ]);
    await membershipEntitlements.acceptEvidence(racingEvent);
    await expect(
      testDatabase.prisma.membershipProjection.findUnique({
        where: { accountId: racingAccountId },
      }),
    ).resolves.toMatchObject({ evidenceVersion: 2n, decision: "not_member" });

    const targetAccountId = accountId("92000000-0000-4000-8000-000000000001");
    const initial = observedEvidence("concurrent-principal", "member", 1);
    const command = {
      accountId: targetAccountId,
      deliveryId: "concurrent-identical",
      source: "link_time" as const,
      evidence: initial,
    };
    const identical = await Promise.all([
      membershipEntitlements.acceptEvidence(command),
      membershipEntitlements.acceptEvidence(command),
    ]);
    expect(identical[0]).toEqual(identical[1]);
    expect(identical[0]).toMatchObject({
      ok: true,
      outcome: "applied",
      evidenceVersion: 1,
    });

    const versions = [4, 2, 5, 3] as const;
    const results = await Promise.all(
      versions.map((version) =>
        accept(
          membershipEntitlements,
          targetAccountId,
          `concurrent-${String(version)}`,
          version % 2 === 0 ? "member_status_event" : "reconciliation",
          observedEvidence(
            "concurrent-principal",
            version === 5 ? "not_member" : "member",
            version,
          ),
        ),
      ),
    );
    expect(results.some((result) => result.ok)).toBe(true);
    expect(
      await testDatabase.prisma.membershipProjection.findUnique({
        where: { accountId: targetAccountId },
      }),
    ).toMatchObject({ evidenceVersion: 5n, decision: "not_member" });
    await expect(
      membershipEntitlements.resolveForAccess(targetAccountId),
    ).resolves.toEqual({ kind: "expired" });
    await expect(
      testDatabase.prisma.membershipEvidenceReceipt.count({
        where: { deliveryId: "concurrent-identical" },
      }),
    ).resolves.toBe(1);
  });

  test("lets only link-time evidence establish a binding and retries earlier events", async () => {
    const targetAccountId = accountId("92000000-0000-4000-8000-000000000002");
    const misroutedEvent = {
      accountId: targetAccountId,
      deliveryId: "event-before-link",
      source: "member_status_event" as const,
      evidence: observedEvidence("wrong-principal", "member", 2),
    };

    await expect(
      membershipEntitlements.acceptEvidence(misroutedEvent),
    ).resolves.toEqual({ ok: false, error: { code: "unavailable" } });
    await expect(
      testDatabase.prisma.membershipBinding.count(),
    ).resolves.toBe(0);
    await expect(
      testDatabase.prisma.membershipEvidenceReceipt.findUniqueOrThrow({
        where: { deliveryId: misroutedEvent.deliveryId },
      }),
    ).resolves.toMatchObject({ outcome: "awaiting_binding" });

    await expect(
      accept(
        membershipEntitlements,
        targetAccountId,
        "authoritative-link",
        "link_time",
        observedEvidence("right-principal", "member", 1),
      ),
    ).resolves.toMatchObject({ ok: true, outcome: "applied" });
    await expect(
      membershipEntitlements.acceptEvidence(misroutedEvent),
    ).resolves.toEqual({
      ok: false,
      error: { code: "principal_mismatch" },
    });
    await expect(
      testDatabase.prisma.membershipBinding.findUniqueOrThrow({
        where: { accountId: targetAccountId },
      }),
    ).resolves.toMatchObject({ principalRef: "right-principal" });
    await expect(
      testDatabase.prisma.membershipProjection.findUniqueOrThrow({
        where: { accountId: targetAccountId },
      }),
    ).resolves.toMatchObject({ evidenceVersion: 1n, decision: "member" });

    const unboundAccountId = accountId("92000000-0000-4000-8000-000000000003");
    const unavailableEvidence = {
      contractVersion: "inside.membership-evidence.v1",
      principalRef: "unbound-principal",
      decision: "unavailable",
      reasonCode: "provider_unavailable",
    };
    await expect(
      accept(
        membershipEntitlements,
        unboundAccountId,
        "unbound-reconciliation",
        "reconciliation",
        unavailableEvidence,
      ),
    ).resolves.toEqual({ ok: false, error: { code: "unavailable" } });
    await expect(
      accept(
        membershipEntitlements,
        unboundAccountId,
        "unbound-link-result",
        "link_time",
        unavailableEvidence,
      ),
    ).resolves.toEqual({
      ok: true,
      outcome: "accepted_without_entitlement",
      decision: "unavailable",
    });
    await expect(
      testDatabase.prisma.membershipBinding.findUnique({
        where: { accountId: unboundAccountId },
      }),
    ).resolves.toBeNull();
  });

  test("rejects unchecked delivery metadata before persistence", async () => {
    const targetAccountId = accountId("94000000-0000-4000-8000-000000000001");
    await expect(
      accept(
        membershipEntitlements,
        targetAccountId,
        "",
        "link_time",
        observedEvidence("unchecked-principal", "member", 1),
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "invalid_evidence" },
    });
    await expect(
      testDatabase.prisma.membershipEvidenceReceipt.count(),
    ).resolves.toBe(0);
  });

  test("only reads local projection for concurrent access resolution and stores redacted receipts", async () => {
    currentTime = new Date(corpus.clock);
    const targetAccountId = accountId("93000000-0000-4000-8000-000000000001");
    await accept(
      membershipEntitlements,
      targetAccountId,
      "local-read-link",
      "link_time",
      observedEvidence("local-read-principal", "member", 1),
    );
    const receiptCount = await testDatabase.prisma.membershipEvidenceReceipt.count();

    await expect(
      Promise.all(
        Array.from({ length: 32 }, () =>
          membershipEntitlements.resolveForAccess(targetAccountId),
        ),
      ),
    ).resolves.toEqual(
      Array.from({ length: 32 }, () => ({
        kind: "active",
        validUntil: "2030-01-01T00:05:00.000Z",
      })),
    );
    await expect(
      testDatabase.prisma.membershipEvidenceReceipt.count(),
    ).resolves.toBe(receiptCount);

    const receipt = await testDatabase.prisma.membershipEvidenceReceipt.findUniqueOrThrow({
      where: { deliveryId: "local-read-link" },
    });
    expect(receipt.retainUntil.toISOString()).toBe("2030-01-31T00:04:00.000Z");
    const columns = columnRowsSchema.parse(
      await testDatabase.prisma.$queryRaw`
        select column_name
        from information_schema.columns
        where table_schema = 'membership_entitlements'
          and table_name = 'evidence_receipts'
        order by column_name
      `,
    );
    expect(columns.map(({ column_name }) => column_name)).not.toContain(
      "telegram_identity_ref",
    );
    expect(columns.map(({ column_name }) => column_name)).not.toContain("payload");
  });
});

async function exerciseFixture(
  membershipEntitlements: MembershipEntitlements,
  targetAccountId: AccountId,
  fixture: z.infer<typeof fixtureSchema>,
): Promise<string> {
  switch (fixture.name) {
    case "member-removed":
      await accept(
        membershipEntitlements,
        targetAccountId,
        `${fixture.name}-seed`,
        "link_time",
        observedEvidence("principal-ref-a", "member", 4),
      );
      await acceptFixture(membershipEntitlements, targetAccountId, fixture, "member_status_event");
      await expect(
        membershipEntitlements.resolveForAccess(targetAccountId),
      ).resolves.toEqual({ kind: "expired" });
      return "replace_with_not_member";
    case "member-rejoined":
      await accept(
        membershipEntitlements,
        targetAccountId,
        `${fixture.name}-seed`,
        "link_time",
        observedEvidence("principal-ref-a", "not_member", 5),
      );
      await acceptFixture(membershipEntitlements, targetAccountId, fixture, "reconciliation");
      await expect(
        membershipEntitlements.resolveForAccess(targetAccountId),
      ).resolves.toMatchObject({ kind: "active" });
      return "replace_with_member";
    case "principal-mismatch":
      await accept(
        membershipEntitlements,
        targetAccountId,
        `${fixture.name}-seed`,
        "link_time",
        observedEvidence(fixture.requestPrincipalRef ?? "principal-ref-b", "member", 1),
      );
      return resultCode(
        await acceptFixture(
          membershipEntitlements,
          targetAccountId,
          fixture,
          "member_status_event",
        ),
      );
    case "replayed-version":
      await accept(
        membershipEntitlements,
        targetAccountId,
        `${fixture.name}-seed`,
        "link_time",
        observedEvidence("principal-ref-a", "member", 4),
      );
      return resultCode(
        await acceptFixture(
          membershipEntitlements,
          targetAccountId,
          fixture,
          "reconciliation",
        ),
      );
    case "linked-member-fresh": {
      const result = await acceptFixture(
        membershipEntitlements,
        targetAccountId,
        fixture,
        "link_time",
      );
      await expect(
        membershipEntitlements.resolveForAccess(targetAccountId),
      ).resolves.toMatchObject({ kind: "active" });
      return result.ok && result.outcome === "applied" && result.state === "active"
        ? "accept_member"
        : resultCode(result);
    }
    case "linked-non-member": {
      const result = await acceptFixture(
        membershipEntitlements,
        targetAccountId,
        fixture,
        "link_time",
      );
      return result.ok && result.outcome === "applied" && result.state === "non_member"
        ? "accept_not_member"
        : resultCode(result);
    }
    case "identity-not-linked":
    case "identity-conflict":
    case "provider-unavailable": {
      const result = await acceptFixture(
        membershipEntitlements,
        targetAccountId,
        fixture,
        "link_time",
      );
      return result.ok && result.outcome === "accepted_without_entitlement"
        ? "accept_without_entitlement"
        : resultCode(result);
    }
    case "positive-expired":
    case "positive-over-five-minutes":
    case "unsupported-major":
    case "malformed-envelope":
      return resultCode(
        await acceptFixture(
          membershipEntitlements,
          targetAccountId,
          fixture,
          "link_time",
        ),
      );
    default:
      throw new Error(`Unmapped Membership fixture: ${fixture.name}`);
  }
}

function acceptFixture(
  membershipEntitlements: MembershipEntitlements,
  targetAccountId: AccountId,
  fixture: z.infer<typeof fixtureSchema>,
  source: MembershipEvidenceSource,
) {
  return accept(
    membershipEntitlements,
    targetAccountId,
    `fixture-${fixture.name}`,
    source,
    fixture.evidence,
  );
}

function accept(
  membershipEntitlements: MembershipEntitlements,
  targetAccountId: AccountId,
  deliveryId: string,
  source: MembershipEvidenceSource,
  evidence: unknown,
) {
  return membershipEntitlements.acceptEvidence({
    accountId: targetAccountId,
    deliveryId,
    source,
    evidence,
  });
}

function resultCode(
  result: Awaited<ReturnType<MembershipEntitlements["acceptEvidence"]>>,
): string {
  return result.ok ? result.outcome : result.error.code;
}

function observedEvidence(
  principalRef: string,
  decision: "member" | "not_member",
  evidenceVersion: number,
) {
  return {
    contractVersion: "inside.membership-evidence.v1",
    principalRef,
    decision,
    reasonCode: decision === "member" ? "chat_member" : "chat_not_member",
    checkedAt: "2030-01-01T00:00:00Z",
    validUntil: "2030-01-01T00:05:00Z",
    telegramIdentityRef: `${principalRef}-telegram`,
    evidenceRef: `${principalRef}-${String(evidenceVersion)}`,
    evidenceVersion,
  };
}

function corpusAccountId(index: number): AccountId {
  return accountId(
    `90000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
}
