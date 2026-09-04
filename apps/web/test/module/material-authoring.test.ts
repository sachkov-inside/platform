import { describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getPlatformAccessToken: vi.fn(),
  getPlatformAccessTokenRsc: vi.fn(),
}));

vi.mock("@/shared/auth/index.server", () => {
  class LogtoSessionUnavailableError extends Error {}
  return {
    getPlatformAccessToken: authMocks.getPlatformAccessToken,
    getPlatformAccessTokenRsc: authMocks.getPlatformAccessTokenRsc,
    LogtoSessionUnavailableError,
    readLogtoBffConfig: vi.fn().mockReturnValue({}),
  };
});

import {
  executeCreateMaterialDraft,
  type MaterialDraftWorkflowDependencies,
} from "@/_pages/material-authoring/api/create-material-draft";
import { getCurrentMaterialPreview } from "@/_pages/material-authoring/api/get-current-material-preview";
import {
  getCurrentMaterial,
  type CurrentMaterialDependencies,
} from "@/_pages/material-authoring/api/get-current-material";
import { mapCurrentMaterialPreview } from "@/_pages/material-authoring/api/material-preview-mapper";
import {
  executeSaveMaterial,
  type SaveMaterialDependencies,
} from "@/_pages/material-authoring/api/save-material";
import { CurrentMaterialAuthoringPage } from "@/_pages/material-authoring/ui/current-material-authoring-page";
import { MaterialCurrentPreviewPage } from "@/_pages/material-authoring/ui/material-current-preview-page";
import { LogtoSessionUnavailableError } from "@/shared/auth/index.server";
import {
  BackendConnectionError,
  type requestMaterialPreview,
} from "@/shared/api/backend/index.server";

const materialId = "94000000-0000-4000-8000-000000000010";
const submissionId = "94000000-0000-4000-8000-000000000011";
const formatId = "94000000-0000-4000-8000-000000000012";
const topicId = "94000000-0000-4000-8000-000000000013";
const tagId = "94000000-0000-4000-8000-000000000014";
const seriesId = "94000000-0000-4000-8000-000000000015";
const videoId = "94000000-0000-4000-8000-000000000016";

describe("Material Authoring action workflow", () => {
  it("uses the read-only Logto reader while rendering existing Material routes", async () => {
    authMocks.getPlatformAccessToken.mockClear();
    authMocks.getPlatformAccessTokenRsc.mockRejectedValue(
      new LogtoSessionUnavailableError(),
    );

    await CurrentMaterialAuthoringPage({
      materialId,
      returnHref: "/authoring/materials?state=draft",
    });
    await MaterialCurrentPreviewPage({
      materialId,
      returnHref: "/authoring/materials?state=draft",
    });

    expect(authMocks.getPlatformAccessTokenRsc).toHaveBeenCalledTimes(2);
    expect(authMocks.getPlatformAccessToken).not.toHaveBeenCalled();
  });

  it("creates one idempotent draft without post-commit reads", async () => {
    const dependencies = successfulDependencies();

    await expect(
      executeCreateMaterialDraft(validFormData(), "access-token", dependencies),
    ).resolves.toMatchObject({
      kind: "created",
      draft: {
        contentVersion: 1,
        materialId,
      },
    });

    expect(dependencies.create).toHaveBeenCalledOnce();
    expect(dependencies.create).toHaveBeenCalledWith(
      expect.objectContaining({
        formatId,
        idempotencyKey: `web-create-${submissionId}`,
        seriesIds: [seriesId],
        tagIds: [tagId],
        topicId,
      }),
      "access-token",
    );
  });

  it("rejects malformed form input before the Nest mutation", async () => {
    const dependencies = successfulDependencies();
    const formData = validFormData();
    formData.set("document", "not-json");

    await expect(
      executeCreateMaterialDraft(formData, "access-token", dependencies),
    ).resolves.toMatchObject({
      kind: "invalid_input",
      issues: [{ path: "/document" }],
    });
    expect(dependencies.create).not.toHaveBeenCalled();
  });

  it("returns the typed unauthorized state for a denied author", async () => {
    const dependencies = {
      ...successfulDependencies(),
      create: vi.fn().mockResolvedValue({
        ok: false,
        problem: { code: "forbidden", status: 403 },
        response: Response.json({}, { status: 403 }),
      }),
    } satisfies MaterialDraftWorkflowDependencies;

    await expect(
      executeCreateMaterialDraft(validFormData(), "access-token", dependencies),
    ).resolves.toEqual({ kind: "forbidden" });
  });

  it("keeps an infrastructure failure retryable with the same submission key", async () => {
    const dependencies = {
      ...successfulDependencies(),
      create: vi.fn().mockRejectedValue(new TypeError("connection refused")),
    } satisfies MaterialDraftWorkflowDependencies;

    await expect(
      executeCreateMaterialDraft(validFormData(), "access-token", dependencies),
    ).resolves.toEqual({
      kind: "unexpected_error",
      reference: "unexpected-authoring-error",
    });
    expect(dependencies.create).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: `web-create-${submissionId}` }),
      "access-token",
    );
  });

  it("models a missing current Preview as an expected domain state", async () => {
    await expect(
      getCurrentMaterialPreview(materialId, "access-token", {
        preview: vi.fn().mockResolvedValue({
          ok: false,
          problem: { code: "material_not_found", status: 404 },
          response: Response.json({}, { status: 404 }),
        }),
        references: successfulReferences(),
      }),
    ).resolves.toEqual({ kind: "not_found" });
  });

  it("keeps a transient current Preview failure retryable", async () => {
    await expect(
      getCurrentMaterialPreview(materialId, "access-token", {
        preview: vi.fn().mockResolvedValue({
          ok: false,
          problem: {
            code: "dependency_unavailable",
            correlationId: "preview-request",
            status: 503,
          },
          response: Response.json({}, { status: 503 }),
        }),
        references: successfulReferences(),
      }),
    ).resolves.toEqual({ kind: "unexpected_error", reference: "preview-request" });
  });

  it("loads the complete current Material into the production editor presentation", async () => {
    const dependencies = {
      load: vi.fn().mockResolvedValue({
        ok: true,
        body: {
          body: {
            doc: {
              content: [{ content: [{ text: "Saved body", type: "text" }], type: "paragraph" }],
              type: "doc",
            },
            schemaVersion: 1,
          },
          contentVersion: 7,
          cover: null,
          firstPublishedAt: "2026-08-30T08:00:00.000Z",
          materialId,
          metadata: {
            access: "membership",
            formatId,
            seriesMemberships: [{ ordinal: 4, seriesId }],
            slug: "saved-material",
            summary: "Saved summary",
            tagIds: [tagId],
            title: "Saved Material",
            topicId,
          },
          publicationState: "published",
          latestVideoDeletion: null,
          primaryVideo: null,
          primaryVideoId: null,
          publishedAt: "2026-08-30T08:00:00.000Z",
        },
        response: Response.json({}),
      }),
      references: successfulReferences(),
    } satisfies CurrentMaterialDependencies;

    await expect(
      getCurrentMaterial(materialId, "access-token", dependencies),
    ).resolves.toMatchObject({
      draft: {
        access: "membership",
        contentVersion: 7,
        materialId,
        readOnly: false,
        seriesIds: [seriesId],
        status: "published",
        title: "Saved Material",
      },
      kind: "ready",
      references: { references: { series: [{ label: "Build", value: seriesId }] } },
    });
    expect(dependencies.load).toHaveBeenCalledWith(materialId, "access-token");
  });

  it("rejects malformed Current Material document and Series payloads at the adapter boundary", async () => {
    const malformedCurrent = {
      load: vi.fn().mockResolvedValue({
        ok: true,
        body: {
          body: { doc: { type: 42 }, schemaVersion: 1 },
          contentVersion: 7,
          firstPublishedAt: null,
          materialId,
          metadata: {
            access: "free",
            formatId: null,
            seriesMemberships: [],
            slug: null,
            summary: null,
            tagIds: [],
            title: null,
            topicId: null,
          },
          publicationState: "draft",
          primaryVideoId: null,
          publishedAt: null,
        },
        response: Response.json({}),
      }),
      references: successfulReferences(),
    } satisfies CurrentMaterialDependencies;

    await expect(
      getCurrentMaterial(materialId, "access-token", malformedCurrent),
    ).rejects.toThrow("Malformed Current Material response");

    const preview = successfulPreview();
    const response = await preview(materialId, "access-token");
    if (!response.ok) throw new Error("Preview fixture must succeed");
    const malformedPreview = structuredClone(response.body) as {
      metadata: { seriesMemberships: unknown[] };
    };
    malformedPreview.metadata.seriesMemberships = [{ ordinal: 0, seriesId }];
    expect(mapCurrentMaterialPreview(malformedPreview).ok).toBe(false);
  });

  it("maps the complete rendered Preview block vocabulary", async () => {
    const preview = successfulPreview();
    const response = await preview(materialId, "access-token");
    if (!response.ok) throw new Error("Preview fixture must succeed");
    const representativePreview = structuredClone(response.body) as {
      body: { blocks: unknown[] };
    };
    representativePreview.body.blocks.push(
      {
        kind: "table",
        rows: [
          {
            cells: [
              {
                content: [
                  {
                    content: [{ kind: "text", marks: [], text: "Evidence" }],
                    kind: "paragraph",
                  },
                ],
                header: true,
              },
            ],
          },
        ],
      },
      {
        alt: "Delivery stages",
        assetId: "02000000-0000-4000-8000-000000000001",
        caption: "One retained path",
        kind: "image",
      },
      {
        assetId: "02000000-0000-4000-8000-000000000002",
        kind: "file",
        label: "Pipeline checklist",
      },
    );

    const mapped = mapCurrentMaterialPreview(representativePreview);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error("Representative Preview must map");
    expect(mapped.data.preview.blocks.map(({ kind }) => kind)).toEqual([
      "paragraph",
      "table",
      "image",
      "file",
    ]);
  });

  it("sends one full-state Save and returns the next idempotency key only after success", async () => {
    const dependencies = successfulSaveDependencies();

    await expect(
      executeSaveMaterial(validSaveFormData(), "access-token", dependencies),
    ).resolves.toMatchObject({
      contentVersion: 4,
      kind: "saved",
      publicationState: "published",
    });
    expect(dependencies.save).toHaveBeenCalledOnce();
    expect(dependencies.save).toHaveBeenCalledWith(
      {
        access: "membership",
        deleteVideoId: null,
        document: {
          content: [{ content: [{ text: "Local full state", type: "text" }], type: "paragraph" }],
          type: "doc",
        },
        expectedContentVersion: 3,
        formatId,
        idempotencyKey: `web-save-${submissionId}`,
        materialId,
        publicationState: "published",
        primaryVideoId: null,
        seriesIds: [seriesId],
        summary: "Saved summary",
        tagIds: [tagId],
        title: "Saved Material",
        topicId,
      },
      "access-token",
    );
  });

  it("passes explicit Video deletion intent only as part of the full-state Save", async () => {
    const dependencies = successfulSaveDependencies();
    const formData = validSaveFormData();
    formData.set("deleteVideoId", videoId);

    await executeSaveMaterial(formData, "access-token", dependencies);

    expect(dependencies.save).toHaveBeenCalledWith(
      expect.objectContaining({ deleteVideoId: videoId }),
      "access-token",
    );
  });

  it("maps a stale Save to conflict without validating or replacing local input", async () => {
    const dependencies = {
      ...successfulSaveDependencies(),
      save: vi.fn().mockResolvedValue({
        ok: false,
        problem: {
          code: "stale_content_version",
          currentContentVersion: 4,
          status: 409,
        },
        response: Response.json({}, { status: 409 }),
      }),
    } satisfies SaveMaterialDependencies;
    const formData = validSaveFormData();

    await expect(
      executeSaveMaterial(formData, "access-token", dependencies),
    ).resolves.toEqual({
      currentContentVersion: 4,
      kind: "conflict",
      staleContentVersion: 3,
    });
    expect(formData.get("title")).toBe("Saved Material");
    expect(formData.get("document")).toContain("Local full state");
  });

  it("retries dependency failure with the same idempotency key", async () => {
    const dependencies = {
      ...successfulSaveDependencies(),
      save: vi.fn().mockResolvedValue({
        ok: false,
        problem: { code: "dependency_unavailable", status: 503 },
        response: Response.json({}, { status: 503 }),
      }),
    } satisfies SaveMaterialDependencies;

    await executeSaveMaterial(validSaveFormData(), "access-token", dependencies);
    await executeSaveMaterial(validSaveFormData(), "access-token", dependencies);

    expect(dependencies.save).toHaveBeenCalledTimes(2);
    expect(dependencies.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ idempotencyKey: `web-save-${submissionId}` }),
      "access-token",
    );
    expect(dependencies.save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ idempotencyKey: `web-save-${submissionId}` }),
      "access-token",
    );
  });

  it("throws protocol failures into the route error boundary", async () => {
    const dependencies = {
      ...successfulSaveDependencies(),
      save: vi
        .fn()
        .mockRejectedValue(
          new BackendConnectionError("invalid-response", "Malformed response"),
        ),
    } satisfies SaveMaterialDependencies;

    await expect(
      executeSaveMaterial(validSaveFormData(), "access-token", dependencies),
    ).rejects.toThrow("Malformed response");
  });
});

function validFormData(): FormData {
  const formData = new FormData();
  formData.set("access", "free");
  formData.set(
    "document",
    JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Current из PostgreSQL." }],
        },
      ],
    }),
  );
  formData.set("formatId", formatId);
  formData.set("submissionId", submissionId);
  formData.set("seriesIds", JSON.stringify([seriesId]));
  formData.set("summary", "Проверяем create, validation и current Preview.");
  formData.append("tagIds", tagId);
  formData.set("title", "Один production path");
  formData.set("topicId", topicId);
  return formData;
}

function successfulDependencies(): MaterialDraftWorkflowDependencies {
  return {
    create: vi.fn().mockResolvedValue({
      ok: true,
      body: {
        contentVersion: 1,
        materialId,
        publicationState: "draft",
        publishedAt: null,
      },
      response: Response.json({}, { status: 201 }),
    }),
  };
}

function successfulPreview(): typeof requestMaterialPreview {
  return vi.fn().mockResolvedValue({
      ok: true,
      body: {
        body: {
          blocks: [
            {
              kind: "paragraph",
              content: [{ kind: "text", marks: [], text: "Current из PostgreSQL." }],
            },
          ],
          schemaVersion: 1,
        },
        cacheScope: "private-no-store",
        contentVersion: 1,
        materialId,
        metadata: {
          access: "free",
          formatId,
          seriesMemberships: [],
          slug: "one-production-path",
          summary: "Проверяем create, validation и current Preview.",
          tagIds: [tagId],
          title: "Один production path",
          topicId,
        },
        publicationState: "draft",
      },
      response: Response.json({}),
    });
}

function successfulReferences() {
  return vi.fn().mockResolvedValue({
    ok: true,
    body: {
      formats: [{ archived: false, id: formatId, name: "Гайд" }],
      series: [{ archived: false, id: seriesId, name: "Build" }],
      tags: [{ archived: false, id: tagId, name: "delivery" }],
      topics: [{ archived: false, id: topicId, name: "Platform" }],
    },
    response: Response.json({}),
  });
}

function validSaveFormData(): FormData {
  const formData = new FormData();
  formData.set("access", "membership");
  formData.set(
    "document",
    JSON.stringify({
      content: [
        {
          content: [{ text: "Local full state", type: "text" }],
          type: "paragraph",
        },
      ],
      type: "doc",
    }),
  );
  formData.set("expectedContentVersion", "3");
  formData.set("formatId", formatId);
  formData.set("materialId", materialId);
  formData.set("publicationState", "published");
  formData.set("seriesIds", JSON.stringify([seriesId]));
  formData.set("slug", "saved-material");
  formData.set("submissionId", submissionId);
  formData.set("summary", "Saved summary");
  formData.append("tagIds", tagId);
  formData.set("title", "Saved Material");
  formData.set("topicId", topicId);
  return formData;
}

function successfulSaveDependencies(): SaveMaterialDependencies {
  return {
    save: vi.fn().mockResolvedValue({
      body: {
        contentVersion: 4,
        materialId,
        publicationState: "published",
        publishedAt: "2026-08-30T08:00:00.000Z",
      },
      ok: true,
      response: Response.json({}),
    }),
  };
}
