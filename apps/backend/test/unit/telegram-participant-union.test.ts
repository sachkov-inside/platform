import { expect, it, vi } from "vitest";
import { ParticipantDiagnostics } from "../../src/entrypoints/mcp/participant-diagnostics.js";

const actor = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const window = {
  from: "2026-10-19T00:00:00.000Z",
  to: "2026-10-20T00:00:00.000Z",
};
const coverage = {
  status: "partial",
  collectionStartedAt: null,
  continuity: "not_proven",
  retentionFrom: "2025-10-20T00:00:00.000Z",
} as const;
const member = {
  read: () =>
    Promise.resolve({
      ok: true as const,
      value: {
        asOf: window.to,
        window,
        coverage,
        rows: [
          {
            accountId: actor,
            kind: "learning_started" as const,
            eventCount: 1,
            firstOccurredAt: window.from,
            lastOccurredAt: window.from,
          },
        ],
      },
    }),
};
const accounts = {
  checkPermission: vi.fn().mockResolvedValue({ ok: true, allowed: true }),
};
function telegram() {
  return {
    read: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        contractVersion: "inside.telegram-activity.v1",
        window,
        asOf: window.to,
        coverage,
        cleanup: {
          status: "known",
          asOf: window.to,
          cutoff: "2025-10-20T00:00:00.000Z",
          oldestExpiredAt: null,
          lagSeconds: null,
          budgetSeconds: 86400,
          withinBudget: true,
        },
        attribution: "current_confirmed_link",
        accountIds: [actor, other, other],
        unlinkedContacts: 3,
      },
    }),
  };
}

it("unions confirmed linked Telegram Accounts with Membership and keeps unlinked contacts separate", async () => {
  const owner = telegram();
  const report = new ParticipantDiagnostics(
    accounts,
    member,
    member,
    member,
    owner,
  );
  const result = await report.read(actor, window);
  expect(result).toMatchObject({
    ok: true,
    value: {
      membership: { count: 1 },
      telegram: { status: "observed", count: 2 },
      combined: { status: "observed", count: 2 },
      unlinkedTelegramContacts: { status: "observed", count: 3 },
      attribution: "current_confirmed_link",
    },
  });
  if (!result.ok) throw new Error("Expected an observed participant report");
  expect(result.value.sources).toContainEqual(
    expect.objectContaining({
      source: "telegram",
      cleanup: {
        status: "known",
        asOf: window.to,
        cutoff: "2025-10-20T00:00:00.000Z",
        oldestExpiredAt: null,
        lagSeconds: null,
        budgetSeconds: 86400,
        withinBudget: true,
      },
    }),
  );
  expect(owner.read).toHaveBeenCalledExactlyOnceWith(window);
  expect(JSON.stringify(result)).not.toContain(actor);
  expect(JSON.stringify(result)).not.toContain(other);
});
it.each(["source_unavailable", "source_budget_exceeded", "outside_retention"])(
  "preserves Membership but makes Telegram/union unknown on %s",
  async (code) => {
    const owner = {
      read: vi.fn().mockResolvedValue({ ok: false, error: { code } }),
    };
    const result = await new ParticipantDiagnostics(
      accounts,
      member,
      member,
      member,
      owner,
    ).read(actor, window);

    expect(result).toMatchObject({
      ok: true,
      value: {
        membership: { count: 1 },
        telegram: { status: "unknown", count: null },
        combined: { status: "unknown", count: null },
        unlinkedTelegramContacts: { count: null },
      },
    });
    if (!result.ok) throw new Error("Expected a partial participant report");
    expect(result.value.sources).toContainEqual({
      source: "telegram",
      status: "unknown",
      asOf: null,
      cleanup: { status: "unknown" },
      error: { code },
      coverage: {
        status: "unknown",
        retentionFrom: null,
        collectionStartedAt: null,
        continuity: "not_proven",
      },
    });
  },
);
it("does not let Telegram replace a failed Membership source in the combined count", async () => {
  const broken = { read: vi.fn().mockRejectedValue(new Error("private")) };
  expect(
    await new ParticipantDiagnostics(
      accounts,
      broken,
      member,
      member,
      telegram(),
    ).read(actor, window),
  ).toMatchObject({
    ok: true,
    value: {
      membership: { count: null },
      telegram: { count: 2 },
      combined: { count: null },
    },
  });
});
it("checks current permission before the Telegram runtime owner is called", async () => {
  const owner = telegram();
  expect(
    await new ParticipantDiagnostics(
      {
        checkPermission: vi
          .fn()
          .mockResolvedValue({ ok: true, allowed: false }),
      },
      member,
      member,
      member,
      owner,
    ).read(actor, window),
  ).toMatchObject({ ok: false, error: { code: "forbidden" } });
  expect(owner.read).not.toHaveBeenCalled();
});

it("treats canonical UUID casing as one Account across surfaces", async () => {
  const id = "abcdef00-0000-4000-8000-000000000001";
  const reading = {
    read: vi.fn().mockResolvedValue({
      ...(await member.read()),
      value: {
        ...(await member.read()).value,
        rows: [
          {
            accountId: id,
            kind: "learning_started",
            eventCount: 1,
            firstOccurredAt: window.from,
            lastOccurredAt: window.from,
          },
        ],
      },
    }),
  };
  const owner = telegram();
  owner.read.mockResolvedValue({
    ok: true,
    value: { ...bodyForCasing(), accountIds: [id.toUpperCase()] },
  });
  expect(
    await new ParticipantDiagnostics(
      accounts,
      reading,
      reading,
      reading,
      owner,
    ).read(actor, window),
  ).toMatchObject({
    ok: true,
    value: {
      membership: { count: 1 },
      telegram: { count: 1 },
      combined: { count: 1 },
    },
  });
});
function bodyForCasing() {
  return {
    contractVersion: "inside.telegram-activity.v1",
    window,
    asOf: window.to,
    coverage,
    cleanup: {
      status: "known",
      asOf: window.to,
      cutoff: "2025-10-20T00:00:00.000Z",
      oldestExpiredAt: null,
      lagSeconds: null,
      budgetSeconds: 86400,
      withinBudget: true,
    },
    attribution: "current_confirmed_link",
    unlinkedContacts: 0,
  };
}
