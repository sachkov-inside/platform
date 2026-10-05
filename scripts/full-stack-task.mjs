// @ts-check
// Isolated full-stack Guide Task seed through real author APIs (#947); never used by production or
// the shared stand.
import { randomUUID } from "node:crypto";

import { z } from "zod";
import { convertMarkdown } from "../tools/authoring/markdown.mjs";

const receipt = z.object({ materialId: z.uuid(), contentVersion: z.number() });

/**
 * A Guide with one chapter, one free lesson and one free task placed after it.
 *
 * @param {string} origin
 * @param {string} accessToken
 */
export async function seedFullStackTask(origin, accessToken) {
  /** @param {string} path @param {unknown} [body] */
  const request = async (path, body) => {
    const response = await fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "idempotency-key": `fullstack-task-${path}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error(
        `Synthetic task seed ${path}: HTTP ${String(response.status)}; ${JSON.stringify(await response.json())}`,
      );
    return /** @type {unknown} */ (await response.json());
  };
  const guideSourceId = "synthetic:fullstack-task-guide";
  const guide = z.object({ id: z.uuid(), slug: z.string() }).parse(
    await request("/authoring/import/guides/reserve", {
      sourceId: guideSourceId,
      name: "Synthetic tasks",
      slug: "synthetic-tasks",
      summary: "Isolated Guide Task fixture",
    }),
  );
  const source = {
    id: "synthetic:fullstack-task-lesson",
    path: "task-lesson.md",
    revision: "a".repeat(64),
    showInFeed: false,
  };
  const reserved = receipt.parse(
    await request("/authoring/import/materials/reserve", { source }),
  );
  const lesson = receipt.parse(
    await request("/authoring/import/materials/apply", {
      source,
      materialId: reserved.materialId,
      expectedContentVersion: reserved.contentVersion,
      publicationState: "published",
      primaryVideoId: null,
      metadata: {
        title: "Synthetic task lesson",
        summary: "The lesson the task follows",
        access: "free",
        topicId: "72000000-0000-4000-8000-000000000002",
        formatId: "guide",
        tagIds: [],
        seriesIds: [guide.id],
        difficulty: null,
        outcomes: [],
      },
      body: convertMarkdown("Урок перед заданием.", {
        sourceId: source.id,
        sourcePath: source.path,
        link: (href) => href,
        image: (href) => href,
      }),
    }),
  );
  const chapterId = randomUUID();
  const order = z
    .object({ orderVersion: z.string() })
    .loose()
    .parse(await request(`/authoring/guides/${guide.id}/order`));
  await request("/authoring/import/guides/composition", {
    sourceId: guideSourceId,
    seriesId: guide.id,
    expectedOrderVersion: order.orderVersion,
    orderedMaterialIds: [lesson.materialId],
    chapters: [{ id: chapterId, name: "Глава 1", summary: "" }],
    chapterAssignments: { [lesson.materialId]: chapterId },
  });
  const code = "fullstack-task";
  await request("/authoring/import/tasks/apply", {
    sourceId: `synthetic:${code}`,
    code,
    guideId: guide.id,
    chapterId,
    position: 1,
    title: "Синтетическое задание",
    access: "free",
    definition: {
      schemaVersion: 1,
      situation: "Заказчик хочет видеть заявки участников.",
      result: ["Участник создаёт заявку и видит её статус."],
      freedom: "Стек выбирает участник.",
      criteria: [
        {
          id: "request",
          level: "required",
          requirement: "Участник создаёт заявку.",
          acceptableEvidence: ["Сценарий создания."],
        },
        {
          id: "deduplication",
          level: "additional",
          requirement: "Повтор не создаёт вторую заявку.",
          acceptableEvidence: ["Наблюдение повтора."],
        },
      ],
    },
    relatedMaterialSourceIds: [source.id],
    afterMaterialSourceId: source.id,
    publicationState: "published",
    provenance: {
      repository: "synthetic/fullstack",
      commit: "b".repeat(40),
      path: "task.yaml",
    },
    expectedRevision: null,
  });
  // The lesson comes from a source package: tests that compose Guides in the editor skip it.
  return { guideSlug: guide.slug, code, materialId: lesson.materialId };
}
