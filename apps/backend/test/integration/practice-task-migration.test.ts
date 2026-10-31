import { registerFixedClock } from "../support/fixed-clock.js";
import { grantProductFixture } from "./setup/product-access.js";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { accountId } from "../../src/modules/accounts/index.js";
import { assembleAccountRights } from "../../src/modules/account-rights/index.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import { assembleMaterialResourceFacts } from "../../src/modules/materials/index.js";
import { assembleLearningTasks } from "../../src/modules/product-tasks/index.js";
import { assembleProductTaskResourceFacts } from "../../src/modules/product-tasks/adapters/content-access/product-task-resource-facts.js";
import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import {
  taskDefinitionSchema,
  taskDefinitionDigest,
} from "../../src/modules/product-tasks/domain/task-definition.js";
import { assembleProductMaterialReading } from "../../src/modules/materials/index.js";
import {
  ProductDirectory,
  ProductDiscovery,
} from "../../src/modules/products/index.js";
import { assembleProductTaskImport } from "../../src/modules/product-tasks/facets/product-task-import/product-task-import.js";
import { practiceDefinitionDigest } from "../../src/modules/materials/domain/practice-definition.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { migrateThrough, upgradeToLatest } from "./setup/historical-upgrade.js";

registerFixedClock();

let database: TestDatabase | undefined;
afterEach(async () => database?.dispose());

test("historical Practice migration retains complete requirements, source pins and receipts without rewriting existing Tasks", async () => {
  database = await createTestDatabase();
  await migrateThrough(database, "0110_product_sales_state");
  const productId = randomUUID();
  const chapterId = randomUUID();
  await historicalProduct(database, {
    data: { id: productId, slug: "migration-course", name: "Migration course" },
  });
  await database.prisma.productChapter.create({
    data: { id: chapterId, productId, ordinal: 1, name: "Chapter" },
  });
  const definition = {
    schemaVersion: 1 as const,
    title: "Original requirements",
    businessInputs: "Original situation",
    expectedOutcome: "Я".repeat(16000),
    allowedFreedom: "Original freedom",
    criteria: [
      {
        id: "evidence",
        requirement: "Original requirement",
        acceptableEvidence: ["Original evidence"],
      },
    ],
  };
  const materialId = randomUUID();
  // Historical row fixture is intentionally independent of current authoring/read adapters.
  await database.prisma.$executeRaw(Prisma.sql`
    insert into materials.materials (id, title, summary, access, publication_state, content_version, source_id, source_revision, source_path, schema_version, body, created_by)
    values (${materialId}::uuid, 'Original lesson', '', 'free', 'draft', 7, 'fixture:lesson', ${"a".repeat(64)}, 'lesson.md', 1, '{"blocks":[]}'::jsonb, ${randomUUID()}::uuid)
  `);
  await historicalMembership(database, {
    data: { productId: productId, materialId },
  });
  await database.prisma.productProgrammePlacement.create({
    data: { id: randomUUID(), productId, chapterId, materialId, ordinal: 1 },
  });
  const sourceReference = {
    materialSourceId: "fixture:lesson",
    materialSourceRevision: "a".repeat(64),
  };
  await historicalPractice(database, {
    data: {
      practiceId: "fixture:requirements",
      materialId,
      definition,
      definitionDigest: practiceDefinitionDigest(definition, sourceReference),
      practiceVersion: 19n,
      boundSourceId: sourceReference.materialSourceId,
      boundSourceRevision: sourceReference.materialSourceRevision,
      boundContentVersion: 7n,
      publicationState: "unpublished",
      sourceRepository: "fixture/source",
      sourceCommit: "b".repeat(40),
      sourcePath: "lesson.md",
      updatedAt: new Date("2026-10-01T00:00:00Z"),
    },
  });
  const receipt = {
    practiceId: "fixture:requirements",
    practiceVersion: 19,
    definitionDigest: practiceDefinitionDigest(definition, sourceReference),
    materialId,
    boundContentVersion: 7,
    publicationState: "unpublished",
  };
  await database.prisma.practiceImportReceipt.create({
    data: {
      actorId: randomUUID(),
      operation: "apply_source_practice",
      idempotencyKey: "original-operation",
      requestFingerprint: "c".repeat(64),
      receipt,
    },
  });
  const original = await historicalPracticeRows(
    database,
    "fixture:requirements",
  ).then((rows) => rows[0]);
  await upgradeToLatest(database);
  const task = await database.prisma.productTask.findUniqueOrThrow({
    where: { sourceId: "fixture:requirements" },
    include: { versions: true },
  });
  expect(task).toMatchObject({
    productId,
    chapterId,
    embeddedMaterialId: materialId,
    currentVersion: 1,
    publicationState: "unpublished",
  });
  const version = task.versions[0];
  const parsed = taskDefinitionSchema.parse(version?.definition);
  expect(parsed).toMatchObject({
    schemaVersion: 1,
    situation: definition.businessInputs,
    result: [definition.expectedOutcome],
    freedom: definition.allowedFreedom,
    criteria: [{ ...definition.criteria[0], level: "required" }],
  });
  expect(version?.definitionDigest).toBe(taskDefinitionDigest(parsed));
  expect(
    await database.prisma.historicalPracticeDefinition.findUniqueOrThrow({
      where: { practiceId: "fixture:requirements" },
    }),
  ).toEqual(original);
  const audit = z
    .array(
      z.object({
        disposition: z.string(),
        practice_version: z.bigint(),
        bound_content_version: z.bigint(),
        task_id: z.string(),
        task_version: z.number(),
        original: z.record(z.string(), z.json()),
      }),
    )
    .parse(
      await database.prisma.$queryRaw(
        Prisma.sql`select * from product_tasks.legacy_practice_migrations`,
      ),
    );
  expect(audit).toHaveLength(1);
  expect(await database.prisma.practiceImportReceipt.findMany()).toMatchObject([
    { idempotencyKey: "original-operation", receipt },
  ]);
  expect(audit[0]).toMatchObject({
    disposition: "migrated",
    practice_version: 19n,
    bound_content_version: 7n,
    task_id: task.id,
    task_version: 1,
    original: { definition, definition_digest: original?.definitionDigest },
  });
  await expect(
    database.prisma.productTaskVersion.update({
      where: { taskId_version: { taskId: task.id, version: 1 } },
      data: { sourcePath: "rewritten.md" },
    }),
  ).rejects.toThrow(/immutable/u);
  await expect(
    database.prisma.productTaskVersion.delete({
      where: { taskId_version: { taskId: task.id, version: 1 } },
    }),
  ).rejects.toThrow(/immutable/u);
});

test("an actually migrated published Practice remains an embedded Task for its archived Product holder", async () => {
  database = await createTestDatabase();
  await migrateThrough(database, "0110_product_sales_state");
  const productId = randomUUID(),
    chapterId = randomUUID(),
    materialId = randomUUID(),
    topicId = randomUUID(),
    actor = randomUUID(),
    holder = randomUUID();
  await historicalProduct(database, {
    data: {
      id: productId,
      slug: "archived-migration",
      name: "Archived migration",
    },
  });
  await database.prisma.productChapter.create({
    data: { id: chapterId, productId, ordinal: 1, name: "Original chapter" },
  });
  await database.prisma.topic.create({
    data: { id: topicId, slug: "archive-migration", name: "Migration" },
  });
  const body = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { nodeId: randomUUID() },
        content: [{ type: "text", text: "Original published lesson" }],
      },
    ],
  };
  await database.prisma
    .$executeRaw(Prisma.sql`insert into materials.materials(id,title,summary,slug,access,publication_state,content_version,source_id,source_revision,source_path,schema_version,body,created_by,topic_id,format_id,first_published_at,published_at,published_by)
    values (${materialId}::uuid,'Original lesson','','archived-lesson','free','published',7,'archive:lesson',${"a".repeat(64)},'lesson.md',1,${JSON.stringify(body)}::jsonb,${actor}::uuid,${topicId}::uuid,'note','2026-10-01','2026-10-01',${actor}::uuid)`);
  // The historical schema predates later columns, so rows are written in its own SQL shape.
  await database.prisma.$executeRaw(
    Prisma.sql`insert into materials.published_materials(material_id,content_version,slug,title,summary,access,topic_id,format_id,public_search_text,published_by,published_at)
    values (${materialId}::uuid,7,'archived-lesson','Original lesson','','free',${topicId}::uuid,'note','Original lesson',${actor}::uuid,'2026-10-01T00:00:00Z')`,
  );
  await historicalMembership(database, { data: { productId, materialId } });
  await database.prisma.$executeRaw(
    Prisma.sql`insert into products.published_material_series_memberships(series_id,material_id) values (${productId}::uuid,${materialId}::uuid)`,
  );
  await database.prisma.productProgrammePlacement.create({
    data: { id: randomUUID(), productId, materialId, chapterId, ordinal: 1 },
  });
  const definition = {
    schemaVersion: 1 as const,
    title: "Original task",
    businessInputs: "Original situation",
    expectedOutcome: "Original outcome",
    allowedFreedom: "Original freedom",
    criteria: [
      {
        id: "original",
        requirement: "Original requirement",
        acceptableEvidence: ["Original evidence"],
      },
    ],
  };
  const sourceReference = {
    materialSourceId: "archive:lesson",
    materialSourceRevision: "a".repeat(64),
  };
  await historicalPractice(database, {
    data: {
      practiceId: "archive:requirements",
      materialId,
      definition,
      definitionDigest: practiceDefinitionDigest(definition, sourceReference),
      practiceVersion: 9n,
      boundSourceId: sourceReference.materialSourceId,
      boundSourceRevision: sourceReference.materialSourceRevision,
      boundContentVersion: 7n,
      publicationState: "published",
      sourceRepository: "fixture/original",
      sourceCommit: "b".repeat(40),
      sourcePath: "lesson.md",
      updatedAt: new Date("2026-10-01T00:00:00Z"),
    },
  });
  await upgradeToLatest(database);
  const migrated = await database.prisma.productTask.findUniqueOrThrow({
    where: { sourceId: "archive:requirements" },
  });
  expect(migrated).toMatchObject({
    embeddedMaterialId: materialId,
    programmeVisibility: "embedded",
    publicationState: "published",
    currentVersion: 1,
  });
  const versions = await database.prisma.productTaskVersion.findMany({
    where: { taskId: migrated.id },
  });
  await grantProductFixture(database.prisma, holder, productId);
  const materials = assembleMaterials({
    prisma: database.prisma,
    authorPolicy: { canManage: () => false },
  });
  const contentAccess = assembleContentAccess({
    materialResourceFacts: assembleMaterialResourceFacts(
      materials.materialContent,
    ),
    productTaskResourceFacts: assembleProductTaskResourceFacts(
      database.prisma,
      new ProductDiscovery(database.prisma),
    ),
    accountRights: assembleAccountRights({ prisma: database.prisma }),
    accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
  });
  const learning = assembleLearningTasks({
    prisma: database.prisma,
    directory: new ProductDirectory(
      database.prisma,
      assembleProductMaterialReading(database.prisma),
    ),
    contentAccess,
    materialReader: materials.publishedMaterialReader,
    submissionsEnabled: true,
  });
  await database.prisma.product.update({
    where: { id: productId },
    data: { archivedAt: new Date("2026-10-02T00:00:00Z") },
  });
  const subject = { kind: "account" as const, accountId: accountId(holder) };
  expect(await learning.materialTask({ subject, materialId })).toMatchObject({
    ok: true,
    value: {
      access: "open",
      task: {
        definition: {
          situation: "Original situation",
          result: ["Original outcome"],
        },
      },
    },
  });
  expect(await learning.list({ subject })).toMatchObject({
    ok: true,
    value: { tasks: [{ code: migrated.code }] },
  });
  expect(
    await learning.materialTask({ subject: { kind: "anonymous" }, materialId }),
  ).toMatchObject({ ok: false, error: { code: "task_not_found" } });
  expect(await learning.list({ subject: { kind: "anonymous" } })).toMatchObject(
    { ok: true, value: { tasks: [] } },
  );
  expect(
    await database.prisma.productTaskVersion.findMany({
      where: { taskId: migrated.id },
    }),
  ).toEqual(versions);
});

test("unowned, ambiguous and conflicting requirements remain passive with their original bindings", async () => {
  database = await createTestDatabase();
  await migrateThrough(database, "0110_product_sales_state");
  const products = [randomUUID(), randomUUID()];
  const chapters = [randomUUID(), randomUUID()];
  for (const [index, productId] of products.entries()) {
    await historicalProduct(database, {
      data: {
        id: productId,
        slug: `passive-${String(index)}`,
        name: "Product",
      },
    });
    await database.prisma.productChapter.create({
      data: {
        id: chapters[index] ?? "",
        productId,
        ordinal: 1,
        name: "Chapter",
      },
    });
  }
  const definition = {
    schemaVersion: 1 as const,
    title: "Identical titles prove no identity",
    businessInputs: "Situation",
    expectedOutcome: "Outcome",
    allowedFreedom: "Freedom",
    criteria: [
      {
        id: "one",
        requirement: "Requirement",
        acceptableEvidence: ["Evidence"],
      },
    ],
  };
  for (const [index, label] of [
    "unowned",
    "ambiguous",
    "conflicting",
    "existing",
    "source-collision",
  ].entries()) {
    const materialId = randomUUID();
    const sourceReference = {
      materialSourceId:
        index === 4 ? "fixture:source-collision" : `fixture:lesson-${label}`,
      materialSourceRevision: "a".repeat(64),
    };
    await database.prisma.$executeRaw(
      Prisma.sql`insert into materials.materials(id,schema_version,body,created_by,access,publication_state,content_version,source_id,source_revision,source_path)
      values (${materialId}::uuid,1,${JSON.stringify({ blocks: [] })}::jsonb,${randomUUID()}::uuid,'free','draft',3,${sourceReference.materialSourceId},${sourceReference.materialSourceRevision},'lesson.md')`,
    );
    await historicalPractice(database, {
      data: {
        practiceId: `fixture:${label}`,
        materialId,
        definition,
        definitionDigest: practiceDefinitionDigest(definition, sourceReference),
        practiceVersion: 41n,
        boundSourceId: sourceReference.materialSourceId,
        boundSourceRevision: sourceReference.materialSourceRevision,
        boundContentVersion: 3n,
        publicationState: "unpublished",
        sourceRepository: "fixture/source",
        sourceCommit: "d".repeat(40),
        sourcePath: "original.md",
        updatedAt: new Date("2026-10-01T00:00:00Z"),
      },
    });
    for (const ownerIndex of index === 0 ? [] : index === 1 ? [0, 1] : [0]) {
      const productId = products[ownerIndex] ?? "";
      await historicalMembership(database, {
        data: { productId: productId, materialId },
      });
      await database.prisma.productProgrammePlacement.create({
        data: {
          id: randomUUID(),
          productId,
          chapterId: chapters[ownerIndex] ?? null,
          materialId,
          ordinal: index + 1,
        },
      });
    }
    if (index === 2 || index === 3) {
      const taskId = randomUUID();
      const taskDefinition = {
        schemaVersion: 1 as const,
        situation: "Different accepted requirements",
        result: ["Accepted outcome"],
        freedom: "Accepted freedom",
        criteria: [
          {
            id: "one",
            level: "required" as const,
            requirement: "Accepted requirement",
            acceptableEvidence: ["Accepted evidence"],
          },
        ],
      };
      await database.prisma.$transaction(async (tx) => {
        await tx.productTask.create({
          data: {
            id: taskId,
            code: label,
            sourceId: index === 3 ? `fixture:${label}` : `other:${label}`,
            productId: products[0] ?? "",
            chapterId: chapters[0] ?? "",
            position: 1,
            title: definition.title,
            access: "free",
            relatedMaterialSourceIds: [],
            publicationState: "unpublished",
            currentVersion: 2,
            revision: 5,
            programmeVisibility: "embedded",
            embeddedMaterialId: materialId,
            createdAt: new Date("2026-10-01T00:00:00Z"),
            updatedAt: new Date("2026-10-01T00:00:00Z"),
          },
        });
        for (const version of [1, 2])
          await tx.productTaskVersion.create({
            data: {
              taskId,
              version,
              definition: taskDefinition,
              definitionDigest: taskDefinitionDigest(taskDefinition),
              sourceRepository: "fixture/current",
              sourceCommit: "e".repeat(40),
              sourcePath: "accepted.md",
              createdAt: new Date("2026-10-01T00:00:00Z"),
            },
          });
      });
      const learnerId = randomUUID();
      for (const taskVersion of [1, 2]) {
        const submissionId = randomUUID();
        await database.prisma.productTaskSubmission.create({
          data: {
            id: submissionId,
            accountId: learnerId,
            taskId,
            taskVersion,
            submissionKey: `saved-${String(taskVersion)}`,
            requestFingerprint: "f".repeat(64),
            source: "form",
            reportText: `Own version ${String(taskVersion)} report`,
            note: "Saved history",
            submittedAt: new Date("2026-10-01T00:00:00Z"),
          },
        });
        await database.prisma.productTaskAuthorFeedback.create({
          data: {
            submissionId,
            comment: "Author feedback is separate",
            reviewedAt: null,
            updatedBy: randomUUID(),
            updatedAt: new Date("2026-10-01T00:00:00Z"),
          },
        });
      }
      await database.prisma.productTaskReviewProgress.create({
        data: {
          accountId: learnerId,
          taskId,
          taskVersion: 2,
          runKey: randomUUID(),
          revision: 7,
          phase: "reviewing",
          summary: "Current snapshot",
          requestFingerprint: "f".repeat(64),
          updatedAt: new Date("2026-10-01T00:00:00Z"),
        },
      });
    }
  }
  const before = {
    submissions: await database.prisma.productTaskSubmission.findMany({
      orderBy: { id: "asc" },
    }),
    feedback: await database.prisma.productTaskAuthorFeedback.findMany({
      orderBy: { submissionId: "asc" },
    }),
    progress: await database.prisma.productTaskReviewProgress.findMany({
      orderBy: { taskId: "asc" },
    }),
    practices: await historicalPracticeRows(database),
    tasks: await database.prisma.productTask.findMany({
      orderBy: { code: "asc" },
    }),
    versions: await database.prisma.productTaskVersion.findMany({
      orderBy: [{ taskId: "asc" }, { version: "asc" }],
    }),
  };
  await upgradeToLatest(database);
  expect(
    await database.prisma.productTaskSubmission.findMany({
      orderBy: { id: "asc" },
    }),
  ).toEqual(before.submissions);
  expect(
    await database.prisma.productTaskAuthorFeedback.findMany({
      orderBy: { submissionId: "asc" },
    }),
  ).toEqual(before.feedback);
  expect(
    await database.prisma.productTaskReviewProgress.findMany({
      orderBy: { taskId: "asc" },
    }),
  ).toEqual(before.progress);
  const submission = before.submissions[0];
  if (submission === undefined)
    throw new Error("Historical submission fixture absent");
  await expect(
    database.prisma.productTaskSubmission.update({
      where: { id: submission.id },
      data: { note: "Rewritten" },
    }),
  ).rejects.toThrow(/immutable/u);
  // Use a submission without its separate feedback to prove the immutable DELETE trigger itself.
  await database.prisma.productTaskAuthorFeedback.delete({
    where: { submissionId: submission.id },
  });
  await expect(
    database.prisma.productTaskSubmission.delete({
      where: { id: submission.id },
    }),
  ).rejects.toThrow(/immutable/u);
  expect(
    await database.prisma.productTaskSubmission.findUniqueOrThrow({
      where: { id: submission.id },
    }),
  ).toEqual(submission);
  expect(
    await database.prisma.historicalPracticeDefinition.findMany({
      orderBy: { practiceId: "asc" },
    }),
  ).toEqual(before.practices);
  expect(
    await database.prisma.productTask.findMany({ orderBy: { code: "asc" } }),
  ).toEqual(before.tasks);
  expect(
    await database.prisma.productTaskVersion.findMany({
      orderBy: [{ taskId: "asc" }, { version: "asc" }],
    }),
  ).toEqual(before.versions);
  const rows = z
    .array(
      z.object({
        practice_id: z.string(),
        disposition: z.string(),
        task_version: z.number().nullable(),
      }),
    )
    .parse(
      await database.prisma.$queryRaw(
        Prisma.sql`select practice_id, disposition, task_version from product_tasks.legacy_practice_migrations order by practice_id`,
      ),
    );
  const actor = randomUUID();
  const importer = assembleProductTaskImport({
    prisma: database.prisma,
    directory: new ProductDirectory(
      database.prisma,
      assembleProductMaterialReading(database.prisma),
    ),
    authorPolicy: { canManage: (account: string) => account === actor },
  });
  const receiptsBefore =
    await database.prisma.productTaskImportReceipt.findMany();
  expect(
    await importer.apply(
      {
        sourceId: "fixture:source-collision",
        code: "source-collision",
        productId: products[0],
        chapterId: chapters[0],
        position: 1,
        title: definition.title,
        access: "free",
        definition: {
          schemaVersion: 1,
          situation: definition.businessInputs,
          result: [definition.expectedOutcome],
          freedom: definition.allowedFreedom,
          criteria: definition.criteria.map((criterion) => ({
            ...criterion,
            level: "required",
          })),
        },
        relatedMaterialSourceIds: [],
        publicationState: "unpublished",
        provenance: {
          repository: "fixture/source",
          commit: "a".repeat(40),
          path: "original.json",
        },
        expectedRevision: null,
      },
      { actor, idempotencyKey: "collision-probe" },
    ),
  ).toEqual({ ok: false, error: { code: "source_mismatch" } });
  expect(await database.prisma.productTaskImportReceipt.findMany()).toEqual(
    receiptsBefore,
  );
  expect(
    await database.prisma.productTask.findMany({ orderBy: { code: "asc" } }),
  ).toEqual(before.tasks);
  expect(
    await database.prisma.productTaskVersion.findMany({
      orderBy: [{ taskId: "asc" }, { version: "asc" }],
    }),
  ).toEqual(before.versions);
  expect(rows).toEqual([
    {
      practice_id: "fixture:ambiguous",
      disposition: "ambiguous_ownership",
      task_version: null,
    },
    {
      practice_id: "fixture:conflicting",
      disposition: "conflicting_task_binding",
      task_version: null,
    },
    {
      practice_id: "fixture:existing",
      disposition: "existing_task",
      task_version: 2 as const,
    },
    {
      practice_id: "fixture:source-collision",
      disposition: "unsupported_identity",
      task_version: null,
    },
    {
      practice_id: "fixture:unowned",
      disposition: "unowned",
      task_version: null,
    },
  ]);
});

async function historicalProduct(
  db: TestDatabase,
  input: { data: { id: string; slug: string; name: string } },
) {
  const { id, slug, name } = input.data;
  await db.prisma.$executeRaw(
    Prisma.sql`insert into products.series(id,slug,name) values (${id}::uuid,${slug},${name})`,
  );
}
async function historicalMembership(
  db: TestDatabase,
  input: { data: { productId: string; materialId: string } },
) {
  const { productId, materialId } = input.data;
  await db.prisma.$executeRaw(
    Prisma.sql`insert into products.series_memberships(series_id,material_id) values (${productId}::uuid,${materialId}::uuid)`,
  );
}
async function historicalPractice(
  db: TestDatabase,
  input: {
    data: {
      practiceId: string;
      materialId: string;
      definition: unknown;
      definitionDigest: string;
      practiceVersion: bigint;
      boundSourceId: string;
      boundSourceRevision: string;
      boundContentVersion: bigint;
      publicationState: string;
      sourceRepository: string;
      sourceCommit: string;
      sourcePath: string;
      updatedAt: Date;
    };
  },
) {
  const d = input.data;
  await db.prisma.$executeRaw(
    Prisma.sql`insert into materials.practice_definitions(practice_id,material_id,definition,definition_digest,practice_version,bound_source_id,bound_source_revision,bound_content_version,publication_state,source_repository,source_commit,source_path,updated_at) values (${d.practiceId},${d.materialId}::uuid,${JSON.stringify(d.definition)}::jsonb,${d.definitionDigest},${d.practiceVersion},${d.boundSourceId},${d.boundSourceRevision},${d.boundContentVersion},${d.publicationState},${d.sourceRepository},${d.sourceCommit},${d.sourcePath},${d.updatedAt})`,
  );
}
async function historicalPracticeRows(db: TestDatabase, practiceId?: string) {
  return db.prisma.$queryRaw<
    Awaited<ReturnType<typeof db.prisma.historicalPracticeDefinition.findMany>>
  >(
    Prisma.sql`select practice_id as "practiceId", material_id as "materialId", definition, definition_digest as "definitionDigest", practice_version as "practiceVersion", bound_source_id as "boundSourceId", bound_source_revision as "boundSourceRevision", bound_content_version as "boundContentVersion", publication_state as "publicationState", source_repository as "sourceRepository", source_commit as "sourceCommit", source_path as "sourcePath", updated_at as "updatedAt" from materials.practice_definitions ${practiceId === undefined ? Prisma.empty : Prisma.sql`where practice_id=${practiceId}`} order by practice_id`,
  );
}
