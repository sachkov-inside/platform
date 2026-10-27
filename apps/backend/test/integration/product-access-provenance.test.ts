import { Pool } from "pg";
import { migrateBefore, upgradeToLatest } from "./setup/historical-upgrade.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
let db: TestDatabase;
let grants: ReturnType<typeof assembleAccessGrants>;
const owner = randomUUID();
const historical = new Map<string, { accountId: string; productId: string }>();
const issuedAt = "2026-01-01T00:00:00.000Z";
beforeAll(async () => {
  db = await createTestDatabase();
  await migrateBefore(db, "0106_lifetime_product_access");
  const pool = new Pool({ connectionString: db.url, max: 1 });
  try {
    for (const source of ["paid", "manual", "legacy"]) {
      const accountId = randomUUID(),
        productId = randomUUID();
      await pool.query(
        "insert into accounts.accounts(id,logto_issuer,logto_subject) values ($1::uuid,$2,$1::text)",
        [accountId, "https://identity.test"],
      );
      await pool.query(
        "insert into products.series(id,name,slug) values ($1::uuid,$2,$1::text)",
        [productId, "Provenance Product"],
      );
      const t = { accountId, productId };
      await pool.query(
        "INSERT INTO account_rights.access_grants(id,account_id,source,source_ref,capabilities,coverage,starts_at,valid_until,revision,reason) VALUES ($1,$2,$3,$4,$5,$6,$7,null,1,'private historical reason')",
        [
          randomUUID(),
          t.accountId,
          source,
          randomUUID(),
          source === "manual" ? ["materials"] : [`product:${t.productId}`],
          { productIds: [t.productId], materialIds: [] },
          issuedAt,
        ],
      );
      historical.set(source, t);
    }
  } finally {
    await pool.end();
  }
  await upgradeToLatest(db);
  await db.prisma.account.create({
    data: {
      id: owner,
      logtoIssuer: "https://identity.test",
      logtoSubject: owner,
    },
  });
  await db.prisma.accountPermission.create({
    data: { accountId: owner, permission: "platform:admin" },
  });
  grants = assembleAccessGrants({
    prisma: db.prisma,
    accounts: assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "synthetic-provenance-fingerprint-key",
    }),
    contentCatalog: new CoverageCatalog(
      db.prisma,
      new ProductDiscovery(db.prisma),
    ),
    clock: () => new Date("2030-01-01"),
  });
});
afterAll(async () => db.dispose());
async function target() {
  const accountId = randomUUID(),
    productId = randomUUID();
  await db.prisma.account.create({
    data: {
      id: accountId,
      logtoIssuer: "https://identity.test",
      logtoSubject: accountId,
    },
  });
  await db.prisma.product.create({
    data: { id: productId, name: "Provenance Product", slug: productId },
  });
  return { accountId, productId };
}
async function sources(
  t: { accountId: string; productId: string },
  expected: string[],
) {
  const own = await grants.readOwnAccess(t.accountId);
  expect(own.ok).toBe(true);
  if (!own.ok) throw new Error(own.error.code);
  expect(own.value.grounds.map((g) => g.source).sort()).toEqual(
    [...expected].sort(),
  );
  for (const ground of own.value.grounds)
    expect(ground).toMatchObject({ active: true, validUntil: null });
  const preview = await grants.previewProductRevocation(owner, t);
  expect(preview).toMatchObject({ ok: true, value: { affectedCount: 1 } });
  if (!preview.ok) throw new Error(preview.error.code);
  expect(preview.value.affected.map((g) => g.source).sort()).toEqual(
    [...expected].sort(),
  );
}
test("a confirmed purchase is paid in own access and owner withdrawal preview", async () => {
  const t = await target();
  expect(
    await grants.issueProductAccess(
      { source: "purchase" },
      {
        ...t,
        sourceRef: randomUUID(),
        issuedAt,
        reason: "private payment reason",
      },
    ),
  ).toMatchObject({ ok: true });
  await sources(t, ["paid"]);
});

for (const origin of ["paid", "manual", "legacy"])
  test(`an actually migrated ${origin} grant keeps its factual origin`, async () => {
    const t = historical.get(origin);
    if (t === undefined) throw new Error("Missing historical fixture");
    await sources(t, [origin]);
  });
test("manual issuance and Course activation retain distinct origins on one lifetime state", async () => {
  const t = await target();
  expect(
    await grants.issueManualProductAccess(owner, {
      ...t,
      sourceRef: randomUUID(),
      reason: "private owner reason",
    }),
  ).toMatchObject({ ok: true });
  await sources(t, ["manual"]);
  expect(
    await grants.issueProductAccess(
      { source: "course_activation" },
      {
        ...t,
        sourceRef: randomUUID(),
        issuedAt,
        reason: "private course evidence",
      },
    ),
  ).toMatchObject({ ok: true });
  await sources(t, ["course_activation", "manual"]);
  expect(
    await grants.issueProductAccess(
      { source: "purchase" },
      {
        ...t,
        sourceRef: randomUUID(),
        issuedAt,
        reason: "private purchase evidence",
      },
    ),
  ).toMatchObject({ ok: true });
  expect(
    await grants.issueProductAccess(
      { source: "purchase" },
      {
        ...t,
        sourceRef: randomUUID(),
        issuedAt,
        reason: "another confirmed purchase",
      },
    ),
  ).toMatchObject({ ok: true });
  await sources(t, ["course_activation", "manual", "paid"]);
  const own = await grants.readOwnAccess(t.accountId);
  expect(JSON.stringify(own)).not.toContain("private");
  expect(JSON.stringify(own)).not.toContain("sourceRef");
  const current = await grants.readProductAccess(owner, t);
  if (!current.ok) throw new Error(current.error.code);
  expect(
    await grants.revokeProductAccess(owner, {
      ...t,
      expectedRevision: current.value.revision,
      operationId: randomUUID(),
      reason: "withdraw",
    }),
  ).toMatchObject({ ok: true });
  expect(await grants.readOwnAccess(t.accountId)).toEqual({
    ok: true,
    value: { grounds: [] },
  });
  expect(await grants.previewProductRevocation(owner, t)).toMatchObject({
    ok: true,
    value: { affectedCount: 0, affected: [] },
  });
  expect(
    await grants.restoreProductAccess(owner, {
      ...t,
      expectedRevision: current.value.revision + 1,
      operationId: randomUUID(),
      reason: "restore",
    }),
  ).toMatchObject({
    ok: true,
    value: { firstIssuedAt: current.value.firstIssuedAt },
  });
  await sources(t, ["course_activation", "manual", "paid"]);
});
for (const mode of [
  "orphan",
  "unsupported",
  "invalid_ref",
  "missing_grant",
  "missing_inventory",
  "wrong_account",
  "wrong_product",
  "support_only",
])
  test(`unproven ${mode} history stays unknown without inventing a source`, async () => {
    const t = await target();
    await db.prisma.productAccess.create({
      data: { ...t, firstIssuedAt: null, revision: 1 },
    });
    if (mode !== "orphan") {
      const pool = new Pool({ connectionString: db.url, max: 1 });
      try {
        const legacy = await target(),
          grantId = randomUUID();
        const grantAccount =
          mode === "wrong_account" ? legacy.accountId : t.accountId;
        const grantProduct =
          mode === "wrong_product" ? legacy.productId : t.productId;
        await pool.query(
          "INSERT INTO account_rights.access_grants(id,account_id,source,source_ref,capabilities,coverage,starts_at,valid_until,revision,reason) VALUES ($1,$2,'paid',$3,$4,$5,$6,null,1,'private unrelated history')",
          [
            grantId,
            grantAccount,
            randomUUID(),
            mode === "support_only" ? ["support"] : [`product:${grantProduct}`],
            { productIds: [grantProduct], materialIds: [] },
            issuedAt,
          ],
        );
        if (mode !== "missing_inventory")
          await pool.query(
            "INSERT INTO account_rights.product_access_migration_inventory(legacy_kind,legacy_id,account_id,product_ids,disposition) VALUES ('grant',$1,$2,$3,'synthetic negative')",
            [grantId, grantAccount, [grantProduct]],
          );
        await db.prisma.productAccessSource.create({
          data: {
            ...t,
            source: mode === "unsupported" ? "unrecognized" : "migration_grant",
            sourceRef:
              mode === "invalid_ref"
                ? "not-a-uuid"
                : `${mode === "missing_grant" ? randomUUID() : grantId}:${t.productId}`,
            issuedAt: new Date(issuedAt),
            reason: "private source reason",
          },
        });
      } finally {
        await pool.end();
      }
    }
    await sources(t, ["unknown"]);
    expect(await grants.readOwnAccess(t.accountId)).toMatchObject({
      ok: true,
      value: { grounds: [{ startsAt: null }] },
    });
  });

test("a Course acquisition alone is never labelled as owner issuance", async () => {
  const t = await target();
  const command = {
    ...t,
    sourceRef: randomUUID(),
    issuedAt,
    reason: "private course evidence",
  };
  for (let replay = 0; replay < 2; replay++)
    expect(
      await grants.issueProductAccess({ source: "course_activation" }, command),
    ).toMatchObject({ ok: true, value: { firstIssuedAt: issuedAt } });
  await sources(t, ["course_activation"]);
});
