// @ts-check
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { learningScenario } from "./learning.mjs";
import { isolatedScenarioApi } from "./isolated-api.mjs";
import { convertMarkdown } from "../tools/authoring/markdown.mjs";

const collection = z.object({ id: z.uuid() }).loose();
const receipt = z
  .object({ materialId: z.uuid(), contentVersion: z.number().int().positive() })
  .loose();
const order = z.object({ orderVersion: z.string() }).loose();

/**
 * Populate the API owned by the caller's disposable instance, through real authoring interfaces.
 * The instance controller binds the address to its process and the database to its owned name.
 * @param {{api: string; databaseName: string; ownerToken: string; holderToken: string}} input
 */
export async function seedLearningScenario({
  api,
  databaseName,
  ownerToken,
  holderToken,
}) {
  const request = isolatedScenarioApi({ api, databaseName, ownerToken });
  const facts = learningScenario;
  const productSourceId = "synthetic-scenarios:learning";
  const topic = collection.parse(
    await request("POST", "/authoring/collections", {
      kind: "topic",
      name: facts.topic.name,
      slug: facts.topic.slug,
      summary: facts.topic.summary,
    }),
  );
  const product = collection.parse(
    await request("POST", "/authoring/import/products/reserve", {
      sourceId: productSourceId,
      name: facts.product.name,
      slug: facts.product.slug,
      summary: facts.product.summary,
    }),
  );
  /** @type {Map<string, {materialId: string; contentVersion: number}>} */
  const materials = new Map();
  for (const lesson of facts.lessons) {
    const source = {
      version: 2,
      id: `synthetic-scenarios:${lesson.key}`,
      path: `learning/${lesson.key}.md`,
      revision: "a".repeat(64),
    };
    const reserved = receipt.parse(
      await request("POST", "/authoring/import/materials/reserve", { source }),
    );
    const metadata = {
      title: lesson.title,
      summary: lesson.summary,
      access: lesson.access,
      difficulty: "basic",
      outcomes: [],
      topicId: topic.id,
      formatId: facts.format.id,
      tagIds: [],
      productIds: [product.id],
    };
    const markdown = [
      `## ${facts.reading.openingHeading}`,
      lesson.summary,
      `## ${facts.reading.checkHeading}`,
      facts.reading.checkInstruction,
      ...(lesson.key === facts.artifact.material
        ? [
            `[${facts.artifact.downloadLabel}](artifact:${facts.artifact.reference})`,
          ]
        : []),
    ].join("\n\n");
    const body = convertMarkdown(markdown, {
      sourcePath: source.path,
      sourceId: source.id,
      link: (href) => {
        if (
          href !== `artifact:${facts.artifact.reference}` ||
          lesson.key !== facts.artifact.material
        )
          throw new Error(`Undeclared learning artifact reference ${href}`);
        return `/api/products/${product.id}/artifact-sources/${encodeURIComponent(facts.artifact.sourceId)}/file`;
      },
      image: () => {
        throw new Error("Learning scenario declares no images");
      },
    });
    const published = receipt.parse(
      await request("POST", "/authoring/import/materials/apply", {
        source,
        materialId: reserved.materialId,
        expectedContentVersion: reserved.contentVersion,
        publicationState: "published",
        primaryVideoId: null,
        notifyTelegram: false,
        metadata,
        body,
      }),
    );
    materials.set(lesson.key, published);
  }
  /** @param {string} key */
  function materialId(key) {
    const material = materials.get(key);
    if (material === undefined)
      throw new Error(`Missing learning Material ${key}`);
    return material.materialId;
  }
  const current = order.parse(
    await request("GET", `/authoring/products/${product.id}/order`),
  );
  const chapters = facts.chapters.map((chapter) => ({
    id: chapter.id,
    name: chapter.name,
    summary: "",
    supplementaryMaterialIds: chapter.supplementary.map(materialId),
  }));
  const placements = facts.chapters.flatMap((chapter, index) =>
    chapter.lessons.map((key) => ({
      id: randomUUID(),
      materialId: materialId(key),
      chapterId: chapters[index]?.id,
      stepGroup: null,
    })),
  );
  await request("POST", "/authoring/import/products/composition", {
    sourceId: productSourceId,
    productId: product.id,
    expectedOrderVersion: current.orderVersion,
    orderedMaterialIds: facts.lessons.map(({ key }) => materialId(key)),
    chapters,
    programmePlacements: placements,
  });
  const holder = z
    .object({ account: z.object({ accountId: z.uuid() }) })
    .parse(await request("POST", "/accounts", undefined, holderToken));
  await request("POST", "/admin/access/products/issue", {
    accountId: holder.account.accountId,
    productId: product.id,
    reason: "Синтетический сценарий обучения",
    sourceRef: "synthetic-scenarios:learning",
  });
  for (const key of facts.learning.completed)
    await request(
      "PUT",
      `/reading-activity/materials/${materialId(key)}`,
      { isRead: true, expectedVersion: 0, commandId: randomUUID() },
      holderToken,
    );
  await request(
    "POST",
    "/reading-activity/opens",
    {
      materialId: materialId(facts.learning.started),
      contentVersion: materials.get(facts.learning.started)?.contentVersion,
      commandId: randomUUID(),
    },
    holderToken,
  );
  await request(
    "PUT",
    `/reading-activity/materials/${materialId(facts.learning.started)}/opened-parts`,
    { openedParts: facts.learning.openedParts },
    holderToken,
  );
  await request(
    "PUT",
    `/bookmarks/materials/${materialId(facts.learning.bookmark)}`,
    {},
    holderToken,
  );
  const { introducedIn, ...term } = facts.glossary;
  await request("PUT", "/authoring/glossary/terms", {
    terms: [
      { ...term, introducedInSourceId: `synthetic-scenarios:${introducedIn}` },
    ],
  });
  const taskChapterIndex = facts.chapters.findIndex(
    (chapter) => chapter.key === facts.task.chapter,
  );
  const taskChapter = chapters[taskChapterIndex];
  if (taskChapter === undefined)
    throw new Error("Missing learning Task chapter");
  const task = {
    sourceId: `synthetic-scenarios:${facts.task.code}`,
    code: facts.task.code,
    productId: product.id,
    chapterId: taskChapter.id,
    position: 1,
    title: facts.task.title,
    access: facts.task.access,
    relatedMaterialSourceIds: facts.task.relatedMaterials.map(
      (key) => `synthetic-scenarios:${key}`,
    ),
    afterMaterialSourceId: `synthetic-scenarios:${facts.task.after}`,
    publicationState: "published",
    provenance: {
      repository: "synthetic/scenarios",
      commit: "a".repeat(40),
      path: "learning/task.yaml",
    },
  };
  const version = z
    .object({ revision: z.number(), currentVersion: z.number() })
    .loose();
  const first = version.parse(
    await request("POST", "/authoring/import/tasks/apply", {
      ...task,
      definition: facts.task.outdatedDefinition,
      expectedRevision: null,
    }),
  );
  await request(
    "POST",
    `/accounts/current/product-tasks/${task.code}/submissions`,
    {
      taskVersion: first.currentVersion,
      submissionKey: randomUUID(),
      note: facts.task.outdatedSubmissionNote,
    },
    holderToken,
  );
  const currentTask = version.parse(
    await request("POST", "/authoring/import/tasks/apply", {
      ...task,
      definition: facts.task.definition,
      expectedRevision: first.revision,
    }),
  );
  const submitted = z
    .object({ submissionId: z.uuid() })
    .loose()
    .parse(
      await request(
        "POST",
        `/accounts/current/product-tasks/${task.code}/submissions`,
        {
          taskVersion: currentTask.currentVersion,
          submissionKey: randomUUID(),
          note: facts.task.submission.note,
        },
        holderToken,
      ),
    );
  await request(
    "PUT",
    `/authoring/product-tasks/submissions/${submitted.submissionId}/feedback`,
    facts.task.feedback,
  );
  const artifactBytes = Buffer.from(facts.artifact.text, "utf8");
  const artifact = new FormData();
  for (const [key, value] of Object.entries({
    productSourceId,
    sourceId: facts.artifact.sourceId,
    title: facts.artifact.title,
    purpose: facts.artifact.purpose,
    access: facts.artifact.access,
    declaredSize: String(artifactBytes.length),
    checksumSha256: createHash("sha256").update(artifactBytes).digest("hex"),
  }))
    artifact.set(key, value);
  artifact.set(
    "file",
    new Blob([artifactBytes], { type: facts.artifact.contentType }),
    facts.artifact.filename,
  );
  await request(
    "POST",
    `/authoring/import/products/${product.id}/artifacts`,
    artifact,
  );
  return { productId: product.id, materials, chapters };
}
