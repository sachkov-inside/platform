import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { assembleMaterials } from "../../src/modules/materials/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("MaterialAuthoring", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("creates and loads one structurally valid incomplete draft", async () => {
    const ownerMaterials = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (accountId) => accountId === actor },
    });
    const { authoring } = ownerMaterials;
    const body = representativeDocument("Current mutable body.");

    const created = await authoring.createDraft({
      actor,
      idempotencyKey: "create-incomplete-draft",
      metadata: {
        title: null,
        summary: null,
        slug: null,
        access: "free",
        topicId: null,
        formatId: null,
        tagIds: [],
        seriesIds: [],
      },
      body,
    });

    expect(created).toMatchObject({
      ok: true,
      value: {
        contentVersion: 1,
        publicationState: "draft",
        publishedAt: null,
      },
    });
    if (!created.ok) {
      throw new Error(created.error.code);
    }

    expect(
      await authoring.loadMaterial({
        actor,
        materialId: created.value.materialId,
      }),
    ).toEqual({
      ok: true,
      value: {
        materialId: created.value.materialId,
        contentVersion: 1,
        publicationState: "draft",
        firstPublishedAt: null,
        publishedAt: null,
        metadata: {
          title: null,
          summary: null,
          slug: null,
          access: "free",
          topicId: null,
          formatId: null,
          tagIds: [],
          seriesMemberships: [],
        },
        body,
      },
    });

    let previewAuthorizations = 0;
    const previewAuthoring = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (accountId) => accountId === actor },
      contentAccess: {
        checkAvailabilityMany:
          ownerMaterials.contentAccess.checkAvailabilityMany.bind(
            ownerMaterials.contentAccess,
          ),
        authorize: async (input) => {
          previewAuthorizations += 1;
          expect(input).toMatchObject({
            subject: { kind: "account", accountId: actor },
            resource: {
              kind: "material",
              materialId: created.value.materialId,
            },
            action: "preview",
            enforcementPoint: "material_preview",
          });
          return ownerMaterials.contentAccess.authorize(input);
        },
      },
    }).authoring;
    expect(
      await previewAuthoring.previewMaterial({
        actor,
        materialId: created.value.materialId,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        materialId: created.value.materialId,
        contentVersion: 1,
        publicationState: "draft",
        cacheScope: "private-no-store",
        body: {
          blocks: [
            { kind: "heading" },
            {
              kind: "paragraph",
              content: [{ kind: "text", text: "Current mutable body." }],
            },
          ],
        },
      },
    });
    expect(previewAuthorizations).toBe(1);
    expect(
      await authoring.validateMaterial({
        actor,
        materialId: created.value.materialId,
        expectedContentVersion: 1,
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_content",
        issues: [
          { code: "required_for_publication", path: "/metadata/formatId" },
          { code: "required_for_publication", path: "/metadata/slug" },
          { code: "required_for_publication", path: "/metadata/summary" },
          { code: "required_for_publication", path: "/metadata/title" },
          { code: "required_for_publication", path: "/metadata/topicId" },
        ],
      },
    });
  });

  test("denies Preview before loading body or private metadata", async () => {
    const owner = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (accountId) => accountId === actor },
    });
    const created = await owner.authoring.createDraft({
      actor,
      idempotencyKey: "create-denied-preview",
      metadata: {
        title: "Protected preview",
        summary: null,
        slug: null,
        access: "membership",
        topicId: null,
        formatId: null,
        tagIds: [],
        seriesIds: [],
      },
      body: representativeDocument("Must stay private."),
    });
    if (!created.ok) {
      throw new Error(created.error.code);
    }

    const unauthorizedMaterials = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => false },
    });
    const bodyRowRead = vi.spyOn(testDatabase.prisma.material, "findUnique");
    const tagRead = vi.spyOn(testDatabase.prisma.materialTag, "findMany");
    const seriesRead = vi.spyOn(
      testDatabase.prisma.seriesMembership,
      "findMany",
    );

    await expect(
      unauthorizedMaterials.authoring.previewMaterial({
        actor,
        materialId: created.value.materialId,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "forbidden" } });
    expect(bodyRowRead).toHaveBeenCalledOnce();
    expect(bodyRowRead).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          publicationState: true,
          access: true,
          contentVersion: true,
        },
      }),
    );
    expect(tagRead).not.toHaveBeenCalled();
    expect(seriesRead).not.toHaveBeenCalled();
    bodyRowRead.mockRestore();
    tagRead.mockRestore();
    seriesRead.mockRestore();
  });

  test("lists sorted authoring references only for a manager", async () => {
    await Promise.all([
      testDatabase.prisma.topic.createMany({
        data: [
          { id: "94000000-0000-4000-8000-000000000031", name: "Platform", slug: "platform" },
          { id: "94000000-0000-4000-8000-000000000032", name: "AI", slug: "ai" },
        ],
      }),
      testDatabase.prisma.format.create({
        data: {
          id: "94000000-0000-4000-8000-000000000033",
          name: "Гайд",
          slug: "guide",
        },
      }),
      testDatabase.prisma.series.create({
        data: {
          id: "94000000-0000-4000-8000-000000000035",
          name: "Build",
          slug: "build",
        },
      }),
      testDatabase.prisma.tag.create({
        data: {
          id: "94000000-0000-4000-8000-000000000034",
          name: "delivery",
          normalizedName: "delivery",
        },
      }),
    ]);
    const owner = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (accountId) => accountId === actor },
    });

    await expect(owner.authoring.listReferences({ actor })).resolves.toEqual({
      ok: true,
      value: {
        formats: [{ id: "94000000-0000-4000-8000-000000000033", name: "Гайд" }],
        series: [{ id: "94000000-0000-4000-8000-000000000035", name: "Build" }],
        tags: [{ id: "94000000-0000-4000-8000-000000000034", name: "delivery" }],
        topics: [
          { id: "94000000-0000-4000-8000-000000000032", name: "AI" },
          { id: "94000000-0000-4000-8000-000000000031", name: "Platform" },
        ],
      },
    });

    const unauthorized = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => false },
    });
    await expect(unauthorized.authoring.listReferences({ actor })).resolves.toEqual({
      error: { code: "forbidden" },
      ok: false,
    });
  });

  test("lists the complete authoring corpus with search, state filtering, and stable pages", async () => {
    const topicId = "95000000-0000-4000-8000-000000000031";
    const formatId = "95000000-0000-4000-8000-000000000032";
    await Promise.all([
      testDatabase.prisma.topic.create({
        data: { id: topicId, name: "Admin topic", slug: "admin-topic" },
      }),
      testDatabase.prisma.format.create({
        data: { id: formatId, name: "Admin format", slug: "admin-format" },
      }),
    ]);
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (accountId) => accountId === actor },
    });
    const drafts = await Promise.all(
      ["Старый", "Средний", "Новый"].map((title) =>
        authoring.createDraft({
          actor,
          idempotencyKey: `list-admin-corpus-${title}`,
          metadata: {
            title: `Admin corpus ${title}`,
            summary: null,
            slug: null,
            access: "free",
            topicId,
            formatId,
            tagIds: [],
            seriesIds: [],
          },
          body: representativeDocument(title),
        }),
      ),
    );
    const materialIds = drafts.map((draft) => {
      if (!draft.ok) throw new Error(draft.error.code);
      return draft.value.materialId;
    });
    const titleless = await authoring.createDraft({
      actor,
      idempotencyKey: "list-admin-titleless",
      metadata: {
        title: null,
        summary: null,
        slug: "titleless-admin-corpus",
        access: "free",
        topicId: null,
        formatId: null,
        tagIds: [],
        seriesIds: [],
      },
      body: representativeDocument("Titleless"),
    });
    if (!titleless.ok) throw new Error(titleless.error.code);
    const retiredDraft = await authoring.createDraft({
      actor,
      idempotencyKey: "list-admin-retired",
      metadata: {
        title: "Retired admin corpus",
        summary: "Previously published Material",
        slug: "retired-admin-corpus",
        access: "free",
        topicId,
        formatId,
        tagIds: [],
        seriesIds: [],
      },
      body: representativeDocument("Retired"),
    });
    if (!retiredDraft.ok) throw new Error(retiredDraft.error.code);
    const published = await authoring.saveMaterial({
      actor,
      idempotencyKey: "list-admin-retired-publish",
      materialId: retiredDraft.value.materialId,
      expectedContentVersion: 1,
      publicationState: "published",
      metadata: {
        title: "Retired admin corpus",
        summary: "Previously published Material",
        slug: "retired-admin-corpus",
        access: "free",
        topicId,
        formatId,
        tagIds: [],
        seriesIds: [],
      },
      body: representativeDocument("Retired"),
    });
    if (!published.ok) throw new Error(published.error.code);
    const unpublished = await authoring.saveMaterial({
      actor,
      idempotencyKey: "list-admin-retired-unpublish",
      materialId: retiredDraft.value.materialId,
      expectedContentVersion: 2,
      publicationState: "unpublished",
      metadata: {
        title: "Retired admin corpus",
        summary: "Previously published Material",
        slug: "retired-admin-corpus",
        access: "free",
        topicId,
        formatId,
        tagIds: [],
        seriesIds: [],
      },
      body: representativeDocument("Retired"),
    });
    if (!unpublished.ok) throw new Error(unpublished.error.code);
    await Promise.all(
      materialIds.map((materialId, index) =>
        testDatabase.prisma.material.update({
          data: { updatedAt: new Date(`2026-08-0${String(index + 1)}T10:00:00.000Z`) },
          where: { id: materialId },
        }),
      ),
    );

    await expect(
      authoring.listMaterials({
        actor,
        first: 2,
        page: 1,
        publicationState: "draft",
        search: "  ADMIN corpus  ",
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        items: [
          {
            contentVersion: 1,
            format: { id: formatId, name: "Admin format" },
            materialId: materialIds[2],
            publicationState: "draft",
            title: "Admin corpus Новый",
            topic: { id: topicId, name: "Admin topic" },
            updatedAt: "2026-08-03T10:00:00.000Z",
          },
          {
            contentVersion: 1,
            format: { id: formatId, name: "Admin format" },
            materialId: materialIds[1],
            publicationState: "draft",
            title: "Admin corpus Средний",
            topic: { id: topicId, name: "Admin topic" },
            updatedAt: "2026-08-02T10:00:00.000Z",
          },
        ],
        page: 1,
        pageSize: 2,
        totalItems: 3,
        totalPages: 2,
      },
    });
    await expect(
      authoring.listMaterials({
        actor,
        first: 2,
        page: 2,
        publicationState: "draft",
        search: "admin corpus",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        items: [{ materialId: materialIds[0], title: "Admin corpus Старый" }],
        page: 2,
        pageSize: 2,
        totalItems: 3,
        totalPages: 2,
      },
    });
    await expect(
      authoring.listMaterials({
        actor,
        first: 20,
        page: 1,
        search: "titleless-admin-corpus",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        items: [
          {
            materialId: titleless.value.materialId,
            publicationState: "draft",
            title: null,
          },
        ],
        totalItems: 1,
      },
    });
    await expect(
      authoring.listMaterials({
        actor,
        first: 20,
        page: 1,
        publicationState: "unpublished",
        search: "retired admin corpus",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        items: [
          {
            contentVersion: 3,
            materialId: retiredDraft.value.materialId,
            publicationState: "unpublished",
            title: "Retired admin corpus",
          },
        ],
        totalItems: 1,
      },
    });

    const unauthorized = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => false },
    });
    await expect(
      unauthorized.authoring.listMaterials({ actor, first: 20, page: 1 }),
    ).resolves.toEqual({ ok: false, error: { code: "forbidden" } });
  });
});
