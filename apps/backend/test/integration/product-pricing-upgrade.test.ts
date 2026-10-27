import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test } from "vitest";
import { BillingPricing } from "../../src/modules/billing/index.js";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import { createTestDatabase } from "./setup/test-database.js";
import { migrateBefore, upgradeToLatest } from "./setup/historical-upgrade.js";

test("Product price rollout pauses legacy publication and intersects restricted Promotion scopes without widening or rewriting source facts", async () => {
  const db = await createTestDatabase();
  const pool = new Pool({ connectionString: db.url, max: 1 });
  try {
    await migrateBefore(db, "0108_product_prices");
    const productA = randomUUID(),
      productB = randomUUID(),
      offerA = randomUUID(),
      offerB = randomUUID(),
      optionA = randomUUID(),
      optionB = randomUUID();
    for (const id of [productA, productB])
      await pool.query(
        "insert into products.series(id,slug,name) values($1::uuid,$1::text,'Historical Product')",
        [id],
      );
    for (const row of [
      { id: offerA, product: productA, option: optionA },
      { id: offerB, product: productB, option: optionB },
    ]) {
      await pool.query(
        "insert into billing.offers(id,name,benefits,published,revision) values($1,'Historical price',$2,true,7)",
        [row.id, [`product:${row.product}`]],
      );
      await pool.query(
        "insert into billing.payment_options(id,offer_id,revision,months,price_kopecks,mode) values($1,$2,2,1,200000,'one_time')",
        [row.option, row.id],
      );
    }
    const intersection = randomUUID(),
      unrestricted = randomUUID(),
      unresolved = randomUUID();
    for (const row of [
      { id: intersection, offers: [offerA, offerB], options: [optionA] },
      { id: unrestricted, offers: [], options: [] },
      { id: unresolved, offers: [offerA], options: [optionB] },
    ]) {
      await pool.query(
        "insert into billing.promotions(id,revision,name,percent,starts_at,ends_at,offer_ids,payment_option_ids,code) values($1,3,'Historical promotion',20,'2020-01-01','2040-01-01',$2,$3,$4)",
        [
          row.id,
          row.offers,
          row.options,
          row.id === unrestricted ? "global-code" : null,
        ],
      );
    }
    const originals = await pool.query(
      "select to_jsonb(o) as row from billing.offers o where id=any($1::uuid[]) order by id",
      [[offerA, offerB]],
    );
    const options = await pool.query(
      "select to_jsonb(o) as row from billing.payment_options o where id=any($1::uuid[]) order by id",
      [[optionA, optionB]],
    );
    await upgradeToLatest(db);
    expect(
      (
        await pool.query(
          "select product_ids,archived from billing.promotions where id=$1",
          [intersection],
        )
      ).rows,
    ).toEqual([{ product_ids: [productA], archived: false }]);
    expect(
      (
        await pool.query(
          "select product_ids,archived from billing.promotions where id=$1",
          [unrestricted],
        )
      ).rows,
    ).toEqual([{ product_ids: [], archived: false }]);
    expect(
      (
        await pool.query(
          "select product_ids,archived from billing.promotions where id=$1",
          [unresolved],
        )
      ).rows,
    ).toEqual([{ product_ids: [], archived: true }]);
    expect(
      (
        await pool.query(
          "select published from billing.product_prices where product_id=any($1::uuid[])",
          [[productA, productB]],
        )
      ).rows,
    ).toEqual([{ published: false }, { published: false }]);
    expect(
      (
        await pool.query(
          "select to_jsonb(o) as row from billing.offers o where id=any($1::uuid[]) order by id",
          [[offerA, offerB]],
        )
      ).rows,
    ).toEqual(originals.rows);
    expect(
      (
        await pool.query(
          "select to_jsonb(o) as row from billing.payment_options o where id=any($1::uuid[]) order by id",
          [[optionA, optionB]],
        )
      ).rows,
    ).toEqual(options.rows);
    expect(
      (
        await pool.query(
          "select disposition from billing.product_price_migration_inventory where product_id=any($1::uuid[])",
          [[productA, productB]],
        )
      ).rows,
    ).toEqual([
      { disposition: "paused_owner_publication" },
      { disposition: "paused_owner_publication" },
    ]);
    expect(
      (
        await pool.query(
          "select disposition from billing.promotion_migration_inventory where promotion_id=$1",
          [intersection],
        )
      ).rows,
    ).toEqual([{ disposition: "mapped_intersection" }]);
    const actor = randomUUID();
    await db.prisma.account.create({
      data: {
        id: actor,
        logtoIssuer: "https://identity.invalid",
        logtoSubject: actor,
      },
    });
    await db.prisma.accountPermission.create({
      data: { accountId: actor, permission: "platform:admin" },
    });
    const pricing = new BillingPricing({
      prisma: db.prisma,
      accounts: assembleAccounts({
        prisma: db.prisma,
        emailFingerprintKey: "pricing-upgrade-test-key-000000000000",
      }),
      contentCatalog: new CoverageCatalog(
        db.prisma,
        new ProductDiscovery(db.prisma),
      ),
      sale: { payments: true },
      clock: () => new Date("2026-10-07T12:00:00Z"),
    });
    for (const productId of [productA, productB]) {
      expect(
        await pricing.quote(actor, {
          operationId: randomUUID(),
          productId,
          priceRevision: 1,
        }),
      ).toMatchObject({ ok: false });
      expect(
        await pricing.manage(actor, {
          operation: "productPrices.save",
          operationId: randomUUID(),
          expectedRevision: 1,
          value: {
            productId,
            name: "Explicitly reviewed Product price",
            priceKopecks: 200000,
            published: true,
          },
        }),
      ).toMatchObject({ ok: true });
    }
    expect(
      await pricing.quote(actor, {
        operationId: randomUUID(),
        productId: productA,
        priceRevision: 2,
      }),
    ).toMatchObject({
      ok: true,
      value: { snapshot: { firstPriceKopecks: 160000 } },
    });
    expect(
      await pricing.quote(actor, {
        operationId: randomUUID(),
        productId: productB,
        priceRevision: 2,
      }),
    ).toMatchObject({
      ok: true,
      value: { snapshot: { firstPriceKopecks: 200000 } },
    });
    await upgradeToLatest(db);
    expect(
      (
        await pool.query(
          "select product_ids from billing.promotions where id=$1",
          [intersection],
        )
      ).rows,
    ).toEqual([{ product_ids: [productA] }]);
  } finally {
    await pool.end();
    await db.dispose();
  }
});

test("restricted Promotion upgrades fail closed for unknown, archived and ambiguous candidates and inventory every old price without casting malformed Product references", async () => {
  const db = await createTestDatabase();
  const pool = new Pool({ connectionString: db.url, max: 1 });
  try {
    await migrateBefore(db, "0108_product_prices");
    const a = randomUUID(),
      b = randomUUID();
    for (const id of [a, b])
      await pool.query(
        "insert into products.series(id,slug,name) values($1::uuid,$1::text,'Product')",
        [id],
      );
    const cases = [
      { name: "a", benefits: [`product:${a}`], archived: false },
      { name: "b", benefits: [`product:${b}`], archived: false },
      {
        name: "composite",
        benefits: [`product:${a}`, `product:${b}`],
        archived: false,
      },
      {
        name: "missing",
        benefits: [`product:${randomUUID()}`],
        archived: false,
      },
      { name: "archived", benefits: [`product:${a}`], archived: true },
      {
        name: "malformed",
        benefits: [`product:${"-".repeat(36)}`],
        archived: false,
      },
      { name: "global", benefits: ["materials"], archived: false },
    ].map((row) => ({ ...row, offer: randomUUID(), option: randomUUID() }));
    for (const row of cases) {
      await pool.query(
        "insert into billing.offers(id,name,benefits,published,revision,archived) values($1,$2,$3,true,7,$4)",
        [row.offer, row.name, row.benefits, row.archived],
      );
      await pool.query(
        "insert into billing.payment_options(id,offer_id,revision,months,price_kopecks,mode) values($1,$2,2,1,200000,'one_time')",
        [row.option, row.offer],
      );
    }
    const [validA, validB, composite, missing, archived, malformed, global] =
      cases;
    if (
      !validA ||
      !validB ||
      !composite ||
      !missing ||
      !archived ||
      !malformed ||
      !global
    )
      throw new Error("Missing fixture");
    const promotions = [
      { offers: [validA.offer], options: [], product: null },
      { offers: [], options: [validB.option], product: null },
      { offers: [validA.offer], options: [validB.option], product: null },
      { offers: [composite.offer], options: [], product: null },
      { offers: [missing.offer], options: [], product: null },
      { offers: [archived.offer], options: [], product: null },
      { offers: [malformed.offer], options: [], product: null },
      { offers: [global.offer], options: [], product: null },
      { offers: [validA.offer, randomUUID()], options: [], product: null },
      { offers: [], options: [validA.option, randomUUID()], product: null },
    ].map((row) => ({ ...row, id: randomUUID() }));
    for (const row of promotions)
      await pool.query(
        "insert into billing.promotions(id,revision,name,percent,starts_at,ends_at,offer_ids,payment_option_ids) values($1,3,'Discount',20,'2020-01-01','2040-01-01',$2,$3)",
        [row.id, row.offers, row.options],
      );
    const beforeOffers = (
      await pool.query(
        "select to_jsonb(o) as row from billing.offers o order by id",
      )
    ).rows;
    const beforeOptions = (
      await pool.query(
        "select to_jsonb(o) as row from billing.payment_options o order by id",
      )
    ).rows;
    const beforePromotions = (
      await pool.query(
        "select id,to_jsonb(p) as row from billing.promotions p order by id",
      )
    ).rows;
    await upgradeToLatest(db);
    for (const row of promotions) {
      const result = (
        await pool.query(
          "select product_ids,archived from billing.promotions where id=$1",
          [row.id],
        )
      ).rows;
      expect(result, row.id).toEqual([
        {
          product_ids: [],
          archived: true,
        },
      ]);
    }
    expect(
      (
        await pool.query(
          "select to_jsonb(o) as row from billing.offers o order by id",
        )
      ).rows,
    ).toEqual(beforeOffers);
    expect(
      (
        await pool.query(
          "select to_jsonb(o) as row from billing.payment_options o order by id",
        )
      ).rows,
    ).toEqual(beforeOptions);
    expect(
      (
        await pool.query(
          "select promotion_id as id,source as row from billing.promotion_migration_inventory order by promotion_id",
        )
      ).rows,
    ).toEqual(beforePromotions);
    expect(
      (
        await pool.query(
          "select payment_option_id from billing.product_price_migration_inventory order by payment_option_id",
        )
      ).rows,
    ).toEqual(
      cases
        .map((row) => ({ payment_option_id: row.option }))
        .sort((a, b) => a.payment_option_id.localeCompare(b.payment_option_id)),
    );
    expect(
      (await pool.query("select published from billing.product_prices")).rows,
    ).toEqual([{ published: false }, { published: false }]);
    await upgradeToLatest(db);
  } finally {
    await pool.end();
    await db.dispose();
  }
});

test("conflicting old prices, archived options and recurring candidates stay passive while saved financial and legal snapshots survive upgrade and replay byte for byte", async () => {
  const db = await createTestDatabase();
  const pool = new Pool({ connectionString: db.url, max: 1 });
  try {
    await migrateBefore(db, "0108_product_prices");
    const product = randomUUID(),
      offer = randomUUID(),
      optionA = randomUUID(),
      optionB = randomUUID(),
      archivedOption = randomUUID(),
      recurringOption = randomUUID();
    await pool.query(
      "insert into products.series(id,slug,name) values($1::uuid,$1::text,'Product')",
      [product],
    );
    await pool.query(
      "insert into billing.offers(id,name,benefits,published,revision) values($1,'Old Product price',$2,true,7)",
      [offer, [`product:${product}`]],
    );
    for (const row of [
      { id: optionA, price: 200000, archived: false, mode: "one_time" },
      { id: optionB, price: 300000, archived: false, mode: "one_time" },
      { id: archivedOption, price: 100000, archived: true, mode: "one_time" },
      {
        id: recurringOption,
        price: 50000,
        archived: false,
        mode: "subscription",
      },
    ]) {
      await pool.query(
        "insert into billing.payment_options(id,offer_id,revision,months,price_kopecks,mode,archived) values($1,$2,2,1,$3,$4,$5)",
        [row.id, offer, row.price, row.mode, row.archived],
      );
    }
    const archivedPromotion = randomUUID(),
      recurringPromotion = randomUUID();
    for (const row of [
      { id: archivedPromotion, options: [optionA, archivedOption] },
      { id: recurringPromotion, options: [recurringOption] },
    ])
      await pool.query(
        "insert into billing.promotions(id,revision,name,percent,starts_at,ends_at,offer_ids,payment_option_ids) values($1,3,'Old scope',20,'2020-01-01','2040-01-01',$2,$3)",
        [row.id, [offer], row.options],
      );
    const account = randomUUID(),
      quote = randomUUID(),
      link = randomUUID(),
      purchase = randomUUID();
    const snapshot = {
      offer: { id: offer, revision: 7, benefits: [`product:${product}`] },
      paymentOption: {
        id: optionA,
        revision: 2,
        mode: "one_time",
        months: 1,
        priceKopecks: 200000,
      },
      firstPriceKopecks: 160000,
      legal: {
        text: "Exact old text\nwith whitespace.  ",
        digest: "sha256:retained-test-fixture",
      },
    };
    await pool.query(
      "insert into billing.payment_links(id,revision,snapshot,created_at) values($1,2,$2,'2026-10-01')",
      [link, snapshot],
    );
    await pool.query(
      "insert into billing.price_quotes(id,account_id,operation_id,fingerprint,snapshot,payment_link_id,created_at,expires_at) values($1,$2,$3,'original-fingerprint',$4,$5,'2026-10-01','2026-10-02')",
      [quote, account, randomUUID(), snapshot, link],
    );
    await pool.query(
      "insert into billing.purchases(id,account_id,quote_ref,state,environment,terminal_ref,payment_id,amount_kopecks,snapshot,acceptance,contact,fiscalization,created_at,updated_at) values($1,$2,$3,'sent','test','original-terminal','original-payment',160000,$4,$5,$6,'pending','2026-10-01','2026-10-01')",
      [
        purchase,
        account,
        quote,
        snapshot,
        { text: snapshot.legal.text, digest: snapshot.legal.digest },
        { email: "buyer@example.invalid" },
      ],
    );
    const saved = async () =>
      (
        await pool.query<{ quote: unknown; link: unknown; purchase: unknown }>(
          "select (select to_jsonb(q) from billing.price_quotes q where id=$1) quote,(select to_jsonb(l) from billing.payment_links l where id=$2) link,(select to_jsonb(p) - 'refund_review_required' from billing.purchases p where id=$3) purchase",
          [quote, link, purchase],
        )
      ).rows;
    const before = await saved();
    await upgradeToLatest(db);
    expect(await saved()).toEqual(before);
    expect(
      (
        await pool.query(
          "select published from billing.product_prices where product_id=$1",
          [product],
        )
      ).rows,
    ).toEqual([{ published: false }]);
    expect(
      (
        await pool.query(
          "select disposition from billing.product_price_migration_inventory where payment_option_id=any($1::uuid[]) order by disposition",
          [[optionA, optionB, archivedOption, recurringOption]],
        )
      ).rows,
    ).toEqual([
      { disposition: "paused_archived" },
      { disposition: "paused_conflicting_prices" },
      { disposition: "paused_conflicting_prices" },
      { disposition: "paused_recurring" },
    ]);
    expect(
      (
        await pool.query(
          "select product_ids,archived from billing.promotions where id=any($1::uuid[])",
          [[archivedPromotion, recurringPromotion]],
        )
      ).rows,
    ).toEqual([
      { product_ids: [], archived: true },
      { product_ids: [], archived: true },
    ]);
    await upgradeToLatest(db);
    expect(await saved()).toEqual(before);
  } finally {
    await pool.end();
    await db.dispose();
  }
});

test.each(["option", "offer", "same_price_option", "all_options"])(
  "a Product Promotion preserves old %s candidate scope after explicit Product publication",
  async (restriction) => {
    const db = await createTestDatabase();
    const pool = new Pool({ connectionString: db.url, max: 1 });
    try {
      await migrateBefore(db, "0108_product_prices");
      const product = randomUUID(),
        offerA = randomUUID(),
        offerB = restriction === "offer" ? randomUUID() : offerA;
      // The lower UUID deterministically selects the previously ineligible 200000 draft.
      const optionA = "00000000-0000-4000-8000-000000000001",
        optionB = "00000000-0000-4000-8000-000000000002",
        promotion = randomUUID();
      await pool.query(
        "insert into products.series(id,slug,name) values($1::uuid,$1::text,'Product')",
        [product],
      );
      for (const id of new Set([offerA, offerB]))
        await pool.query(
          "insert into billing.offers(id,name,benefits,published,revision) values($1,'Historical offer',$2,true,7)",
          [id, [`product:${product}`]],
        );
      for (const row of [
        { id: optionA, offer: offerA, price: 200000 },
        {
          id: optionB,
          offer: offerB,
          price: restriction === "same_price_option" ? 200000 : 300000,
        },
      ])
        await pool.query(
          "insert into billing.payment_options(id,offer_id,revision,months,price_kopecks,mode) values($1,$2,2,1,$3,'one_time')",
          [row.id, row.offer, row.price],
        );
      await pool.query(
        "insert into billing.promotions(id,revision,name,percent,starts_at,ends_at,offer_ids,payment_option_ids) values($1,3,'Historical candidate scope',20,'2020-01-01','2040-01-01',$2,$3)",
        [
          promotion,
          restriction === "offer" ? [offerB] : [],
          restriction === "all_options"
            ? [optionA, optionB]
            : restriction === "offer"
              ? []
              : [optionB],
        ],
      );
      const original = (
        await pool.query(
          "select to_jsonb(p) as source from billing.promotions p where id=$1",
          [promotion],
        )
      ).rows;
      await upgradeToLatest(db);
      const actor = randomUUID();
      await db.prisma.account.create({
        data: {
          id: actor,
          logtoIssuer: "https://identity.invalid",
          logtoSubject: actor,
        },
      });
      await db.prisma.accountPermission.create({
        data: { accountId: actor, permission: "platform:admin" },
      });
      const pricing = new BillingPricing({
        prisma: db.prisma,
        accounts: assembleAccounts({
          prisma: db.prisma,
          emailFingerprintKey: "pricing-upgrade-test-key-000000000000",
        }),
        contentCatalog: new CoverageCatalog(
          db.prisma,
          new ProductDiscovery(db.prisma),
        ),
        sale: { payments: true },
        clock: () => new Date("2026-10-07T12:00:00Z"),
      });
      expect(
        await pricing.manage(actor, {
          operation: "productPrices.save",
          operationId: randomUUID(),
          expectedRevision: 1,
          value: {
            productId: product,
            name: "Explicit owner publication",
            priceKopecks: 200000,
            published: true,
          },
        }),
      ).toMatchObject({ ok: true });
      expect(
        await pricing.quote(actor, {
          operationId: randomUUID(),
          productId: product,
          priceRevision: 2,
        }),
      ).toMatchObject({
        ok: true,
        value: {
          snapshot: {
            firstPriceKopecks: restriction === "all_options" ? 160000 : 200000,
          },
        },
      });
      expect(
        (
          await pool.query(
            "select product_ids,archived from billing.promotions where id=$1",
            [promotion],
          )
        ).rows,
      ).toEqual([
        {
          product_ids: restriction === "all_options" ? [product] : [],
          archived: restriction !== "all_options",
        },
      ]);
      expect(
        (
          await pool.query(
            "select source from billing.promotion_migration_inventory where promotion_id=$1",
            [promotion],
          )
        ).rows,
      ).toEqual(original);
      expect(
        (
          await pool.query(
            "select disposition from billing.promotion_migration_inventory where promotion_id=$1",
            [promotion],
          )
        ).rows,
      ).toEqual([
        {
          disposition:
            restriction === "all_options"
              ? "mapped_intersection"
              : "paused_partial_product_scope",
        },
      ]);
      await upgradeToLatest(db);
    } finally {
      await pool.end();
      await db.dispose();
    }
  },
);

const compositionCases: readonly {
  a: string;
  b: string;
  scope: "offer" | "option" | "both" | "all" | "global" | "all_options";
  expected:
    | "mapped"
    | "partial"
    | "unsupported"
    | "unprovable"
    | "selected_unrepresentable";
  status?:
    | "unpublished"
    | "archived_offer"
    | "archived_option"
    | "recurring"
    | "invalid_period";
  sameAmount?: boolean;
}[] = [
  {
    a: "direct",
    b: "coverage",
    scope: "all_options",
    expected: "selected_unrepresentable",
    status: "recurring",
  },
  { a: "direct", b: "coverage", scope: "offer", expected: "partial" },
  { a: "direct", b: "coverage", scope: "option", expected: "partial" },
  { a: "direct", b: "coverage", scope: "both", expected: "partial" },
  { a: "direct", b: "coverage", scope: "all", expected: "mapped" },
  { a: "direct", b: "coverage", scope: "global", expected: "mapped" },
  {
    a: "direct",
    b: "coverage",
    scope: "offer",
    expected: "partial",
    sameAmount: true,
  },
  {
    a: "direct",
    b: "coverage",
    scope: "offer",
    expected: "partial",
    status: "unpublished",
  },
  {
    a: "direct",
    b: "coverage",
    scope: "offer",
    expected: "mapped",
    status: "archived_offer",
  },
  {
    a: "direct",
    b: "coverage",
    scope: "offer",
    expected: "mapped",
    status: "archived_option",
  },
  {
    a: "direct",
    b: "coverage",
    scope: "offer",
    expected: "mapped",
    status: "recurring",
  },
  { a: "direct", b: "support", scope: "offer", expected: "mapped" },
  { a: "direct", b: "community", scope: "offer", expected: "mapped" },
  { a: "direct", b: "other", scope: "offer", expected: "mapped" },
  { a: "coverage", b: "other", scope: "offer", expected: "mapped" },
  { a: "missing_support", b: "other", scope: "offer", expected: "mapped" },
  {
    a: "direct",
    b: "other",
    scope: "offer",
    expected: "mapped",
    status: "invalid_period",
  },
  { a: "duplicate_paths", b: "other", scope: "offer", expected: "mapped" },
  ...[
    "bundle",
    "mixed_material",
    "whole_platform",
    "malformed_coverage",
    "reviews",
    "unknown",
    "material_only",
  ].map((b) => ({
    a: "direct",
    b,
    scope: "offer" as const,
    expected: "unprovable" as const,
  })),
  ...[
    "bundle",
    "multi_coverage",
    "mixed_material",
    "whole_platform",
    "malformed_coverage",
    "wrong_collection",
    "nonstring_id",
    "missing_product",
    "duplicate_coverage",
    "unknown_key",
    "empty_materials",
    "material_only",
    "reviews",
    "unknown",
    "malformed_benefit",
    "support",
    "community",
  ].map((a) => ({
    a,
    b: "other",
    scope: "offer" as const,
    expected: "unsupported" as const,
  })),
];

test.each(compositionCases)(
  "full old content composition $a/$b with $scope scope and $status retains only proved Product discount authority",
  async (scenario) => {
    const db = await createTestDatabase();
    const pool = new Pool({ connectionString: db.url, max: 1 });
    try {
      await migrateBefore(db, "0108_product_prices");
      const product = randomUUID(),
        other = randomUUID(),
        offerA = randomUUID(),
        offerB = randomUUID(),
        promotion = randomUUID();
      const optionA = "00000000-0000-4000-8000-000000000001",
        optionB = "00000000-0000-4000-8000-000000000002";
      for (const id of [product, other])
        await pool.query(
          "insert into products.series(id,slug,name) values($1::uuid,$1::text,'Historical Product')",
          [id],
        );
      function composition(kind: string): {
        benefits: string[];
        coverage: unknown;
      } {
        const scope = { productIds: [product], materialIds: [] as string[] };
        if (kind === "direct")
          return {
            benefits: [`product:${product}`, "support"],
            coverage: null,
          };
        if (kind === "missing_support")
          return { benefits: [`product:${product}`], coverage: null };
        if (kind === "coverage")
          return { benefits: ["materials"], coverage: scope };
        if (kind === "other")
          return {
            benefits: ["materials"],
            coverage: { ...scope, productIds: [other] },
          };
        if (kind === "support" || kind === "community")
          return { benefits: [kind], coverage: scope };
        if (kind === "duplicate_paths")
          return {
            benefits: [`product:${product}`, "materials", "support"],
            coverage: scope,
          };
        if (kind === "bundle")
          return {
            benefits: [`product:${product}`, "materials", "support"],
            coverage: { ...scope, productIds: [other] },
          };
        if (kind === "multi_coverage")
          return {
            benefits: ["materials"],
            coverage: { ...scope, productIds: [product, other] },
          };
        if (kind === "reviews" || kind === "unknown")
          return {
            benefits: [
              `product:${product}`,
              "support",
              kind === "reviews" ? "reviews" : "unrecognized-content",
            ],
            coverage: null,
          };
        if (kind === "malformed_benefit")
          return {
            benefits: [`product:${product}`, "product:bad-uuid", "support"],
            coverage: null,
          };
        const benefits = [`product:${product}`, "materials", "support"];
        if (kind === "mixed_material")
          return {
            benefits,
            coverage: { ...scope, materialIds: [randomUUID()] },
          };
        if (kind === "material_only")
          return {
            benefits: ["materials"],
            coverage: { productIds: [], materialIds: [randomUUID()] },
          };
        if (kind === "whole_platform")
          return {
            benefits,
            coverage: { productIds: [], materialIds: [], wholePlatform: true },
          };
        if (kind === "malformed_coverage")
          return { benefits, coverage: { ...scope, productIds: ["bad-uuid"] } };
        if (kind === "wrong_collection")
          return {
            benefits,
            coverage: { ...scope, productIds: "not-an-array" },
          };
        if (kind === "nonstring_id")
          return { benefits, coverage: { ...scope, productIds: [42] } };
        if (kind === "missing_product")
          return {
            benefits,
            coverage: { ...scope, productIds: [randomUUID()] },
          };
        if (kind === "duplicate_coverage")
          return {
            benefits,
            coverage: { ...scope, productIds: [product, product] },
          };
        if (kind === "unknown_key")
          return { benefits, coverage: { ...scope, inventedContent: true } };
        if (kind === "empty_materials") return { benefits, coverage: null };
        throw new Error(`Unknown fixture composition ${kind}`);
      }
      for (const row of [
        { id: offerA, kind: scenario.a },
        { id: offerB, kind: scenario.b },
      ]) {
        const definition = composition(row.kind);
        await pool.query(
          "insert into billing.offers(id,name,benefits,benefit_periods,coverage,published,revision) values($1,'Historical offer',$2,$3,$4,true,7)",
          [
            row.id,
            definition.benefits,
            JSON.stringify([{ capability: "support", months: 3 }]),
            JSON.stringify(definition.coverage),
          ],
        );
      }
      if (scenario.status === "invalid_period")
        await pool.query(
          "update billing.offers set benefit_periods=$2 where id=$1",
          [offerA, JSON.stringify({ invalid: true })],
        );
      if (scenario.status === "unpublished")
        await pool.query(
          "update billing.offers set published=false where id=$1",
          [offerB],
        );
      if (scenario.status === "archived_offer")
        await pool.query(
          "update billing.offers set archived=true where id=$1",
          [offerB],
        );
      for (const row of [
        { id: optionA, offer: offerA, price: 200000 },
        {
          id: optionB,
          offer: offerB,
          price: scenario.sameAmount === true ? 200000 : 300000,
        },
      ])
        await pool.query(
          "insert into billing.payment_options(id,offer_id,revision,months,price_kopecks,mode) values($1,$2,2,1,$3,'one_time')",
          [row.id, row.offer, row.price],
        );
      if (scenario.status === "archived_option")
        await pool.query(
          "update billing.payment_options set archived=true where id=$1",
          [optionB],
        );
      if (scenario.status === "recurring")
        await pool.query(
          "update billing.payment_options set mode='subscription' where id=$1",
          [optionB],
        );
      const offers =
        scenario.scope === "all"
          ? [offerA, offerB]
          : scenario.scope === "offer" || scenario.scope === "both"
            ? [offerA]
            : [];
      const options =
        scenario.scope === "all_options"
          ? [optionA, optionB]
          : scenario.scope === "option" || scenario.scope === "both"
            ? [optionA]
            : [];
      await pool.query(
        "insert into billing.promotions(id,revision,name,percent,starts_at,ends_at,offer_ids,payment_option_ids) values($1,3,'Historical restriction',20,'2020-01-01','2040-01-01',$2,$3)",
        [promotion, offers, options],
      );
      const source = (
        await pool.query(
          "select to_jsonb(p) source from billing.promotions p where id=$1",
          [promotion],
        )
      ).rows;
      const originalOffers = (
        await pool.query(
          "select to_jsonb(o) source from billing.offers o order by id",
        )
      ).rows;
      const originalOptions = (
        await pool.query(
          "select to_jsonb(o) source from billing.payment_options o order by id",
        )
      ).rows;
      await upgradeToLatest(db);
      expect(
        (
          await pool.query(
            "select to_jsonb(o) source from billing.offers o order by id",
          )
        ).rows,
      ).toEqual(originalOffers);
      expect(
        (
          await pool.query(
            "select to_jsonb(o) source from billing.payment_options o order by id",
          )
        ).rows,
      ).toEqual(originalOptions);
      expect(
        (
          await pool.query(
            "select source from billing.promotion_migration_inventory where promotion_id=$1",
            [promotion],
          )
        ).rows,
      ).toEqual(source);
      const supported = scenario.expected !== "unsupported",
        mapped = scenario.expected === "mapped";
      expect(
        (
          await pool.query(
            "select published from billing.product_prices where product_id=$1",
            [product],
          )
        ).rows,
      ).toEqual(supported ? [{ published: false }] : []);
      expect(
        (
          await pool.query(
            "select product_id from billing.product_price_migration_inventory where payment_option_id=$1",
            [optionA],
          )
        ).rows,
      ).toEqual([{ product_id: supported ? product : null }]);
      expect(
        (
          await pool.query(
            "select source_sale_ready from billing.product_price_migration_inventory where payment_option_id=$1",
            [optionA],
          )
        ).rows,
      ).toEqual([
        {
          source_sale_ready:
            supported &&
            scenario.a !== "missing_support" &&
            scenario.status !== "invalid_period",
        },
      ]);
      const expectedDisposition =
        scenario.expected === "selected_unrepresentable"
          ? "paused_requested_recurring_option"
          : scenario.scope === "global"
            ? "unrestricted"
            : mapped
              ? "mapped_intersection"
              : scenario.expected === "partial"
                ? "paused_partial_product_scope"
                : scenario.expected === "unprovable"
                  ? "paused_unprovable_content_scope"
                  : "paused_requires_review";
      expect(
        (
          await pool.query(
            "select p.product_ids,p.archived,i.disposition from billing.promotions p join billing.promotion_migration_inventory i on i.promotion_id=p.id where p.id=$1",
            [promotion],
          )
        ).rows,
      ).toEqual([
        {
          product_ids: mapped && scenario.scope !== "global" ? [product] : [],
          archived: !mapped,
          disposition: expectedDisposition,
        },
      ]);
      const actor = randomUUID();
      await db.prisma.account.create({
        data: {
          id: actor,
          logtoIssuer: "https://identity.invalid",
          logtoSubject: actor,
        },
      });
      await db.prisma.accountPermission.create({
        data: { accountId: actor, permission: "platform:admin" },
      });
      const pricing = new BillingPricing({
        prisma: db.prisma,
        accounts: assembleAccounts({
          prisma: db.prisma,
          emailFingerprintKey: "pricing-upgrade-test-key-000000000000",
        }),
        contentCatalog: new CoverageCatalog(
          db.prisma,
          new ProductDiscovery(db.prisma),
        ),
        sale: { payments: true },
        clock: () => new Date("2026-10-07T12:00:00Z"),
      });
      expect(
        await pricing.manage(actor, {
          operation: "productPrices.save",
          operationId: randomUUID(),
          ...(supported ? { expectedRevision: 1 } : {}),
          value: {
            productId: product,
            name: "Explicit owner publication",
            priceKopecks: 200000,
            published: true,
          },
        }),
      ).toMatchObject({ ok: true });
      expect(
        await pricing.quote(actor, {
          operationId: randomUUID(),
          productId: product,
          priceRevision: supported ? 2 : 1,
        }),
      ).toMatchObject({
        ok: true,
        value: { snapshot: { firstPriceKopecks: mapped ? 160000 : 200000 } },
      });
      await upgradeToLatest(db);
    } finally {
      await pool.end();
      await db.dispose();
    }
  },
);
