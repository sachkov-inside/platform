import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { anonymousSubject } from "../../src/modules/content-access/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";

const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const source = {
  id: "authoring-test-one",
  path: "materials/one.md",
  revision: "a".repeat(64),
  showInFeed: false,
};
const metadata = {
  title: "Imported",
  summary: null,
  access: "free" as const,
  difficulty: null,
  outcomes: [],
  topicId: null,
  formatId: "note" as const,
  tagIds: [],
  seriesIds: [],
};

describe("authoring source Material", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createMigratedTestDatabase();
  });
  afterAll(async () => {
    await database.dispose();
  });

  test("reserves once, preserves identity across rename, rejects ordinary writes and stale imports", async () => {
    const { authoring } = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: (id) => id === actor },
    });
    const reservations = await Promise.all([
      authoring.reserveSourceMaterial({ actor, source }),
      authoring.reserveSourceMaterial({ actor, source }),
    ]);
    const first = reservations[0];
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("Source reservation failed");
    expect(reservations[1]).toEqual(first);
    const command = {
      actor,
      materialId: first.value.materialId,
      expectedContentVersion: 1,
      idempotencyKey: "apply-one",
      source,
      publicationState: "draft" as const,
      primaryVideoId: null,
      metadata,
      body: representativeDocument("Imported original"),
    };
    const applied = await authoring.applySourceMaterial(command);
    expect(applied).toMatchObject({ ok: true, value: { contentVersion: 2 } });
    expect(await authoring.applySourceMaterial(command)).toEqual(applied);
    const { source: ignored, ...ordinary } = command;
    void ignored;
    expect(
      await authoring.saveMaterial({
        ...ordinary,
        expectedContentVersion: 2,
        idempotencyKey: "ordinary",
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      await authoring.deleteDraft({
        actor,
        materialId: command.materialId,
        expectedContentVersion: 2,
        idempotencyKey: "delete-source",
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      await authoring.applySourceMaterial({
        ...command,
        idempotencyKey: "stale-import",
      }),
    ).toMatchObject({ ok: false, error: { code: "stale_content_version" } });
    const renamed = {
      ...source,
      path: "materials/renamed.md",
      revision: "b".repeat(64),
    };
    expect(
      await authoring.applySourceMaterial({
        ...command,
        source: renamed,
        expectedContentVersion: 2,
        idempotencyKey: "rename-import",
      }),
    ).toMatchObject({
      ok: true,
      value: { materialId: command.materialId, contentVersion: 3 },
    });
    expect(
      await authoring.reserveSourceMaterial({ actor, source: renamed }),
    ).toMatchObject({
      ok: true,
      value: { materialId: command.materialId, contentVersion: 3 },
    });
    expect(
      await authoring.reserveSourceMaterial({
        actor: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        source,
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });
  test("feed includes every published free Material regardless of the legacy visibility flag", async () => {
    const { authoring, publishedMaterialReader } = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: (id) => id === actor },
    });
    const topic = await authoring.createContentCollection({
      actor,
      kind: "topic",
      name: "Import topic",
      slug: "import-topic",
      summary: "",
    });
    if (!topic.ok) throw new Error(topic.error.code);
    const ids: string[] = [];
    for (const showInFeed of [false, true]) {
      const feedSource = {
        ...source,
        id: `feed-${String(showInFeed)}`,
        showInFeed,
      };
      const reserved = await authoring.reserveSourceMaterial({
        actor,
        source: feedSource,
      });
      if (!reserved.ok) throw new Error(reserved.error.code);
      ids.push(reserved.value.materialId);
      const saved = await authoring.applySourceMaterial({
        actor,
        source: feedSource,
        materialId: reserved.value.materialId,
        expectedContentVersion: 1,
        idempotencyKey: `feed-${String(showInFeed)}`,
        publicationState: "published",
        primaryVideoId: null,
        metadata: {
          ...metadata,
          title: `Feed ${String(showInFeed)}`,
          summary: "Published import",
          topicId: topic.value.id,
        },
        body: representativeDocument("Searchable needle"),
      });
      expect(saved).toMatchObject({ ok: true });
    }
    const catalog = await publishedMaterialReader.listProjections({
      first: 12,
    });
    expect(catalog).toMatchObject({ ok: true, value: { totalCount: 2 } });
    const feed = await publishedMaterialReader.listProjections({
      first: 12,
      feedOnly: true,
    });
    expect(feed).toMatchObject({
      ok: true,
      value: {
        totalCount: 2,
        facets: { topics: [{ count: 2 }], formats: [{ count: 2 }] },
      },
    });
    const hiddenSearch = await publishedMaterialReader.listProjections({
      first: 12,
      feedOnly: true,
      q: "false",
    });
    expect(hiddenSearch).toMatchObject({
      ok: true,
      value: { totalCount: 1, items: [{ materialId: ids[0] }] },
    });
  });

  test("ordinary writes cannot change a source programme and removing the final paid feed placement fails", async () => {
    const { authoring } = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: (id) => id === actor },
    });
    const product = await authoring.reserveSourceProduct({
      actor,
      sourceId: "paid-product",
      name: "Paid product",
      slug: "paid-product",
      summary: "Programme",
    });
    if (!product.ok) throw new Error(product.error.code);
    const ordinary = await authoring.createDraft({
      actor,
      idempotencyKey: "ordinary-in-source-product",
      metadata: { ...metadata, seriesIds: [product.value.id] },
      body: representativeDocument("Ordinary"),
    });
    expect(ordinary).toMatchObject({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [
          { code: "material_source_mismatch", path: "/metadata/seriesIds/0" },
        ],
      },
    });
    const plain = await authoring.createDraft({
      actor,
      idempotencyKey: "ordinary-outside-product",
      metadata,
      body: representativeDocument("Ordinary"),
    });
    if (!plain.ok) throw new Error(plain.error.code);
    expect(
      await authoring.saveMaterial({
        actor,
        idempotencyKey: "attach-to-source-product",
        materialId: plain.value.materialId,
        expectedContentVersion: 1,
        publicationState: "draft",
        primaryVideoId: null,
        metadata: { ...metadata, seriesIds: [product.value.id] },
        body: representativeDocument("Ordinary"),
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [
          { code: "material_source_mismatch", path: "/metadata/seriesIds/0" },
        ],
      },
    });
    const paidSource = { ...source, id: "paid-feed-lesson", showInFeed: true };
    const reserved = await authoring.reserveSourceMaterial({
      actor,
      source: paidSource,
    });
    if (!reserved.ok) throw new Error(reserved.error.code);
    const topic = await authoring.createContentCollection({
      actor,
      kind: "topic",
      name: "Paid topic",
      slug: "paid-topic",
      summary: "",
    });
    if (!topic.ok) throw new Error(topic.error.code);
    expect(
      await authoring.applySourceMaterial({
        actor,
        source: paidSource,
        materialId: reserved.value.materialId,
        expectedContentVersion: 1,
        idempotencyKey: "paid-feed-publish",
        publicationState: "published",
        primaryVideoId: null,
        metadata: {
          ...metadata,
          access: "closed",
          summary: "Paid lesson",
          topicId: topic.value.id,
          seriesIds: [product.value.id],
        },
        body: representativeDocument("Protected body"),
      }),
    ).toMatchObject({ ok: true });
    const order = await authoring.loadSeriesOrder({
      actor,
      seriesId: product.value.id,
    });
    if (!order.ok) throw new Error(order.error.code);
    expect(
      await authoring.reorderSourceProduct({
        actor,
        sourceId: "paid-product",
        seriesId: product.value.id,
        expectedOrderVersion: order.value.orderVersion,
        orderedMaterialIds: [],
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [{ code: "standalone_feed_material_must_be_free" }],
      },
    });
    expect(
      await database.prisma.material.findUnique({
        where: { id: reserved.value.materialId },
        select: { access: true, showInFeed: true },
      }),
    ).toEqual({ access: "closed", showInFeed: true });
    expect(
      await database.prisma.productMembership.count({
        where: { materialId: reserved.value.materialId },
      }),
    ).toBe(1);
  });

  test("a composition names the Material whose source ownership differs from the Product", async () => {
    const { authoring } = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: (id) => id === actor },
    });
    const plain = await authoring.createDraft({
      actor,
      idempotencyKey: "mismatch-plain",
      metadata,
      body: representativeDocument("Plain"),
    });
    if (!plain.ok) throw new Error(plain.error.code);
    const imported = await authoring.reserveSourceMaterial({
      actor,
      source: { ...source, id: "mismatch-imported" },
    });
    if (!imported.ok) throw new Error(imported.error.code);

    const editorProduct = await authoring.createContentCollection({
      actor,
      kind: "series",
      name: "Editor product",
      slug: "mismatch-editor-product",
      summary: "",
    });
    if (!editorProduct.ok) throw new Error(editorProduct.error.code);
    const editorOrder = await authoring.loadSeriesOrder({
      actor,
      seriesId: editorProduct.value.id,
    });
    if (!editorOrder.ok) throw new Error(editorOrder.error.code);
    expect(
      await authoring.reorderSeries({
        actor,
        seriesId: editorProduct.value.id,
        expectedOrderVersion: editorOrder.value.orderVersion,
        orderedMaterialIds: [plain.value.materialId, imported.value.materialId],
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [
          { code: "material_source_mismatch", path: "/orderedMaterialIds/1" },
        ],
      },
    });

    const sourceProduct = await authoring.reserveSourceProduct({
      actor,
      sourceId: "mismatch-source-product",
      name: "Source product",
      slug: "mismatch-source-product",
      summary: "",
    });
    if (!sourceProduct.ok) throw new Error(sourceProduct.error.code);
    const sourceOrder = await authoring.loadSeriesOrder({
      actor,
      seriesId: sourceProduct.value.id,
    });
    if (!sourceOrder.ok) throw new Error(sourceOrder.error.code);
    expect(
      await authoring.reorderSourceProduct({
        actor,
        sourceId: "mismatch-source-product",
        seriesId: sourceProduct.value.id,
        expectedOrderVersion: sourceOrder.value.orderVersion,
        orderedMaterialIds: [plain.value.materialId, imported.value.materialId],
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [
          { code: "material_source_mismatch", path: "/orderedMaterialIds/0" },
        ],
      },
    });
  });

  test("a removed closed lesson can be unpublished idempotently but cannot be republished without a Product", async () => {
    const { authoring, publishedMaterialReader } = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: (id) => id === actor },
    });
    const product = await authoring.reserveSourceProduct({
      actor,
      sourceId: "retired-product",
      name: "Retired product",
      slug: "retired-product",
      summary: "Programme",
    });
    if (!product.ok) throw new Error(product.error.code);
    const topic = await authoring.createContentCollection({
      actor,
      kind: "topic",
      name: "Retirement topic",
      slug: "retirement-topic",
      summary: "",
    });
    if (!topic.ok) throw new Error(topic.error.code);
    const retiredSource = { ...source, id: "retired-closed-lesson" };
    const reserved = await authoring.reserveSourceMaterial({
      actor,
      source: retiredSource,
    });
    if (!reserved.ok) throw new Error(reserved.error.code);
    const command = {
      actor,
      source: retiredSource,
      materialId: reserved.value.materialId,
      expectedContentVersion: 1,
      idempotencyKey: "retirement-publish",
      publicationState: "published" as const,
      primaryVideoId: null,
      metadata: {
        ...metadata,
        access: "closed" as const,
        summary: "Retired lesson",
        topicId: topic.value.id,
        seriesIds: [product.value.id],
      },
      body: representativeDocument("Retired protected body"),
    };
    expect(await authoring.applySourceMaterial(command)).toMatchObject({
      ok: true,
      value: { contentVersion: 2 },
    });
    const orphanedMetadata = { ...command.metadata, seriesIds: [] };
    expect(
      await authoring.applySourceMaterial({
        ...command,
        expectedContentVersion: 2,
        idempotencyKey: "retirement-keep-published",
        metadata: orphanedMetadata,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_content" },
    });
    const order = await authoring.loadSeriesOrder({
      actor,
      seriesId: product.value.id,
    });
    if (!order.ok) throw new Error(order.error.code);
    expect(
      await authoring.reorderSourceProduct({
        actor,
        sourceId: "retired-product",
        seriesId: product.value.id,
        expectedOrderVersion: order.value.orderVersion,
        orderedMaterialIds: [],
        confirmedProductRemovals: [product.value.id],
      }),
    ).toMatchObject({ ok: true });
    const unpublish = {
      ...command,
      expectedContentVersion: 2,
      idempotencyKey: "retirement-unpublish",
      publicationState: "unpublished" as const,
      metadata: orphanedMetadata,
    };
    const retired = await authoring.applySourceMaterial(unpublish);
    if (!retired.ok) throw new Error(JSON.stringify(retired.error));
    expect(retired).toMatchObject({
      ok: true,
      value: { contentVersion: 3 },
    });
    expect(await authoring.applySourceMaterial(unpublish)).toEqual(retired);
    expect(
      await authoring.loadMaterial({ actor, materialId: command.materialId }),
    ).toMatchObject({
      ok: true,
      value: { publicationState: "unpublished", contentVersion: 3 },
    });
    const catalog = await publishedMaterialReader.listProjections({
      first: 12,
    });
    if (!catalog.ok) throw new Error(catalog.error.code);
    expect(catalog.value.items.map((item) => item.materialId)).not.toContain(
      command.materialId,
    );
    const current = await authoring.loadMaterial({
      actor,
      materialId: command.materialId,
    });
    if (!current.ok || current.value.metadata.slug === null)
      throw new Error("Missing retired Material");
    expect(
      await publishedMaterialReader.read({
        subject: anonymousSubject,
        slug: current.value.metadata.slug,
      }),
    ).toEqual({ ok: false, error: { code: "material_not_found" } });
    expect(
      await authoring.applySourceMaterial({
        ...command,
        expectedContentVersion: 3,
        idempotencyKey: "retirement-invalid-republish",
        metadata: orphanedMetadata,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_content" },
    });
  });

  test("source deletion is restricted to the exact source and a never-published draft, and replays after deletion", async () => {
    const { authoring } = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: (id) => id === actor },
    });
    const draftSource = { ...source, id: "obsolete-source-draft" };
    const reserved = await authoring.reserveSourceMaterial({
      actor,
      source: draftSource,
    });
    if (!reserved.ok) throw new Error(reserved.error.code);
    const command = {
      actor,
      sourceId: draftSource.id,
      materialId: reserved.value.materialId,
      expectedContentVersion: 1,
      idempotencyKey: "delete-obsolete-source",
    };
    expect(
      await authoring.deleteSourceDraft({
        ...command,
        actor: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      await authoring.deleteSourceDraft({
        ...command,
        sourceId: "other-source",
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      await authoring.deleteSourceDraft({
        ...command,
        expectedContentVersion: 2,
      }),
    ).toMatchObject({ ok: false, error: { code: "stale_content_version" } });
    const deleted = await authoring.deleteSourceDraft(command);
    expect(deleted).toEqual({
      ok: true,
      value: { materialId: reserved.value.materialId },
    });
    expect(await authoring.deleteSourceDraft(command)).toEqual(deleted);
    expect(
      await authoring.loadMaterial({ actor, materialId: command.materialId }),
    ).toMatchObject({ ok: false, error: { code: "material_not_found" } });
    const keptSource = { ...source, id: "retired-source-deletion-test" };
    const retired = await authoring.reserveSourceMaterial({
      actor,
      source: keptSource,
    });
    if (!retired.ok) throw new Error(retired.error.code);
    const topic = await authoring.createContentCollection({
      actor,
      kind: "topic",
      name: "Deletion topic",
      slug: "deletion-topic",
      summary: "",
    });
    if (!topic.ok) throw new Error(topic.error.code);
    const publish = {
      actor,
      source: keptSource,
      materialId: retired.value.materialId,
      expectedContentVersion: 1,
      idempotencyKey: "source-deletion-publish",
      publicationState: "published" as const,
      primaryVideoId: null,
      metadata: {
        ...metadata,
        summary: "Published original",
        topicId: topic.value.id,
      },
      body: representativeDocument("Cannot delete this publication"),
    };
    expect(await authoring.applySourceMaterial(publish)).toMatchObject({
      ok: true,
    });
    const cannotDelete = {
      ...command,
      sourceId: keptSource.id,
      materialId: retired.value.materialId,
      expectedContentVersion: 2,
      idempotencyKey: "cannot-delete-published-source",
    };
    expect(await authoring.deleteSourceDraft(cannotDelete)).toMatchObject({
      ok: false,
      error: { code: "draft_deletion_forbidden" },
    });
    expect(
      await authoring.applySourceMaterial({
        ...publish,
        publicationState: "unpublished",
        expectedContentVersion: 2,
        idempotencyKey: "source-deletion-unpublish",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await authoring.deleteSourceDraft({
        ...cannotDelete,
        expectedContentVersion: 3,
        idempotencyKey: "cannot-delete-unpublished-source",
      }),
    ).toMatchObject({ ok: false, error: { code: "draft_deletion_forbidden" } });
  });

  test("source draft deletion cannot remove a Product member", async () => {
    const { authoring } = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: (id) => id === actor },
    });
    const product = await authoring.reserveSourceProduct({
      actor,
      sourceId: "draft-delete-product",
      name: "Keep composition",
      slug: "draft-delete-product",
      summary: "",
    });
    if (!product.ok) throw new Error(product.error.code);
    const memberSource = { ...source, id: "draft-delete-member" };
    const reserved = await authoring.reserveSourceMaterial({
      actor,
      source: memberSource,
    });
    if (!reserved.ok) throw new Error(reserved.error.code);
    expect(
      await authoring.applySourceMaterial({
        actor,
        source: memberSource,
        materialId: reserved.value.materialId,
        expectedContentVersion: 1,
        idempotencyKey: "draft-delete-attach",
        publicationState: "draft",
        primaryVideoId: null,
        metadata: { ...metadata, seriesIds: [product.value.id] },
        body: representativeDocument("Keep member"),
      }),
    ).toMatchObject({ ok: true });
    expect(
      await authoring.deleteSourceDraft({
        actor,
        sourceId: memberSource.id,
        materialId: reserved.value.materialId,
        expectedContentVersion: 2,
        idempotencyKey: "draft-delete-member",
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_reference" } });
    expect(
      await authoring.loadSeriesOrder({ actor, seriesId: product.value.id }),
    ).toMatchObject({
      ok: true,
      value: { items: [{ materialId: reserved.value.materialId }] },
    });
  });
});
