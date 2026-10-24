import { createHash, randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import {
  assembleProductMaterialReading,
  assembleMaterialResourceFacts,
} from "../../src/modules/materials/index.js";
import { ProductDirectory } from "../../src/modules/products/index.js";
import {
  assembleContentAccess,
  anonymousSubject,
} from "../../src/modules/content-access/index.js";
import { assembleAccountRights } from "../../src/modules/account-rights/index.js";
import { assembleProductTaskResourceFacts } from "../../src/modules/product-tasks/adapters/content-access/product-task-resource-facts.js";
import { assembleLearningTasks } from "../../src/modules/product-tasks/index.js";
import { assembleApplySourceTask } from "../../src/modules/product-tasks/features/import-product-task/import-product-task.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
registerFixedClock();
let database: TestDatabase | undefined;
afterEach(async () => database?.dispose());
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

test("public Task import and pinned multipart reader preserve a 16000-character Unicode outcome and near-limit legacy requirements", async () => {
  database = await createMigratedTestDatabase();
  const productId = randomUUID(),
    chapterId = randomUUID(),
    actor = randomUUID();
  await database.prisma.product.create({
    data: { id: productId, slug: "lossless-task", name: "Lossless task" },
  });
  await database.prisma.productChapter.create({
    data: { id: chapterId, productId, ordinal: 1, name: "Chapter" },
  });
  const materials = assembleMaterials({
    prisma: database.prisma,
    authorPolicy: { canManage: () => false },
  });
  const directory = new ProductDirectory(
    database.prisma,
    assembleProductMaterialReading(database.prisma),
  );
  const contentAccess = assembleContentAccess({
    materialResourceFacts: assembleMaterialResourceFacts(
      materials.materialContent,
    ),
    productTaskResourceFacts: assembleProductTaskResourceFacts(database.prisma),
    accountRights: assembleAccountRights({ prisma: database.prisma }),
    accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
  });
  const learning = assembleLearningTasks({
    prisma: database.prisma,
    directory,
    contentAccess,
    submissionsEnabled: true,
  });
  const apply = assembleApplySourceTask({
    prisma: database.prisma,
    directory,
    authorPolicy: { canManage: (account) => account === actor },
  });
  const definition = {
    schemaVersion: 1 as const,
    situation: "Situation",
    result: ["Я".repeat(16000)],
    freedom: "Freedom",
    criteria: Array.from({ length: 50 }, (_, index) => ({
      id: `criterion-${String(index)}`,
      level: "required" as const,
      requirement: "r".repeat(1750),
      acceptableEvidence: ["e".repeat(150)],
    })),
  };
  expect(Buffer.byteLength(JSON.stringify(definition))).toBeGreaterThan(
    128 * 1024,
  );
  const command = {
    code: "lossless-requirements",
    sourceId: "fixture:lossless-requirements",
    productId,
    chapterId,
    position: 1,
    title: "Lossless requirements",
    access: "free",
    definition,
    relatedMaterialSourceIds: [],
    publicationState: "published",
    provenance: {
      repository: "fixture/source",
      commit: "a".repeat(40),
      path: "original.md",
    },
    expectedRevision: null,
  };
  const imported = await apply(command, {
    actor,
    idempotencyKey: "original-requirements",
  });
  expect(imported).toMatchObject({ ok: true });
  const first = await learning.read({
    subject: anonymousSubject,
    code: command.code,
  });
  if (!first.ok) throw new Error(first.error.code);
  expect(first.value.partCount).toBeGreaterThan(1);
  let serialized = first.value.data;
  for (let part = 1; part < first.value.partCount; part++) {
    const result = await learning.read({
      subject: anonymousSubject,
      code: command.code,
      expectedContextVersion: first.value.contextVersion,
      expectedContentSha256: first.value.contentSha256,
      part,
    });
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.partSha256).toBe(sha256(result.value.data));
    expect(result.value.endOfContext).toBe(part === first.value.partCount - 1);
    serialized += result.value.data;
  }
  expect(sha256(serialized)).toBe(first.value.contentSha256);
  const context = z
    .object({
      payload: z.object({ task: z.object({ definition: z.json() }) }),
      terminalMarker: z.string(),
    })
    .parse(JSON.parse(serialized));
  expect(context.payload.task.definition).toEqual(definition);
  expect(context.terminalMarker).toBe(
    `END_CONTEXT:${first.value.contextVersion}`,
  );
  expect(
    await apply(command, { actor, idempotencyKey: "original-requirements" }),
  ).toEqual(imported);
  expect(await database.prisma.productTaskVersion.count()).toBe(1);
  const current = await database.prisma.productTask.findUniqueOrThrow({
    where: { code: command.code },
  });
  const changed = await apply(
    {
      ...command,
      expectedRevision: current.revision,
      definition: { ...definition, freedom: "Changed freedom" },
    },
    { actor, idempotencyKey: "next-requirements" },
  );
  expect(changed).toMatchObject({ ok: true });
  expect(
    await learning.read({
      subject: anonymousSubject,
      code: command.code,
      expectedContextVersion: first.value.contextVersion,
      expectedContentSha256: first.value.contentSha256,
      part: 1,
    }),
  ).toMatchObject({
    ok: false,
    error: { code: "task_context_version_mismatch" },
  });
});
