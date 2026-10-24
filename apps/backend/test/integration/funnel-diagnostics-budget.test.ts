import { afterEach, beforeEach, expect, it } from "vitest";
import { assembleTestFunnel } from "../fixtures/sales-funnel.js";
import { BillingProductSales } from "../../src/modules/billing/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { createQueryRowClient } from "./setup/query-rows.js";

const actor = "10000000-0000-4000-8000-000000000001";
const at = new Date("2026-10-19T10:00:00Z");
const input = { from: "2026-10-18T21:00:00Z", to: "2026-10-19T21:00:00Z" };
const id = (index: number) =>
  `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
let database: TestDatabase;
beforeEach(async () => {
  database = await createMigratedTestDatabase();
  await database.prisma.account.create({
    data: {
      id: actor,
      logtoIssuer: "https://funnel.example.test",
      logtoSubject: actor,
    },
  });
  await database.prisma.accountPermission.create({
    data: { accountId: actor, permission: "platform:admin" },
  });
});
afterEach(async () => {
  await database.dispose();
});

it.each(["journal", "sales"] as const)(
  "%s returns unknown at cap+1 relevant candidate rows",
  async (source) => {
    if (source === "journal")
      await database.prisma.salesFunnelBotEvent.createMany({
        data: Array.from({ length: 2_100 }, (_, index) => ({
          eventId: id(index + 1),
          contactRef: id(index + 1),
          kind: "bot_entered",
          sourceCode: "fixture",
          occurredAt: at,
          receivedAt: at,
        })),
      });
    else
      await database.prisma.billingPriceQuote.createMany({
        data: Array.from({ length: 2_100 }, (_, index) => ({
          id: id(index + 1),
          accountId: id(index + 1),
          operationId: id(index + 1),
          fingerprint: "fixture",
          snapshot: { offer: { coverage: { productIds: [actor] } } },
          createdAt: at,
          expiresAt: new Date("2026-10-19T11:00:00Z"),
        })),
      });
    const observer = createQueryRowClient(database.url);
    try {
      const measured = await observer.measure(async () =>
        source === "journal"
          ? await assembleTestFunnel(observer.prisma).readDiagnostics(
              actor,
              input,
            )
          : await new BillingProductSales(observer.prisma).listForDiagnostics(
              actor,
            ),
      );
      expect(measured.result).toMatchObject({
        ok: false,
        error: { code: "source_budget_exceeded" },
      });
      if (source === "journal")
        expect(measured.result).toMatchObject({ coverage: "unknown" });
      const sourceTable =
        source === "journal"
          ? "sales_funnel.bot_events"
          : "billing.price_quotes";
      const sourceReads = measured.rows.filter((row) =>
        row.statement.includes(sourceTable),
      );
      expect(sourceReads).toHaveLength(1);
      expect(sourceReads[0]?.count).toBe(2_001);
      expect(sourceReads[0]?.statement.toLowerCase()).toContain("limit");
      expect(
        measured.statements.some((statement) =>
          statement.includes("set_config('statement_timeout'"),
        ),
      ).toBe(true);
    } finally {
      await observer.prisma.$disconnect();
    }
  },
);

it("reports the complete small entry cohort despite unrelated historical bot events", async () => {
  const historicalAt = new Date("2025-01-01T10:00:00Z");
  await database.prisma.salesFunnelBotEvent.createMany({
    data: Array.from({ length: 2_100 }, (_, index) => ({
      eventId: id(index + 1),
      contactRef: id(index + 1),
      kind: "bot_entered",
      sourceCode: "historical",
      occurredAt: historicalAt,
      receivedAt: historicalAt,
    })),
  });
  await database.prisma.salesFunnelBotEvent.createMany({
    data: [
      {
        eventId: id(3001),
        contactRef: id(3001),
        kind: "bot_entered",
        sourceCode: "current",
        occurredAt: at,
        receivedAt: at,
      },
      {
        eventId: id(3002),
        contactRef: id(1),
        kind: "bot_entered",
        sourceCode: "repeat",
        occurredAt: at,
        receivedAt: at,
      },
      {
        eventId: id(3003),
        contactRef: id(3001),
        kind: "marketing_consent",
        granted: true,
        occurredAt: at,
        receivedAt: at,
      },
    ],
  });
  const result = await assembleTestFunnel(database.prisma).readDiagnostics(
    actor,
    input,
  );
  expect(result).toMatchObject({
    ok: true,
    value: { total: { entered: 1, consented: 1 } },
  });
  if (result.ok) expect(result.value.rows).toHaveLength(1);
});

it("ignores unrelated historical quotes while keeping complete selected Product first facts", async () => {
  await database.prisma.billingPriceQuote.createMany({
    data: Array.from({ length: 2100 }, (_, index) => ({
      id: id(index + 1),
      accountId: actor,
      operationId: id(index + 1),
      fingerprint: "fixture",
      snapshot: { offer: { coverage: { productIds: [id(9000)] } } },
      createdAt: new Date("2025-01-01T00:00:00Z"),
      expiresAt: at,
    })),
  });
  await database.prisma.billingPriceQuote.create({
    data: {
      id: id(3001),
      accountId: actor,
      operationId: id(3001),
      fingerprint: "selected",
      snapshot: { offer: { coverage: { productIds: [actor] } } },
      createdAt: at,
      expiresAt: new Date("2026-10-20T00:00:00Z"),
    },
  });
  await database.prisma.$executeRaw`ANALYZE billing.price_quotes`;
  const observer = createQueryRowClient(
    database.url,
    false,
    "min(quote.created_at)",
  );
  try {
    const measured = await observer.measure(() =>
      new BillingProductSales(observer.prisma).listForDiagnostics(actor),
    );
    expect(measured.result).toMatchObject({ ok: true });
    if (measured.result.ok)
      expect([...measured.result.value.checkout]).toEqual([[actor, at]]);
    expect(JSON.stringify(await observer.explainCapturedRead())).toContain(
      "price_quotes_product_coverage",
    );
  } finally {
    await observer.prisma.$disconnect();
  }
});

it("preserves Product cohorts and historical/current identity attribution beyond unrelated history", async () => {
  const productId = id(9001);
  const oldAt = new Date("2025-01-01T00:00:00Z");
  const after = new Date("2026-10-25T10:00:00Z");
  await database.prisma.product.create({
    data: { id: productId, slug: "current", name: "Current" },
  });
  await database.prisma.productChapter.create({
    data: { id: id(9002), productId, name: "Chapter", ordinal: 1 },
  });
  await database.prisma.product.createMany({
    data: Array.from({ length: 2100 }, (_, index) => ({
      id: id(10000 + index),
      slug: `archived-${index}`,
      name: "Archived",
      archivedAt: oldAt,
    })),
  });
  await database.prisma.salesFunnelBotEvent.createMany({
    data: Array.from({ length: 2100 }, (_, index) => ({
      eventId: id(20000 + index),
      contactRef: id(20000 + index),
      kind: "bot_entered",
      sourceCode: "unrelated",
      occurredAt: oldAt,
      receivedAt: oldAt,
    })),
  });
  await database.prisma.telegramAccountLinkState.createMany({
    data: Array.from({ length: 2100 }, (_, index) => ({
      accountId: id(30000 + index),
      linkRef: id(30000 + index),
      revision: 1,
      principalRef: `unrelated-${index}`,
      identityRef: `unrelated-${index}`,
      updatedAt: oldAt,
    })),
  });
  await database.prisma.billingPriceQuote.createMany({
    data: Array.from({ length: 2100 }, (_, index) => ({
      id: id(40000 + index),
      accountId: id(30000 + index),
      operationId: id(40000 + index),
      fingerprint: "history",
      snapshot: { offer: { coverage: { productIds: [id(9999)] } } },
      createdAt: oldAt,
      expiresAt: at,
    })),
  });
  await database.prisma.readingMaterialVisit.createMany({
    data: Array.from({ length: 2100 }, (_, index) => ({
      accountId: id(30000 + index),
      materialId: id(50000 + index),
      firstOpenedAt: oldAt,
      lastOpenedAt: oldAt,
    })),
  });
  await database.prisma.billingPriceQuote.createMany({
    data: Array.from({ length: 2100 }, (_, index) => ({
      id: id(90000 + index),
      accountId: id(30000 + index),
      operationId: id(90000 + index),
      fingerprint: "old-selected-Product",
      snapshot: { offer: { coverage: { productIds: [productId] } } },
      createdAt: oldAt,
      expiresAt: at,
    })),
  });
  await database.prisma.billingSurveyRespondent.createMany({
    data: Array.from({ length: 2100 }, (_, index) => ({
      username: `respondent_${index}`,
      importedAt: oldAt,
    })),
  });
  const stored = id(8001),
    resolved = id(8002),
    current = id(8003),
    outside = id(8004),
    earlierOutside = id(8005),
    shadowed = id(8006);
  await database.prisma.telegramAccountLinkState.createMany({
    data: [resolved, current].map((accountId) => ({
      accountId,
      linkRef: accountId,
      revision: 1,
      principalRef: `principal-${accountId}`,
      identityRef: `identity-${accountId}`,
      updatedAt: at,
    })),
  });
  await database.prisma.salesFunnelBotEvent.createMany({
    data: [
      {
        eventId: id(60001),
        contactRef: stored,
        kind: "bot_entered",
        sourceCode: "stored-old",
        occurredAt: oldAt,
        receivedAt: oldAt,
      },
      {
        eventId: id(60002),
        contactRef: stored,
        kind: "account_linked",
        accountId: stored,
        telegramIdentityRef: "now-unlinked",
        occurredAt: oldAt,
        receivedAt: oldAt,
      },
      {
        eventId: id(60003),
        contactRef: resolved,
        kind: "bot_entered",
        sourceCode: "resolved-old",
        occurredAt: oldAt,
        receivedAt: oldAt,
      },
      {
        eventId: id(60004),
        contactRef: resolved,
        kind: "account_linked",
        telegramIdentityRef: `identity-${resolved}`,
        occurredAt: oldAt,
        receivedAt: oldAt,
      },
      {
        eventId: id(60005),
        contactRef: current,
        kind: "bot_entered",
        sourceCode: "current",
        occurredAt: at,
        receivedAt: at,
      },
      {
        eventId: id(60006),
        contactRef: current,
        kind: "account_linked",
        telegramIdentityRef: `identity-${current}`,
        occurredAt: at,
        receivedAt: at,
      },
    ],
  });
  await database.prisma.salesFunnelBotEvent.createMany({
    data: [
      {
        eventId: id(60020),
        contactRef: id(60020),
        kind: "bot_entered",
        sourceCode: "shadow-old",
        occurredAt: oldAt,
        receivedAt: oldAt,
      },
      {
        eventId: id(60021),
        contactRef: id(60020),
        kind: "account_linked",
        accountId: shadowed,
        telegramIdentityRef: "shadow-old",
        occurredAt: oldAt,
        receivedAt: oldAt,
      },
      {
        eventId: id(60022),
        contactRef: id(60022),
        kind: "bot_entered",
        sourceCode: "current",
        occurredAt: at,
        receivedAt: at,
      },
      {
        eventId: id(60023),
        contactRef: id(60022),
        kind: "account_linked",
        accountId: shadowed,
        telegramIdentityRef: "shadow-current",
        occurredAt: at,
        receivedAt: at,
      },
    ],
  });
  const quote = async (accountId: string, createdAt: Date, offset: number) => {
    const quoteRef = id(70000 + offset);
    await database.prisma.billingPriceQuote.create({
      data: {
        id: quoteRef,
        accountId,
        operationId: quoteRef,
        fingerprint: "selected",
        snapshot: { offer: { coverage: { productIds: [productId] } } },
        createdAt,
        expiresAt: after,
      },
    });
    return quoteRef;
  };
  await quote(stored, at, 1);
  await quote(resolved, at, 2);
  await quote(shadowed, at, 3);
  for (const [index, accountId] of [
    current,
    outside,
    earlierOutside,
  ].entries()) {
    const quoteRef = await quote(
      accountId,
      accountId === earlierOutside ? oldAt : at,
      10 + index,
    );
    await database.prisma.billingPurchase.create({
      data: {
        id: id(80000 + index),
        accountId,
        quoteRef,
        kind: "one_time",
        lifecycleActive: false,
        state: "confirmed",
        environment: "test",
        terminalRef: "test",
        paymentId: `test-${index}`,
        amountKopecks: 100n,
        snapshot: { offer: { coverage: { productIds: [productId] } } },
        acceptance: {},
        contact: {},
        fiscalization: "pending",
        confirmedAt: accountId === current ? after : at,
        createdAt: at,
        updatedAt: at,
      },
    });
  }
  const result = await assembleTestFunnel(database.prisma).readDiagnostics(
    actor,
    { ...input, productId, limit: 1 },
  );
  expect(result).toMatchObject({
    ok: true,
    value: {
      total: {
        entered: 2,
        consented: 0,
        openedChapter: 0,
        checkout: 2,
        paid: 2,
      },
      surveyRespondents: { uploaded: 2100, issued: 0, paid: 0 },
      freshness: { status: "not_proven" },
    },
  });
  if (result.ok) {
    expect(result.value.rows).toHaveLength(1);
    expect(result.value.nextCursor).not.toBeNull();
    const next = await assembleTestFunnel(database.prisma).readDiagnostics(
      actor,
      { ...input, productId, limit: 1, cursor: result.value.nextCursor },
    );
    expect(next).toMatchObject({
      ok: true,
      value: {
        total: result.value.total,
        rows: [
          { source: { kind: "outside_bot" }, counts: { checkout: 1, paid: 1 } },
        ],
      },
    });
  }
});

it("bounds first-open candidates by the Product materials and their first-date window", async () => {
  const materialId = id(9500),
    currentAccount = id(9501);
  await database.prisma.readingMaterialVisit.createMany({
    data: Array.from({ length: 2100 }, (_, index) => ({
      accountId: id(10000 + index),
      materialId,
      firstOpenedAt: new Date("2025-01-01T00:00:00Z"),
      lastOpenedAt: at,
    })),
  });
  await database.prisma.readingMaterialVisit.create({
    data: {
      accountId: currentAccount,
      materialId,
      firstOpenedAt: at,
      lastOpenedAt: at,
    },
  });
  const owner = new (
    await import("../../src/modules/reading-activity/index.js")
  ).MaterialFirstOpens(database.prisma);
  const candidates = await owner.listForDiagnostics([materialId], {
    from: new Date(input.from),
    to: new Date(input.to),
  });
  expect(candidates).toMatchObject({ ok: true });
  if (candidates.ok)
    expect([...candidates.value]).toEqual([[currentAccount, at]]);
  const full = await owner.listForDiagnostics([materialId], {
    accountIds: [id(10000)],
  });
  expect(full).toMatchObject({ ok: true });
  if (full.ok)
    expect(full.value.get(id(10000))).toEqual(new Date("2025-01-01T00:00:00Z"));
});

it("keeps waitlist demand in the owner report without reading or publishing it in bounded diagnostics", async () => {
  const productId = id(9801);
  const intakeId = id(9802);
  await database.prisma.product.create({
    data: { id: productId, slug: "waitlist-boundary", name: "Waitlist" },
  });
  await database.prisma.productWaitlistIntake.create({
    data: {
      id: intakeId,
      productId,
      name: "Owner-only intake",
      accepting: true,
    },
  });
  const observer = createQueryRowClient(database.url);
  try {
    const funnel = assembleTestFunnel(observer.prisma);
    const diagnostic = await observer.measure(() =>
      funnel.readDiagnostics(actor, { ...input, productId }),
    );
    expect(diagnostic.result).toMatchObject({ ok: true });
    expect(diagnostic.result).not.toHaveProperty("value.waitlist");
    expect(
      diagnostic.statements.some((statement) =>
        statement.includes("product_waitlist"),
      ),
    ).toBe(false);
    expect(
      await funnel.readReport(actor, { ...input, productId }),
    ).toMatchObject({
      ok: true,
      value: { waitlist: { intakeId, name: "Owner-only intake", active: 0 } },
    });
  } finally {
    await observer.prisma.$disconnect();
  }
});
