import { z } from "zod";
import { funnelDiagnosticDatabase } from "../fixtures/funnel-diagnostics-database.js";
import { expect, it } from "vitest";
import { assembleTestFunnel } from "../fixtures/sales-funnel.js";
import { diagnosticDatabase } from "../fixtures/payment-diagnostics-database.js";

const actor = "10000000-0000-4000-8000-000000000001";
const input = { from: "2026-10-18T21:00:00Z", to: "2026-10-19T21:00:00Z" };
it("denies a non-admin diagnostic actor before any report sources are read", async () => {
  const funnel = assembleTestFunnel(
    diagnosticDatabase({ permissionGranted: false }),
  );
  expect(await funnel.readDiagnostics(actor, input)).toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
});

it("stops an overflowing relevant catalog composition before report aggregation and returns unknown", async () => {
  const { prisma, queries, guards } = funnelDiagnosticDatabase({
    sourceRows: { productProgrammePlacement: 2_001 },
  });
  const funnel = assembleTestFunnel(prisma);
  expect(await funnel.readDiagnostics(actor, input)).toMatchObject({
    ok: false,
    coverage: "unknown",
    error: { code: "source_budget_exceeded" },
  });
  expect(guards).toContainEqual({
    table: "productProgrammePlacement",
    take: 2_001,
  });
  expect(queries.filter((query) => !query.includes("set_config"))).toEqual([]);
});

it("paginates source rows while preserving the existing whole-cohort totals and filter-bound continuation", async () => {
  const { prisma } = funnelDiagnosticDatabase({
    contacts: ["b", "a", null].map((source_code) => ({
      source_code,
      entered_at: new Date("2026-10-19T10:00:00Z"),
      consented_at: null,
      account_id: null,
      telegram_identity_ref: null,
    })),
  });
  const funnel = assembleTestFunnel(prisma);
  const first = await funnel.readDiagnostics(actor, { ...input, limit: 1 });
  expect(first).toMatchObject({
    ok: true,
    value: {
      totalScope: "bounded_cohort",
      total: { entered: 3 },
      coverage: "paginated",
      rows: [{ source: { kind: "label", code: "a" }, counts: { entered: 1 } }],
    },
  });
  const cursor = z
    .object({ value: z.object({ nextCursor: z.string() }) })
    .parse(first).value.nextCursor;
  const second = await funnel.readDiagnostics(actor, {
    ...input,
    limit: 2,
    cursor,
  });
  expect(second).toMatchObject({
    ok: true,
    value: {
      rows: [
        { source: { kind: "label", code: "b" } },
        { source: { kind: "unlabelled" } },
      ],
      nextCursor: null,
      total: { entered: 3 },
    },
  });
  expect(
    await funnel.readDiagnostics(actor, {
      ...input,
      to: "2026-10-20T21:00:00Z",
      cursor,
    }),
  ).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  const legacy = await funnel.readReport(actor, input);
  expect(legacy).toMatchObject({
    ok: true,
    value: {
      total: { entered: 3 },
      rows: [
        { source: { kind: "label", code: "a" } },
        { source: { kind: "label", code: "b" } },
        { source: { kind: "unlabelled" } },
      ],
    },
  });
});

it("returns source failure and unknown instead of a zero funnel when a prerequisite is unavailable", async () => {
  const { prisma } = funnelDiagnosticDatabase({ failTable: "product" });
  expect(
    await assembleTestFunnel(prisma).readDiagnostics(actor, input),
  ).toMatchObject({
    ok: false,
    coverage: "unknown",
    error: { code: "dependency_unavailable" },
  });
});

it("leaves bot counts and source freshness unknown before any bot receipt exists", async () => {
  const { prisma } = funnelDiagnosticDatabase({ lastReceivedAt: null });
  expect(
    await assembleTestFunnel(prisma).readDiagnostics(actor, input),
  ).toMatchObject({
    ok: true,
    value: {
      coverage: "partial",
      total: { entered: null, consented: null },
      freshness: { status: "not_proven", lastBotEventReceivedAt: null },
    },
  });
});

it("does not accept an actor, permission or source-budget override in public input", async () => {
  const funnel = assembleTestFunnel(diagnosticDatabase());
  for (const override of [
    { actorId: actor },
    { permission: "platform:admin" },
    { sourceBudget: 100_000 },
  ])
    expect(
      await funnel.readDiagnostics(actor, { ...input, ...override }),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });
});

it("returns an empty source page without continuation even when the requested limit is positive", async () => {
  const { prisma } = funnelDiagnosticDatabase();
  expect(
    await assembleTestFunnel(prisma).readDiagnostics(actor, {
      ...input,
      limit: 50,
    }),
  ).toMatchObject({ ok: true, value: { rows: [], nextCursor: null } });
});
