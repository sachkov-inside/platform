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
        seriesMemberships: [],
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
        seriesMemberships: [],
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
});
