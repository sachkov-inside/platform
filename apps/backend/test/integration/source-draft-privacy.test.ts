import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type {
  ObjectStorage,
  StoredObject,
} from "../../src/infrastructure/object-storage/index.js";
import { accountId } from "../../src/modules/accounts/index.js";
import { assembleMaterialAssets } from "../../src/modules/assets/index.js";
import {
  discoverPublishedMaterials,
  listPublishedMaterials,
} from "../../src/modules/content-library/index.js";
import { readLearningMaterial } from "../../src/modules/content-library/features/read-learning-material/read-learning-material.js";
import {
  anonymousSubject,
  assembleContentAccess,
  assembleDeterministicMembershipEntitlements,
  type Subject,
} from "../../src/modules/content-access/index.js";
import { assembleAssetResourceFacts } from "../../src/modules/materials/adapters/content-access/asset-resource-facts.js";
import {
  assembleMaterialResourceFacts,
  assembleMaterials,
  materialId as checkedMaterialId,
  PublishedSeriesComposition,
} from "../../src/modules/materials/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

// Acceptance evidence for #804: a source-imported draft stays private until the owner
// publishes it explicitly. Every read goes through the production facades over PostgreSQL.
const owner = randomUUID();
const stranger = randomUUID();
const guideSourceId = "inside-content:draft-privacy-guide";
const guideSlug = "draft-privacy-guide";
const draftTitle = "Private draft lesson";
// Source Materials take their slug from the source id at reservation, before publication.
const draftSlug = "inside-content-draft-privacy-lesson";
const draftNeedle = "Zephyrdraftneedle";
const draftSource = {
  id: "inside-content:draft-privacy-lesson",
  path: "lessons/private.md",
  revision: "d".repeat(64),
  showInFeed: true,
};
const siblingSource = {
  id: "inside-content:draft-privacy-sibling",
  path: "lessons/public.md",
  revision: "e".repeat(64),
  showInFeed: true,
};

describe("source-imported draft privacy", () => {
  let database: TestDatabase;
  let materials: ReturnType<typeof assembleMaterials>;
  let access: ReturnType<typeof assembleContentAccess>;
  let guideId: string;
  let topicId: string;
  let draftId: string;
  let siblingId: string;
  let assetId: string;
  const guest: Subject = anonymousSubject;
  const strangerSubject: Subject = {
    kind: "account",
    accountId: accountId(stranger),
  };
  const ownerSubject: Subject = {
    kind: "account",
    accountId: accountId(owner),
  };

  function metadata(title: string) {
    return {
      title,
      summary: "Imported lesson",
      access: "free" as const,
      difficulty: null,
      outcomes: [],
      topicId,
      formatId: "note" as const,
      tagIds: [],
      seriesIds: [guideId],
    };
  }

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    materials = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: (id) => id === owner },
    });
    const { authoring } = materials;
    const objects = new Map<string, StoredObject>();
    const storage: ObjectStorage = {
      putImmutable: (input) => {
        objects.set(`${input.namespace}:${input.key}`, {
          body: input.body,
          checksumSha256: input.checksumSha256,
          contentLength: input.body.length,
          contentType: input.contentType,
        });
        return Promise.resolve({ ok: true });
      },
      read: (namespace, key) =>
        Promise.resolve(objects.get(`${namespace}:${key}`) ?? null),
      delete: (namespace, key) => {
        objects.delete(`${namespace}:${key}`);
        return Promise.resolve();
      },
      signGet: (input) =>
        Promise.resolve(`https://storage.example.test/${input.key}`),
    };
    const assets = assembleMaterialAssets({
      prisma: database.prisma,
      objectStorage: storage,
    });
    access = assembleContentAccess({
      assetResourceFacts: assembleAssetResourceFacts(assets),
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      accountPermissions: {
        hasMaterialsManage: (id) => Promise.resolve(id === owner),
      },
      membershipEntitlements: assembleDeterministicMembershipEntitlements(),
    });

    const topic = await authoring.createContentCollection({
      actor: owner,
      kind: "topic",
      name: "Draft privacy topic",
      slug: "draft-privacy-topic",
      summary: "",
    });
    if (!topic.ok) throw new Error(topic.error.code);
    topicId = topic.value.id;
    const guide = await authoring.reserveSourceGuide({
      actor: owner,
      sourceId: guideSourceId,
      name: "Draft privacy guide",
      slug: guideSlug,
      summary: "Programme",
    });
    if (!guide.ok) throw new Error(guide.error.code);
    guideId = guide.value.id;

    // A published sibling keeps the Guide programme, search and feed non-empty.
    const sibling = await authoring.reserveSourceMaterial({
      actor: owner,
      source: siblingSource,
    });
    if (!sibling.ok) throw new Error(sibling.error.code);
    siblingId = sibling.value.materialId;
    const siblingApplied = await authoring.applySourceMaterial({
      actor: owner,
      source: siblingSource,
      materialId: siblingId,
      expectedContentVersion: 1,
      idempotencyKey: "sibling-publish",
      publicationState: "published",
      primaryVideoId: null,
      metadata: metadata("Public sibling lesson"),
      body: representativeDocument(`Public sibling ${draftNeedle}`),
    });
    if (!siblingApplied.ok) throw new Error(siblingApplied.error.code);

    // The default import: reserve, then apply as a private draft inside the Guide.
    const reserved = await authoring.reserveSourceMaterial({
      actor: owner,
      source: draftSource,
    });
    if (!reserved.ok) throw new Error(reserved.error.code);
    draftId = reserved.value.materialId;
    expect(
      await authoring.applySourceMaterial({
        actor: owner,
        source: draftSource,
        materialId: draftId,
        expectedContentVersion: 1,
        idempotencyKey: "draft-import",
        publicationState: "draft",
        primaryVideoId: null,
        metadata: metadata(draftTitle),
        body: representativeDocument(`Secret draft body ${draftNeedle}`),
      }),
    ).toMatchObject({
      ok: true,
      value: { contentVersion: 2, publicationState: "draft" },
    });
    const order = await authoring.loadSeriesOrder({
      actor: owner,
      seriesId: guideId,
    });
    if (!order.ok) throw new Error(order.error.code);
    expect(
      await authoring.reorderSourceGuide({
        actor: owner,
        sourceId: guideSourceId,
        seriesId: guideId,
        expectedOrderVersion: order.value.orderVersion,
        orderedMaterialIds: [draftId, siblingId],
      }),
    ).toMatchObject({ ok: true });

    const bytes = new TextEncoder().encode("Draft attachment");
    const uploaded = await assets.upload({
      actor: owner,
      materialId: draftId,
      body: bytes,
      declaredContentType: "text/plain",
      declaredSize: bytes.length,
      expectedChecksumSha256: createHash("sha256").update(bytes).digest("hex"),
      filename: "draft-attachment.txt",
      idempotencyKey: randomUUID(),
      kind: "file",
    });
    if (!uploaded.ok) throw new Error(uploaded.error.code);
    assetId = uploaded.value.assetId;
  });
  afterAll(async () => {
    await database.dispose();
  });

  test("the Guide composition holds the draft, but no published projection exists", async () => {
    expect(
      await database.prisma.material.findUnique({
        where: { id: draftId },
        select: { slug: true, publicationState: true },
      }),
    ).toEqual({ slug: draftSlug, publicationState: "draft" });
    const order = await materials.authoring.loadSeriesOrder({
      actor: owner,
      seriesId: guideId,
    });
    expect(order).toMatchObject({
      ok: true,
      value: {
        items: [
          { materialId: draftId, publicationState: "draft" },
          { materialId: siblingId, publicationState: "published" },
        ],
      },
    });
    expect(
      await database.prisma.publishedMaterial.count({
        where: { materialId: draftId },
      }),
    ).toBe(0);
  });

  test("ContentAccess denies read and download of the draft and its asset to a guest and a stranger", async () => {
    for (const subject of [guest, strangerSubject]) {
      for (const action of ["read", "download", "preview"] as const) {
        expect(
          await access.authorize({
            subject,
            action,
            resource: {
              kind: "material",
              materialId: checkedMaterialId(draftId),
            },
            enforcementPoint: "published_material_read",
            correlationId: randomUUID(),
          }),
        ).toMatchObject({ effect: "deny" });
      }
      for (const action of ["read", "download"] as const) {
        expect(
          await access.authorize({
            subject,
            action,
            resource: { kind: "asset", assetId },
            enforcementPoint: "download_delivery",
            correlationId: randomUUID(),
          }),
        ).toMatchObject({ effect: "deny" });
      }
    }
  });

  test("slug read, search, feed, Guide programme and learning MCP read never return the draft", async () => {
    const { publishedMaterialReader } = materials;
    for (const subject of [guest, strangerSubject]) {
      expect(
        await publishedMaterialReader.read({ subject, slug: draftSlug }),
      ).toMatchObject({ ok: false, error: { code: "material_not_found" } });
      for (const query of [
        { q: "lesson" },
        { feedOnly: true },
        { seriesSlugs: [guideSlug], sort: "series" as const },
      ]) {
        const listed = await listPublishedMaterials(
          publishedMaterialReader,
          access,
          emptyCatalogVideos,
          { subject, first: 24, ...query },
        );
        if (!listed.ok) throw new Error(listed.error.code);
        const ids = listed.value.items.map((item) => item.materialId);
        expect(ids).toContain(siblingId);
        expect(ids).not.toContain(draftId);
      }
      const programme = await discoverPublishedMaterials(
        publishedMaterialReader,
        access,
        emptyCatalogVideos,
        { first: null, kind: "series", slug: guideSlug, subject },
      );
      if (!programme.ok) throw new Error(programme.error.code);
      expect(programme.value.items.map((item) => item.materialId)).toEqual([
        siblingId,
      ]);
      expect(
        programme.value.chapters.flatMap((chapter) => chapter.materialIds),
      ).not.toContain(draftId);
    }
    expect(
      await new PublishedSeriesComposition(database.prisma).read(guideId),
    ).toEqual({ ok: true, value: [siblingId] });
    expect(
      await readLearningMaterial(
        { reader: publishedMaterialReader, contentAccess: access },
        { subject: strangerSubject, slug: draftSlug },
      ),
    ).toMatchObject({ ok: false, error: { code: "material_not_found" } });
  });

  test("a materials manager may preview the draft and sees its body", async () => {
    expect(
      await access.authorize({
        subject: ownerSubject,
        action: "preview",
        resource: {
          kind: "material",
          materialId: checkedMaterialId(draftId),
        },
        enforcementPoint: "material_preview",
        correlationId: randomUUID(),
      }),
    ).toMatchObject({ effect: "allow", reason: "materials_manager" });
    const preview = await materials.authoring.previewMaterial({
      actor: owner,
      materialId: draftId,
    });
    expect(preview).toMatchObject({
      ok: true,
      value: { materialId: draftId, publicationState: "draft" },
    });
    expect(JSON.stringify(preview)).toContain(
      `Secret draft body ${draftNeedle}`,
    );
    expect(
      await materials.authoring.previewMaterial({
        actor: stranger,
        materialId: draftId,
      }),
    ).toMatchObject({ ok: false });
  });

  test("re-import keeps the draft, explicit approval publishes it, and a later draft apply cannot unpublish", async () => {
    const { authoring, publishedMaterialReader } = materials;
    const base = {
      actor: owner,
      materialId: draftId,
      primaryVideoId: null,
      metadata: metadata(draftTitle),
    };
    expect(
      await authoring.applySourceMaterial({
        ...base,
        source: { ...draftSource, revision: "f".repeat(64) },
        expectedContentVersion: 2,
        idempotencyKey: "draft-reimport",
        publicationState: "draft",
        body: representativeDocument(`Revised draft ${draftNeedle}`),
      }),
    ).toMatchObject({
      ok: true,
      value: { contentVersion: 3, publicationState: "draft" },
    });
    expect(
      await database.prisma.publishedMaterial.count({
        where: { materialId: draftId },
      }),
    ).toBe(0);
    expect(
      await publishedMaterialReader.read({ subject: guest, slug: draftSlug }),
    ).toMatchObject({ ok: false, error: { code: "material_not_found" } });

    expect(
      await authoring.applySourceMaterial({
        ...base,
        source: { ...draftSource, revision: "1".repeat(64) },
        expectedContentVersion: 3,
        idempotencyKey: "owner-approved-publish",
        publicationState: "published",
        body: representativeDocument("Approved public body"),
      }),
    ).toMatchObject({
      ok: true,
      value: { contentVersion: 4, publicationState: "published" },
    });
    const approvedBody = {
      blocks: [
        { kind: "heading" },
        {
          kind: "paragraph",
          content: [{ kind: "text", text: "Approved public body" }],
        },
      ],
    };
    expect(
      await publishedMaterialReader.read({ subject: guest, slug: draftSlug }),
    ).toMatchObject({
      ok: true,
      value: {
        kind: "available",
        projection: { materialId: draftId, contentVersion: 4 },
        body: approvedBody,
      },
    });

    expect(
      await authoring.applySourceMaterial({
        ...base,
        source: { ...draftSource, revision: "2".repeat(64) },
        expectedContentVersion: 4,
        idempotencyKey: "draft-after-publish",
        publicationState: "draft",
        body: representativeDocument("Must not replace the public body"),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_publication_transition" },
    });
    expect(
      await publishedMaterialReader.read({ subject: guest, slug: draftSlug }),
    ).toMatchObject({
      ok: true,
      value: {
        kind: "available",
        projection: { contentVersion: 4 },
        body: approvedBody,
      },
    });
  });
});
