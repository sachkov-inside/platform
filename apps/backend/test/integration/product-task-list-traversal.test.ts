import { beforeAll, afterAll, expect, test } from "vitest";
import { z } from "zod";
import { MemberNames } from "../../src/modules/member-profiles/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { assembleSubmissionReview } from "../../src/modules/product-tasks/facets/submission-review/submission-review.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import { accountId } from "../../src/modules/accounts/index.js";
import {
  assembleMaterials,
  assembleMaterialResourceFacts,
  ProductDirectory,
} from "../../src/modules/materials/index.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import { assembleAccountRights } from "../../src/modules/account-rights/index.js";
import { assembleProductTaskResourceFacts } from "../../src/modules/product-tasks/adapters/content-access/product-task-resource-facts.js";
import { assembleLearningTasks } from "../../src/modules/product-tasks/index.js";
import { taskDefinitionDigest } from "../../src/modules/product-tasks/domain/task-definition.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { createQueryProtocolClient } from "./setup/query-protocol.js";

registerFixedClock();
const id = (ordinal: number) =>
  `46000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
const subject = { kind: "account" as const, accountId: accountId(id(9001)) };
const definition = {
  schemaVersion: 1 as const,
  situation: "A participant sees their own request.",
  result: ["The participant sees the request."],
  freedom: "Any implementation.",
  criteria: [
    {
      id: "ownership",
      level: "required" as const,
      requirement: "Requests belong to their participant.",
      acceptableEvidence: ["Ownership is checked."],
    },
  ],
};
let database: TestDatabase;
let disposeDatabase: (() => Promise<void>) | undefined;
let disposeMeasured: (() => Promise<void>) | undefined;
let measured: ReturnType<typeof createQueryProtocolClient>;
beforeAll(async () => {
  database = await createMigratedTestDatabase();
  disposeDatabase = () => database.dispose();
  await database.prisma.account.createMany({
    data: [9001, 9002].map((ordinal) => ({
      id: id(ordinal),
      logtoIssuer: "https://identity.example.test",
      logtoSubject: id(ordinal),
    })),
  });
  const products = [
    1,
    2,
    3,
    ...Array.from({ length: 101 }, (_, index) => 10001 + index),
  ].map((ordinal) => ({
    id: id(ordinal),
    slug: `traversal-${String(ordinal)}`,
    name: `Traversal ${String(ordinal)}`,
  }));
  await database.prisma.product.createMany({ data: products });
  await database.prisma.productChapter.createMany({
    data: products.map((product, index) => ({
      id: id(50001 + index),
      productId: product.id,
      name: "Chapter",
      ordinal: 1,
    })),
  });
  const tasks = [
    ...Array.from({ length: 501 }, (_, index) => ({
      ordinal: 1001 + index,
      product: 1,
      chapter: 50001,
      position: index + 1,
      access: index === 500 ? "free" : "closed",
    })),
    ...Array.from({ length: 501 }, (_, index) => ({
      ordinal: 2001 + index,
      product: 2,
      chapter: 50002,
      position: index + 1,
      access: "free",
    })),
    { ordinal: 3001, product: 3, chapter: 50003, position: 1, access: "free" },
    ...Array.from({ length: 101 }, (_, index) => ({
      ordinal: 20001 + index,
      product: 10001 + index,
      chapter: 50004 + index,
      position: 1,
      access: "free",
    })),
  ];
  await database.prisma.$transaction(async (tx) => {
    await tx.productTask.createMany({
      data: tasks.map((task) => ({
        id: id(task.ordinal),
        code: `task-${String(task.ordinal)}`,
        sourceId: `synthetic:task-${String(task.ordinal)}`,
        productId: id(task.product),
        chapterId: id(task.chapter),
        position: task.position,
        title: `Task ${String(task.ordinal)}`,
        access: task.access,
        relatedMaterialSourceIds: [],
        publicationState: "published",
        currentVersion: 1,
        revision: 1,
        createdAt: new Date("2026-10-01T00:00:00Z"),
        updatedAt: new Date("2026-10-01T00:00:00Z"),
      })),
    });
    await tx.productTaskVersion.createMany({
      data: tasks.map((task) => ({
        taskId: id(task.ordinal),
        version: 1,
        definition,
        definitionDigest: taskDefinitionDigest(definition),
        sourceRepository: "synthetic/fixtures",
        sourceCommit: "a".repeat(40),
        sourcePath: `${String(task.ordinal)}.json`,
        createdAt: new Date("2026-10-01T00:00:00Z"),
      })),
    });
  });
  await database.prisma.productTaskSubmission.createMany({
    data: Array.from({ length: 51 }, (_, index) => ({
      id: id(4001 + index),
      accountId: subject.accountId,
      taskId: id(3001),
      taskVersion: 1,
      submissionKey: `history-${String(index)}`,
      requestFingerprint: "b".repeat(64),
      source: "form",
      reportText: `Attempt ${String(index + 1)}`,
      note: "Own attempt",
      submittedAt: new Date(
        index === 50 ? "2026-10-02T00:00:00Z" : "2026-10-01T00:00:00Z",
      ),
    })),
  });
  await database.prisma.productTaskSubmission.createMany({
    data: Array.from({ length: 101 }, (_, index) => ({
      id: id(30001 + index),
      accountId: subject.accountId,
      taskId: id(20001 + index),
      taskVersion: 1,
      submissionKey: `directory-${String(index)}`,
      requestFingerprint: "c".repeat(64),
      source: "form",
      reportText: "Directory attempt",
      note: "Own attempt",
      submittedAt: new Date("2026-10-01T00:00:00Z"),
    })),
  });
  await database.prisma.productTaskSubmission.create({
    data: {
      id: id(6001),
      accountId: id(9002),
      taskId: id(3001),
      taskVersion: 1,
      submissionKey: "other-account-history",
      requestFingerprint: "d".repeat(64),
      source: "form",
      reportText: "Another Account's attempt",
      note: "Other attempt",
      submittedAt: new Date("2026-10-03T00:00:00Z"),
    },
  });
  await database.prisma.productTaskAuthorFeedback.create({
    data: {
      submissionId: id(4001),
      comment: "Oldest feedback stays reachable",
      reviewedAt: new Date("2026-10-02T00:00:00Z"),
      updatedBy: id(9002),
      updatedAt: new Date("2026-10-02T00:00:00Z"),
    },
  });
  measured = createQueryProtocolClient(database.url);
  disposeMeasured = () => measured.prisma.$disconnect();
  await measured.prisma.productTask.count();
});
afterAll(async () => {
  try {
    await disposeMeasured?.();
  } finally {
    await disposeDatabase?.();
  }
});
function owners() {
  const prisma = measured.prisma;
  const materials = assembleMaterials({
    prisma,
    authorPolicy: { canManage: () => false },
  });
  const contentAccess = assembleContentAccess({
    materialResourceFacts: assembleMaterialResourceFacts(
      materials.materialContent,
    ),
    productTaskResourceFacts: assembleProductTaskResourceFacts(prisma),
    accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
    accountRights: assembleAccountRights({ prisma }),
  });
  let availabilityCalls = 0;
  const tasks = assembleLearningTasks({
    prisma,
    directory: new ProductDirectory(prisma),
    contentAccess: {
      ...contentAccess,
      checkAvailabilityMany: (query) => {
        availabilityCalls++;
        return contentAccess.checkAvailabilityMany(query);
      },
    },
    submissionsEnabled: true,
  });
  return { tasks, availabilityCalls: () => availabilityCalls };
}

test("500 inaccessible Tasks do not conceal the accessible Task 501", async () => {
  const owner = owners();
  const measuredRead = await measured.measure(() =>
    owner.tasks.list({ subject, productSlug: "traversal-1" }),
  );
  process.stdout.write(
    `PC1 seed excluded ${JSON.stringify({ sql: measuredRead.statements.length, availabilityCalls: owner.availabilityCalls(), providerRequests: 0 })}\n`,
  );
  expect(measuredRead.result).toMatchObject({
    ok: true,
    value: { tasks: [{ code: "task-1501" }] },
  });
});
test("programme composition preserves Task 501 without a silent authoring bound", async () => {
  const owner = owners();
  const measuredRead = await measured.measure(() =>
    owner.tasks.chapterTasks({ subject, productId: id(2) }),
  );
  process.stdout.write(
    `PC2 seed excluded ${JSON.stringify({ sql: measuredRead.statements.length, availabilityCalls: owner.availabilityCalls(), providerRequests: 0 })}\n`,
  );
  if (!measuredRead.result.ok) throw new Error(measuredRead.result.error.code);
  expect(measuredRead.result.value.tasks).toHaveLength(501);
  expect(measuredRead.result.value.tasks.at(-1)?.code).toBe("task-2501");
});

test("51 own attempts and the oldest feedback remain reachable through stable scoped cursors", async () => {
  const owner = owners();
  const seen: string[] = [];
  let after: string | undefined;
  let pages = 0;
  let firstContinuation: string | undefined;
  let sql = 0;
  let bytes = 0;
  for (;;) {
    const observation = await measured.measure(() =>
      owner.tasks.submissions({
        subject,
        code: "task-3001",
        ...(after === undefined ? {} : { after }),
      }),
    );
    if (!observation.result.ok) throw new Error(observation.result.error.code);
    const page = observation.result.value;
    if (after === undefined)
      process.stdout.write(
        `PAG06 first page seed excluded ${JSON.stringify({ sql: observation.statements.length, rows: page.submissions.length, bytes: Buffer.byteLength(JSON.stringify(page)) })}\n`,
      );
    pages++;
    sql += observation.statements.length;
    bytes += Buffer.byteLength(JSON.stringify(page));
    seen.push(...page.submissions.map(({ submissionId }) => submissionId));
    expect(page.latestSubmittedAt).toBe("2026-10-02T00:00:00.000Z");
    const next = z.string().nullable().parse(Reflect.get(page, "nextCursor"));
    expect(page.submissions.length).toBeLessThanOrEqual(50);
    if (next === null) {
      expect(page.submissions.at(-1)?.authorFeedback?.comment).toBe(
        "Oldest feedback stays reachable",
      );
      break;
    }
    firstContinuation ??= next;
    after = next;
  }
  process.stdout.write(
    `PAG06 seed excluded ${JSON.stringify({ pages, sql, bytes, providerRequests: 0 })}\n`,
  );
  expect(seen).toEqual(
    Array.from({ length: 51 }, (_, index) => id(4051 - index)),
  );
  expect(pages).toBe(2);
  if (firstContinuation === undefined)
    throw new Error("Missing history continuation");
  const retry = await owner.tasks.submissions({
    subject,
    code: "task-3001",
    after: firstContinuation,
  });
  expect(retry).toMatchObject({
    ok: true,
    value: {
      submissions: [
        {
          submissionId: id(4001),
          authorFeedback: { comment: "Oldest feedback stays reachable" },
        },
      ],
      nextCursor: null,
    },
  });
  const wrongAccount = await owner.tasks.submissions({
    subject: { kind: "account", accountId: accountId(id(9002)) },
    code: "task-3001",
    after: firstContinuation,
  });
  expect(wrongAccount).toEqual({
    ok: false,
    error: { code: "invalid_request_shape" },
  });
  const wrongTask = await owner.tasks.submissions({
    subject,
    code: "task-1501",
    after: firstContinuation,
  });
  expect(wrongTask).toEqual({
    ok: false,
    error: { code: "invalid_request_shape" },
  });
  const other = await owner.tasks.submissions({
    subject: { kind: "account", accountId: accountId(id(9002)) },
    code: "task-3001",
  });
  expect(other).toMatchObject({
    ok: true,
    value: { submissions: [{ submissionId: id(6001) }] },
  });
});

test("author submission pages and filters remain usable across 101 Products without oversized directory calls", async () => {
  const directory = new ProductDirectory(measured.prisma);
  const lookupSizes: number[] = [];
  const review = assembleSubmissionReview({
    prisma: measured.prisma,
    directory: {
      products: (query) => {
        lookupSizes.push(
          "ids" in query ? query.ids.length : query.slugs.length,
        );
        return directory.products(query);
      },
    },
    authorPolicy: { canManage: (actor) => actor === id(9002) },
    identities: new TelegramAccountLinks(measured.prisma),
    names: new MemberNames(measured.prisma),
  });
  const first = await measured.measure(() => review.list(id(9002), {}));
  process.stdout.write(
    `PAG07 seed excluded ${JSON.stringify({ sql: first.statements.length, lookupSizes, providerRequests: 0, ok: first.result.ok })}\n`,
  );
  if (!first.result.ok) throw new Error(first.result.error.code);
  expect(first.result.value.submissions).toHaveLength(25);
  const filtered = await review.list(id(9002), { productId: id(10101) });
  expect(filtered).toMatchObject({
    ok: true,
    value: { submissions: [{ task: { code: "task-20101" } }] },
  });
  const next = await review.list(id(9002), {
    cursor: first.result.value.nextCursor,
  });
  expect(next.ok).toBe(true);
  if (!next.ok) throw new Error(next.error.code);
  expect(next.value.submissions).toHaveLength(25);
  const reachableProducts = new Set(
    first.result.value.products.map(({ id }) => id),
  );
  let productCursor = first.result.value.nextProductCursor;
  let filterPages = 1;
  while (productCursor !== null) {
    const page = await review.list(id(9002), { productCursor });
    if (!page.ok) throw new Error(page.error.code);
    filterPages++;
    for (const product of page.value.products)
      reachableProducts.add(product.id);
    productCursor = page.value.nextProductCursor;
  }
  expect(reachableProducts.size).toBe(104);
  expect(filterPages).toBe(5);
  expect(lookupSizes.every((size) => size <= 100)).toBe(true);
  process.stdout.write(
    `PAG07 complete filter traversal ${JSON.stringify({ filterPages, products: reachableProducts.size, lookupSizes })}\n`,
  );
});
