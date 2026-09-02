import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { assembleMaterials } from "../../src/modules/materials/index.js";
import {
  assembleVideos,
  type ProviderVideo,
  type VideoProvider,
  type Videos,
} from "../../src/modules/videos/index.js";
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
        primaryVideoId: null,
        primaryVideo: null,
        latestVideoDeletion: null,
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
          primaryVideoId: true,
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
        formats: [{
          archived: false,
          id: "94000000-0000-4000-8000-000000000033",
          name: "Гайд",
        }],
        series: [{
          archived: false,
          id: "94000000-0000-4000-8000-000000000035",
          name: "Build",
        }],
        tags: [{
          archived: false,
          id: "94000000-0000-4000-8000-000000000034",
          name: "delivery",
        }],
        topics: [
          {
            archived: false,
            id: "94000000-0000-4000-8000-000000000032",
            name: "AI",
          },
          {
            archived: false,
            id: "94000000-0000-4000-8000-000000000031",
            name: "Platform",
          },
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
            canDelete: true,
            contentVersion: 1,
            format: { id: formatId, name: "Admin format" },
            materialId: materialIds[2],
            publicationState: "draft",
            title: "Admin corpus Новый",
            topic: { id: topicId, name: "Admin topic" },
            updatedAt: "2026-08-03T10:00:00.000Z",
          },
          {
            canDelete: true,
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
        search: "Admin corpus Старый",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        items: [
          {
            canDelete: true,
            materialId: materialIds[0],
            publicationState: "draft",
            title: "Admin corpus Старый",
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
            canDelete: false,
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

  test("fails closed on Video validation and changes published playback only after a successful Save", async () => {
    const topicId = "96000000-0000-4000-8000-000000000031";
    const formatId = "96000000-0000-4000-8000-000000000032";
    const firstVideoId = "96000000-0000-4000-8000-000000000033";
    const replacementVideoId = "96000000-0000-4000-8000-000000000034";
    await Promise.all([
      testDatabase.prisma.topic.create({
        data: { id: topicId, name: "Video topic", slug: "video-topic" },
      }),
      testDatabase.prisma.format.create({
        data: { id: formatId, name: "Video guide", slug: "video-guide" },
      }),
    ]);
    const metadata = {
      access: "free" as const,
      formatId,
      seriesIds: [],
      summary: "One primary Video outside the Material body.",
      tagIds: [],
      title: "Primary Video lifecycle",
      topicId,
    };
    const withoutVideos = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (accountId) => accountId === actor },
    });
    const created = await withoutVideos.authoring.createDraft({
      actor,
      body: representativeDocument("Published body remains independent."),
      idempotencyKey: "create-primary-video-material",
      metadata,
    });
    if (!created.ok) throw new Error(created.error.code);

    await expect(withoutVideos.authoring.saveMaterial({
      actor,
      body: representativeDocument("Published body remains independent."),
      expectedContentVersion: 1,
      idempotencyKey: "publish-with-missing-video-dependency",
      materialId: created.value.materialId,
      metadata,
      primaryVideoId: firstVideoId,
      publicationState: "published",
    })).resolves.toEqual({
      error: { code: "dependency_unavailable", retryable: true },
      ok: false,
    });

    let replacementReady = false;
    const inspectPrimaryReference = vi.fn(({ videoId }: { readonly videoId: string }) =>
      Promise.resolve(videoId === replacementVideoId && !replacementReady
        ? { error: { code: "video_not_ready" as const }, ok: false as const }
        : { ok: true as const, value: undefined }));
    const loadPresentation = vi.fn(({ videoId }: { readonly videoId: string }) => Promise.resolve({
      ok: true as const,
      value: {
        state: "ready" as const,
        title: videoId === firstVideoId ? "First Video" : "Replacement Video",
        videoId,
      },
    }));
    const videos = { inspectPrimaryReference, loadPresentation } satisfies Pick<
      Videos,
      "inspectPrimaryReference" | "loadPresentation"
    >;
    const withVideos = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (accountId) => accountId === actor },
      videos,
    });
    const published = await withVideos.authoring.saveMaterial({
      actor,
      body: representativeDocument("Published body remains independent."),
      expectedContentVersion: 1,
      idempotencyKey: "publish-with-primary-video",
      materialId: created.value.materialId,
      metadata,
      primaryVideoId: firstVideoId,
      publicationState: "published",
    });
    expect(published).toMatchObject({ ok: true, value: { contentVersion: 2 } });

    await expect(withVideos.authoring.saveMaterial({
      actor,
      body: representativeDocument("Published body remains independent."),
      expectedContentVersion: 2,
      idempotencyKey: "reject-processing-video-replacement",
      materialId: created.value.materialId,
      metadata,
      primaryVideoId: replacementVideoId,
      publicationState: "published",
    })).resolves.toEqual({
      error: {
        code: "invalid_reference",
        issues: [{ code: "video_not_ready", path: "/primaryVideoId" }],
      },
      ok: false,
    });
    await expect(withVideos.publishedMaterialReader.read({
      slug: "primary-video-lifecycle",
      subject: { kind: "anonymous" },
    })).resolves.toMatchObject({
      ok: true,
      value: {
        kind: "available",
        primaryVideo: { title: "First Video", videoId: firstVideoId },
        projection: { primaryVideoId: firstVideoId },
      },
    });

    replacementReady = true;
    await expect(withVideos.authoring.saveMaterial({
      actor,
      body: representativeDocument("Published body remains independent."),
      expectedContentVersion: 2,
      idempotencyKey: "save-ready-video-replacement",
      materialId: created.value.materialId,
      metadata,
      primaryVideoId: replacementVideoId,
      publicationState: "published",
    })).resolves.toMatchObject({ ok: true, value: { contentVersion: 3 } });
    await expect(withVideos.authoring.loadMaterial({
      actor,
      materialId: created.value.materialId,
    })).resolves.toMatchObject({
      ok: true,
      value: { primaryVideoId: replacementVideoId },
    });
    await expect(withVideos.publishedMaterialReader.read({
      slug: "primary-video-lifecycle",
      subject: { kind: "anonymous" },
    })).resolves.toMatchObject({
      ok: true,
      value: {
        primaryVideo: { title: "Replacement Video", videoId: replacementVideoId },
        projection: { primaryVideoId: replacementVideoId },
      },
    });
  });

  test("commits an owned Video deletion intent only with a successful detach Save", async () => {
    const providerVideos = new Map<string, ProviderVideo>();
    let providerDeleteCalls = 0;
    const provider: VideoProvider = {
      delete() {
        providerDeleteCalls += 1;
        return Promise.resolve({ kind: "deleted" });
      },
      find(input) {
        return Promise.resolve(providerVideos.get(input.id) ?? null);
      },
      initUpload(input) {
        const id = `owned-${crypto.randomUUID()}`;
        providerVideos.set(id, {
          embedLocator: `https://kinescope.io/embed/${id}`,
          id,
          projectId: input.projectId,
          status: "done",
          title: input.title,
        });
        return Promise.resolve({
          id,
          uploadEndpoint: `https://uploads.example.test/${id}`,
        });
      },
    };
    const videos = assembleVideos({
      canManage: () => Promise.resolve(true),
      prisma: testDatabase.prisma,
      projects: { free: "public-project", membership: "member-project" },
      provider,
    });
    const materials = assembleMaterials({
      authorPolicy: { canManage: () => Promise.resolve(true) },
      prisma: testDatabase.prisma,
      videos,
    });
    const metadata = {
      access: "free" as const,
      formatId: null,
      seriesIds: [],
      summary: null,
      tagIds: [],
      title: "Owned Video deletion",
      topicId: null,
    };
    const created = await materials.authoring.createDraft({
      actor,
      body: representativeDocument("Delete only after Save."),
      idempotencyKey: "create-owned-video-deletion",
      metadata,
    });
    if (!created.ok) throw new Error(created.error.code);
    const initialized = await videos.initUpload({
      access: "free",
      actor,
      byteSize: 1_024,
      filename: "owned.mp4",
      idempotencyKey: "owned-video-upload",
      materialId: created.value.materialId,
      title: "Owned lesson",
    });
    if (!initialized.ok) throw new Error(initialized.error.code);
    const videoId = initialized.value.video.videoId;
    await expect(videos.reconcile({ actor, videoId })).resolves.toMatchObject({
      ok: true,
      value: { state: "ready" },
    });
    await expect(materials.authoring.saveMaterial({
      actor,
      body: representativeDocument("Delete only after Save."),
      expectedContentVersion: 1,
      idempotencyKey: "attach-owned-video",
      materialId: created.value.materialId,
      metadata,
      primaryVideoId: videoId,
      publicationState: "draft",
    })).resolves.toMatchObject({ ok: true, value: { contentVersion: 2 } });

    await expect(materials.authoring.saveMaterial({
      actor,
      body: representativeDocument("Delete only after Save."),
      expectedContentVersion: 2,
      idempotencyKey: "detach-owned-video-without-deletion",
      materialId: created.value.materialId,
      metadata,
      primaryVideoId: null,
      publicationState: "draft",
    })).resolves.toMatchObject({ ok: true, value: { contentVersion: 3 } });
    await expect(testDatabase.prisma.videoDeletionOperation.count({
      where: { videoId },
    })).resolves.toBe(0);
    expect(providerDeleteCalls).toBe(0);

    await expect(materials.authoring.saveMaterial({
      actor,
      body: representativeDocument("Delete only after Save."),
      expectedContentVersion: 3,
      idempotencyKey: "reattach-owned-video-before-deletion",
      materialId: created.value.materialId,
      metadata,
      primaryVideoId: videoId,
      publicationState: "draft",
    })).resolves.toMatchObject({ ok: true, value: { contentVersion: 4 } });

    await expect(materials.authoring.saveMaterial({
      actor,
      body: representativeDocument("Delete only after Save."),
      deleteVideoId: videoId,
      expectedContentVersion: 3,
      idempotencyKey: "stale-owned-video-deletion",
      materialId: created.value.materialId,
      metadata,
      primaryVideoId: null,
      publicationState: "draft",
    })).resolves.toMatchObject({
      error: { code: "stale_content_version" },
      ok: false,
    });
    await expect(testDatabase.prisma.videoDeletionOperation.count({
      where: { videoId },
    })).resolves.toBe(0);

    await expect(materials.authoring.saveMaterial({
      actor,
      body: representativeDocument("Delete only after Save."),
      deleteVideoId: videoId,
      expectedContentVersion: 4,
      idempotencyKey: "detach-and-delete-owned-video",
      materialId: created.value.materialId,
      metadata,
      primaryVideoId: null,
      publicationState: "draft",
    })).resolves.toMatchObject({ ok: true, value: { contentVersion: 5 } });
    await expect(testDatabase.prisma.videoDeletionOperation.findUniqueOrThrow({
      where: { videoId },
    })).resolves.toMatchObject({
      attempts: 0,
      completedAt: null,
      requestedBy: actor,
      state: "deletion_requested",
    });
    await expect(materials.authoring.loadMaterial({
      actor,
      materialId: created.value.materialId,
    })).resolves.toMatchObject({
      ok: true,
      value: {
        latestVideoDeletion: {
          origin: "platform_upload",
          state: "deletion_requested",
          title: "Owned lesson",
          videoId,
        },
        primaryVideo: null,
        primaryVideoId: null,
      },
    });
    expect(providerDeleteCalls).toBe(0);
  });

  test("records active Platform upload deletion on Save and defers physical DELETE to the worker", async () => {
    let providerDeleteCalls = 0;
    const provider: VideoProvider = {
      delete() {
        providerDeleteCalls += 1;
        return Promise.resolve({ kind: "deleted" });
      },
      find(input) {
        return Promise.resolve({
          embedLocator: null,
          id: input.id,
          projectId: input.projectId,
          status: "uploading",
          title: "Interrupted upload",
        });
      },
      initUpload(_input) {
        const id = `active-${crypto.randomUUID()}`;
        return Promise.resolve({ id, uploadEndpoint: `https://uploads.example.test/${id}` });
      },
    };
    const videos = assembleVideos({
      canManage: () => Promise.resolve(true),
      prisma: testDatabase.prisma,
      projects: { free: "public-project", membership: "member-project" },
      provider,
    });
    const materials = assembleMaterials({
      authorPolicy: { canManage: () => Promise.resolve(true) },
      prisma: testDatabase.prisma,
      videos,
    });
    const metadata = {
      access: "free" as const,
      formatId: null,
      seriesIds: [],
      summary: null,
      tagIds: [],
      title: "Active upload deletion",
      topicId: null,
    };
    const created = await materials.authoring.createDraft({
      actor,
      body: representativeDocument("Cancel transfer before deletion."),
      idempotencyKey: "create-active-upload-deletion",
      metadata,
    });
    if (!created.ok) throw new Error(created.error.code);
    const initialized = await videos.initUpload({
      access: "free",
      actor,
      byteSize: 1_024,
      filename: "interrupted.mp4",
      idempotencyKey: "active-video-upload",
      materialId: created.value.materialId,
      title: "Interrupted upload",
    });
    if (!initialized.ok) throw new Error(initialized.error.code);

    await expect(materials.authoring.saveMaterial({
      actor,
      body: representativeDocument("Cancel transfer before deletion."),
      deleteVideoId: initialized.value.video.videoId,
      expectedContentVersion: 1,
      idempotencyKey: "request-active-video-deletion",
      materialId: created.value.materialId,
      metadata,
      primaryVideoId: null,
      publicationState: "draft",
    })).resolves.toMatchObject({ ok: true, value: { contentVersion: 2 } });
    await expect(testDatabase.prisma.video.findUniqueOrThrow({
      where: { id: initialized.value.video.videoId },
    })).resolves.toMatchObject({
      providerStatus: "uploading",
      state: "deletion_requested",
    });
    expect(providerDeleteCalls).toBe(0);
  });

  test("hard-deletes a never-published draft while retaining its owned Video deletion audit", async () => {
    const provider: VideoProvider = {
      delete: () => Promise.resolve({ kind: "deleted" }),
      find(input) {
        return Promise.resolve({
          embedLocator: `https://kinescope.io/embed/${input.id}`,
          id: input.id,
          projectId: input.projectId,
          status: "done",
          title: "Draft-only video",
        });
      },
      initUpload(_input) {
        const id = `draft-${crypto.randomUUID()}`;
        return Promise.resolve({ id, uploadEndpoint: `https://uploads.example.test/${id}` });
      },
    };
    const videos = assembleVideos({
      canManage: () => Promise.resolve(true),
      prisma: testDatabase.prisma,
      projects: { free: "public-project", membership: "member-project" },
      provider,
    });
    const materials = assembleMaterials({
      authorPolicy: { canManage: () => Promise.resolve(true) },
      prisma: testDatabase.prisma,
      videos,
    });
    const metadata = {
      access: "free" as const,
      formatId: null,
      seriesIds: [],
      summary: null,
      tagIds: [],
      title: "Disposable draft",
      topicId: null,
    };
    const created = await materials.authoring.createDraft({
      actor,
      body: representativeDocument("Draft is disposable."),
      idempotencyKey: "create-draft-hard-delete-video",
      metadata,
    });
    if (!created.ok) throw new Error(created.error.code);
    const initialized = await videos.initUpload({
      access: "free",
      actor,
      byteSize: 1_024,
      filename: "draft.mp4",
      idempotencyKey: "draft-hard-delete-upload",
      materialId: created.value.materialId,
      title: "Draft-only video",
    });
    if (!initialized.ok) throw new Error(initialized.error.code);
    await videos.reconcile({ actor, videoId: initialized.value.video.videoId });
    await materials.authoring.saveMaterial({
      actor,
      body: representativeDocument("Draft is disposable."),
      expectedContentVersion: 1,
      idempotencyKey: "attach-draft-hard-delete-video",
      materialId: created.value.materialId,
      metadata,
      primaryVideoId: initialized.value.video.videoId,
      publicationState: "draft",
    });

    await expect(materials.authoring.deleteDraft({
      actor,
      deleteVideoId: initialized.value.video.videoId,
      expectedContentVersion: 2,
      idempotencyKey: "delete-draft-with-owned-video",
      materialId: created.value.materialId,
    })).resolves.toEqual({ ok: true, value: { materialId: created.value.materialId } });
    await expect(testDatabase.prisma.material.findUnique({
      where: { id: created.value.materialId },
    })).resolves.toBeNull();
    await expect(testDatabase.prisma.videoDeletionOperation.findUniqueOrThrow({
      where: { videoId: initialized.value.video.videoId },
    })).resolves.toMatchObject({ state: "deletion_requested" });
  });

  test("rejects deletion of an externally attached Video without detaching it", async () => {
    let providerDeleteCalls = 0;
    const provider: VideoProvider = {
      delete() {
        providerDeleteCalls += 1;
        return Promise.resolve({ kind: "deleted" });
      },
      find(input) {
        return Promise.resolve({
          embedLocator: `https://kinescope.io/embed/${input.id}`,
          id: input.id,
          projectId: input.projectId,
          status: "done",
          title: "Externally attached lesson",
        });
      },
      initUpload: () => Promise.reject(new Error("unused")),
    };
    const videos = assembleVideos({
      canManage: () => Promise.resolve(true),
      prisma: testDatabase.prisma,
      projects: { free: "public-project", membership: "member-project" },
      provider,
    });
    const materials = assembleMaterials({
      authorPolicy: { canManage: () => Promise.resolve(true) },
      prisma: testDatabase.prisma,
      videos,
    });
    const metadata = {
      access: "free" as const,
      formatId: null,
      seriesIds: [],
      summary: null,
      tagIds: [],
      title: "External Video deletion",
      topicId: null,
    };
    const created = await materials.authoring.createDraft({
      actor,
      body: representativeDocument("External Video stays in Kinescope."),
      idempotencyKey: "create-external-video-deletion",
      metadata,
    });
    if (!created.ok) throw new Error(created.error.code);
    const attached = await videos.attachExisting({
      access: "free",
      actor,
      materialId: created.value.materialId,
      providerVideoId: `external-${crypto.randomUUID()}`,
    });
    if (!attached.ok) throw new Error(attached.error.code);
    await expect(materials.authoring.saveMaterial({
      actor,
      body: representativeDocument("External Video stays in Kinescope."),
      expectedContentVersion: 1,
      idempotencyKey: "attach-external-video",
      materialId: created.value.materialId,
      metadata,
      primaryVideoId: attached.value.videoId,
      publicationState: "draft",
    })).resolves.toMatchObject({ ok: true, value: { contentVersion: 2 } });

    await expect(materials.authoring.saveMaterial({
      actor,
      body: representativeDocument("External Video stays in Kinescope."),
      deleteVideoId: attached.value.videoId,
      expectedContentVersion: 2,
      idempotencyKey: "forged-external-video-deletion",
      materialId: created.value.materialId,
      metadata,
      primaryVideoId: null,
      publicationState: "draft",
    })).resolves.toEqual({
      error: {
        code: "invalid_reference",
        issues: [{ code: "video_deletion_forbidden", path: "/deleteVideoId" }],
      },
      ok: false,
    });
    await expect(materials.authoring.loadMaterial({
      actor,
      materialId: created.value.materialId,
    })).resolves.toMatchObject({
      ok: true,
      value: { contentVersion: 2, primaryVideoId: attached.value.videoId },
    });
    await expect(testDatabase.prisma.videoDeletionOperation.count({
      where: { videoId: attached.value.videoId },
    })).resolves.toBe(0);
    expect(providerDeleteCalls).toBe(0);
  });
});
