// @ts-check
// Synthetic package v2 import for the isolated full-stack check, never the owner's stand.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

import { z } from "zod";

import { canonical, checksum } from "../tools/authoring/package.mjs";
import { syncLocal } from "../tools/authoring/local-sync.mjs";

/** @param {string} origin @param {string} accessToken */
export async function seedFullStackTaskC(origin, accessToken) {
  const directory = await mkdtemp(join(tmpdir(), "inside-task-c-"));
  try {
    const imageBytes = await readFile(
      resolve("apps/web/.storybook/fixtures/reader-images/960"),
    );
    await writeFile(join(directory, "diagram.png"), imageBytes);
    const provenance = {
      repository: "synthetic/fullstack",
      commit: "b".repeat(40),
      path: "task.yaml",
    };
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
      topicId: null,
      access: "free",
      showInFeed: false,
      difficulty: null,
      outcomes: null,
      markdown: "Урок перед заданием.",
      links: {},
      images: {},
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
        markdown: `Построй небольшой проект.\n\n## Что нужно сделать\n\n### 1. Создай запрос\n\nВернись к [уроку](lesson.md).\n\n![Схема учебного проекта](diagram.png)\n\n> [!tip]- Мой совет\n> Начни с одного запроса.\n\n## Что решаешь сам\n\nСтек выбираешь сам.\n\n## Сдать\n\nПроверь отчёт перед отправкой.\n\n## Материалы к заданию\n\n[Урок](lesson.md)`,
        images: { "diagram.png": "diagram" },
        links: { "lesson.md": "c-lesson" },
        access,
      },
    });
    const manifest = {
      schemaVersion: 2,
      requiredFeatures: ["task-c-v2"],
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
    const journal = z
      .object({
        operations: z.record(
          z.string(),
          z
            .object({
              request: z
                .object({ path: z.string(), body: z.unknown() })
                .passthrough(),
            })
            .passthrough(),
        ),
      })
      .parse(
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
    let closedAssetId;
    for (const operation of Object.values(journal.operations)) {
      if (operation.request.path !== "/authoring/import/tasks/apply") continue;
      const parsed = taskApply.safeParse(operation.request.body);
      if (parsed.success)
        closedAssetId = parsed.data.resolvedImages["diagram.png"]?.assetId;
    }
    if (closedAssetId === undefined)
      throw new Error("Synthetic closed Task has no imported diagram");
    return {
      productSlug: "synthetic-format-c",
      code: "c-first",
      closedCode: "c-closed",
      closedAssetId,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
