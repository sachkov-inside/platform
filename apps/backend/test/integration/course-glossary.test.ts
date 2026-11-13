import { registerFixedClock } from "../support/fixed-clock.js";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { accountId } from "../../src/modules/accounts/index.js";
import { anonymousSubject } from "../../src/modules/content-access/index.js";
import {
  assembleGlossary,
  type Glossary,
} from "../../src/modules/glossary/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

const author = "89000000-0000-4000-8000-000000002701";
const reader = accountId("89000000-0000-4000-8000-000000002702");
const topicId = "89000000-0000-4000-8000-000000002703";

const term = (id: string, title: string, lesson: string | null) => ({
  id,
  title,
  englishTitle: null,
  shortDefinition: `${title}: коротко.`,
  fullDefinition: `${title}: полностью.`,
  introducedInSourceId: lesson === null ? null : `content-studio:${lesson}`,
});

describe("Course Glossary", () => {
  let testDatabase: TestDatabase;
  let glossary: Glossary;
  let materials: ReturnType<typeof assembleMaterials>;
  let sequence = 0;

  const lesson = async (
    sourceId: string,
    title: string,
    access: "free" | "closed",
    productIds: readonly string[],
  ) => {
    sequence += 1;
    const metadata = {
      access,
      formatId: "guide",
      difficulty: null,
      outcomes: [],
      productIds: [...productIds],
      summary: `${title}.`,
      tagIds: [],
      title,
      topicId,
    };
    const created = await materials.authoring.createDraft({
      actor: author,
      idempotencyKey: `course-glossary-create-${String(sequence)}`,
      metadata,
      body: representativeDocument(`${title}.`),
    });
    if (!created.ok) throw new Error(created.error.code);
    const published = await materials.authoring.saveMaterial({
      actor: author,
      idempotencyKey: `course-glossary-publish-${String(sequence)}`,
      materialId: created.value.materialId,
      expectedContentVersion: 1,
      publicationState: "published",
      metadata,
      body: representativeDocument(`${title}.`),
    });
    if (!published.ok) throw new Error(published.error.code);
    const stored = await testDatabase.prisma.material.update({
      where: { id: created.value.materialId },
      data: {
        sourceId: `content-studio:${sourceId}`,
        sourcePath: `lessons/${sourceId}.md`,
        sourceRevision: "1",
      },
      select: { id: true, slug: true },
    });
    return { id: stored.id, slug: stored.slug ?? "" };
  };

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    glossary = assembleGlossary({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (actor) => actor === author },
    });
    materials = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (actor) => actor === author },
      // A free lesson of a course opens to a signed-in reader with a confirmed Telegram link.
      telegramLinks: {
        confirmedLinks: (accountIds) =>
          Promise.resolve({
            ok: true as const,
            links: new Map(accountIds.map((id) => [id, true])),
          }),
      },
      glossary,
    });
    await testDatabase.prisma.topic.create({
      data: { id: topicId, slug: "course-glossary", name: "Course glossary" },
    });
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("lists the terms of the course lessons a reader may read, each with its lesson", async () => {
    const created = await materials.authoring.createContentCollection({
      actor: author,
      kind: "product",
      name: "DDD",
      slug: "ddd",
      summary: "",
    });
    if (!created.ok) throw new Error(created.error.code);
    const productId = created.value.id;
    const intro = await lesson("ddd-intro", "Введение", "free", [productId]);
    const paid = await lesson("ddd-paid", "Платный урок", "closed", [
      productId,
    ]);
    await lesson("elsewhere", "Урок вне курса", "free", []);
    const order = await materials.authoring.loadProductOrder({
      actor: author,
      productId,
    });
    if (!order.ok) throw new Error(order.error.code);
    const reordered = await materials.authoring.reorderProduct({
      actor: author,
      productId,
      expectedOrderVersion: order.value.orderVersion,
      orderedMaterialIds: [intro.id, paid.id],
    });
    if (!reordered.ok) throw new Error(reordered.error.code);
    await glossary.upsert({
      actor: author,
      terms: [
        term("ubiquitous-language", "Единый язык", "ddd-intro"),
        term("bounded-context", "Ограниченный контекст", "ddd-intro"),
        term("aggregate", "Агрегат", "ddd-paid"),
        term("outside", "Чужой термин", "elsewhere"),
        term("orphan", "Ничей термин", null),
      ],
    });

    const read = await materials.publishedMaterialReader.readCourseGlossary({
      subject: { kind: "account", accountId: reader },
      productSlug: "ddd",
    });
    // The reader cannot read the paid lesson, so its term stays hidden; terms sort by title.
    expect(read).toEqual({
      ok: true,
      value: {
        product: { slug: "ddd", name: "DDD" },
        terms: [
          {
            id: "ubiquitous-language",
            title: "Единый язык",
            englishTitle: null,
            shortDefinition: "Единый язык: коротко.",
            fullDefinition: "Единый язык: полностью.",
            lesson: { slug: intro.slug, title: "Введение" },
          },
          {
            id: "bounded-context",
            title: "Ограниченный контекст",
            englishTitle: null,
            shortDefinition: "Ограниченный контекст: коротко.",
            fullDefinition: "Ограниченный контекст: полностью.",
            lesson: { slug: intro.slug, title: "Введение" },
          },
        ],
      },
    });
  });

  test("shows a guest no term of a lesson that needs signing in", async () => {
    expect(
      await materials.publishedMaterialReader.readCourseGlossary({
        subject: anonymousSubject,
        productSlug: "ddd",
      }),
    ).toEqual({
      ok: true,
      value: { product: { slug: "ddd", name: "DDD" }, terms: [] },
    });
  });

  test("answers an unknown course as not found", async () => {
    expect(
      await materials.publishedMaterialReader.readCourseGlossary({
        subject: anonymousSubject,
        productSlug: "no-such-course",
      }),
    ).toEqual({ ok: false, error: { code: "discovery_not_found" } });
  });

  test("answers a failed access check as a dependency failure", async () => {
    const failingAccess = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (actor) => actor === author },
      contentAccess: {
        authorize: () => Promise.reject(new Error("unused")),
        checkProductAccess: () => Promise.resolve({ kind: "open" }),
        checkProductAccessMany: () => Promise.reject(new Error("unused")),
        checkAvailabilityMany: () =>
          Promise.resolve({ ok: false, error: { code: "batch_too_large" } }),
      },
      glossary,
    });

    expect(
      await failingAccess.publishedMaterialReader.readCourseGlossary({
        subject: { kind: "account", accountId: reader },
        productSlug: "ddd",
      }),
    ).toEqual({
      ok: false,
      error: { code: "dependency_unavailable", retryable: true },
    });
  });
});
