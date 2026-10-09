import { expect, it, vi } from "vitest";
import { WebTelemetry } from "../../src/modules/web-telemetry/index.js";

it("rejects visitor identifiers before reaching persistence", async () => {
  const query = vi.fn();
  const telemetry = new WebTelemetry({
    prisma: { $queryRaw: query, $executeRaw: vi.fn() },
    accounts: {
      checkPermission: () => Promise.resolve({ ok: true, allowed: false }),
    },
    clock: () => new Date("2026-10-09T12:00:00Z"),
  });
  expect(
    await telemetry.record({
      kind: "vitals",
      route: "/",
      mobile: false,
      accountId: "private",
      metrics: [{ name: "LCP", value: 1 }],
    }),
  ).toEqual({ ok: false, error: { code: "invalid_input" } });
  expect(query).not.toHaveBeenCalled();
});
