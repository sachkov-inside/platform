import { registerFixedClock } from "../support/fixed-clock.js";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { anonymousSubject } from "../../src/modules/content-access/index.js";
import {
  assembleGlossary,
  type Glossary,
} from "../../src/modules/glossary/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

const author = "89000000-0000-4000-8000-000000002601";
const reader = "89000000-0000-4000-8000-000000002602";
const topicId = "89000000-0000-4000-8000-000000002603";

const boundedContext = {
  id: "bounded-context",
  title: "Ограниченный контекст",
  englishTitle: "Bounded context",
  shortDefinition: "Граница, внутри которой у слов модели один смысл.",
  fullDefinition:
    "Часть системы со своей моделью и своим языком.\n\nСлово внутри границы значит одно.",
  introducedInSourceId: "content-studio:ddd-intro",
};
const aggregate = {
  id: "aggregate",
  title: "Агрегат",
  englishTitle: null,
  shortDefinition: "Группа объектов, которая меняется как одно целое.",
  fullDefinition: "Граница согласованности изменений.",
  introducedInSourceId: null,
};

function lessonBody() {
  const mention = (text: string, termId: string) => ({
    type: "text",
    text,
    marks: [{ type: "link", attrs: { href: `term:${termId}` } }],
  });
  return {
    schemaVersion: 1 as const,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { nodeId: "89000000-0000-4000-8000-000000002611" },
          content: [
            mention("Ограниченный контекст", "bounded-context"),
            { type: "text", text: " и " },
            mention("зона", "unknown-term"),
          ],
        },
        {
          type: "termDefinition",
          attrs: {
            nodeId: "89000000-0000-4000-8000-000000002612",
            termId: "bounded-context",
          },
        },
        {
          type: "paragraph",
          attrs: { nodeId: "89000000-0000-4000-8000-000000002613" },
          content: [mention("контекст", "bounded-context")],
        },
      ],
    },
  };
}

describe("Glossary", () => {
  let testDatabase: TestDatabase;
  let glossary: Glossary;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    glossary = assembleGlossary({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (actor) => actor === author },
    });
    await testDatabase.prisma.topic.create({
      data: { id: topicId, slug: "glossary", name: "Glossary" },
    });
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("replaces the whole Glossary and reports what changed", async () => {
    expect(
      await glossary.replace({ actor: author, terms: [boundedContext] }),
    ).toEqual({
      ok: true,
      value: { created: 1, updated: 0, removed: 0, unchanged: 0 },
    });
    const corrected = {
      ...boundedContext,
      shortDefinition: "Граница одного смысла слов модели.",
    };
    expect(
      await glossary.replace({ actor: author, terms: [aggregate, corrected] }),
    ).toEqual({
      ok: true,
      value: { created: 1, updated: 1, removed: 0, unchanged: 0 },
    });
    expect(await glossary.list({ actor: author })).toEqual({
      ok: true,
      value: [aggregate, corrected],
    });
    expect(
      await glossary.replace({ actor: author, terms: [corrected] }),
    ).toEqual({
      ok: true,
      value: { created: 0, updated: 0, removed: 1, unchanged: 1 },
    });
    expect(await glossary.lookup(["aggregate", "bounded-context"])).toEqual({
      ok: true,
      value: [corrected],
    });
  });

  test("stores trimmed text and refuses a repeated identifier", async () => {
    expect(
      await glossary.replace({
        actor: author,
        terms: [{ ...aggregate, title: "  Агрегат  " }],
      }),
    ).toMatchObject({ ok: true });
    expect(await glossary.lookup(["aggregate"])).toEqual({
      ok: true,
      value: [aggregate],
    });
    expect(
      await glossary.replace({ actor: author, terms: [aggregate, aggregate] }),
    ).toMatchObject({ ok: false, error: { code: "invalid_glossary" } });
    expect(
      await glossary.replace({
        actor: author,
        terms: [{ ...aggregate, id: "Aggregate" }],
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_glossary" } });
  });

  test("lets only a Materials manager write or list it", async () => {
    expect(await glossary.replace({ actor: reader, terms: [] })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(await glossary.list({ actor: reader })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });

  test("a published Material reads the current definitions of its terms without republication", async () => {
    await glossary.replace({ actor: author, terms: [boundedContext] });
    const materials = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
      glossary,
    });
    const metadata = {
      access: "free" as const,
      formatId: "guide",
      difficulty: null,
      outcomes: [],
      productIds: [],
      summary: "Урок с терминами.",
      tagIds: [],
      title: "Урок с терминами",
      topicId,
    };
    const created = await materials.authoring.createDraft({
      actor: author,
      idempotencyKey: "glossary-lesson-create",
      metadata,
      body: lessonBody(),
    });
    if (!created.ok) throw new Error(created.error.code);
    const published = await materials.authoring.saveMaterial({
      actor: author,
      idempotencyKey: "glossary-lesson-publish",
      materialId: created.value.materialId,
      expectedContentVersion: 1,
      publicationState: "published",
      metadata,
      body: lessonBody(),
    });
    if (!published.ok) throw new Error(published.error.code);
    const stored = await testDatabase.prisma.material.findUniqueOrThrow({
      where: { id: created.value.materialId },
      select: { slug: true },
    });
    const read = () =>
      materials.publishedMaterialReader.read({
        subject: anonymousSubject,
        slug: stored.slug ?? "",
      });

    const first = await read();
    if (!first.ok || first.value.kind !== "available")
      throw new Error("Expected the lesson body");
    expect(first.value.glossaryTerms).toEqual([
      {
        id: "bounded-context",
        title: boundedContext.title,
        englishTitle: boundedContext.englishTitle,
        shortDefinition: boundedContext.shortDefinition,
        fullDefinition: boundedContext.fullDefinition,
      },
    ]);
    // Only the first mention stays a term link; the repeated one reads as plain text.
    expect(first.value.body.blocks[2]).toEqual({
      kind: "paragraph",
      content: [{ kind: "text", text: "контекст", marks: [] }],
    });

    const corrected = "Исправленное определение.";
    await glossary.replace({
      actor: author,
      terms: [{ ...boundedContext, shortDefinition: corrected }],
    });
    expect(await read()).toMatchObject({
      ok: true,
      value: {
        glossaryTerms: [{ id: "bounded-context", shortDefinition: corrected }],
      },
    });
  });
});
