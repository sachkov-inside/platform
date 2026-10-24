import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import {
  declaredServer,
  type DeclaredServer,
} from "../support/declared-api.js";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createQueryEventClient } from "./setup/query-events.js";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { assembleTestBillingPricing } from "./setup/billing-pricing.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let app: NestFastifyApplication | undefined;
let server: DeclaredServer;
let database: TestDatabase;
let observer: ReturnType<typeof createQueryEventClient>;
const productId = (ordinal: number) =>
  `47000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
beforeAll(async () => {
  database = await createMigratedTestDatabase();
  observer = createQueryEventClient(database.url);
  await database.prisma.billingProductSalesState.createMany({
    data: Array.from({ length: 101 }, (_, index) => ({
      productId: productId(index + 1),
      revision: 1,
      name: `Cohort ${String(index + 1)}`,
      stage: "preorder",
      startsOn: new Date("2026-11-01T00:00:00.000Z"),
      nextEvent: "Launch",
    })),
  });
  await database.prisma.product.createMany({
    data: Array.from({ length: 101 }, (_, index) => ({
      id: productId(index + 1),
      slug: productId(index + 1),
      name: "Owner Product",
    })),
  });
  await database.prisma.billingProductPrice.createMany({
    data: Array.from({ length: 101 }, (_, index) => ({
      productId: productId(index + 1),
      revision: 1,
      name: "Owner Product",
      priceKopecks: 10000n,
      published: false,
      updatedAt: new Date("2026-10-14T00:00:00Z"),
    })),
  });
  app = await createApiApplication(
    parsePlatformConfig({ NODE_ENV: "test", DATABASE_URL: database.url }),
    { logger: false },
  );
  await app.init();
  server = declaredServer(app.getHttpAdapter().getInstance());
  await server.ready();
});
afterAll(async () => {
  await app?.close();
  await observer.prisma.$disconnect();
  await database.dispose();
});

test("a Product beyond the global hundred-row page retains its true scoped cohort", async () => {
  const accounts = assembleAccounts({
    prisma: observer.prisma,
    emailFingerprintKey: "cohort-test-key-00000000000000000000",
  });
  const billing = assembleTestBillingPricing({
    prisma: observer.prisma,
    accounts,
    clock: () => new Date("2026-10-14T00:00:00.000Z"),
    sale: { payments: true },
  });
  const legacy = await observer.measure(() => billing.cohorts());
  expect(legacy.statements).toHaveLength(1);
  if (!legacy.result.ok) throw new Error(legacy.result.error.code);
  expect(legacy.result.value.items).toHaveLength(100);
  expect(legacy.result.value.nextCursor).toBe(productId(100));
  const continuation = await observer.measure(() =>
    billing.cohorts(undefined, productId(100)),
  );
  expect(continuation.statements).toHaveLength(1);
  expect(continuation.result).toMatchObject({
    ok: true,
    value: { items: [{ productId: productId(101) }], nextCursor: null },
  });
  const measured = await observer.measure(() =>
    billing.cohorts(productId(101)),
  );
  expect(measured.statements).toHaveLength(1);
  const result = measured.result;
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  expect(result.value.items).toEqual([
    {
      productId: productId(101),
      revision: 1,
      name: "Cohort 101",
      stage: "preorder",
      startsOn: "2026-11-01",
      nextEvent: "Launch",
      priceAfterStartKopecks: null,
    },
  ]);
  expect(await billing.cohorts(productId(1000))).toMatchObject({
    ok: true,
    value: { items: [] },
  });
  expect(await billing.cohorts("invalid")).toMatchObject({
    ok: false,
    error: { code: "invalid_request" },
  });
});

test("HTTP scope and continuation preserve the strict products.v1 bot response", async () => {
  const scoped = await server.inject({
    method: "GET",
    url: `/billing/cohorts?productId=${productId(101)}`,
  });
  expect(scoped.statusCode).toBe(200);
  expect(scoped.json()).toMatchObject({
    items: [{ productId: productId(101), name: "Cohort 101" }],
    nextCursor: null,
  });
  const first = await server.inject({ method: "GET", url: "/billing/cohorts" });
  expect(first.statusCode).toBe(200);
  expect(first.json()).toMatchObject({ nextCursor: productId(100) });
  const continuation = await server.inject({
    method: "GET",
    url: `/billing/cohorts?cursor=${productId(100)}`,
  });
  expect(continuation.json()).toMatchObject({
    items: [{ productId: productId(101) }],
    nextCursor: null,
  });
  const bot = await server.inject({
    method: "GET",
    url: `/billing/cohorts?productId=${productId(101)}`,
    headers: { "x-inside-domain-names": "products.v1" },
  });
  expect(bot.statusCode).toBe(200);
  expect(bot.json()).toEqual({
    items: [
      {
        productId: productId(101),
        revision: 1,
        name: "Cohort 101",
        stage: "preorder",
        startsOn: "2026-11-01",
        nextEvent: "Launch",
      },
    ],
  });
  for (const query of [
    "productId=invalid",
    `productId=${productId(101)}&cursor=${productId(100)}`,
  ]) {
    expect(
      (await server.inject({ method: "GET", url: `/billing/cohorts?${query}` }))
        .statusCode,
    ).toBe(400);
  }
});

test("owner catalogue cursor pages every Product price without skipping or repeating Products", async () => {
  const accounts = assembleAccounts({
    prisma: observer.prisma,
    emailFingerprintKey: "owner-catalog-key-00000000000000000000",
  });
  const billing = assembleTestBillingPricing({
    prisma: observer.prisma,
    accounts,
    clock: () => new Date("2026-10-14T00:00:00.000Z"),
    sale: { payments: true },
  });
  const first = await observer.measure(() =>
    billing.ownerCatalog({ limit: 100 }),
  );
  expect(first.result.ok).toBe(true);
  if (!first.result.ok) throw new Error(first.result.error.code);
  expect(first.result.value.items).toHaveLength(100);
  const cursor = first.result.value.nextCursor;
  expect(cursor).toBe(productId(100));
  const second = await observer.measure(() =>
    billing.ownerCatalog({ limit: 100, cursor }),
  );
  expect(second.result.ok).toBe(true);
  if (!second.result.ok) throw new Error(second.result.error.code);
  expect(second.result.value.items).toHaveLength(1);
  expect(second.result.value.items[0]?.paymentOption.id).toBe(productId(101));
  expect(second.result.value.nextCursor).toBeNull();
  process.stdout.write(
    `${JSON.stringify({ record: "PAG05", firstStatements: first.statements.length, secondStatements: second.statements.length, ownerCalls: 2, providerRequests: 0 })}\n`,
  );
});

test("Product Sales State has its own public read without changing staged prices by calendar", async () => {
  const response = await server.inject({
    method: "GET",
    url: `/billing/product-sales-states?productId=${productId(101)}`,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    items: [
      {
        productId: productId(101),
        revision: 1,
        name: "Cohort 101",
        stage: "preorder",
        startsOn: "2026-11-01",
        nextEvent: "Launch",
        priceAfterStartKopecks: null,
      },
    ],
    nextCursor: null,
  });
  expect(
    await database.prisma.billingProductPrice.findUniqueOrThrow({
      where: { productId: productId(101) },
    }),
  ).toMatchObject({ revision: 1, priceKopecks: 10000n, published: false });
});

test("canonical Product price scope selects one identity and rejects conflicting legacy capability", async () => {
  const billing = assembleTestBillingPricing({
    prisma: observer.prisma,
    accounts: assembleAccounts({
      prisma: observer.prisma,
      emailFingerprintKey: "scope-test-key-00000000000000000000",
    }),
    sale: { payments: true },
  });
  const scoped = await billing.ownerCatalog({
    productId: productId(101),
    limit: 50,
  });
  expect(scoped).toMatchObject({
    ok: true,
    value: { items: [{ product: { id: productId(101) } }], nextCursor: null },
  });
  if (!scoped.ok) throw new Error(scoped.error.code);
  expect(scoped.value.items).toHaveLength(1);
  expect(
    await billing.ownerCatalog({
      productId: productId(101),
      capability: `product:${productId(1)}`,
    }),
  ).toEqual({ ok: false, error: { code: "invalid_request" } });
  const publicRead = await server.inject({
    method: "GET",
    url: `/billing/product-prices?productId=${productId(101)}`,
  });
  expect(publicRead.statusCode).toBe(200);
  expect(publicRead.json()).toEqual({ items: [], nextCursor: null });
});
