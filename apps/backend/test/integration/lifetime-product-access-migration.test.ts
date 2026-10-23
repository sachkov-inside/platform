import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { Pool } from "pg";
import {
  assembleAccounts,
  accountId,
} from "../../src/modules/accounts/index.js";
import {
  assembleAccessGrants,
  assembleAccountRights,
} from "../../src/modules/account-rights/index.js";
import { createTestDatabase } from "./setup/test-database.js";
import { migrateBefore, upgradeToLatest } from "./setup/historical-upgrade.js";

test("upgrade freezes legacy scoped history into one lifetime state, preserves revocation and immutable receipts, and replays without rewriting facts", async () => {
  const db = await createTestDatabase(),
    pool = new Pool({ connectionString: db.url, max: 1 });
  try {
    await migrateBefore(db, "0106_lifetime_product_access");
    const holder = randomUUID(),
      withdrawn = randomUUID(),
      orphanWithdrawal = randomUUID(),
      bridgeHolder = randomUUID(),
      expired = randomUUID(),
      unscoped = randomUUID(),
      future = randomUUID(),
      owner = randomUUID(),
      product = randomUUID(),
      second = randomUUID();
    for (const id of [
      holder,
      withdrawn,
      orphanWithdrawal,
      bridgeHolder,
      expired,
      unscoped,
      future,
      owner,
    ])
      await db.prisma.account.create({
        data: { id, logtoIssuer: "https://identity.test", logtoSubject: id },
      });
    await db.prisma.accountPermission.create({
      data: { accountId: owner, permission: "platform:admin" },
    });
    for (const id of [product, second])
      await db.prisma.product.create({
        data: {
          id,
          name: "Historical product",
          slug: id,
          createdAt: new Date("2020-01-01"),
        },
      });
    const historical = {
      version: 1,
      acceptedText: "Terms stay byte-for-byte",
      currency: "RUB",
      amount: 490000,
    };
    await pool.query(
      "insert into account_rights.access_receipts(scope,operation_id,fingerprint,result,payload,created_at) values ('historical',$1,$2,$3,$3,'2020-01-01')",
      [randomUUID(), "a".repeat(64), historical],
    );
    for (const [who, source, starts, revoked] of [
      [holder, "original", "2020-01-31", null],
      [holder, "repeat", "2020-02-02", null],
      [withdrawn, "withdrawn", "2020-01-31", "2020-03-01"],
    ] as const) {
      await pool.query(
        "insert into account_rights.access_grants(id,account_id,source,source_ref,capabilities,coverage,starts_at,valid_until,revoked_at,revision,reason) values ($1,$2,'manual',$3,$4,$5,$6,null,$7,1,'Historical access')",
        [
          randomUUID(),
          who,
          source,
          [`product:${product}`],
          { productIds: [product], materialIds: [] },
          starts,
          revoked,
        ],
      );
    }
    for (const [who, capabilities, coverage, starts, until] of [
      [
        expired,
        [`product:${product}`],
        { productIds: [product], materialIds: [] },
        "2020-01-01",
        "2020-05-01",
      ],
      [
        unscoped,
        ["materials"],
        { wholePlatform: true, productIds: [], materialIds: [] },
        "2020-01-01",
        null,
      ],
      [
        future,
        [`product:${product}`],
        { productIds: [product], materialIds: [] },
        "2090-01-01",
        null,
      ],
    ] as const)
      await pool.query(
        "insert into account_rights.access_grants(id,account_id,source,source_ref,capabilities,coverage,starts_at,valid_until,revision,reason) values ($1,$2,'manual',$3,$4,$5,$6,$7,1,'Historical technical state')",
        [
          randomUUID(),
          who,
          randomUUID(),
          capabilities,
          coverage,
          starts,
          until,
        ],
      );
    await pool.query(
      "insert into account_rights.product_access_exclusions(account_id,product_id,grant_ids,bridge,actor_id,reason,revoked_at) values ($1,$2,'{}',false,$3,'Explicit withdrawal','2020-03-01')",
      [orphanWithdrawal, second, owner],
    );
    await pool.query(
      "insert into account_rights.legacy_classifications(account_id,classification,source_ref,reason,verified_at,revision,bridge_enabled,bridge_coverage) values ($1,'confirmed_legacy','old-bridge','Verified former holder','2020-01-01',1,true,$2)",
      [bridgeHolder, { productIds: [product], materialIds: [] }],
    );
    await pool.query(
      "insert into account_rights.account_bindings(account_id,principal_ref,linked_at) values ($1,'verified-principal','2020-01-01')",
      [bridgeHolder],
    );
    await pool.query(
      "insert into account_rights.current_projections(account_id,principal_ref,decision,evidence_ref,evidence_version,evidence_fingerprint,checked_at,valid_until,updated_at) values ($1,'verified-principal','member','old-evidence',1,$2,'2026-01-01','2030-01-01','2026-01-01')",
      [bridgeHolder, "b".repeat(64)],
    );
    const before = await pool.query(
      "select to_jsonb(g) as value from account_rights.access_grants g order by id",
    );
    const receipts = await pool.query(
      "select to_jsonb(r) as value from account_rights.access_receipts r order by scope,operation_id",
    );
    await upgradeToLatest(db);
    const rights = assembleAccountRights({
      prisma: db.prisma,
      clock: () => new Date("2040-01-01"),
    });
    const grants = assembleAccessGrants({
      contentCatalog: new CoverageCatalog(
        db.prisma,
        new ProductDiscovery(db.prisma),
      ),
      prisma: db.prisma,
      accounts: assembleAccounts({
        prisma: db.prisma,
        emailFingerprintKey: "synthetic-migration-fingerprint-key",
      }),
    });
    expect(await rights.resolveForAccess(accountId(holder), [product])).toEqual(
      { kind: "active", validUntil: null },
    );
    expect(
      await rights.resolveForAccess(accountId(bridgeHolder), [product]),
    ).toEqual({ kind: "required" });
    for (const who of [expired, unscoped, future])
      expect(await rights.resolveForAccess(accountId(who), [product])).toEqual({
        kind: "required",
      });
    const laterProduct = randomUUID();
    await db.prisma.product.create({
      data: { id: laterProduct, name: "Future Product", slug: laterProduct },
    });
    expect(
      await rights.resolveForAccess(accountId(holder), [laterProduct]),
    ).toEqual({ kind: "required" });
    expect(await rights.resolveForAccess(accountId(holder), [second])).toEqual({
      kind: "required",
    });
    expect(
      await rights.resolveForAccess(accountId(withdrawn), [product]),
    ).toEqual({ kind: "required" });
    expect(
      await grants.readProductAccess(owner, {
        accountId: holder,
        productId: product,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        firstIssuedAt: "2020-01-31T00:00:00.000Z",
        access: "active",
      },
    });
    expect(
      await grants.issueProductAccess(
        { source: "course_activation" },
        {
          accountId: orphanWithdrawal,
          productId: second,
          sourceRef: randomUUID(),
          issuedAt: "2020-04-01T00:00:00.000Z",
          reason: "Late activation",
        },
      ),
    ).toMatchObject({ ok: true, outcome: "revoked" });
    expect(
      (
        await pool.query(
          "select to_jsonb(g) as value from account_rights.access_grants g order by id",
        )
      ).rows,
    ).toEqual(before.rows);
    expect(
      (
        await pool.query(
          "select to_jsonb(r) as value from account_rights.access_receipts r order by scope,operation_id",
        )
      ).rows,
    ).toEqual(receipts.rows);
    await upgradeToLatest(db);
    expect(await rights.resolveForAccess(accountId(holder), [product])).toEqual(
      { kind: "active", validUntil: null },
    );
  } finally {
    await pool.end();
    await db.dispose();
  }
});
