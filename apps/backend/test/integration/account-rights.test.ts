import { assemblePriorParticipantsFixture } from "./setup/prior-participants.js";
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
  type AccountRights,
  type MembershipEvidenceSource,
} from "../../src/modules/account-rights/index.js";
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
  "../../../../docs/contracts/inside-membership-evidence-v1/",
  import.meta.url,
);
const corpus = fixtureCorpusSchema.parse(
  JSON.parse(await readFile(new URL("fixtures.json", snapshotRoot), "utf8")),
);

describe("AccountRights", () => {
  let testDatabase: TestDatabase;
  let currentTime = new Date(corpus.clock);
  let accountRights: AccountRights;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    accountRights = assemblePriorParticipantsFixture({
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
        accountRights,
        targetAccountId,
        fixture,
      );

      expect(observed).toBe(fixture.expected);
    },
  );

  test("binds a confirmed opaque Principal idempotently and rejects silent transfer", async () => {
    const firstAccount = accountId("90000000-0000-4000-8000-000000000001");
    const secondAccount = accountId("90000000-0000-4000-8000-000000000002");
    await expect(
      accountRights.bindPrincipal({
        accountId: firstAccount,
        principalRef: "confirmed-principal-a",
      }),
    ).resolves.toEqual({ ok: true, outcome: "bound" });
    await expect(
      accountRights.bindPrincipal({
        accountId: firstAccount,
        principalRef: "confirmed-principal-a",
      }),
    ).resolves.toEqual({ ok: true, outcome: "idempotent" });
    await expect(
      accountRights.bindPrincipal({
        accountId: secondAccount,
        principalRef: "confirmed-principal-a",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "conflict" } });
    await expect(
      accountRights.acceptEvidence({
        accountId: firstAccount,
        deliveryId: "confirmed-reconciliation",
        source: "reconciliation",
        evidence: observedEvidence("confirmed-principal-a", "member", 1),
      }),
    ).resolves.toMatchObject({ ok: true, outcome: "applied" });
  });

  test("keeps fresh negative on provider outage and fails a stale positive closed", async () => {
    const negativeAccount = accountId("91000000-0000-4000-8000-000000000001");
    await expect(
      accept(
        accountRights,
        negativeAccount,
        "negative-link",
        "link_time",
        observedEvidence("negative-principal", "not_member", 1),
      ),
    ).resolves.toMatchObject({ ok: true, outcome: "applied" });
    await expect(
      accept(
        accountRights,
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
      accountRights.resolveForAccess(negativeAccount),
    ).resolves.toEqual({ kind: "expired" });

    const positiveAccount = accountId("91000000-0000-4000-8000-000000000002");
    await accept(
      accountRights,
      positiveAccount,
      "positive-link",
      "link_time",
      observedEvidence("positive-principal", "member", 1),
    );
    currentTime = new Date("2030-01-01T00:05:00Z");
    await expect(
      accountRights.resolveForAccess(positiveAccount),
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
        accountRights,
        racingAccountId,
        "racing-link",
        "link_time",
        observedEvidence("racing-principal", "member", 1),
      ),
      accountRights.acceptEvidence(racingEvent),
    ]);
    await accountRights.acceptEvidence(racingEvent);
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
      accountRights.acceptEvidence(command),
      accountRights.acceptEvidence(command),
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
          accountRights,
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
      accountRights.resolveForAccess(targetAccountId),
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

    await expect(accountRights.acceptEvidence(misroutedEvent)).resolves.toEqual(
      { ok: false, error: { code: "unavailable" } },
    );
    await expect(testDatabase.prisma.membershipBinding.count()).resolves.toBe(
      0,
    );
    await expect(
      testDatabase.prisma.membershipEvidenceReceipt.findUniqueOrThrow({
        where: { deliveryId: misroutedEvent.deliveryId },
      }),
    ).resolves.toMatchObject({ outcome: "awaiting_binding" });

    await expect(
      accept(
        accountRights,
        targetAccountId,
        "authoritative-link",
        "link_time",
        observedEvidence("right-principal", "member", 1),
      ),
    ).resolves.toMatchObject({ ok: true, outcome: "applied" });
    await expect(accountRights.acceptEvidence(misroutedEvent)).resolves.toEqual(
      {
        ok: false,
        error: { code: "principal_mismatch" },
      },
    );
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
        accountRights,
        unboundAccountId,
        "unbound-reconciliation",
        "reconciliation",
        unavailableEvidence,
      ),
    ).resolves.toEqual({ ok: false, error: { code: "unavailable" } });
    await expect(
      accept(
        accountRights,
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

  test("serializes concurrent retries of one delivery after its binding appears", async () => {
    const targetAccountId = accountId("92000000-0000-4000-8000-000000000004");
    const event = {
      accountId: targetAccountId,
      deliveryId: "retry-after-binding",
      source: "member_status_event" as const,
      evidence: observedEvidence("retry-principal", "not_member", 2),
    };

    await expect(accountRights.acceptEvidence(event)).resolves.toEqual({
      ok: false,
      error: { code: "unavailable" },
    });
    await expect(
      accept(
        accountRights,
        targetAccountId,
        "retry-link",
        "link_time",
        observedEvidence("retry-principal", "member", 1),
      ),
    ).resolves.toMatchObject({ ok: true, outcome: "applied" });

    const retries = await Promise.all([
      accountRights.acceptEvidence(event),
      accountRights.acceptEvidence(event),
    ]);
    expect(retries).toEqual([
      { ok: true, outcome: "applied", state: "non_member", evidenceVersion: 2 },
      { ok: true, outcome: "applied", state: "non_member", evidenceVersion: 2 },
    ]);
    await expect(
      testDatabase.prisma.membershipEvidenceReceipt.findUniqueOrThrow({
        where: { deliveryId: event.deliveryId },
      }),
    ).resolves.toMatchObject({ outcome: "applied", evidenceVersion: 2n });
  });

  test("rejects unchecked delivery metadata before persistence", async () => {
    const targetAccountId = accountId("94000000-0000-4000-8000-000000000001");
    await expect(
      accept(
        accountRights,
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
      accountRights,
      targetAccountId,
      "local-read-link",
      "link_time",
      observedEvidence("local-read-principal", "member", 1),
    );
    const receiptCount =
      await testDatabase.prisma.membershipEvidenceReceipt.count();

    await expect(
      Promise.all(
        Array.from({ length: 32 }, () =>
          accountRights.resolveForAccess(targetAccountId),
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

    const receipt =
      await testDatabase.prisma.membershipEvidenceReceipt.findUniqueOrThrow({
        where: { deliveryId: "local-read-link" },
      });
    expect(receipt.retainUntil.toISOString()).toBe("2030-01-31T00:04:00.000Z");
    const columns = columnRowsSchema.parse(
      await testDatabase.prisma.$queryRaw`
        select column_name
        from information_schema.columns
        where table_schema = 'account_rights'
          and table_name = 'evidence_receipts'
        order by column_name
      `,
    );
    expect(columns.map(({ column_name }) => column_name)).not.toContain(
      "telegram_identity_ref",
    );
    expect(columns.map(({ column_name }) => column_name)).not.toContain(
      "payload",
    );
  });
});

async function exerciseFixture(
  accountRights: AccountRights,
  targetAccountId: AccountId,
  fixture: z.infer<typeof fixtureSchema>,
): Promise<string> {
  switch (fixture.name) {
    case "member-removed":
      await accept(
        accountRights,
        targetAccountId,
        `${fixture.name}-seed`,
        "link_time",
        observedEvidence("principal-ref-a", "member", 4),
      );
      await acceptFixture(
        accountRights,
        targetAccountId,
        fixture,
        "member_status_event",
      );
      await expect(
        accountRights.resolveForAccess(targetAccountId),
      ).resolves.toEqual({ kind: "expired" });
      return "replace_with_not_member";
    case "member-rejoined":
      await accept(
        accountRights,
        targetAccountId,
        `${fixture.name}-seed`,
        "link_time",
        observedEvidence("principal-ref-a", "not_member", 5),
      );
      await acceptFixture(
        accountRights,
        targetAccountId,
        fixture,
        "reconciliation",
      );
      await expect(
        accountRights.resolveForAccess(targetAccountId),
      ).resolves.toMatchObject({ kind: "active" });
      return "replace_with_member";
    case "principal-mismatch":
      await accept(
        accountRights,
        targetAccountId,
        `${fixture.name}-seed`,
        "link_time",
        observedEvidence(
          fixture.requestPrincipalRef ?? "principal-ref-b",
          "member",
          1,
        ),
      );
      return resultCode(
        await acceptFixture(
          accountRights,
          targetAccountId,
          fixture,
          "member_status_event",
        ),
      );
    case "replayed-version":
      await accept(
        accountRights,
        targetAccountId,
        `${fixture.name}-seed`,
        "link_time",
        observedEvidence("principal-ref-a", "member", 4),
      );
      return resultCode(
        await acceptFixture(
          accountRights,
          targetAccountId,
          fixture,
          "reconciliation",
        ),
      );
    case "linked-member-fresh": {
      const result = await acceptFixture(
        accountRights,
        targetAccountId,
        fixture,
        "link_time",
      );
      await expect(
        accountRights.resolveForAccess(targetAccountId),
      ).resolves.toMatchObject({ kind: "active" });
      return result.ok &&
        result.outcome === "applied" &&
        result.state === "active"
        ? "accept_member"
        : resultCode(result);
    }
    case "linked-non-member": {
      const result = await acceptFixture(
        accountRights,
        targetAccountId,
        fixture,
        "link_time",
      );
      return result.ok &&
        result.outcome === "applied" &&
        result.state === "non_member"
        ? "accept_not_member"
        : resultCode(result);
    }
    case "identity-not-linked":
    case "identity-conflict":
    case "provider-unavailable": {
      const result = await acceptFixture(
        accountRights,
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
          accountRights,
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
  accountRights: AccountRights,
  targetAccountId: AccountId,
  fixture: z.infer<typeof fixtureSchema>,
  source: MembershipEvidenceSource,
) {
  return accept(
    accountRights,
    targetAccountId,
    `fixture-${fixture.name}`,
    source,
    fixture.evidence,
  );
}

function accept(
  accountRights: AccountRights,
  targetAccountId: AccountId,
  deliveryId: string,
  source: MembershipEvidenceSource,
  evidence: unknown,
) {
  return accountRights.acceptEvidence({
    accountId: targetAccountId,
    deliveryId,
    source,
    evidence,
  });
}

function resultCode(
  result: Awaited<ReturnType<AccountRights["acceptEvidence"]>>,
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
