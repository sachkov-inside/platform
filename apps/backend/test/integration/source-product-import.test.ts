import { createHash, randomUUID } from "node:crypto";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { ObjectStorage } from "../../src/infrastructure/object-storage/index.js";
import {
  assembleContentCovers,
  assembleProductArtifacts,
  assembleMaterials,
} from "../../src/modules/materials/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { readHomeContent } from "../../src/modules/content-library/features/read-home-content/read-home-content.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const actor = randomUUID();
const productSource = "inside-content:product-import";
const page = {
  card: {
    eyebrow: "Практикум",
    subtitle: "Инженерная работа",
    action: "Открыть практикум",
  },
  blocks: [
    {
      id: "hero",
      kind: "hero" as const,
      badge: "",
      lead: "Лид страницы.",
      highlights: ["Твой стек", "Поддержка {support_term}"],
    },
    {
      id: "audience",
      kind: "cards" as const,
      eyebrow: "",
      title: "Кому это нужно",
      lead: "",
      items: [
        { title: "Новичкам", text: "Текст.", detailLabel: "", detail: "" },
      ],
      note: "",
    },
  ],
};
const materialSource = {
  id: "inside-content:product-import-lesson",
  path: "lesson.md",
  revision: "c".repeat(64),
  showInFeed: false,
};

describe("authoring source Product completion", () => {
  let database: TestDatabase;
  const stored = new Map<string, Uint8Array>();
  const objectStorage: ObjectStorage = {
    delete: (_namespace, key) => {
      stored.delete(key);
      return Promise.resolve();
    },
    putImmutable: (input) => {
      stored.set(input.key, input.body);
      return Promise.resolve({ ok: true as const });
    },
    read: (_namespace, key) => {
      const body = stored.get(key);
      return Promise.resolve(
        body === undefined
          ? null
          : {
              body,
              checksumSha256: createHash("sha256").update(body).digest("hex"),
              contentLength: body.byteLength,
              contentType: "application/octet-stream",
            },
      );
    },
    signGet: () => Promise.resolve("https://storage.example.test/object"),
  };
  const authorPolicy = { canManage: (id: string) => id === actor };
  let authoring: ReturnType<typeof assembleMaterials>["authoring"];

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    authoring = assembleMaterials({
      prisma: database.prisma,
      authorPolicy,
    }).authoring;
  });
  afterAll(async () => {
    await database.dispose();
  });

  async function reserveProduct(sourceId: string, slug: string) {
    const product = await authoring.reserveSourceProduct({
      actor,
      sourceId,
      name: "Импортированный продукт",
      slug,
      summary: "Подзаголовок",
    });
    if (!product.ok) throw new Error(product.error.code);
    return product.value;
  }

  test("archives an imported Product through Platform and renames it through its source", async () => {
    const product = await reserveProduct(productSource, "product-import");
    const updated = await authoring.updateSourceProduct({
      actor,
      sourceId: productSource,
      collectionId: product.id,
      expectedVersion: product.version,
      name: "Переименованный продукт",
      summary: product.summary,
      source: { slug: product.slug, presentation: "default", page: null },
    });
    expect(updated).toMatchObject({
      ok: true,
      value: { name: "Переименованный продукт" },
    });
    if (!updated.ok) throw new Error(updated.error.code);
    expect(
      await authoring.updateSourceProduct({
        actor,
        sourceId: "inside-content:other",
        collectionId: product.id,
        expectedVersion: updated.value.version,
        name: "Чужой",
        summary: "",
        source: { slug: product.slug, presentation: "default", page: null },
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      await authoring.setContentCollectionArchive({
        actor,
        kind: "product",
        collectionId: product.id,
        expectedVersion: updated.value.version,
        archived: true,
      }),
    ).toMatchObject({ ok: true, value: { archived: true } });
  });

  test("imports introduction, preserves omitted fields and rejects editor replacements", async () => {
    const sourceId = "inside-content:introduction";
    const product = await reserveProduct(sourceId, "introduction");
    const introduction = {
      audience: "Инженерам",
      outcome: "Проект",
      prerequisites: "TypeScript",
      scope: "Практика",
    };
    const request = {
      actor,
      sourceId,
      collectionId: product.id,
      expectedVersion: product.version,
      name: product.name,
      summary: product.summary,
      source: {
        slug: product.slug,
        presentation: "default" as const,
        page: null,
      },
    };
    const imported = await authoring.updateSourceProduct({
      ...request,
      introduction,
    });
    expect(imported).toMatchObject({ ok: true, value: { introduction } });
    if (!imported.ok) throw new Error(imported.error.code);
    expect(
      await authoring.updateSourceProduct({
        ...request,
        expectedVersion: imported.value.version,
        name: "Новое название",
      }),
    ).toMatchObject({ ok: true, value: { introduction } });
    expect(
      await authoring.updateContentCollection({
        actor,
        kind: "product",
        collectionId: product.id,
        expectedVersion: imported.value.version,
        introduction,
        name: product.name,
        summary: product.summary,
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  test("stores the product page only through its source and keeps the product when its address changes", async () => {
    const sourceId = "inside-content:page-product";
    const productId = randomUUID();
    await database.prisma.product.create({
      data: {
        id: productId,
        name: "Импортированный продукт",
        slug: "page-product",
        summary: "Подзаголовок",
      },
    });
    const topicId = randomUUID();
    await database.prisma.topic.create({
      data: { id: topicId, name: "Page topic", slug: "page-topic" },
    });
    const lesson = await authoring.createDraft({
      actor,
      idempotencyKey: randomUUID(),
      body: representativeDocument("Lesson"),
      metadata: {
        title: "Lesson",
        summary: "Lesson summary",
        access: "free",
        topicId,
        formatId: "guide",
        tagIds: [],
        difficulty: null,
        outcomes: [],
        seriesIds: [productId],
      },
    });
    if (!lesson.ok) throw new Error(lesson.error.code);
    const published = await authoring.transitionPublication({
      actor,
      idempotencyKey: randomUUID(),
      materialId: lesson.value.materialId,
      expectedContentVersion: lesson.value.contentVersion,
      publicationState: "published",
    });
    if (!published.ok) throw new Error(published.error.code);
    // Imported Products accept only imported lessons, so the source is attached after composition.
    await database.prisma.product.update({
      where: { id: productId },
      data: { sourceId },
    });
    const product = await reserveProduct(sourceId, "page-product");
    expect(product).toMatchObject({
      id: productId,
      sourceId,
      presentation: "default",
    });
    const pin = await authoring.loadHomePin({ actor });
    if (!pin.ok) throw new Error(pin.error.code);
    expect(
      await authoring.setHomePin({
        actor,
        seriesId: product.id,
        expectedVersion: pin.value.version,
      }),
    ).toMatchObject({ ok: true });

    const request = {
      actor,
      sourceId,
      collectionId: product.id,
      expectedVersion: product.version,
      name: product.name,
      summary: product.summary,
    };
    // An ordinary editor write never carries source-owned fields, even for an imported Product.
    const { sourceId: _ignored, ...editorRequest } = request;
    expect(
      await authoring.updateContentCollection({
        ...editorRequest,
        kind: "product",
        source: {
          slug: "page-product",
          presentation: "ai-first-process",
          page,
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    for (const invalid of [
      { slug: "page-product", presentation: "unknown-look", page },
      {
        slug: "page-product",
        presentation: "ai-first-process",
        page: {
          ...page,
          blocks: [{ ...page.blocks[0], lead: "Цена {price}" }],
        },
      },
      {
        slug: "page-product",
        presentation: "ai-first-process",
        page: { ...page, blocks: [page.blocks[0], page.blocks[0]] },
      },
      {
        slug: "page-product",
        presentation: "ai-first-process",
        page: { ...page, blocks: [{ ...page.blocks[0], kind: "video" }] },
      },
    ]) {
      const outcome = await authoring.updateSourceProduct({
        ...request,
        // @ts-expect-error -- the import boundary receives unchecked values
        source: invalid,
      });
      expect(outcome).toMatchObject({
        ok: false,
        error: { code: "invalid_content" },
      });
    }

    const imported = await authoring.updateSourceProduct({
      ...request,
      source: { slug: "page-product", presentation: "ai-first-process", page },
    });
    if (!imported.ok) throw new Error(imported.error.code);
    expect(imported.value).toMatchObject({
      presentation: "ai-first-process",
      version: product.version + 1,
    });
    // The same description on a stale version is recognised, not reported as a conflict.
    const repeated = await authoring.updateSourceProduct({
      ...request,
      source: {
        slug: "page-product",
        presentation: "ai-first-process",
        page: structuredClone(page),
      },
    });
    expect(repeated).toMatchObject({
      ok: true,
      value: { version: imported.value.version },
    });

    const moved = await authoring.updateSourceProduct({
      ...request,
      expectedVersion: imported.value.version,
      source: {
        slug: "page-product-renamed",
        presentation: "ai-first-process",
        page,
      },
    });
    expect(moved).toMatchObject({
      ok: true,
      value: {
        id: product.id,
        slug: "page-product-renamed",
        presentation: "ai-first-process",
      },
    });
    const materials = assembleMaterials({
      prisma: database.prisma,
      authorPolicy,
    });
    expect(
      await materials.publishedMaterialReader.discoverProjections({
        kind: "series",
        slug: "page-product",
        first: 10,
      }),
    ).toMatchObject({ ok: false });
    const discovered =
      await materials.publishedMaterialReader.discoverProjections({
        kind: "series",
        slug: "page-product-renamed",
        first: 10,
      });
    expect(discovered).toMatchObject({
      ok: true,
      value: {
        reference: {
          id: product.id,
          productPage: { presentation: "ai-first-process", page },
        },
        items: [{ materialId: lesson.value.materialId }],
      },
    });
    const home = await readHomeContent(
      materials.publishedMaterialReader,
      materials.contentAccess,
      emptyCatalogVideos,
      { resolveForAccess: () => Promise.resolve({ kind: "required" }) },
      true,
      { kind: "anonymous" },
    );
    expect(home).toMatchObject({
      ok: true,
      value: {
        pinnedSeries: {
          id: product.id,
          slug: "page-product-renamed",
          presentation: "ai-first-process",
          card: page.card,
        },
      },
    });

    // Описание, которое больше не проходит схему, видно переносу и подлежит замене.
    await database.prisma.product.update({
      where: { id: productId },
      data: { page: { card: null, blocks: [{ id: "hero", kind: "poster" }] } },
    });
    const listed = await authoring.listContentCollections({
      actor,
      kind: "product",
    });
    if (!listed.ok) throw new Error(listed.error.code);
    expect(listed.value.find((item) => item.id === productId)).toMatchObject({
      page: null,
      pageRejected: true,
    });
    const current = listed.value.find((item) => item.id === productId);
    if (current === undefined)
      throw new Error("Expected the imported Product in the list");
    const repaired = await authoring.updateSourceProduct({
      ...request,
      expectedVersion: current.version,
      source: {
        slug: "page-product-renamed",
        presentation: "ai-first-process",
        page,
      },
    });
    expect(repaired).toMatchObject({
      ok: true,
      value: { pageRejected: false },
    });

    // Первый перенос продукта на занятый адрес — понятный конфликт, а не внутренняя ошибка.
    expect(
      await authoring.reserveSourceProduct({
        actor,
        sourceId: "inside-content:taken-address",
        name: "Чужой адрес",
        slug: "page-product-renamed",
        summary: "",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "content_collection_slug_conflict" },
    });

    const other = await reserveProduct(
      "inside-content:other-page-product",
      "other-page-product",
    );
    expect(
      await authoring.updateSourceProduct({
        actor,
        sourceId: "inside-content:other-page-product",
        collectionId: other.id,
        expectedVersion: other.version,
        name: other.name,
        summary: other.summary,
        source: {
          slug: "page-product-renamed",
          presentation: "default",
          page: null,
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "content_collection_slug_conflict" },
    });
  });

  test("changes covers only for records owned by the same source", async () => {
    const covers = assembleContentCovers({
      prisma: database.prisma,
      objectStorage,
      authorPolicy,
    });
    const reserved = await authoring.reserveSourceMaterial({
      actor,
      source: materialSource,
    });
    if (!reserved.ok) throw new Error(reserved.error.code);
    const lesson = { id: reserved.value.materialId, kind: "material" as const };
    expect(
      await covers.change({
        actor,
        expectedCoverId: null,
        kind: "upload",
        owner: lesson,
        ...(await coverUpload("#123456")),
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      await covers.changeImported(
        {
          actor,
          expectedCoverId: null,
          kind: "upload",
          owner: lesson,
          ...(await coverUpload("#123456")),
        },
        "inside-content:other",
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const imported = await covers.changeImported(
      {
        actor,
        expectedCoverId: null,
        kind: "upload",
        owner: lesson,
        ...(await coverUpload("#123456")),
      },
      materialSource.id,
    );
    expect(imported.ok && imported.value.cover !== null).toBe(true);

    const plain = await authoring.createDraft({
      actor,
      idempotencyKey: "plain-cover-owner",
      body: representativeDocument("Plain"),
      metadata: {
        title: "Plain",
        summary: null,
        access: "free",
        topicId: null,
        formatId: null,
        tagIds: [],
        difficulty: null,
        outcomes: [],
        seriesIds: [],
      },
    });
    if (!plain.ok) throw new Error(plain.error.code);
    expect(
      await covers.changeImported(
        {
          actor,
          expectedCoverId: null,
          kind: "upload",
          owner: { id: plain.value.materialId, kind: "material" },
          ...(await coverUpload("#654321")),
        },
        materialSource.id,
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });

    const product = await reserveProduct(
      "inside-content:cover-product",
      "cover-product",
    );
    expect(
      await covers.change({
        actor,
        expectedCoverId: null,
        kind: "remove",
        owner: { id: product.id, kind: "series" },
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      await covers.changeImported(
        {
          actor,
          expectedCoverId: null,
          kind: "remove",
          owner: { id: product.id, kind: "series" },
        },
        "inside-content:other",
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      await covers.changeImported(
        {
          actor,
          expectedCoverId: null,
          kind: "upload",
          owner: { id: product.id, kind: "series" },
          ...(await coverUpload("#abcdef")),
        },
        "inside-content:cover-product",
      ),
    ).toMatchObject({ ok: true });
  });

  test("imports artifacts only into the Product owned by the declared source", async () => {
    const artifacts = assembleProductArtifacts({
      authorPolicy,
      objectStorage,
      prisma: database.prisma,
    });
    const product = await reserveProduct(
      "inside-content:artifact-product",
      "artifact-product",
    );
    expect(
      await artifacts.create({
        actor,
        productId: product.id,
        kind: "link",
        externalUrl: "https://example.test/editor",
        metadata: { access: "closed", title: "Editor", purpose: "" },
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const body = Buffer.from("# Чек-лист\n");
    const file = {
      body,
      declaredContentType: "text/markdown",
      declaredSize: body.byteLength,
      expectedChecksumSha256: createHash("sha256").update(body).digest("hex"),
      filename: "checklist.md",
    };
    const artifact = {
      access: "closed" as const,
      file,
      purpose: "",
      sourceId: "inside-content:checklist",
      title: "Чек-лист",
    };
    expect(
      await artifacts.applyAuthoringImport({
        actor,
        artifacts: [artifact],
        productId: product.id,
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      await artifacts.applyAuthoringImport({
        actor,
        artifacts: [artifact],
        productId: product.id,
        productSourceId: "inside-content:other",
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      await artifacts.applyAuthoringImport({
        actor,
        artifacts: [artifact],
        productId: product.id,
        productSourceId: "inside-content:artifact-product",
      }),
    ).toMatchObject({
      ok: true,
      value: {
        outcomes: [
          { outcome: "created", sourceId: "inside-content:checklist" },
        ],
      },
    });
    const listed = await artifacts.listForProduct({
      actor,
      productId: product.id,
    });
    if (!listed.ok) throw new Error(listed.error.code);
    const artifactId = listed.value[0]?.artifactId;
    if (artifactId === undefined) throw new Error("Imported artifact missing");
    const mutations = [
      artifacts.update({
        actor,
        artifactId,
        metadata: { access: "closed", title: "Editor", purpose: "" },
      }),
      artifacts.replaceContent({
        actor,
        artifactId,
        kind: "link",
        externalUrl: "https://example.test/editor",
      }),
      artifacts.setArchived({ actor, artifactId, archived: true }),
      artifacts.setProducts({ actor, artifactId, productIds: [] }),
      artifacts.setMaterials({ actor, artifactId, materialIds: [] }),
      artifacts.remove({ actor, artifactId }),
    ];
    for (const mutation of mutations)
      expect(await mutation).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
    const plainProduct = await authoring.createContentCollection({
      actor,
      kind: "product",
      name: "Legacy import",
      slug: "legacy-shared-artifact",
      summary: "",
    });
    if (!plainProduct.ok) throw new Error(plainProduct.error.code);
    expect(
      await artifacts.applyAuthoringImport({
        actor,
        productId: plainProduct.value.id,
        artifacts: [{ ...artifact, title: "Legacy bypass" }],
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      await artifacts.listForProduct({
        actor,
        productId: plainProduct.value.id,
      }),
    ).toMatchObject({ ok: true, value: [] });
    expect(
      await artifacts.applyAuthoringImport({
        actor,
        artifacts: [artifact],
        productId: product.id,
        productSourceId: "inside-content:artifact-product",
      }),
    ).toMatchObject({
      ok: true,
      value: { outcomes: [{ outcome: "unchanged" }] },
    });
  });
  test("artifact import rolls back the entire batch and uses the same locks as editor refusals", async () => {
    const artifacts = assembleProductArtifacts({
      authorPolicy,
      objectStorage,
      prisma: database.prisma,
    });
    const product = await reserveProduct(
      "inside-content:atomic-artifacts",
      "atomic-artifacts",
    );
    const first = {
      sourceId: "inside-content:atomic-first",
      title: "Atomic first",
      purpose: "",
      access: "closed" as const,
      externalUrl: "https://example.test/first",
    };
    const second = {
      ...first,
      sourceId: "inside-content:atomic-second",
      title: "Rejected batch artifact",
    };
    await database.prisma
      .$executeRaw`alter table materials.product_artifacts add constraint reject_test_artifact_second check (title <> 'Rejected batch artifact') not valid`;
    try {
      expect(
        await artifacts.applyAuthoringImport({
          actor,
          productId: product.id,
          productSourceId: "inside-content:atomic-artifacts",
          artifacts: [first, second],
        }),
      ).toMatchObject({ ok: false, error: { code: "dependency_unavailable" } });
      expect(
        await artifacts.listForProduct({ actor, productId: product.id }),
      ).toMatchObject({ ok: true, value: [] });
      const reusable = await artifacts.listReusable({ actor });
      if (!reusable.ok) throw new Error(reusable.error.code);
      expect(
        reusable.value.some((row) => row.sourceId === first.sourceId),
      ).toBe(false);
    } finally {
      await database.prisma
        .$executeRaw`alter table materials.product_artifacts drop constraint reject_test_artifact_second`;
    }
    const created = await artifacts.applyAuthoringImport({
      actor,
      productId: product.id,
      productSourceId: "inside-content:atomic-artifacts",
      artifacts: [first],
    });
    if (!created.ok) throw new Error(created.error.code);
    const artifactId = created.value.outcomes[0]?.artifactId;
    if (artifactId === undefined) throw new Error("Artifact missing");
    const [editor, imported] = await Promise.all([
      artifacts.update({
        actor,
        artifactId,
        metadata: { access: "closed", title: "Editor", purpose: "" },
      }),
      artifacts.applyAuthoringImport({
        actor,
        productId: product.id,
        productSourceId: "inside-content:atomic-artifacts",
        artifacts: [{ ...first, title: "Source revision" }],
      }),
    ]);
    expect(editor).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(imported).toMatchObject({
      ok: true,
      value: { outcomes: [{ outcome: "updated" }] },
    });
    expect(
      await artifacts.listForProduct({ actor, productId: product.id }),
    ).toMatchObject({ ok: true, value: [{ title: "Source revision" }] });
  });
});

async function coverUpload(color: string) {
  const body = await sharp({
    create: { background: color, channels: 4, height: 900, width: 1600 },
  })
    .png()
    .toBuffer();
  return {
    body,
    declaredContentType: "image/png",
    declaredSize: body.byteLength,
    expectedChecksumSha256: createHash("sha256").update(body).digest("hex"),
    filename: "cover.png",
  } as const;
}
