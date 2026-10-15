import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  accountId,
  assembleAccounts,
} from "../../src/modules/accounts/index.js";
import {
  assembleAccessGrants,
  assembleAccountRights,
} from "../../src/modules/account-rights/index.js";
import {
  assembleContentAccess,
  assembleCurrentAccountPermissions,
  anonymousSubject,
} from "../../src/modules/content-access/index.js";
import {
  assembleMaterials,
  assembleMaterialResourceFacts,
  ProductDirectory,
  PublishedSeriesComposition,
} from "../../src/modules/materials/index.js";
import { readProductSaleAvailability } from "../../src/modules/content-library/features/read-product-sale-availability/read-product-sale-availability.js";
import { assembleTestBillingPricing } from "./setup/billing-pricing.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";
import { createQueryEventClient } from "./setup/query-events.js";

const instant = new Date("2030-01-01T00:00:00.000Z");
function clock() {
  return new Date(instant);
}
async function fixture(size: number) {
  const database = await createMigratedTestDatabase();
  const measured = createQueryEventClient(database.url);
  try {
    const products = Array.from({ length: size }, () => randomUUID());
    const archivedProducts = Array.from({ length: size }, () => randomUUID());
    const archived = archivedProducts[0];
    if (archived === undefined)
      throw new Error("Missing archived Product fixture");
    const missing = randomUUID();
    const holder = randomUUID();
    const other = randomUUID();
    await database.prisma.account.createMany({
      data: [holder, other].map((id) => ({
        id,
        logtoIssuer: "https://identity.example.test/oidc",
        logtoSubject: id,
      })),
    });
    await database.prisma.product.createMany({
      data: [
        ...products.map((id) => ({
          id,
          slug: `sale-${id}`,
          name: "Current Product",
        })),
        ...archivedProducts.map((id) => ({
          id,
          slug: `sale-${id}`,
          name: "Archived Product",
          archivedAt: instant,
        })),
      ],
    });
    const offerProducts = [...products, archived].map((productId) => ({
      productId,
      offerId: randomUUID(),
    }));
    await database.prisma.billingOffer.createMany({
      data: offerProducts.map(({ productId, offerId }) => ({
        id: offerId,
        revision: 1,
        name: "Admitted sale",
        benefits: [`product:${productId}`, "support"],
        benefitPeriods: [{ capability: "support", months: 1 }],
        published: true,
      })),
    });
    await database.prisma.billingPaymentOption.createMany({
      data: offerProducts.map(({ offerId }) => ({
        id: randomUUID(),
        offerId,
        revision: 1,
        months: 1,
        mode: "one_time",
        priceKopecks: 10000n,
      })),
    });
    const accounts = assembleAccounts({
      prisma: measured.prisma,
      emailFingerprintKey: "reader-sale-visibility-fixture-key",
    });
    const grants = assembleAccessGrants({
      prisma: database.prisma,
      accounts,
      clock,
    });
    const applied = await grants.applyPaidPeriod({
      eventRef: randomUUID(),
      periodRef: randomUUID(),
      accountId: holder,
      revision: 1,
      revoked: false,
      terms: {
        capabilities: archivedProducts.map((id) => `product:${id}` as const),
        startsAt: instant.toISOString(),
        validUntil: "2030-02-01T00:00:00.000Z",
        reason: "Paid archived Product fixture",
      },
    });
    if (!applied.ok) throw new Error(applied.error.code);
    const materialOwner = assembleMaterials({
      prisma: measured.prisma,
      authorPolicy: { canManage: () => false },
    });
    const contentAccess = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(
        materialOwner.materialContent,
      ),
      accountPermissions: assembleCurrentAccountPermissions(accounts),
      accountRights: assembleAccountRights({ prisma: measured.prisma, clock }),
      clock,
    });
    const dependencies = {
      directory: new ProductDirectory(measured.prisma),
      pricing: assembleTestBillingPricing({
        prisma: measured.prisma,
        accounts,
        clock,
        sale: { payments: true, subscriptions: true },
      }),
      contentAccess,
    };
    return {
      database,
      grants,
      measured,
      dependencies,
      products,
      archived,
      archivedProducts,
      missing,
      holder,
      other,
      async dispose() {
        await measured.prisma.$disconnect();
        await database.dispose();
      },
    };
  } catch (error) {
    await measured.prisma.$disconnect();
    await database.dispose();
    throw error;
  }
}

describe.each([1, 10, 100])(
  "reader Product visibility at %i memberships",
  (size) => {
    let corpus: Awaited<ReturnType<typeof fixture>>;
    beforeAll(async () => {
      corpus = await fixture(size);
    });
    afterAll(async () => {
      await corpus.dispose();
    });
    test("batches archive Product access for one holder without sharing rights with another Account", async () => {
      const reader = {
        subject: {
          kind: "account" as const,
          accountId: accountId(corpus.holder),
        },
        contentAccess: corpus.dependencies.contentAccess,
      };
      const original = new PublishedSeriesComposition(corpus.measured.prisma);
      const originalRead = await corpus.measured.measure(() =>
        Promise.all(
          corpus.archivedProducts.map((id) => original.read(id, reader)),
        ),
      );
      expect(originalRead.result.every((item) => item.ok)).toBe(true);
      const single = await corpus.measured.measure(() =>
        corpus.dependencies.directory.readerVisibleIds(
          [corpus.archived],
          reader,
        ),
      );
      const batch = await corpus.measured.measure(() =>
        corpus.dependencies.directory.readerVisibleIds(
          corpus.archivedProducts,
          reader,
        ),
      );
      expect(batch.result).toEqual({
        ok: true,
        value: corpus.archivedProducts,
      });
      process.stdout.write(
        `${JSON.stringify({
          record: "FLOW05",
          archiveProducts: size,
          originalStatements: originalRead.statements.length,
          originalSelects: originalRead.statements.filter((sql) =>
            /^\s*SELECT\b/iu.test(sql),
          ).length,
          singleStatements: single.statements.length,
          batchStatements: batch.statements.length,
          singleSelects: single.statements.filter((sql) =>
            /^\s*SELECT\b/iu.test(sql),
          ).length,
          batchSelects: batch.statements.filter((sql) =>
            /^\s*SELECT\b/iu.test(sql),
          ).length,
          batchNonSelects: batch.statements.filter(
            (sql) => !/^\s*SELECT\b/iu.test(sql),
          ),
          providerRequests: 0,
        })}\n`,
      );
      expect(batch.statements).toHaveLength(single.statements.length);
      expect(
        await corpus.dependencies.directory.readerVisibleIds(
          corpus.archivedProducts,
          {
            ...reader,
            subject: { kind: "account", accountId: accountId(corpus.other) },
          },
        ),
      ).toEqual({ ok: true, value: [] });
    });
    test("uses bounded current Product facts instead of full programme assembly", async () => {
      const read = await corpus.measured.measure(() =>
        readProductSaleAvailability(
          corpus.dependencies,
          { productIds: corpus.products },
          anonymousSubject,
        ),
      );
      expect(read.result).toEqual({
        ok: true,
        value: {
          items: corpus.products.map((productId) => ({
            productId,
            sold: true,
          })),
        },
      });
      expect(
        read.statements.filter((sql) => /^\s*SELECT\b/iu.test(sql)),
      ).toHaveLength(4);
    });
    test("does not invite a guest to an archived or nonexistent Product even with an active price", async () => {
      expect(
        await readProductSaleAvailability(
          corpus.dependencies,
          { productIds: [corpus.archived, corpus.missing] },
          anonymousSubject,
        ),
      ).toEqual({
        ok: true,
        value: {
          items: [
            { productId: corpus.archived, sold: false },
            { productId: corpus.missing, sold: false },
          ],
        },
      });
    });
    test("keeps the archived programme gate for the active holder and denies another Account", async () => {
      expect(
        await readProductSaleAvailability(
          corpus.dependencies,
          { productIds: [corpus.archived] },
          { kind: "account", accountId: accountId(corpus.holder) },
        ),
      ).toEqual({
        ok: true,
        value: { items: [{ productId: corpus.archived, sold: true }] },
      });
      expect(
        await readProductSaleAvailability(
          corpus.dependencies,
          { productIds: [corpus.archived] },
          { kind: "account", accountId: accountId(corpus.other) },
        ),
      ).toEqual({
        ok: true,
        value: { items: [{ productId: corpus.archived, sold: false }] },
      });
    });
  },
);

describe("reader Product composition policy", () => {
  let corpus: Awaited<ReturnType<typeof fixture>>;
  let oversized: string;
  beforeAll(async () => {
    corpus = await fixture(1);
    oversized = randomUUID();
    await corpus.database.prisma.product.create({
      data: {
        id: oversized,
        slug: `oversized-${oversized}`,
        name: "Oversized Product",
      },
    });
    const materialIds = Array.from({ length: 10_001 }, () => randomUUID());
    for (let start = 0; start < materialIds.length; start += 500) {
      const chunk = materialIds.slice(start, start + 500);
      await corpus.database.prisma.material.createMany({
        data: chunk.map((id) => ({
          id,
          createdBy: corpus.holder,
          access: "free",
          publicationState: "draft",
          schemaVersion: 1,
          body: { type: "doc", content: [] },
          contentVersion: 1n,
        })),
      });
      await corpus.database.prisma.productMembership.createMany({
        data: chunk.map((materialId, index) => ({
          seriesId: oversized,
          materialId,
          ordinal: start + index + 1,
        })),
      });
    }
  });
  afterAll(async () => {
    await corpus.dispose();
  });
  test("keeps an empty current programme visible and applies the existing 10000-placement bound", async () => {
    const read = await corpus.measured.measure(() =>
      corpus.dependencies.directory.readerVisibleIds(
        [corpus.products[0] ?? "", oversized],
        {
          subject: anonymousSubject,
          contentAccess: corpus.dependencies.contentAccess,
        },
      ),
    );
    expect(read.result).toEqual({ ok: true, value: corpus.products });
    expect(
      read.statements.filter((sql) => /^\s*SELECT\b/iu.test(sql)),
    ).toHaveLength(1);
  });
});

describe("reader archive gate with current Product exclusions", () => {
  let corpus: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    corpus = await fixture(2);
    await corpus.database.prisma.accountPermission.create({
      data: { accountId: corpus.holder, permission: "platform:admin" },
    });
    const preview = await corpus.grants.previewProductRevocation(
      corpus.holder,
      { accountId: corpus.holder, productId: corpus.archived },
    );
    if (!preview.ok) throw new Error(preview.error.code);
    const revoked = await corpus.grants.revokeProductAccess(corpus.holder, {
      operationId: randomUUID(),
      accountId: corpus.holder,
      productId: corpus.archived,
      expectedRevision: preview.value.revision,
      reason: "Exclude one archived Product for this Account only",
    });
    if (!revoked.ok) throw new Error(revoked.error.code);
    const otherGrant = await corpus.grants.applyPaidPeriod({
      eventRef: randomUUID(),
      periodRef: randomUUID(),
      accountId: corpus.other,
      revision: 1,
      revoked: false,
      terms: {
        capabilities: [`product:${corpus.archived}`],
        startsAt: instant.toISOString(),
        validUntil: "2030-02-01T00:00:00.000Z",
        reason: "Independent holder of the same archived Product",
      },
    });
    if (!otherGrant.ok) throw new Error(otherGrant.error.code);
  });
  afterAll(async () => {
    await corpus.dispose();
  });
  test("matches the original programme gate for archive, missing and empty Products after an Account-scoped exclusion", async () => {
    const original = new PublishedSeriesComposition(corpus.measured.prisma);
    const ids = [
      ...corpus.products,
      ...corpus.archivedProducts,
      corpus.missing,
    ];
    for (const subject of [
      anonymousSubject,
      { kind: "account" as const, accountId: accountId(corpus.holder) },
      { kind: "account" as const, accountId: accountId(corpus.other) },
    ]) {
      const reader = {
        subject,
        contentAccess: corpus.dependencies.contentAccess,
      };
      const expected: string[] = [];
      for (const id of ids)
        if ((await original.read(id, reader)).ok) expected.push(id);
      expect(
        await corpus.dependencies.directory.readerVisibleIds(ids, reader),
      ).toEqual({ ok: true, value: expected });
    }
    expect(
      await readProductSaleAvailability(
        corpus.dependencies,
        { productIds: [corpus.archived] },
        { kind: "account", accountId: accountId(corpus.holder) },
      ),
    ).toEqual({
      ok: true,
      value: { items: [{ productId: corpus.archived, sold: false }] },
    });
    expect(
      await readProductSaleAvailability(
        corpus.dependencies,
        { productIds: [corpus.archived] },
        { kind: "account", accountId: accountId(corpus.other) },
      ),
    ).toEqual({
      ok: true,
      value: { items: [{ productId: corpus.archived, sold: true }] },
    });
  });
});
