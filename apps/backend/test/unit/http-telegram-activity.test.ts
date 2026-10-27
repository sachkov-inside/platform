import { expect, it, vi } from "vitest";
import { HttpTelegramActivity } from "../../src/modules/telegram-membership/infrastructure/http/http-telegram-activity.js";
const window = {
  from: "2026-10-19T00:00:00.000Z",
  to: "2026-10-20T00:00:00.000Z",
};
const secret = "synthetic_platform_activity_secret_32";
function body() {
  return {
    ok: true,
    value: {
      contractVersion: "inside.telegram-activity.v1",
      window,
      asOf: window.to,
      coverage: {
        status: "partial",
        collectionStartedAt: window.from,
        continuity: "not_proven",
        retentionFrom: "2025-10-20T00:00:00.000Z",
      },
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
      accountIds: [],
      unlinkedContacts: 0,
    },
  };
}
it("calls only the authenticated owner route and validates the captured body and matching window", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(body()));
  expect(
    await new HttpTelegramActivity(
      "http://telegram.test/integrations/platform/v1/identity-links",
      secret,
      fetcher,
    ).read(window),
  ).toMatchObject({ ok: true, value: { unlinkedContacts: 0 } });
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    new URL(
      "http://telegram.test/integrations/platform/v1/participant-activity",
    ),
    expect.objectContaining({
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contractVersion: "inside.telegram-activity.v1",
        ...window,
      }),
    }),
  );
});
it.each([401, 403, 404, 500])(
  "does not treat HTTP%s as observed zero",
  async (status) => {
    expect(
      await new HttpTelegramActivity(
        "http://telegram.test/identity-links",
        secret,
        vi.fn().mockResolvedValue(Response.json(body(), { status })),
      ).read(window),
    ).toEqual({ ok: false, error: { code: "source_unavailable" } });
  },
);
it.each(["malformed", "wrong-window", "oversize", "private-fields"])(
  "refuses %s owner responses without returning private data",
  async (kind) => {
    const raw = body();
    if (kind === "wrong-window")
      raw.value.window = { ...window, from: "2026-10-18T00:00:00Z" };
    const response =
      kind === "malformed"
        ? new Response("private not json")
        : kind === "oversize"
          ? new Response("x".repeat(524289))
          : kind === "private-fields"
            ? Response.json({ ...raw, telegramUserId: "private" })
            : Response.json(raw);
    const result = await new HttpTelegramActivity(
      "http://telegram.test/identity-links",
      secret,
      vi.fn().mockResolvedValue(response),
    ).read(window);
    expect(result).toEqual({
      ok: false,
      error: { code: "source_unavailable" },
    });
  },
);

it.each([
  "negative-lag",
  "missing-oldest",
  "wrong-cutoff",
  "future-clock",
  "wrong-budget",
  "false-healthy",
])("refuses incoherent cleanup diagnostic %s as unknown", async (fault) => {
  const raw = body();
  const cleanup: Record<string, unknown> = {
    ...raw.value.cleanup,
    oldestExpiredAt: "2025-10-18T00:00:00.000Z",
    lagSeconds: 172800,
    withinBudget: false,
  };
  const changed = { ...raw, value: { ...raw.value, cleanup } };
  if (fault === "negative-lag") changed.value.cleanup["lagSeconds"] = -1;
  if (fault === "missing-oldest")
    changed.value.cleanup = { ...cleanup, oldestExpiredAt: null };
  if (fault === "wrong-cutoff")
    changed.value.cleanup["cutoff"] = "2025-10-21T00:00:00.000Z";
  if (fault === "future-clock")
    changed.value.cleanup["asOf"] = "2026-10-21T00:00:00.000Z";
  if (fault === "wrong-budget") changed.value.cleanup["budgetSeconds"] = 172800;
  if (fault === "false-healthy") changed.value.cleanup["withinBudget"] = true;
  expect(
    await new HttpTelegramActivity(
      "http://telegram.test/identity-links",
      secret,
      vi.fn().mockResolvedValue(Response.json(changed)),
    ).read(window),
  ).toEqual({ ok: false, error: { code: "source_unavailable" } });
});

it.each([
  ["2025-10-19T00:00:00.000Z", 86400, true],
  ["2025-10-18T23:59:59.999Z", 86400.001, false],
] as const)(
  "preserves the measured 24-hour cleanup boundary at %s",
  async (oldestExpiredAt, lagSeconds, withinBudget) => {
    const raw = body();
    const value = {
      ...raw.value,
      cleanup: {
        ...raw.value.cleanup,
        oldestExpiredAt,
        lagSeconds,
        withinBudget,
      },
    };
    expect(
      await new HttpTelegramActivity(
        "http://telegram.test/identity-links",
        secret,
        vi.fn().mockResolvedValue(Response.json({ ...raw, value })),
      ).read(window),
    ).toMatchObject({
      ok: true,
      value: { cleanup: { oldestExpiredAt, lagSeconds, withinBudget } },
    });
  },
);
