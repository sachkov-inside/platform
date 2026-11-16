import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";
import {
  assembleAccounts,
  bootstrapOwnerAccount,
} from "../../src/modules/accounts/index.js";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import type { MaterialAuthoring } from "../../src/modules/materials/index.js";
import { assembleProductIntakeCreation } from "../../src/entrypoints/composition/assemble-product-intake-creation.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import { ProductWaitlists } from "../../src/modules/sales-funnel/index.js";
import { assembleAccountRights } from "../../src/modules/account-rights/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";

registerFixedClock();
let database: TestDatabase | undefined;
let actor: string;
let authoring: MaterialAuthoring;
let createIntake: ReturnType<typeof assembleProductIntakeCreation>;
let waitlists: ProductWaitlists;
afterAll(async () => {
  await database?.dispose();
});
afterEach(async () => {
  await database?.drain();
});
beforeAll(async () => {
  database = await createMigratedTestDatabase();
  const owner = await bootstrapOwnerAccount(
    database.prisma,
    { issuer: "https://intake-scenarios.invalid", subject: "intake-owner" },
    "platform:admin",
  );
  actor = owner.accountId;
  const accounts = assembleAccounts({
    prisma: database.prisma,
    emailFingerprintKey: "synthetic-product-intake-email-fingerprint-key",
  });
  authoring = assembleMaterials({
    prisma: database.prisma,
    authorPolicy: {
      async canManage(accountId, transaction) {
        const result = await accounts.checkPermission(
          { accountId, permission: "materials:manage" },
          transaction,
        );
        if (!result.ok) throw new Error(result.error.code);
        return result.allowed;
      },
    },
  }).authoring;
  createIntake = assembleProductIntakeCreation({ prisma: database.prisma });
  waitlists = new ProductWaitlists({
    prisma: database.prisma,
    products: new ProductDiscovery(database.prisma),
    rights: assembleAccountRights({ prisma: database.prisma }),
    links: new TelegramAccountLinks(database.prisma),
    clock: () => new Date(fixedTestInstant()),
  });
});
async function product(slug: string) {
  const result = await authoring.createContentCollection({
    actor,
    kind: "product",
    name: "Учебный продукт для набора",
    slug,
    summary: "",
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

test("a fresh migrated database gains one explicit Product Intake through the trusted domain interface without joining anyone", async () => {
  const createdProduct = await product("intake-created");
  expect(await waitlists.readIntake(createdProduct.id)).toMatchObject({
    ok: false,
    error: { code: "intake_not_found" },
  });
  expect(
    await createIntake({
      intakeId: "98000000-0000-4000-8000-000000000001",
      productId: createdProduct.id,
      name: "Учебный набор",
      accepting: true,
    }),
  ).toEqual({
    ok: true,
    value: {
      intakeId: "98000000-0000-4000-8000-000000000001",
      productId: createdProduct.id,
      name: "Учебный набор",
      accepting: true,
    },
  });
  expect(await waitlists.readIntake(createdProduct.id)).toEqual({
    ok: true,
    value: {
      intakeId: "98000000-0000-4000-8000-000000000001",
      name: "Учебный набор",
    },
  });
  expect(await waitlists.read(actor, createdProduct.id)).toMatchObject({
    ok: true,
    value: { active: false },
  });
  expect(await waitlists.readForAccount(actor)).toEqual({
    ok: true,
    value: [],
  });
  expect(
    await waitlists.notificationAudience(
      "98000000-0000-4000-8000-000000000001",
    ),
  ).toMatchObject({ ok: true, value: { accountIds: [] } });
});

test("an identical normalized request returns the same stable intake", async () => {
  const createdProduct = await product("intake-replay");
  const command = {
    intakeId: "98abcdef-0000-4000-8000-000000000002",
    productId: createdProduct.id,
    name: "Учебный повтор",
    accepting: true,
  };
  expect(await createIntake(command)).toEqual({
    ok: true,
    value: {
      intakeId: "98abcdef-0000-4000-8000-000000000002",
      productId: createdProduct.id,
      name: "Учебный повтор",
      accepting: true,
    },
  });
  expect(
    await createIntake({
      ...command,
      intakeId: command.intakeId.toUpperCase(),
      productId: createdProduct.id.toUpperCase(),
      name: " Учебный повтор ",
    }),
  ).toEqual({
    ok: true,
    value: {
      intakeId: "98abcdef-0000-4000-8000-000000000002",
      productId: createdProduct.id,
      name: "Учебный повтор",
      accepting: true,
    },
  });
  expect(await waitlists.readIntake(createdProduct.id)).toEqual({
    ok: true,
    value: {
      intakeId: "98abcdef-0000-4000-8000-000000000002",
      name: "Учебный повтор",
    },
  });
});

test("an incompatible replay preserves the original identity, Product binding and accepting state", async () => {
  const original = await product("intake-incompatible");
  const other = await product("intake-other-product");
  const command = {
    intakeId: "98000000-0000-4000-8000-000000000003",
    productId: original.id,
    name: "Первоначальный набор",
    accepting: true,
  };
  expect(await createIntake(command)).toMatchObject({ ok: true });
  expect(await createIntake({ ...command, name: "Другое название" })).toEqual({
    ok: false,
    error: { code: "intake_conflict" },
  });
  expect(await createIntake({ ...command, productId: other.id })).toEqual({
    ok: false,
    error: { code: "intake_conflict" },
  });
  expect(await createIntake({ ...command, accepting: false })).toEqual({
    ok: false,
    error: { code: "intake_conflict" },
  });
  expect(await waitlists.readIntake(original.id)).toEqual({
    ok: true,
    value: {
      intakeId: "98000000-0000-4000-8000-000000000003",
      name: "Первоначальный набор",
    },
  });
  expect(await waitlists.readIntake(other.id)).toEqual({
    ok: false,
    error: { code: "intake_not_found" },
  });
});

function owned<Result>(operation: () => Promise<Result>): Promise<Result> {
  if (database === undefined) throw new Error("Missing test database");
  return database.run(operation);
}

test("concurrent identical requests converge on the same explicit intake", async () => {
  const current = await product("intake-concurrent-replay");
  const command = {
    intakeId: "98000000-0000-4000-8000-000000000004",
    productId: current.id,
    name: "Общий учебный набор",
    accepting: true,
  };
  const results = await Promise.all(
    Array.from({ length: 8 }, () => owned(() => createIntake(command))),
  );
  for (const result of results)
    expect(result).toEqual({
      ok: true,
      value: {
        intakeId: "98000000-0000-4000-8000-000000000004",
        productId: current.id,
        name: "Общий учебный набор",
        accepting: true,
      },
    });
  expect(await waitlists.readIntake(current.id)).toEqual({
    ok: true,
    value: {
      intakeId: "98000000-0000-4000-8000-000000000004",
      name: "Общий учебный набор",
    },
  });
});

test("competing explicit identities keep only one accepting intake on a Product", async () => {
  const current = await product("intake-competing-identities");
  const results = await Promise.all([
    owned(() =>
      createIntake({
        intakeId: "98000000-0000-4000-8000-000000000005",
        productId: current.id,
        name: "Конкурентный набор А",
        accepting: true,
      }),
    ),
    owned(() =>
      createIntake({
        intakeId: "98000000-0000-4000-8000-000000000006",
        productId: current.id,
        name: "Конкурентный набор Б",
        accepting: true,
      }),
    ),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toEqual([
    { ok: false, error: { code: "accepting_intake_exists" } },
  ]);
  const read = await waitlists.readIntake(current.id);
  expect(read.ok).toBe(true);
  if (!read.ok) throw new Error("Missing accepting intake");
  expect([
    "98000000-0000-4000-8000-000000000005",
    "98000000-0000-4000-8000-000000000006",
  ]).toContain(read.value.intakeId);
  expect(["Конкурентный набор А", "Конкурентный набор Б"]).toContain(
    read.value.name,
  );
});

test("one explicit identity cannot race into two Product bindings", async () => {
  const first = await product("intake-binding-first");
  const second = await product("intake-binding-second");
  const results = await Promise.all([
    owned(() =>
      createIntake({
        intakeId: "98000000-0000-4000-8000-000000000007",
        productId: first.id,
        name: "Одна идентичность",
        accepting: true,
      }),
    ),
    owned(() =>
      createIntake({
        intakeId: "98000000-0000-4000-8000-000000000007",
        productId: second.id,
        name: "Одна идентичность",
        accepting: true,
      }),
    ),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toEqual([
    { ok: false, error: { code: "intake_conflict" } },
  ]);
  const reads = await Promise.all([
    waitlists.readIntake(first.id),
    waitlists.readIntake(second.id),
  ]);
  expect(reads.filter((result) => result.ok)).toHaveLength(1);
  expect(reads.filter((result) => !result.ok)).toEqual([
    { ok: false, error: { code: "intake_not_found" } },
  ]);
});

test("an unknown Product cannot gain an intake", async () => {
  expect(
    await createIntake({
      intakeId: "98000000-0000-4000-8000-000000000008",
      productId: "98000000-0000-4000-8000-000000000099",
      name: "Неизвестный продукт",
      accepting: true,
    }),
  ).toEqual({ ok: false, error: { code: "product_not_found" } });
});

test("an archived Product refuses intake creation and keeps the old identity when restored", async () => {
  const current = await product("intake-archived-product");
  const command = {
    intakeId: "98000000-0000-4000-8000-000000000009",
    productId: current.id,
    name: "Набор до архива",
    accepting: true,
  };
  expect(await createIntake(command)).toMatchObject({ ok: true });
  const archived = await authoring.setContentCollectionArchive({
    actor,
    kind: "product",
    collectionId: current.id,
    expectedVersion: current.version,
    archived: true,
  });
  if (!archived.ok) throw new Error(archived.error.code);
  expect(await createIntake(command)).toEqual({
    ok: false,
    error: { code: "product_not_found" },
  });
  expect(
    await createIntake({
      ...command,
      intakeId: "98000000-0000-4000-8000-000000000010",
    }),
  ).toEqual({ ok: false, error: { code: "product_not_found" } });
  expect(await waitlists.readIntake(current.id)).toEqual({
    ok: false,
    error: { code: "intake_not_found" },
  });
  const restored = await authoring.setContentCollectionArchive({
    actor,
    kind: "product",
    collectionId: current.id,
    expectedVersion: archived.value.version,
    archived: false,
  });
  if (!restored.ok) throw new Error(restored.error.code);
  expect(await waitlists.readIntake(current.id)).toEqual({
    ok: true,
    value: {
      intakeId: "98000000-0000-4000-8000-000000000009",
      name: "Набор до архива",
    },
  });
});

test("an inactive explicit intake never displaces the accepting one", async () => {
  const current = await product("intake-inactive-product");
  expect(
    await createIntake({
      intakeId: "98000000-0000-4000-8000-000000000011",
      productId: current.id,
      name: "Не принимающий набор",
      accepting: false,
    }),
  ).toMatchObject({ ok: true, value: { accepting: false } });
  expect(await waitlists.readIntake(current.id)).toEqual({
    ok: false,
    error: { code: "intake_not_found" },
  });
  expect(
    await createIntake({
      intakeId: "98000000-0000-4000-8000-000000000012",
      productId: current.id,
      name: "Принимающий набор",
      accepting: true,
    }),
  ).toMatchObject({ ok: true, value: { accepting: true } });
  expect(await waitlists.readIntake(current.id)).toEqual({
    ok: true,
    value: {
      intakeId: "98000000-0000-4000-8000-000000000012",
      name: "Принимающий набор",
    },
  });
});

test.each([
  {
    intakeId: "not-a-uuid",
    productId: "98000000-0000-4000-8000-000000000099",
    name: "Набор",
    accepting: true,
  },
  {
    intakeId: "98000000-0000-4000-8000-000000000013",
    productId: "not-a-uuid",
    name: "Набор",
    accepting: true,
  },
  {
    intakeId: "98000000-0000-4000-8000-000000000013",
    productId: "98000000-0000-4000-8000-000000000099",
    name: "  ",
    accepting: true,
  },
  {
    intakeId: "98000000-0000-4000-8000-000000000013",
    productId: "98000000-0000-4000-8000-000000000099",
    name: "a".repeat(121),
    accepting: true,
  },
  {
    intakeId: "98000000-0000-4000-8000-000000000013",
    productId: "98000000-0000-4000-8000-000000000099",
    name: "Набор",
    accepting: true,
    unexpected: true,
  },
])("malformed intake commands report invalid_request", async (command) => {
  expect(await createIntake(command)).toEqual({
    ok: false,
    error: { code: "invalid_request" },
  });
});
