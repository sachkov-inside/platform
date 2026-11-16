// @ts-check
// A synthetic course package for the light preview's tests (#2221); never a Content original.
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import sharp from "sharp";
import { canonical } from "./package.mjs";

/**
 * @typedef {{ readonly sourceId: string } & Readonly<Record<string, unknown>>} PreviewRow
 * @typedef {{ readonly materials: readonly PreviewRow[] } & Readonly<Record<string, unknown>>} PreviewManifest
 */

export const previewVideoId = "6b2b6d5f-c42e-464f-a3b3-6163b0382240";

/**
 * Synthetic page row: every field a package v3 Material carries.
 * @param {string} sourceId
 * @param {string} title
 * @param {string} markdown
 * @param {Record<string, unknown>} [extra]
 */
function page(sourceId, title, markdown, extra = {}) {
  return {
    sourceId,
    sourcePath: `works/${sourceId}.md`,
    sourceIds: [],
    relatedMaterialIds: [],
    readingTimeMinutes: null,
    kind: "guide",
    title,
    summary: `О чём ${title}`,
    stage: "draft",
    topicId: "ai-agents",
    access: "free",
    difficulty: null,
    outcomes: [],
    markdown,
    links: {},
    images: {},
    coverAssetId: null,
    coverAlt: null,
    video: null,
    videoChapters: [],
    artifacts: [],
    ...extra,
  };
}

const lessonMarkdown = [
  "## Как агент читает проект",
  "",
  "Новая сессия видит только файлы. [Следующий урок](lesson-two.md) о [harness](term:harness).",
  "",
  '![Схема сессий](images/scheme.png "Между сессиями")',
  "",
  "```ts",
  "export const ready = true;",
  "```",
  "",
].join("\n");

/**
 * A course package as Content Studio exports it: one chapter, two lessons and a Task.
 * @param {{ readonly sha256: string }} scheme
 */
function manifest(scheme) {
  return {
    schemaVersion: 3,
    requiredFeatures: [
      "canonical-product-source-v2",
      "exercise-v1",
      "glossary-v1",
      "task-c-v2",
    ],
    sourceNamespace: "synthetic",
    selection: {
      productId: "course",
      chapterIds: ["intro"],
      materialIds: ["lesson-one", "lesson-two"],
      taskIds: ["task-one"],
      complete: true,
    },
    glossaryTerms: [
      {
        sourceId: "harness",
        title: "Harness",
        englishTitle: null,
        shortDefinition: "Обвязка агента.",
        fullDefinition: "Обвязка агента: правила, скиллы и проверки.",
        introducedInMaterialId: "lesson-one",
      },
    ],
    materials: [
      page("lesson-one", "Как агент работает с проектом", lessonMarkdown, {
        links: { "lesson-two.md": "lesson-two" },
        images: { "images/scheme.png": "scheme" },
        video: { kinescopeId: previewVideoId },
        videoChapters: [{ start: 0, title: "Начало" }],
        readerBlocks: [
          { kind: "markdown", markdown: lessonMarkdown },
          {
            kind: "quiz",
            id: "session-memory",
            reveal: "after-answer",
            questionMarkdown: "Что останется к следующей сессии?",
            selectionMode: "single",
            options: [
              {
                id: "chat",
                markdown: "Разговор.",
                correct: false,
                explanationMarkdown: "Разговор не сохраняется.",
              },
              { id: "files", markdown: "Файлы проекта.", correct: true },
            ],
          },
        ],
      }),
      page("lesson-two", "Подготовка проекта", "Второй урок.\n"),
    ],
    products: [
      {
        sourceId: "course",
        slug: "course",
        title: "Курс про агентов",
        summary: "Курс.",
        complete: true,
        chapters: [
          {
            sourceId: "intro",
            title: "Подготовка проекта",
            summary: "Первая глава.",
            materialIds: ["lesson-one", "lesson-two"],
          },
        ],
        materialIds: ["lesson-one", "lesson-two"],
        supplementaryMaterialIds: [],
      },
    ],
    tasks: [
      {
        sourceId: "task-one",
        productId: "course",
        chapterId: "intro",
        title: "Подготовь основу",
        access: null,
        afterMaterialId: "lesson-one",
        publicationState: "unpublished",
        relatedMaterialIds: ["lesson-one"],
        provenance: {
          repository: "synthetic/content",
          commit: "0123456789abcdef0123456789abcdef01234567",
          path: "works/task-one/task.yaml",
        },
        definition: {
          schemaVersion: 2,
          format: "c",
          intro: "Подготовь проект.",
          freedom: "Стек выбираешь ты.",
          criteria: [
            {
              id: "stack",
              level: "required",
              task: "Выбери стек.",
              explanation: "Почему этот стек.",
              advice: "Бери знакомый язык.",
              acceptableEvidence: ["Записанное решение."],
            },
            {
              id: "second-agent",
              level: "additional",
              task: "Подключи второго агента.",
              explanation: "Инструкции для двух агентов.",
              acceptableEvidence: ["Инструкции."],
            },
          ],
        },
        page: page(
          "task-one",
          "Задание 1. Подготовь основу",
          "## Что сделать\n\nСобери каркас по [уроку](lesson-one.md).\n",
          { links: { "lesson-one.md": "lesson-one" }, access: null },
        ),
      },
    ],
    assets: [
      {
        sourceId: "scheme",
        path: "assets/scheme.png",
        sha256: scheme.sha256,
        mimeType: "image/png",
      },
    ],
    diagnostics: [],
  };
}

/**
 * Writes the package into `directory` and returns its package.json path. `change` edits the manifest
 * before it is written, as an author's edit and a new export would.
 * @param {string} directory
 * @param {(value: PreviewManifest) => unknown} [change]
 */
export async function writePreviewPackage(
  directory,
  change = (value) => value,
) {
  await mkdir(join(directory, "assets"), { recursive: true });
  const image = await sharp({
    create: { width: 1200, height: 600, channels: 3, background: "#e9e3dc" },
  })
    .png()
    .toBuffer();
  await writeFile(join(directory, "assets/scheme.png"), image);
  const sha256 = createHash("sha256").update(image).digest("hex");
  const path = join(directory, "package.json");
  await writeFile(path, canonical(change(manifest({ sha256 }))));
  return path;
}
