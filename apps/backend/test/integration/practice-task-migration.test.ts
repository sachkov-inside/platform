import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import {
  taskDefinitionSchema,
  taskDefinitionDigest,
} from "../../src/modules/product-tasks/domain/task-definition.js";
import { assembleProductMaterialReading } from "../../src/modules/materials/index.js";
import { ProductDirectory } from "../../src/modules/products/index.js";
import { assembleProductTaskImport } from "../../src/modules/product-tasks/facets/product-task-import/product-task-import.js";
import { practiceDefinitionDigest } from "../../src/modules/materials/domain/practice-definition.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { migrateThrough, upgradeToLatest } from "./setup/historical-upgrade.js";

let database: TestDatabase | undefined;
afterEach(async () => database?.dispose());

test("historical Practice migration retains complete requirements, source pins and receipts without rewriting existing Tasks", async () => {
  database = await createTestDatabase();
  await migrateThrough(database, "0110_product_sales_state");
  const productId = randomUUID();
  const chapterId = randomUUID();
  await database.prisma.product.create({
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
  await database.prisma.productMembership.create({
    data: { seriesId: productId, materialId },
  });
  await database.prisma.productProgrammePlacement.create({
    data: { id: randomUUID(), productId, chapterId, materialId, ordinal: 1 },
  });
  const sourceReference = {
    materialSourceId: "fixture:lesson",
    materialSourceRevision: "a".repeat(64),
  };
  await database.prisma.practiceDefinition.create({
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
  const original = await database.prisma.practiceDefinition.findUniqueOrThrow({
    where: { practiceId: "fixture:requirements" },
  });
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
    await database.prisma.practiceDefinition.findUniqueOrThrow({
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
    original: { definition, definition_digest: original.definitionDigest },
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

test("unowned, ambiguous and conflicting requirements remain passive with their original bindings", async () => {
  database = await createTestDatabase();
  await migrateThrough(database, "0110_product_sales_state");
  const products = [randomUUID(), randomUUID()];
  const chapters = [randomUUID(), randomUUID()];
  for (const [index, productId] of products.entries()) {
    await database.prisma.product.create({
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
    await database.prisma.material.create({
      data: {
        id: materialId,
        schemaVersion: 1,
        body: { blocks: [] },
        createdBy: randomUUID(),
        access: "free",
        publicationState: "draft",
        contentVersion: 3n,
        sourceId: sourceReference.materialSourceId,
        sourceRevision: sourceReference.materialSourceRevision,
        sourcePath: "lesson.md",
      },
    });
    await database.prisma.practiceDefinition.create({
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
      await database.prisma.productMembership.create({
        data: { seriesId: productId, materialId },
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
    practices: await database.prisma.practiceDefinition.findMany({
      orderBy: { practiceId: "asc" },
    }),
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
    await database.prisma.practiceDefinition.findMany({
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
      task_version: 2,
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
