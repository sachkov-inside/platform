import { afterAll, beforeAll, describe, expect, test } from "vitest";

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
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (accountId) => accountId === actor },
    });
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

    expect(
      await authoring.previewMaterial({
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
});
