import { registerFixedClock } from "../support/fixed-clock.js";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import { anonymousSubject } from "../../src/modules/content-access/index.js";
import { listPublishedMaterials } from "../../src/modules/content-library/index.js";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

const actor = "74000000-0000-4000-8000-000000000001";
const productId = "74000000-0000-4000-8000-000000000188";
const metadata = {
  summary: "Public summary",
  access: "free" as const,
  topicId: "72000000-0000-4000-8000-000000000002",
  formatId: "guide",
  tagIds: [],
  difficulty: null,
  outcomes: [],
  productIds: [] as string[],
};
const body = {
  schemaVersion: 1 as const,
  doc: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { nodeId: "74000000-0000-4000-8000-000000000189" },
        content: [{ type: "text", text: "Body" }],
      },
    ],
  },
};

/** Лента показывает только материалы, которые автор явно выложил в неё (#1885). */
describe("Home feed selection", () => {
  let database: TestDatabase;
  let materials: ReturnType<typeof assembleMaterials>;
  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    await seedLocalDevelopment(database.prisma);
    await database.prisma.product.create({
      data: {
        id: productId,
        slug: "feed-selection-product",
        name: "Feed selection product",
      },
    });
    materials = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: (id) => id === actor },
    });
  });
  afterAll(async () => {
    await database.dispose();
  });

  async function draft(title: string) {
    const created = await materials.authoring.createDraft({
      actor,
      idempotencyKey: `${title}-draft`,
      metadata: { ...metadata, title },
      body,
    });
    if (!created.ok) throw new Error(created.error.code);
    let version = created.value.contentVersion;
    let step = 0;
    return {
      materialId: created.value.materialId,
      save: async (values: {
        readonly inFeed?: boolean;
        readonly notifyTelegram?: boolean;
        readonly access?: "free" | "closed";
        readonly productIds?: readonly string[];
      }) => {
        step += 1;
        const result = await materials.authoring.saveMaterial({
          actor,
          idempotencyKey: `${title}-save-${String(step)}`,
          materialId: created.value.materialId,
          expectedContentVersion: version,
          publicationState: "published",
          ...(values.inFeed === undefined ? {} : { inFeed: values.inFeed }),
          ...(values.notifyTelegram === undefined
            ? {}
            : { notifyTelegram: values.notifyTelegram }),
          metadata: {
            ...metadata,
            title,
            access: values.access ?? "free",
            productIds: [...(values.productIds ?? [])],
          },
          body,
          primaryVideoId: null,
          deleteVideoId: null,
        });
        if (result.ok) version = result.value.contentVersion;
        return result;
      },
    };
  }

  /** Слаги ленты с фильтрами; главная выбирает материалы тем же правилом. */
  async function feedSlugs(): Promise<readonly string[]> {
    const feed = await listPublishedMaterials(
      materials.publishedMaterialReader,
      materials.contentAccess,
      emptyCatalogVideos,
      {
        subject: anonymousSubject,
        feedOnly: true,
        q: "Feed selection",
        first: 24,
      },
    );
    if (!feed.ok) throw new Error(feed.error.code);
    const home = await materials.publishedMaterialReader.readHomeProjections();
    if (!home.ok) throw new Error(home.error.code);
    const feedItems = feed.value.items.map((item) => item.slug);
    const homeItems = home.value.guides
      .map((item) => item.slug)
      .filter((slug) => slug.startsWith("feed-selection"));
    // Главная берёт только восемь новейших гайдов, поэтому её выдача входит в ленту целиком.
    for (const slug of homeItems) expect(feedItems).toContain(slug);
    return feedItems;
  }

  async function slugOf(materialId: string): Promise<string> {
    const row = await database.prisma.material.findUniqueOrThrow({
      where: { id: materialId },
      select: { slug: true },
    });
    if (row.slug === null) throw new Error("published Material has no slug");
    return row.slug;
  }

  test("a published free Material enters the feed only when the author places it there", async () => {
    const material = await draft("Feed selection explicit");
    expect((await material.save({})).ok).toBe(true);
    const slug = await slugOf(material.materialId);
    expect(await feedSlugs()).not.toContain(slug);

    expect((await material.save({ inFeed: true })).ok).toBe(true);
    expect(await feedSlugs()).toContain(slug);

    // Сохранение без поля оставляет выбор автора как есть.
    expect((await material.save({})).ok).toBe(true);
    expect(await feedSlugs()).toContain(slug);

    expect((await material.save({ inFeed: false })).ok).toBe(true);
    expect(await feedSlugs()).not.toContain(slug);
  });

  test("a Product lesson never enters the feed", async () => {
    const lesson = await draft("Feed selection lesson");
    for (const values of [
      { access: "free" as const, productIds: [productId] },
      { access: "closed" as const, productIds: [productId] },
    ]) {
      expect(await lesson.save({ ...values, inFeed: true })).toEqual({
        ok: false,
        error: {
          code: "invalid_content",
          issues: [{ code: "feed_requires_public_material", path: "/inFeed" }],
        },
      });
    }
    expect((await lesson.save({ productIds: [productId] })).ok).toBe(true);
    const slug = await slugOf(lesson.materialId);
    // Даже запись, поставленная в обход сохранения, не выводит урок курса в ленту.
    await database.prisma.publishedMaterial.update({
      where: { materialId: lesson.materialId },
      data: { inFeed: true },
    });
    expect(await feedSlugs()).not.toContain(slug);

    // Материал из ленты, позже добавленный в курс, из ленты уходит.
    const moved = await draft("Feed selection moved");
    expect((await moved.save({ inFeed: true })).ok).toBe(true);
    const movedSlug = await slugOf(moved.materialId);
    expect(await feedSlugs()).toContain(movedSlug);
    expect((await moved.save({ productIds: [productId] })).ok).toBe(true);
    expect(await feedSlugs()).not.toContain(movedSlug);
    expect(
      await database.prisma.material.findUniqueOrThrow({
        where: { id: moved.materialId },
        select: { inFeed: true },
      }),
    ).toEqual({ inFeed: false });
    // Состав Product меняет и Products, минуя Save: лента и загрузка всё равно видят урок курса.
    const composed = await draft("Feed selection composed");
    expect((await composed.save({ inFeed: true })).ok).toBe(true);
    const composedSlug = await slugOf(composed.materialId);
    await database.prisma.productMembership.create({
      data: { productId, materialId: composed.materialId },
    });
    expect(await feedSlugs()).not.toContain(composedSlug);
    const loaded = await materials.authoring.loadMaterial({
      actor,
      materialId: composed.materialId,
    });
    if (!loaded.ok) throw new Error(loaded.error.code);
    expect(loaded.value.inFeed).toBe(false);
    // Загруженный выбор сохраняется обратно без ошибки.
    expect(
      (
        await composed.save({
          inFeed: loaded.value.inFeed,
          productIds: [productId],
        })
      ).ok,
    ).toBe(true);
  });

  test("a Telegram announcement goes out only for a feed Material", async () => {
    const hidden = await draft("Feed selection hidden announcement");
    expect((await hidden.save({ notifyTelegram: true })).ok).toBe(true);
    const visible = await draft("Feed selection visible announcement");
    expect(
      (await visible.save({ notifyTelegram: true, inFeed: true })).ok,
    ).toBe(true);
    const announcements = await database.prisma.materialAnnouncement.findMany({
      where: { materialId: { in: [hidden.materialId, visible.materialId] } },
      select: { materialId: true, telegramEnabled: true },
    });
    expect(announcements).toEqual(
      expect.arrayContaining([
        { materialId: hidden.materialId, telegramEnabled: false },
        { materialId: visible.materialId, telegramEnabled: true },
      ]),
    );
  });
});
