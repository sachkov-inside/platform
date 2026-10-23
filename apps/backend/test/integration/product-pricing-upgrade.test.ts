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
      { offers: [validA.offer], options: [], product: a },
      { offers: [], options: [validB.option], product: b },
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
          product_ids: row.product === null ? [] : [row.product],
          archived: row.product === null,
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
          "select (select to_jsonb(q) from billing.price_quotes q where id=$1) quote,(select to_jsonb(l) from billing.payment_links l where id=$2) link,(select to_jsonb(p) from billing.purchases p where id=$3) purchase",
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
