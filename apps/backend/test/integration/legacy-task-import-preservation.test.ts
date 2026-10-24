import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { migratePracticeRequirements } from "../../../../tools/authoring/legacy-practice-tasks.mjs";
import { assertLegacyTaskTargets } from "../../../../tools/authoring/legacy-task-targets.mjs";
import {
  previewTasks,
  syncSourceTasks,
} from "../../../../tools/authoring/task-import.mjs";
import { manifestSchema } from "../../../../tools/authoring/package.mjs";
import { sourceUuid } from "../../../../tools/authoring/markdown.mjs";
import { withJournal } from "../../../../tools/authoring/journal.mjs";
import {
  parseLocalResponse,
  type LocalRequest,
} from "../../../../tools/authoring/local-boundaries.mjs";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import {
  assembleProductMaterialReading,
  assembleMaterialResourceFacts,
} from "../../src/modules/materials/index.js";
import { ProductDirectory } from "../../src/modules/products/index.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import { assembleAccountRights } from "../../src/modules/account-rights/index.js";
import { accountId } from "../../src/modules/accounts/index.js";
import { assembleProductTaskResourceFacts } from "../../src/modules/product-tasks/adapters/content-access/product-task-resource-facts.js";
import { assembleLearningTasks } from "../../src/modules/product-tasks/index.js";
import { assembleProductTaskImport } from "../../src/modules/product-tasks/facets/product-task-import/product-task-import.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
registerFixedClock();
let database: TestDatabase | undefined;
let journalDirectory: string | undefined;
afterEach(async () => {
  try {
    await database?.dispose();
  } finally {
    if (journalDirectory !== undefined)
      await rm(journalDirectory, { recursive: true, force: true });
  }
});

test.each(["matching", "divergent", "wrong-material"] as const)(
  "legacy tooling preserves existing Task v2/submission for %s target requirements",
  async (scenario) => {
    database = await createMigratedTestDatabase();
    journalDirectory = await mkdtemp(join(tmpdir(), "legacy-task-transfer-"));
    const actor = randomUUID(),
      learnerId = accountId(randomUUID()),
      productId = randomUUID(),
      topicId = randomUUID();
    const chapterId = sourceUuid("fixture:course:chapter:chapter");
    const authorPolicy = { canManage: (account: string) => account === actor };
    const materials = assembleMaterials({
      prisma: database.prisma,
      authorPolicy,
    });
    const directory = new ProductDirectory(
      database.prisma,
      assembleProductMaterialReading(database.prisma),
    );
    const tasks = assembleProductTaskImport({
      prisma: database.prisma,
      directory,
      authorPolicy,
    });
    await database.prisma.product.create({
      data: {
        id: productId,
        sourceId: "fixture:course",
        slug: "legacy-target",
        name: "Accepted Product",
      },
    });
    await database.prisma.productChapter.create({
      data: { id: chapterId, productId, ordinal: 1, name: "Accepted chapter" },
    });
    await database.prisma.topic.create({
      data: { id: topicId, slug: "legacy-target", name: "Topic" },
    });
    await database.prisma.account.create({
      data: {
        id: learnerId,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: learnerId,
      },
    });
    for (const [index, code] of ["lesson", "other"].entries()) {
      const source = {
        id: `fixture:${code}`,
        path: `${code}.md`,
        revision: "a".repeat(64),
        showInFeed: false,
      };
      const reserved = await materials.authoring.reserveSourceMaterial({
        actor,
        source,
      });
      if (!reserved.ok) throw new Error(reserved.error.code);
      const applied = await materials.authoring.applySourceMaterial({
        actor,
        idempotencyKey: code,
        source,
        materialId: reserved.value.materialId,
        expectedContentVersion: reserved.value.contentVersion,
        publicationState: "published",
        primaryVideoId: null,
        metadata: {
          title: code,
          summary: code,
          access: "free",
          topicId,
          formatId: "guide",
          tagIds: [],
          seriesIds: [],
          difficulty: null,
          outcomes: [],
        },
        body: representativeDocument(`Complete ${code} context`),
      });
      if (!applied.ok) throw new Error(applied.error.code);
      await database.prisma.productMembership.create({
        data: { seriesId: productId, materialId: applied.value.materialId },
      });
      await database.prisma.productProgrammePlacement.create({
        data: {
          id: randomUUID(),
          productId,
          materialId: applied.value.materialId,
          chapterId,
          ordinal: index + 1,
        },
      });
    }
    const original = manifestSchema.parse({
      schemaVersion: 1,
      sourceNamespace: "fixture",
      selection: {
        productId: "course",
        chapterIds: ["chapter"],
        materialIds: ["lesson"],
        complete: true,
      },
      products: [
        {
          sourceId: "course",
          title: "Course",
          summary: "",
          complete: true,
          chapters: [
            {
              sourceId: "chapter",
              title: "Chapter",
              summary: "",
              materialIds: ["lesson"],
            },
          ],
          materialIds: ["lesson"],
          supplementaryMaterialIds: [],
        },
      ],
      materials: [
        {
          sourceId: "lesson",
          sourcePath: "lesson.md",
          sourceIds: [],
          relatedMaterialIds: [],
          readingTimeMinutes: null,
          kind: "guide",
          title: "Lesson",
          summary: "Lesson",
          stage: "published",
          topicId: null,
          access: "free",
          showInFeed: false,
          difficulty: null,
          outcomes: [],
          markdown: "Lesson",
          links: {},
          images: {},
          coverAssetId: null,
          coverAlt: null,
          video: null,
          videoChapters: [],
          artifacts: [],
        },
      ],
      assets: [],
      diagnostics: [],
      practiceDefinitions: [
        {
          practiceId: "fixture:requirements",
          definition: {
            schemaVersion: 1,
            title: "Old legacy title",
            businessInputs: "Original situation",
            expectedOutcome: "Original outcome",
            allowedFreedom: "Original freedom",
            criteria: [
              {
                id: "one",
                requirement: "Original requirement",
                acceptableEvidence: ["Original evidence"],
              },
            ],
          },
          sourceReference: {
            materialSourceId: "fixture:lesson",
            materialSourceRevision: "a".repeat(64),
          },
          provenance: {
            repository: "fixture/source",
            commit: "b".repeat(40),
            path: "old-legacy.json",
          },
          publicationState: "published",
        },
      ],
    });
    const manifest = migratePracticeRequirements(original);
    const converted = manifest.tasks?.[0];
    if (converted === undefined) throw new Error("Converted Task absent");
    const definition = {
      schemaVersion: 1 as const,
      situation: "Original situation",
      result: ["Original outcome"],
      freedom: "Original freedom",
      criteria: [
        {
          id: "one",
          level: "required" as const,
          requirement: "Original requirement",
          acceptableEvidence: ["Original evidence"],
        },
      ],
    };
    const body = {
      sourceId: "fixture:requirements",
      code: "requirements",
      productId,
      chapterId,
      position: 1,
      title: "Accepted current title",
      access: "free",
      definition: { ...definition, situation: "Initial requirements" },
      relatedMaterialSourceIds: ["fixture:lesson"],
      programmeVisibility: "embedded",
      embeddedMaterialSourceId:
        scenario === "wrong-material" ? "fixture:other" : "fixture:lesson",
      publicationState: "published",
      provenance: {
        repository: "fixture/current",
        commit: "c".repeat(40),
        path: "current-task.yaml",
      },
      expectedRevision: null,
    };
    const first = await tasks.apply(body, { actor, idempotencyKey: "task-v1" });
    if (!first.ok) throw new Error(first.error.code);
    const second = await tasks.apply(
      {
        ...body,
        definition:
          scenario === "divergent"
            ? { ...definition, result: ["Current accepted outcome"] }
            : definition,
        expectedRevision: first.value.revision,
      },
      { actor, idempotencyKey: "task-v2" },
    );
    expect(second).toMatchObject({ ok: true, value: { currentVersion: 2 } });
    const contentAccess = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      productTaskResourceFacts: assembleProductTaskResourceFacts(
        database.prisma,
      ),
      accountRights: assembleAccountRights({ prisma: database.prisma }),
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
    });
    const learning = assembleLearningTasks({
      prisma: database.prisma,
      directory,
      contentAccess,
      materialReader: materials.publishedMaterialReader,
      submissionsEnabled: true,
    });
    const subject = { kind: "account" as const, accountId: learnerId };
    const saved = await learning.submit({
      subject,
      source: "form",
      submission: {
        code: body.code,
        taskVersion: 2,
        submissionKey: "saved-v2-report",
        note: "Saved own report",
        reportText: "Report on accepted version two",
      },
    });
    expect(saved).toMatchObject({ ok: true });
    const before = {
      task: await database.prisma.productTask.findUniqueOrThrow({
        where: { code: body.code },
      }),
      versions: await database.prisma.productTaskVersion.findMany({
        orderBy: { version: "asc" },
      }),
      history: await learning.submissions({ subject, code: body.code }),
    };
    let writes = 0;
    const send = async (
      path: string,
      input?: unknown,
      key?: string,
    ): Promise<unknown> => {
      const result =
        path === "/authoring/import/materials/state?namespace=fixture"
          ? await materials.authoring.readSourceMaterialState({
              actor,
              namespace: "fixture",
            })
          : path === "/authoring/import/tasks/state?namespace=fixture"
            ? await tasks.readState({ namespace: "fixture" }, { actor })
            : path === "/authoring/collections?kind=product"
              ? await materials.authoring.listContentCollections({
                  actor,
                  kind: "product",
                })
              : path === "/authoring/import/tasks/validate"
                ? await tasks.validate(input, { actor })
                : path === "/authoring/import/tasks/apply"
                  ? (writes++,
                    await tasks.apply(input, {
                      actor,
                      idempotencyKey: key ?? "",
                    }))
                  : undefined;
      if (result === undefined)
        throw new Error(`Unexpected public transport path ${path}`);
      if (!result.ok) throw new Error(result.error.code);
      return result.value;
    };
    const request: LocalRequest = async (path, input, key) =>
      parseLocalResponse(path, await send(path, input, key));
    let failure: unknown;
    try {
      const preservedLegacyTasks = await assertLegacyTaskTargets(
        { manifest, legacyPractices: original.practiceDefinitions },
        send,
      );
      await withJournal(
        journalDirectory,
        "http://127.0.0.1:1710",
        async (context) => {
          const preview = await previewTasks(
            manifest,
            context.journal,
            request,
            () => true,
            preservedLegacyTasks,
          );
          expect(preview.tasks).toMatchObject([
            {
              sourceId: body.code,
              change: "unchanged",
              publication: "published",
            },
          ]);
          return syncSourceTasks(manifest, context, request, {
            productIdOf: () => productId,
            selected: () => true,
            preservedLegacyTasks,
          });
        },
      );
    } catch (error) {
      failure = error;
    }
    expect(
      await database.prisma.productTask.findUniqueOrThrow({
        where: { code: body.code },
      }),
    ).toEqual(before.task);
    expect(
      await database.prisma.productTaskVersion.findMany({
        orderBy: { version: "asc" },
      }),
    ).toEqual(before.versions);
    expect(await learning.submissions({ subject, code: body.code })).toEqual(
      before.history,
    );
    expect(writes).toBe(0);
    if (scenario === "matching") expect(failure).toBeUndefined();
    else {
      expect(failure).toBeInstanceOf(Error);
      if (!(failure instanceof Error))
        throw new Error("Expected an import refusal");
      expect(failure.message).toMatch(
        scenario === "divergent"
          ? /existing Task definition differs/u
          : /ownership\/source binding conflicts/u,
      );
    }
  },
);
