import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

// Owner reads behind the people list and the person card (#1721): who holds which Product, how it
// was first acquired, and the history of each Product Access with its actors.
let db: TestDatabase;
let grants: ReturnType<typeof assembleAccessGrants>;
let now = new Date("2030-01-01T10:00:00.000Z");
const at = (iso: string) => (now = new Date(iso));
const owner = randomUUID(),
  admin = randomUUID(),
  author = randomUUID(),
  messenger = randomUUID(),
  plain = randomUUID();
const alice = randomUUID(),
  bob = randomUUID(),
  carol = randomUUID(),
  dave = randomUUID();
const products = [randomUUID(), randomUUID(), randomUUID()].sort(compare);
const first = products[0] ?? "",
  second = products[1] ?? "",
  third = products[2] ?? "";

/** Action IDs are generated; the test names an action by its kind, time and revision. */
function withoutActionIds(
  result: Awaited<ReturnType<typeof grants.readAccountProductAccess>>,
) {
  if (!result.ok) return result;
  return {
    ...result,
    value: {
      ...result.value,
      products: result.value.products.map((product) => ({
        ...product,
        history: product.history.map((event) => {
          if (event.type === "source") return event;
          const { id: _id, ...rest } = event;
          return rest;
        }),
      })),
    },
  };
}

function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

beforeAll(async () => {
  db = await createMigratedTestDatabase();
  for (const id of [
    owner,
    admin,
    author,
    messenger,
    plain,
    alice,
    bob,
    carol,
    dave,
  ])
    await db.prisma.account.create({
      data: { id, logtoIssuer: "https://identity.test", logtoSubject: id },
    });
  for (const [accountId, permission] of [
    [owner, "billing:manage"],
    [admin, "platform:admin"],
    [author, "materials:manage"],
    [messenger, "communications:manage"],
  ] as const)
    await db.prisma.accountPermission.create({
      data: { accountId, permission },
    });
  for (const id of [first, second, third])
    await db.prisma.product.create({
      data: { id, name: "People Product", slug: id },
    });
  grants = assembleAccessGrants({
    prisma: db.prisma,
    accounts: assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "synthetic-people-access-fingerprint-key",
    }),
    contentCatalog: new CoverageCatalog(
      db.prisma,
      new ProductDiscovery(db.prisma),
    ),
    clock: () => now,
  });
  const ok = (result: { ok: boolean }) => {
    if (!result.ok) throw new Error(JSON.stringify(result));
  };
  // The source reference names the case, so equal instants still order deterministically.
  const manual = (
    actor: string,
    accountId: string,
    productId: string,
    reason: string,
  ) =>
    grants.issueManualProductAccess(actor, {
      accountId,
      productId,
      sourceRef: `manual:${reason}`,
      reason,
    });
  const change = async (
    kind: "revoke" | "restore",
    actor: string,
    accountId: string,
    productId: string,
    reason: string,
  ) => {
    const current = await grants.readProductAccess(actor, {
      accountId,
      productId,
    });
    if (!current.ok) throw new Error(current.error.code);
    const command = {
      accountId,
      productId,
      operationId: randomUUID(),
      expectedRevision: current.value.revision,
      reason,
    };
    ok(
      kind === "revoke"
        ? await grants.revokeProductAccess(actor, command)
        : await grants.restoreProductAccess(actor, command),
    );
  };
  at("2030-01-01T10:00:00.000Z");
  ok(await manual(owner, alice, first, "Gift"));
  at("2030-01-02T10:00:00.000Z");
  ok(
    await grants.issueProductAccess(
      { source: "purchase" },
      {
        accountId: bob,
        productId: first,
        sourceRef: `payment:${randomUUID()}`,
        issuedAt: "2030-01-02T09:00:00.000Z",
        reason: "payment_confirmed",
      },
    ),
  );
  at("2030-01-03T10:00:00.000Z");
  await change("revoke", owner, bob, first, "Refund");
  at("2030-01-04T10:00:00.000Z");
  ok(
    await grants.issueProductAccess(
      { source: "purchase" },
      {
        accountId: carol,
        productId: second,
        sourceRef: "payment:carol",
        issuedAt: "2030-01-04T10:00:00.000Z",
        reason: "payment_confirmed",
      },
    ),
  );
  at("2030-01-05T10:00:00.000Z");
  ok(await manual(admin, carol, first, "Bonus"));
  at("2030-01-06T10:00:00.000Z");
  ok(await manual(owner, carol, second, "Extra"));
  at("2030-01-07T10:00:00.000Z");
  ok(
    await grants.issueProductAccess(
      { source: "course_activation" },
      {
        accountId: carol,
        productId: third,
        sourceRef: "course:carol",
        issuedAt: "2030-01-07T10:00:00.000Z",
        reason: "Verified course source activation",
      },
    ),
  );
  // Two manual sources at one instant: their actions cannot be told apart.
  at("2030-01-08T10:00:00.000Z");
  ok(await manual(owner, carol, third, "Twin A"));
  ok(await manual(admin, carol, third, "Twin B"));
  at("2030-01-09T10:00:00.000Z");
  await change("revoke", owner, carol, second, "Moved");
  at("2030-01-10T10:00:00.000Z");
  await change("restore", admin, carol, second, "Mistake");
});
afterAll(async () => db.dispose());

describe("listAccessAccounts", () => {
  test("answers every Account whose one Product Access matches all filters", async () => {
    const list = async (filter: unknown) => {
      const result = await grants.listAccessAccounts(owner, filter);
      if (!result.ok) throw new Error(result.error.code);
      return result.accountIds;
    };
    expect(await list({ productId: first })).toEqual(
      [alice, bob, carol].sort(compare),
    );
    expect(
      await list({ productId: first.toUpperCase(), state: "revoked" }),
    ).toEqual([bob]);
    expect(await list({ origin: "paid" })).toEqual([bob, carol].sort(compare));
    expect(await list({ origin: "manual" })).toEqual(
      [alice, carol].sort(compare),
    );
    expect(await list({ origin: "course_activation" })).toEqual([carol]);
    expect(await list({ productId: second, origin: "manual" })).toEqual([]);
    expect(await list({ state: "active", origin: "paid" })).toEqual([carol]);
    expect(await list({})).toEqual([alice, bob, carol].sort(compare));
  });

  test("refuses malformed filters", async () => {
    for (const filter of [
      { origin: "gift" },
      { productId: "x" },
      { extra: true },
      null,
    ])
      expect(await grants.listAccessAccounts(owner, filter)).toEqual({
        ok: false,
        error: { code: "invalid_input" },
      });
  });

  test("refuses a set above its bound instead of cutting it", async () => {
    const bulk = randomUUID();
    await db.prisma.$executeRaw`
      INSERT INTO account_rights.product_access(account_id, product_id, revision)
      SELECT gen_random_uuid(), ${bulk}::uuid, 1 FROM generate_series(1, 50001)`;
    try {
      expect(
        await grants.listAccessAccounts(owner, { productId: bulk }),
      ).toEqual({
        ok: false,
        error: { code: "unavailable" },
      });
      await db.prisma.$executeRaw`
        DELETE FROM account_rights.product_access
        WHERE product_id = ${bulk}::uuid
          AND account_id = (SELECT min(account_id::text)::uuid FROM account_rights.product_access WHERE product_id = ${bulk}::uuid)`;
      const bounded = await grants.listAccessAccounts(owner, {
        productId: bulk,
      });
      expect(bounded.ok && bounded.accountIds.length).toBe(50_000);
    } finally {
      await db.prisma.$executeRaw`
        DELETE FROM account_rights.product_access WHERE product_id = ${bulk}::uuid`;
    }
  });
});

describe("readAccessSummaries", () => {
  test("answers each requested Account under its declared key", async () => {
    const result = await grants.readAccessSummaries(owner, [
      alice.toUpperCase(),
      bob,
      dave,
      carol,
    ]);
    expect(result).toEqual({
      ok: true,
      accounts: new Map([
        [
          alice.toUpperCase(),
          [{ productId: first, access: "active", origin: "manual" }],
        ],
        [bob, [{ productId: first, access: "revoked", origin: "paid" }]],
        [dave, []],
        [
          carol,
          [
            { productId: first, access: "active", origin: "manual" },
            { productId: second, access: "active", origin: "paid" },
            { productId: third, access: "active", origin: "course_activation" },
          ],
        ],
      ]),
    });
  });

  test("answers at most one page of Accounts", async () => {
    expect(
      await grants.readAccessSummaries(
        owner,
        Array.from({ length: 51 }, () => randomUUID()),
      ),
    ).toEqual({ ok: false, error: { code: "invalid_input" } });
    expect(await grants.readAccessSummaries(owner, ["x"])).toEqual({
      ok: false,
      error: { code: "invalid_input" },
    });
  });
});

describe("readAccountProductAccess", () => {
  test("names each source, action and actor of every Product Access", async () => {
    expect(
      withoutActionIds(await grants.readAccountProductAccess(owner, carol)),
    ).toEqual({
      ok: true,
      value: {
        accountId: carol,
        products: [
          {
            productId: first,
            access: "active",
            revision: 1,
            firstIssuedAt: "2030-01-05T10:00:00.000Z",
            origin: "manual",
            history: [
              {
                type: "source",
                kind: "manual_issue",
                origin: "manual",
                sourceRef: "manual:Bonus",
                at: "2030-01-05T10:00:00.000Z",
                actor: { state: "known", actorId: admin },
                reason: "Bonus",
              },
            ],
          },
          {
            productId: second,
            access: "active",
            revision: 3,
            firstIssuedAt: "2030-01-04T10:00:00.000Z",
            origin: "paid",
            history: [
              {
                type: "source",
                kind: "purchase",
                origin: "paid",
                sourceRef: "payment:carol",
                at: "2030-01-04T10:00:00.000Z",
                actor: { state: "known", actorId: null },
                reason: "payment_confirmed",
              },
              {
                type: "source",
                kind: "manual_issue",
                origin: "manual",
                sourceRef: "manual:Extra",
                at: "2030-01-06T10:00:00.000Z",
                actor: { state: "known", actorId: owner },
                reason: "Extra",
              },
              {
                type: "action",
                kind: "revoke",
                at: "2030-01-09T10:00:00.000Z",
                actor: { state: "known", actorId: owner },
                reason: "Moved",
                revision: 2,
              },
              {
                type: "action",
                kind: "restore",
                at: "2030-01-10T10:00:00.000Z",
                actor: { state: "known", actorId: admin },
                reason: "Mistake",
                revision: 3,
              },
            ],
          },
          {
            productId: third,
            access: "active",
            revision: 1,
            firstIssuedAt: "2030-01-07T10:00:00.000Z",
            origin: "course_activation",
            history: [
              {
                type: "source",
                kind: "activation",
                origin: "course_activation",
                sourceRef: "course:carol",
                at: "2030-01-07T10:00:00.000Z",
                actor: { state: "known", actorId: null },
                reason: "Verified course source activation",
              },
              ...["Twin A", "Twin B"].map((reason) => ({
                type: "source",
                kind: "manual_issue",
                origin: "manual",
                sourceRef: `manual:${reason}`,
                at: "2030-01-08T10:00:00.000Z",
                actor: { state: "unknown" },
                reason,
              })),
            ],
          },
        ],
      },
    });
  });

  test("names a revoked Product with its withdrawal", async () => {
    const result = await grants.readAccountProductAccess(owner, bob);
    expect(result.ok && result.value.products).toEqual([
      {
        productId: first,
        access: "revoked",
        revision: 2,
        firstIssuedAt: "2030-01-02T09:00:00.000Z",
        origin: "paid",
        history: [
          expect.objectContaining({
            type: "source",
            kind: "purchase",
            at: "2030-01-02T09:00:00.000Z",
          }),
          expect.objectContaining({
            type: "action",
            kind: "revoke",
            actor: { state: "known", actorId: owner },
            reason: "Refund",
          }),
        ],
      },
    ]);
  });

  test("names a migrated source as a transfer", async () => {
    const migrated = randomUUID();
    await db.prisma.$executeRaw`
      INSERT INTO account_rights.product_access(account_id, product_id, first_issued_at, revision)
      VALUES (${migrated}::uuid, ${first}::uuid, '2029-01-01T00:00:00Z', 1)`;
    await db.prisma.$executeRaw`
      INSERT INTO account_rights.product_access_sources(source, source_ref, account_id, product_id, issued_at, reason)
      VALUES ('migration_grant', ${`${randomUUID()}:${first}`}, ${migrated}::uuid, ${first}::uuid, '2029-01-01T00:00:00Z', 'Historical')`;
    await db.prisma.$executeRaw`
      INSERT INTO account_rights.product_access_actions(id, account_id, product_id, kind, reason, recorded_at, revision)
      VALUES (gen_random_uuid(), ${migrated}::uuid, ${first}::uuid, 'migrate', 'Preserved', '2029-01-01T00:00:00Z', 1)`;
    const result = await grants.readAccountProductAccess(owner, migrated);
    expect(result.ok && result.value.products[0]?.history).toEqual([
      expect.objectContaining({
        type: "source",
        kind: "transfer",
        origin: "unknown",
      }),
      expect.objectContaining({
        type: "action",
        kind: "migrate",
        actor: { state: "known", actorId: null },
      }),
    ]);
    expect(result.ok && result.value.products[0]?.origin).toBe("unknown");
  });

  test("answers an Account without Product Access with no products", async () => {
    expect(await grants.readAccountProductAccess(owner, dave)).toEqual({
      ok: true,
      value: { accountId: dave, products: [] },
    });
    expect(await grants.readAccountProductAccess(owner, "x")).toEqual({
      ok: false,
      error: { code: "invalid_input" },
    });
  });
});

describe("previewProductRevocation", () => {
  test("closes the community only when no other active Product keeps it", async () => {
    const preview = async (accountId: string, productId: string) => {
      const result = await grants.previewProductRevocation(owner, {
        accountId,
        productId,
      });
      if (!result.ok) throw new Error(result.error.code);
      return result.value;
    };
    expect(await preview(alice, first)).toMatchObject({
      affectedCount: 1,
      community: "closes",
    });
    expect(await preview(carol, first)).toMatchObject({
      affectedCount: 1,
      community: "remains",
    });
    expect(await preview(bob, first)).toMatchObject({
      affectedCount: 0,
      community: "remains",
    });
  });
});

describe("rights", () => {
  test("answers billing:manage and platform:admin and refuses other roles", async () => {
    const reads = (actor: string) => [
      grants.listAccessAccounts(actor, { productId: first }),
      grants.readAccessSummaries(actor, [alice]),
      grants.readAccountProductAccess(actor, alice),
    ];
    for (const result of await Promise.all(reads(admin)))
      expect(result.ok).toBe(true);
    for (const actor of [author, messenger, plain])
      for (const result of await Promise.all(reads(actor)))
        expect(result).toEqual({ ok: false, error: { code: "forbidden" } });
    for (const result of await Promise.all(reads("not-an-account")))
      expect(result).toEqual({ ok: false, error: { code: "invalid_input" } });
  });
});
