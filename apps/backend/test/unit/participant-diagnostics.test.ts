import { expect, it, vi } from "vitest";
import { ParticipantDiagnostics } from "../../src/entrypoints/mcp/participant-diagnostics.js";

const actor = "10000000-0000-4000-8000-000000000001";
const window = { from: "2026-10-19T00:00:00Z", to: "2026-10-20T00:00:00Z" };
it("checks current admin permission before reading any activity owner", async () => {
  const read = vi.fn().mockRejectedValue(new Error("private source"));
  const permission = vi.fn().mockResolvedValue({ ok: true, allowed: false });
  const report = new ParticipantDiagnostics(
    { checkPermission: permission },
    { read },
    { read },
    { read },
  );
  expect(await report.read(actor, window)).toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
  expect(permission).toHaveBeenCalledWith({
    accountId: actor,
    permission: "platform:admin",
  });
  expect(read).not.toHaveBeenCalled();
});

function snapshot(ids: readonly string[]) {
  return {
    ok: true as const,
    value: {
      asOf: "2026-10-20T01:00:00.000Z",
      window,
      coverage: {
        status: "partial" as const,
        collectionStartedAt: null,
        continuity: "not_proven" as const,
        retentionFrom: "2025-10-20T01:00:00.000Z",
      },
      rows: ids.map((accountId) => ({
        accountId,
        kind: "learning_started" as const,
        eventCount: 2100,
        firstOccurredAt: window.from,
        lastOccurredAt: window.from,
      })),
    },
  };
}
it("counts the union of Account identities across owners and normalizes the one shared interval", async () => {
  const other = "10000000-0000-4000-8000-000000000002";
  const reading = vi.fn().mockResolvedValue(snapshot([actor, actor]));
  const bookmarks = vi.fn().mockResolvedValue(snapshot([actor, other]));
  const submissions = vi.fn().mockResolvedValue(snapshot([other]));
  const report = new ParticipantDiagnostics(
    { checkPermission: vi.fn().mockResolvedValue({ ok: true, allowed: true }) },
    { read: reading },
    { read: bookmarks },
    { read: submissions },
  );
  const result = await report.read(actor, {
    from: "2026-10-19T03:00:00+03:00",
    to: "2026-10-20T03:00:00+03:00",
  });
  expect(result).toMatchObject({
    ok: true,
    value: {
      membership: { status: "observed", count: 2, coverage: "partial" },
      telegram: { status: "not_collected", count: null },
      combined: { status: "not_collected", count: null },
      unlinkedTelegramContacts: { status: "not_collected", count: null },
    },
  });
  for (const read of [reading, bookmarks, submissions])
    expect(read).toHaveBeenCalledExactlyOnceWith({
      from: "2026-10-19T00:00:00.000Z",
      to: "2026-10-20T00:00:00.000Z",
    });
  expect(JSON.stringify(result)).not.toContain(actor);
  expect(JSON.stringify(result)).not.toContain(other);
});
it("distinguishes source observation from incomplete historical coverage", async () => {
  const read = vi.fn().mockResolvedValue(snapshot([]));
  const report = new ParticipantDiagnostics(
    { checkPermission: vi.fn().mockResolvedValue({ ok: true, allowed: true }) },
    { read },
    { read },
    { read },
  );
  expect(await report.read(actor, window)).toMatchObject({
    ok: true,
    value: {
      membership: { status: "observed", count: 0, coverage: "partial" },
      sources: [
        {
          source: "reading",
          status: "observed",
          asOf: "2026-10-20T01:00:00.000Z",
          coverage: {
            status: "partial",
            continuity: "not_proven",
            collectionStartedAt: null,
            retentionFrom: "2025-10-20T01:00:00.000Z",
          },
        },
        { source: "bookmarks", status: "observed" },
        { source: "submissions", status: "observed" },
      ],
    },
  });
});

it.each([
  "source_unavailable",
  "source_budget_exceeded",
  "outside_retention",
] as const)(
  "does not publish a partial Membership count when one owner reports %s",
  async (code) => {
    const reading = { read: vi.fn().mockResolvedValue(snapshot([actor])) };
    const bookmarks = {
      read: vi.fn().mockResolvedValue({ ok: false, error: { code } }),
    };
    const report = new ParticipantDiagnostics(
      {
        checkPermission: vi.fn().mockResolvedValue({ ok: true, allowed: true }),
      },
      reading,
      bookmarks,
      reading,
    );
    expect(await report.read(actor, window)).toMatchObject({
      ok: true,
      value: {
        membership: { status: "unknown", count: null },
        sources: [
          { source: "reading", status: "observed" },
          { source: "bookmarks", status: "unknown", error: { code } },
          { source: "submissions", status: "observed" },
        ],
      },
    });
  },
);
it("checks permission again after revocation and does not leak a failed permission dependency", async () => {
  const read = vi.fn().mockResolvedValue(snapshot([]));
  const permission = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, allowed: true })
    .mockResolvedValueOnce({ ok: true, allowed: false })
    .mockRejectedValueOnce(new Error("sensitive account details"));
  const report = new ParticipantDiagnostics(
    { checkPermission: permission },
    { read },
    { read },
    { read },
  );
  expect(await report.read(actor, window)).toMatchObject({ ok: true });
  read.mockClear();
  expect(await report.read(actor, window)).toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
  expect(await report.read(actor, window)).toEqual({
    ok: false,
    error: { code: "dependency_unavailable" },
  });
  expect(read).not.toHaveBeenCalled();
});
it.each([
  { ...window, accountId: actor },
  { from: window.to, to: window.from },
  { from: "2026-09-01T00:00:00Z", to: "2026-10-03T00:00:00Z" },
  { from: new Date(window.from), to: new Date(window.to) },
])(
  "rejects invalid or caller-expanded intervals before authorization and private reads %#",
  async (input) => {
    const read = vi.fn();
    const permission = vi.fn();
    const report = new ParticipantDiagnostics(
      { checkPermission: permission },
      { read },
      { read },
      { read },
    );
    expect(await report.read(actor, input)).toEqual({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(await report.read("malformed", window)).toEqual({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(permission).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  },
);

it("returns unknown instead of a union when a source throws, without returning its private error", async () => {
  const good = { read: vi.fn().mockResolvedValue(snapshot([actor])) };
  const failed = {
    read: vi.fn().mockRejectedValue(new Error(`private ${actor}`)),
  };
  const report = new ParticipantDiagnostics(
    { checkPermission: vi.fn().mockResolvedValue({ ok: true, allowed: true }) },
    failed,
    good,
    good,
  );
  const result = await report.read(actor, window);
  expect(result).toMatchObject({
    ok: true,
    value: {
      membership: { status: "unknown", count: null },
      sources: [
        {
          source: "reading",
          status: "unknown",
          error: { code: "source_unavailable" },
        },
        { status: "observed" },
        { status: "observed" },
      ],
    },
  });
  expect(JSON.stringify(result)).not.toContain(actor);
});
it("keeps unavailable authorization distinct from forbidden", async () => {
  const read = vi.fn();
  const report = new ParticipantDiagnostics(
    {
      checkPermission: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "internal_error" } }),
    },
    { read },
    { read },
    { read },
  );
  expect(await report.read(actor, window)).toEqual({
    ok: false,
    error: { code: "dependency_unavailable" },
  });
  expect(read).not.toHaveBeenCalled();
});
