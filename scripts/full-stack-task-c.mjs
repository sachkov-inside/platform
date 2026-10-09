// @ts-check
// Synthetic package v2 import for the isolated full-stack check, never the owner's stand.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

import { z } from "zod";

import { canonical, checksum } from "../tools/authoring/package.mjs";
import { syncLocal } from "../tools/authoring/local-sync.mjs";
import {
  parseJournal,
  materialReceiptSchema,
  isJournalOperation,
} from "../tools/authoring/local-boundaries.mjs";

/** @param {string} origin @param {string} accessToken */
export async function seedFullStackTaskC(origin, accessToken) {
  const directory = await mkdtemp(join(tmpdir(), "inside-task-c-"));
  try {
    const imageBytes = await readFile(
      resolve("apps/web/.storybook/fixtures/reader-images/960"),
    );
    await writeFile(join(directory, "diagram.png"), imageBytes);
    const imageVariants = {
      wideLight: "scene-wide-light",
      wideDark: "scene-wide-dark",
      tallLight: "scene-tall-light",
      tallDark: "scene-tall-dark",
    };
    const sceneAssets = [];
    for (const [variant, sourceId] of Object.entries(imageVariants)) {
      const bytes = await readFile(
        resolve(`apps/web/.storybook/fixtures/image-variants/${variant}.png`),
      );
      const path = `${sourceId}.png`;
      await writeFile(join(directory, path), bytes);
      sceneAssets.push({
        sourceId,
        path,
        sha256: checksum(bytes),
        mimeType: "image/png",
      });
    }
    const provenance = {
      repository: "synthetic/fullstack",
      commit: "b".repeat(40),
      path: "task.yaml",
    };
    const padding = Array.from(
      { length: 20 },
      () =>
        "Синтетический текст перед целевым разделом для проверки прокрутки.",
    ).join("\n\n");
    const tail = Array.from(
      { length: 20 },
      () => "Продолжение после раздела для проверки позиции заголовка.",
    ).join("\n\n");
    const duplicateHeadings = "## Раздел\n\n## Раздел-1\n\n## Раздел";
    const lesson = {
      sourceId: "c-lesson",
      sourcePath: "lesson.md",
      sourceIds: [],
      relatedMaterialIds: [],
      readingTimeMinutes: 1,
      kind: "guide",
      title: "Synthetic c lesson",
      summary: "Урок перед заданием",
      stage: "published",
      topicId: "software-engineering",
      access: "free",
      showInFeed: false,
      difficulty: null,
      outcomes: null,
      markdown: `![Схема вариантов](assets/схема.png)\n\nУрок перед заданием. [Открой задание](c-first.md). [К разделу задания](c-first.md#как-спроектировать-один-этап).\n\n${padding}\n\n${duplicateHeadings}\n\n${tail}`,
      links: {
        "c-first.md": "c-first",
        "c-first.md#как-спроектировать-один-этап": "c-first",
      },
      images: { "assets/схема.png": imageVariants.wideLight },
      imageVariants: { "assets/схема.png": imageVariants },
      coverAssetId: null,
      coverAlt: null,
      video: null,
      videoChapters: [],
      artifacts: [],
    };
    /** @param {string} code @param {"free"|"closed"} access @param {string|undefined} afterMaterialId */
    const task = (code, access, afterMaterialId) => ({
      sourceId: code,
      productId: "format-c-course",
      chapterId: "first",
      title: `Синтетическое ${code}`,
      access,
      ...(afterMaterialId === undefined ? {} : { afterMaterialId }),
      relatedMaterialIds: ["c-lesson"],
      publicationState: "published",
      provenance,
      definition: {
        schemaVersion: 2,
        format: "c",
        intro: "Построй небольшой проект.",
        freedom: "Стек выбираешь сам.",
        criteria: [
          {
            id: "build",
            level: "required",
            task: "Создай запрос",
            explanation: "Вернись к [уроку](lesson.md).",
            advice: "Начни с одного запроса.",
            acceptableEvidence: ["SECRET_AGENT_EVIDENCE"],
          },
        ],
      },
      page: {
        ...lesson,
        sourceId: code,
        sourcePath: `${code}.md`,
        title: `Задание c. ${code}`,
        summary: "Синтетическая страница формата c",
        markdown: `[Здесь](#как-спроектировать-один-этап). [Нет раздела](#отсутствует). [К повторному разделу урока](lesson.md#раздел-2).\n\n${padding}\n\n## Как спроектировать один этап?\n\n${duplicateHeadings}\n\n${tail}\n\nПострой небольшой проект.\n\n## Что нужно сделать\n\n### 1. Создай запрос\n\nВернись к [уроку](lesson.md) и [следующему заданию](next.md).\n\n![Схема учебного проекта](diagram.png)\n\n![Схема вариантов](assets/%D1%81%D1%85%D0%B5%D0%BC%D0%B0.png)\n\n> [!tip]- Мой совет\n> Начни с одного запроса.\n\n## Что решаешь сам\n\nСтек выбираешь сам.\n\n## Сдать\n\nПроверь отчёт перед отправкой.\n\n## Материалы к заданию\n\n[Урок](lesson.md)`,
        images: {
          "diagram.png": "diagram",
          "assets/%D1%81%D1%85%D0%B5%D0%BC%D0%B0.png": imageVariants.wideLight,
        },
        imageVariants: {
          "assets/%D1%81%D1%85%D0%B5%D0%BC%D0%B0.png": imageVariants,
        },
        links: {
          "lesson.md": "c-lesson",
          "lesson.md#раздел-2": "c-lesson",
          "next.md": "c-second",
        },
        access,
      },
    });
    const manifest = {
      schemaVersion: 2,
      requiredFeatures: ["task-c-v2", "github-anchors-v1", "image-variants-v1"],
      sourceNamespace: "synthetic",
      selection: {
        productId: "format-c-course",
        chapterIds: [],
        materialIds: ["c-lesson"],
        taskIds: ["c-leading", "c-first", "c-second", "c-closed"],
        complete: true,
      },
      products: [
        {
          sourceId: "format-c-course",
          slug: "synthetic-format-c",
          title: "Синтетический курс c",
          summary: "Проверка #1194",
          complete: true,
          chapters: [
            {
              sourceId: "first",
              title: "Глава c",
              summary: "",
              materialIds: ["c-lesson"],
            },
          ],
          materialIds: ["c-lesson"],
          supplementaryMaterialIds: [],
        },
      ],
      materials: [lesson],
      tasks: [
        task("c-leading", "free", undefined),
        task("c-first", "free", "c-lesson"),
        task("c-second", "free", "c-lesson"),
        task("c-closed", "closed", "c-lesson"),
      ],
      assets: [
        ...sceneAssets,
        {
          sourceId: "diagram",
          path: "diagram.png",
          sha256: checksum(imageBytes),
          mimeType: "image/png",
        },
      ],
      diagnostics: [],
    };
    const path = join(directory, "package.json");
    await writeFile(path, canonical(manifest));
    /** @type {import('../tools/authoring/target.mjs').LocalTransport} */
    const request = async (path, body, key, options) => {
      const multipart = body instanceof FormData;
      const response = await fetch(`${origin}${path}`, {
        method: options?.method ?? (body === undefined ? "GET" : "POST"),
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(multipart ? {} : { "content-type": "application/json" }),
          ...(key === undefined ? {} : { "idempotency-key": key }),
        },
        ...(body === undefined
          ? {}
          : { body: multipart ? body : JSON.stringify(body) }),
      });
      if (!response.ok)
        throw new Error(
          `Synthetic c import ${path}: HTTP ${String(response.status)}; ${JSON.stringify(await response.json())}`,
        );
      return /** @type {unknown} */ (await response.json());
    };
    await syncLocal(path, join(directory, "state"), {
      origin,
      request,
      publish: "all",
    });
    const repeat = await syncLocal(path, join(directory, "state"), {
      origin,
      request,
      publish: "all",
    });
    if (repeat.unchanged !== 1)
      throw new Error("Synthetic diagram repeat changed its lesson");
    const journal = parseJournal(
      JSON.parse(
        await readFile(join(directory, "state", "journal.json"), "utf8"),
      ),
    );
    const taskApply = z
      .object({
        code: z.literal("c-closed"),
        resolvedImages: z.record(
          z.string(),
          z.object({ assetId: z.uuid() }).passthrough(),
        ),
      })
      .passthrough();
    const taskRequest = z.object({
      path: z.literal("/authoring/import/tasks/apply"),
      body: taskApply,
    });
    const materialIds = new Set(
      Object.values(journal.materials).map(({ materialId }) => materialId),
    );
    const materialRequest = z.object({
      path: z.literal("/authoring/import/materials/apply"),
    });
    const variantIdsSchema = z.object({
      wideLight: z.uuid(),
      wideDark: z.uuid(),
      tallLight: z.uuid(),
      tallDark: z.uuid(),
    });
    const diagramNode = z.object({
      attrs: z.object({
        sourceSrc: z.literal("assets/схема.png"),
        imageVariants: variantIdsSchema,
      }),
    });
    let materialImageVariants;
    let taskImageVariants;
    let closedAssetId;
    for (const operation of Object.values(journal.operations)) {
      if (!isJournalOperation(operation) || operation.status !== "applied")
        continue;
      if (materialRequest.safeParse(operation.request).success)
        materialIds.add(
          materialReceiptSchema.parse(operation.result).materialId,
        );
      const requestBody = z
        .object({ path: z.string(), body: z.record(z.string(), z.unknown()) })
        .parse(operation.request);
      if (
        requestBody.path === "/authoring/import/materials/apply" &&
        z
          .object({ id: z.literal("synthetic:c-lesson") })
          .safeParse(requestBody.body["source"]).success
      ) {
        const doc = z
          .object({ doc: z.object({ content: z.array(z.unknown()) }) })
          .parse(requestBody.body["body"]);
        for (const node of doc.doc.content) {
          const parsed = diagramNode.safeParse(node);
          if (parsed.success)
            materialImageVariants = parsed.data.attrs.imageVariants;
        }
      }
      if (
        requestBody.path === "/authoring/import/tasks/apply" &&
        requestBody.body["code"] === "c-first"
      ) {
        const doc = z
          .object({ doc: z.object({ content: z.array(z.unknown()) }) })
          .parse(requestBody.body["pageBody"]);
        for (const node of doc.doc.content) {
          const parsed = z
            .object({
              attrs: z.object({
                sourceSrc: z.literal(
                  "assets/%D1%81%D1%85%D0%B5%D0%BC%D0%B0.png",
                ),
                imageVariants: variantIdsSchema,
              }),
            })
            .safeParse(node);
          if (parsed.success)
            taskImageVariants = parsed.data.attrs.imageVariants;
        }
      }
      const parsed = taskRequest.safeParse(operation.request);
      if (parsed.success)
        closedAssetId = parsed.data.body.resolvedImages["diagram.png"]?.assetId;
    }
    if (closedAssetId === undefined)
      throw new Error("Synthetic closed Task has no imported diagram");
    if (materialImageVariants === undefined || taskImageVariants === undefined)
      throw new Error("Synthetic diagrams lost variant relations");
    return {
      materialImageVariants,
      taskImageVariants,
      productSlug: "synthetic-format-c",
      code: "c-first",
      closedCode: "c-closed",
      closedAssetId,
      materialIds: [...materialIds],
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
