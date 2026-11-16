// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  previewVideoId as videoId,
  writePreviewPackage as writePackage,
} from "./file-preview-test-support.mjs";
import {
  openPreview,
  previewAsset,
  previewIndex,
  previewMaterial,
  previewTask,
  resolvePreviewPackage,
} from "./file-preview.mjs";

/** @param {import("node:test").TestContext} t */
async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), "file-preview-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("a package path may name package.json, its directory or the export folder with the newest package", async (t) => {
  const root = await temporary(t);
  const older = await writePackage(join(root, "a1"));
  const newer = await writePackage(join(root, "b2"));
  await utimes(
    older,
    new Date("2026-11-16T10:00:00Z"),
    new Date("2026-11-16T10:00:00Z"),
  );
  await utimes(
    newer,
    new Date("2026-11-16T11:00:00Z"),
    new Date("2026-11-16T11:00:00Z"),
  );

  assert.equal(await resolvePreviewPackage(older), older);
  assert.equal(await resolvePreviewPackage(join(root, "a1")), older);
  assert.equal(await resolvePreviewPackage(root), newer);
  await assert.rejects(
    resolvePreviewPackage(join(root, "missing")),
    /no package at/u,
  );
});

test("the index lists the package's lessons and Tasks with their preview addresses", async (t) => {
  const preview = await openPreview(await writePackage(await temporary(t)));
  assert.deepEqual(previewIndex(preview), {
    products: [{ sourceId: "course", title: "Курс про агентов" }],
    materials: [
      {
        sourceId: "lesson-one",
        title: "Как агент работает с проектом",
        href: "/materials/lesson-one",
      },
      {
        sourceId: "lesson-two",
        title: "Подготовка проекта",
        href: "/materials/lesson-two",
      },
    ],
    tasks: [
      {
        sourceId: "task-one",
        title: "Задание 1. Подготовь основу",
        href: "/products/course/tasks/task-one",
      },
    ],
  });
});

test("a lesson becomes the reader's blocks with a sized local image, code, an exercise and its video", async (t) => {
  const preview = await openPreview(await writePackage(await temporary(t)));
  const lesson = await previewMaterial(preview, "lesson-one");
  assert.ok(lesson);
  const kinds = lesson.body.map((block) => block.kind);
  assert.deepEqual(kinds, [
    "heading",
    "paragraph",
    "image",
    "code_block",
    "quiz",
  ]);
  const image = lesson.body[2];
  assert.equal(image?.kind, "image");
  if (image?.kind !== "image") return;
  assert.equal(image.alt, "Схема сессий");
  assert.equal(image.caption, "Между сессиями");
  assert.equal(image.width, 1200);
  assert.equal(image.height, 600);
  assert.deepEqual(image.variants, [{ width: 1200, height: 600 }]);
  const asset = previewAsset(preview, image.assetId);
  assert.equal(asset?.mimeType, "image/png");
  assert.match(asset?.path ?? "", /assets\/scheme\.png$/u);

  const paragraph = lesson.body[1];
  assert.equal(paragraph?.kind, "paragraph");
  if (paragraph?.kind !== "paragraph") return;
  assert.deepEqual(
    paragraph.content
      .flatMap((text) => text.marks)
      .flatMap((mark) => (mark.kind === "link" ? [mark.href] : [])),
    ["/materials/lesson-two", "term:harness"],
  );
  assert.deepEqual(lesson.glossaryTerms, [
    {
      id: "harness",
      title: "Harness",
      englishTitle: null,
      shortDefinition: "Обвязка агента.",
      fullDefinition: "Обвязка агента: правила, скиллы и проверки.",
    },
  ]);
  assert.deepEqual(
    lesson.lessonTerms.map((term) => term.id),
    ["harness"],
  );
  assert.deepEqual(lesson.primaryVideo, {
    videoId,
    title: "Как агент работает с проектом",
    state: "ready",
    chapters: [{ start: 0, title: "Начало" }],
  });
  assert.equal(lesson.material.slug, "lesson-one");
  assert.equal(lesson.material.format.name, "Гайд");
  assert.deepEqual(lesson.material.productMemberships, [
    {
      ordinal: 1,
      product: {
        id: lesson.course?.reference.id,
        name: "Курс про агентов",
        slug: "course",
      },
    },
  ]);
});

test("a lesson of a course carries the course programme, with its Task after the named lesson", async (t) => {
  const preview = await openPreview(await writePackage(await temporary(t)));
  const lesson = await previewMaterial(preview, "lesson-two");
  assert.ok(lesson?.course);
  const { course } = lesson;
  assert.equal(course.reference.slug, "course");
  assert.deepEqual(
    course.items.map((item) => item.slug),
    ["lesson-one", "lesson-two"],
  );
  const [chapter] = course.chapters;
  assert.equal(chapter?.name, "Подготовка проекта");
  assert.deepEqual(
    chapter?.materialIds,
    course.items.map((item) => item.materialId),
  );
  assert.deepEqual(
    chapter?.tasks?.map((task) => [task.code, task.afterMaterialId]),
    [["task-one", course.items[0]?.materialId]],
  );
});

test("a Task becomes the learner's open Task page with its page body and chapter place", async (t) => {
  const preview = await openPreview(await writePackage(await temporary(t)));
  const task = await previewTask(preview, "task-one");
  assert.ok(task);
  assert.equal(task.page.access, "open");
  assert.deepEqual(
    {
      code: task.page.task.code,
      title: task.page.task.title,
      product: task.page.task.product,
      chapter: task.page.task.chapter,
    },
    {
      code: "task-one",
      title: "Подготовь основу",
      product: { slug: "course", name: "Курс про агентов" },
      chapter: { name: "Подготовка проекта", ordinal: 1 },
    },
  );
  assert.deepEqual(task.page.task.definition.criteria, [
    {
      id: "stack",
      level: "required",
      task: "Выбери стек.",
      explanation: "Почему этот стек.",
      advice: "Бери знакомый язык.",
    },
    {
      id: "second-agent",
      level: "additional",
      task: "Подключи второго агента.",
      explanation: "Инструкции для двух агентов.",
    },
  ]);
  assert.equal(task.page.task.page?.title, "Задание 1. Подготовь основу");
  assert.deepEqual(
    task.page.task.page?.body.blocks.map((block) => block.kind),
    ["heading", "paragraph"],
  );
  assert.deepEqual(task.page.relatedMaterials, [
    {
      materialId: task.course.items[0]?.materialId,
      slug: "lesson-one",
      title: "Как агент работает с проектом",
      availability: "available",
    },
  ]);
});

test("an unknown page is absent, and a broken package names the cause", async (t) => {
  const directory = await temporary(t);
  const preview = await openPreview(await writePackage(directory));
  assert.equal(await previewMaterial(preview, "missing"), null);
  assert.equal(await previewTask(preview, "missing"), null);

  const broken = await writePackage(join(directory, "broken"), (value) => ({
    ...value,
    materials: value.materials.map((row) =>
      row.sourceId === "lesson-two"
        ? { ...row, markdown: "![Нет файла](images/absent.png)\n" }
        : row,
    ),
  }));
  const opened = await openPreview(broken);
  await assert.rejects(
    previewMaterial(opened, "lesson-two"),
    /works\/lesson-two\.md: unresolved image: images\/absent\.png/u,
  );
});
