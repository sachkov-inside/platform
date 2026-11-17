import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { renderToStaticMarkup } from "react-dom/server";

import { executeCreateMaterialDraft } from "@/_pages/material-authoring/api/create-material-draft";
import {
  createMaterialDraftInputSchema,
  type CreateMaterialDraftInput,
} from "@/_pages/material-authoring/model/create-material-draft";
import {
  saveMaterialInputSchema,
  type SaveMaterialInput,
} from "@/_pages/material-authoring/model/save-material";
import { getCurrentMaterialPreview } from "@/_pages/material-authoring/api/get-current-material-preview";
import { getCurrentMaterial } from "@/_pages/material-authoring/api/get-current-material";
import { mapCurrentMaterialPreview } from "@/_pages/material-authoring/api/material-preview-mapper";
import { executeSaveMaterial } from "@/_pages/material-authoring/api/save-material";
import { CurrentMaterialAuthoringPage } from "@/_pages/material-authoring/ui/current-material-authoring-page";
import { MaterialCurrentPreviewPage } from "@/_pages/material-authoring/ui/material-current-preview-page";
import { sessionAdapter } from "@/shared/auth/session-adapter.server";
import { realBffSession } from "../support/real-bff-session";
import { configureWebRuntime } from "../support/web-runtime";
import { interceptBackendHttp } from "../support/backend-http";

const materialId = "94000000-0000-4000-8000-000000000010";
const submissionId = "94000000-0000-4000-8000-000000000011";
const formatId = "guide";
const topicId = "94000000-0000-4000-8000-000000000013";
const tagId = "94000000-0000-4000-8000-000000000014";
const productId = "94000000-0000-4000-8000-000000000015";
const videoId = "94000000-0000-4000-8000-000000000016";

interface BackendReply {
  readonly method: string;
  readonly path: string;
  readonly response: Response | Error;
}
let replies: BackendReply[];
const backend = vi.fn<(request: Request) => Promise<Response>>();
beforeEach(() => {
  configureWebRuntime();
  vi.setSystemTime(new Date("2026-11-16T12:00:00.000Z"));
  replies = [];
  backend.mockReset();
  backend.mockImplementation(() => {
    const reply = replies[backend.mock.calls.length - 1];
    return reply === undefined
      ? Promise.reject(new Error("Unexpected external request"))
      : reply.response instanceof Error
        ? Promise.reject(reply.response)
        : Promise.resolve(reply.response);
  });
  interceptBackendHttp(backend);
});
afterEach(() => {
  try {
    expect(backend).toHaveBeenCalledTimes(replies.length);
    replies.forEach((reply, index) => {
      const request = backend.mock.calls[index]?.[0];
      if (request === undefined) throw new Error("Expected backend request");
      expect(request.method).toBe(reply.method);
      expect(request.url).toBe(
        `https://platform-api.example.test${reply.path}`,
      );
      expect(request.headers.get("authorization")).toBe("Bearer access-token");
      if (reply.method === "GET") expect(request.body).toBeNull();
    });
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
function respond(method: string, path: string, body: unknown, status = 200) {
  replies.push({ method, path, response: Response.json(body, { status }) });
}
function created() {
  respond("POST", "/authoring/materials", createdDraft(), 201);
}
function saved() {
  respond("PUT", `/authoring/materials/${materialId}`, savedMaterial());
}
function references() {
  respond("GET", "/authoring/materials/references", referenceFacts());
}
async function requestBody(index = 0) {
  const request = backend.mock.calls[index]?.[0];
  if (request === undefined) throw new Error("Expected backend request");
  return request.json() as Promise<unknown>;
}
function requestKey(index = 0) {
  return backend.mock.calls[index]?.[0].headers.get("idempotency-key");
}

describe("Material Authoring action workflow", () => {
  it("uses the read-only Logto reader while rendering existing Material routes", async () => {
    const scope = await realBffSession(null);
    const sessionRead = vi.spyOn(sessionAdapter, "accessToken");
    const editor = await scope(() =>
      CurrentMaterialAuthoringPage({
        materialId,
        returnHref: "/authoring/materials?state=draft",
      }),
    );
    const preview = await scope(() =>
      MaterialCurrentPreviewPage({
        materialId,
        returnHref: "/authoring/materials?state=draft",
      }),
    );
    for (const rendered of [editor, preview])
      expect(renderToStaticMarkup(rendered)).toContain(
        'name="returnTo" value="/authoring/materials?state=draft"',
      );
    expect(sessionRead).toHaveBeenCalledTimes(2);
    expect(sessionRead).toHaveBeenNthCalledWith(1, "rsc");
    expect(sessionRead).toHaveBeenNthCalledWith(2, "rsc");
    expect(backend).not.toHaveBeenCalled();
  });

  it("creates one idempotent draft without post-commit reads", async () => {
    created();

    await expect(
      executeCreateMaterialDraft(validDraftInput(), "access-token"),
    ).resolves.toMatchObject({
      kind: "created",
      draft: {
        contentVersion: 1,
        materialId,
      },
    });

    expect(backend).toHaveBeenCalledOnce();
    expect(requestKey()).toBe(
      "web-create-94000000-0000-4000-8000-000000000011",
    );
    expect(await requestBody()).toMatchObject({
      body: { schemaVersion: 1 },
      metadata: { formatId, productIds: [productId], tagIds: [tagId], topicId },
    });
  });

  it("rejects a malformed document before the Nest mutation", async () => {
    const input = validDraftInput({ document: { type: "paragraph" } });

    await expect(
      executeCreateMaterialDraft(input, "access-token"),
    ).resolves.toMatchObject({
      kind: "invalid_input",
      issues: [{ path: "/document" }],
    });
    expect(backend).not.toHaveBeenCalled();
  });

  it("returns the typed unauthorized state for a denied author", async () => {
    respond(
      "POST",
      "/authoring/materials",
      { code: "forbidden", status: 403 },
      403,
    );

    await expect(
      executeCreateMaterialDraft(validDraftInput(), "access-token"),
    ).resolves.toEqual({ kind: "forbidden" });
  });

  it("keeps an invalid draft receipt retryable with the same submission key", async () => {
    respond("POST", "/authoring/materials", {}, 201);
    await expect(
      executeCreateMaterialDraft(validDraftInput(), "access-token"),
    ).resolves.toEqual({
      kind: "unexpected_error",
      reference: "unexpected-authoring-error",
    });
    expect(requestKey()).toBe(
      "web-create-94000000-0000-4000-8000-000000000011",
    );
  });

  // Newly adopted implementation-derived preservation criterion, not a historical product contract:
  // https://github.com/sachkov-inside/platform/issues/2292#issuecomment-6940196888
  it("keeps external backend loss retryable with the same draft key", async () => {
    replies.push({
      method: "POST",
      path: "/authoring/materials",
      response: new Error("External backend offline"),
    });
    await expect(
      executeCreateMaterialDraft(validDraftInput(), "access-token"),
    ).resolves.toEqual({ kind: "unexpected_error", reference: "unavailable" });
    expect(requestKey()).toBe(
      "web-create-94000000-0000-4000-8000-000000000011",
    );
  });

  it("models a missing current Preview as an expected domain state", async () => {
    respond(
      "GET",
      `/authoring/materials/${materialId}/preview`,
      { code: "material_not_found", status: 404 },
      404,
    );
    references();
    await expect(
      getCurrentMaterialPreview(materialId, "access-token"),
    ).resolves.toEqual({ kind: "not_found" });
  });

  it("keeps a transient current Preview failure retryable", async () => {
    respond(
      "GET",
      `/authoring/materials/${materialId}/preview`,
      {
        code: "dependency_unavailable",
        correlationId: "preview-request",
        status: 503,
      },
      503,
    );
    references();
    await expect(
      getCurrentMaterialPreview(materialId, "access-token"),
    ).resolves.toEqual({
      kind: "unexpected_error",
      reference: "preview-request",
    });
  });

  it("loads the complete current Material into the production editor presentation", async () => {
    respond(
      "GET",
      `/authoring/materials/${materialId}`,
      {
        body: {
          doc: {
            content: [
              {
                content: [{ text: "Saved body", type: "text" }],
                type: "paragraph",
              },
            ],
            type: "doc",
          },
          schemaVersion: 1,
        },
        contentVersion: 7,
        cover: null,
        firstPublishedAt: "2026-08-30T08:00:00.000Z",
        materialId,
        metadata: {
          access: "closed",
          difficulty: "intermediate",
          outcomes: [
            "Провести задачу до мержа",
            "Назвать место, где она застревает",
          ],
          formatId,
          productMemberships: [{ ordinal: 4, productId }],
          slug: "saved-material",
          summary: "Saved summary",
          tagIds: [tagId],
          title: "Saved Material",
          topicId,
        },
        publicationState: "published",
        inFeed: false,
        latestVideoDeletion: null,
        unselectedVideoUpload: {
          origin: "platform_upload",
          protected: true,
          state: "processing",
          title: "Незавершённая загрузка",
          videoId: "70000000-0000-4000-8000-000000000001",
        },
        primaryVideo: null,
        primaryVideoId: null,
        publishedAt: "2026-08-30T08:00:00.000Z",
      },
      200,
    );
    references();

    await expect(
      getCurrentMaterial(materialId, "access-token"),
    ).resolves.toMatchObject({
      draft: {
        access: "closed",
        contentVersion: 7,
        materialId,
        readOnly: false,
        productIds: [productId],
        status: "published",
        title: "Saved Material",
        inFeed: false,
        unselectedVideoUpload: {
          state: "processing",
          videoId: "70000000-0000-4000-8000-000000000001",
        },
      },
      kind: "ready",
      references: {
        references: { products: [{ label: "Build", value: productId }] },
      },
    });
    expect(backend).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed Current Material document and Product payloads at the adapter boundary", async () => {
    respond(
      "GET",
      `/authoring/materials/${materialId}`,
      {
        body: { doc: { type: 42 }, schemaVersion: 1 },
        contentVersion: 7,
        firstPublishedAt: null,
        materialId,
        metadata: {
          access: "free",
          difficulty: null,
          outcomes: [],
          formatId: null,
          productMemberships: [],
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
      200,
    );
    references();

    await expect(
      getCurrentMaterial(materialId, "access-token"),
    ).rejects.toThrow("Malformed Current Material response");

    const preview = previewFacts();
    const malformedPreview = z
      .looseObject({
        metadata: z.looseObject({ productMemberships: z.array(z.unknown()) }),
      })
      .parse(structuredClone(preview));
    malformedPreview.metadata.productMemberships = [{ ordinal: 0, productId }];
    expect(mapCurrentMaterialPreview(malformedPreview).ok).toBe(false);
  });

  it("maps the complete rendered Preview block vocabulary", () => {
    const preview = previewFacts();
    const representativePreview = z
      .looseObject({ body: z.looseObject({ blocks: z.array(z.unknown()) }) })
      .parse(structuredClone(preview));
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

  it.each([true, false])(
    "preserves an explicit Telegram author choice %s through the save adapter",
    async (enabled) => {
      saved();
      const input = validSaveInput({ notifyTelegram: enabled });
      await executeSaveMaterial(input, "access-token");
      expect(await requestBody()).toMatchObject({ notifyTelegram: enabled });
    },
  );

  it("sends one full-state Save and returns the next idempotency key only after success", async () => {
    saved();

    await expect(
      executeSaveMaterial(validSaveInput(), "access-token"),
    ).resolves.toMatchObject({
      contentVersion: 4,
      kind: "saved",
      publicationState: "published",
    });
    expect(backend).toHaveBeenCalledOnce();
    expect(requestKey()).toBe("web-save-94000000-0000-4000-8000-000000000011");
    expect(await requestBody()).toEqual({
      body: {
        doc: {
          content: [
            {
              content: [{ text: "Local full state", type: "text" }],
              type: "paragraph",
            },
          ],
          type: "doc",
        },
        schemaVersion: 1,
      },
      deleteVideoId: null,
      detachVideoIds: [],
      expectedContentVersion: 3,
      metadata: {
        access: "closed",
        difficulty: "basic",
        formatId,
        outcomes: [
          "Собрать один production path",
          "Проверить его одним прогоном",
        ],
        productIds: [productId],
        summary: "Saved summary",
        tagIds: [tagId],
        title: "Saved Material",
        topicId,
      },
      publicationState: "published",
      primaryVideoId: null,
    });
  });

  it("passes explicit Video deletion intent only as part of the full-state Save", async () => {
    saved();
    const input = validSaveInput({ deleteVideoId: videoId });

    await executeSaveMaterial(input, "access-token");

    expect(await requestBody(0)).toMatchObject({ deleteVideoId: videoId });
  });

  it("passes every Video the author removed as part of the full-state Save", async () => {
    saved();
    const replacementId = "30000000-0000-4000-8000-000000000009";
    const input = validSaveInput({
      detachVideoIds: [videoId, replacementId],
    });

    await executeSaveMaterial(input, "access-token");

    expect(await requestBody(0)).toMatchObject({
      detachVideoIds: [videoId, replacementId],
    });
  });

  it("maps a stale Save to conflict without validating or replacing local input", async () => {
    respond(
      "PUT",
      `/authoring/materials/${materialId}`,
      {
        code: "stale_content_version",
        currentContentVersion: 4,
        status: 409,
      },
      409,
    );
    const input = validSaveInput();

    await expect(executeSaveMaterial(input, "access-token")).resolves.toEqual({
      currentContentVersion: 4,
      kind: "conflict",
      staleContentVersion: 3,
    });
    expect(input.title).toBe("Saved Material");
    expect(JSON.stringify(input.document)).toContain("Local full state");
  });

  it("explains source ownership mismatches in Save", async () => {
    respond(
      "PUT",
      `/authoring/materials/${materialId}`,
      {
        code: "invalid_reference",
        issues: [
          {
            code: "material_source_mismatch",
            path: "/metadata/productIds/0",
          },
        ],
        status: 422,
      },
      422,
    );
    await expect(
      executeSaveMaterial(validSaveInput(), "access-token"),
    ).resolves.toEqual({
      kind: "invalid_input",
      issues: [
        {
          path: "/metadata/productIds/0",
          message:
            "Материалы, перенесённые из источника, и материалы, созданные в редакторе, не смешиваются в одном продукте. Уберите несовместимый материал или продукт из состава и сохраните изменения.",
        },
      ],
    });
  });

  it("asks to confirm a removal from a bought product and sends the confirmed products", async () => {
    const products = [{ productId, holders: 2, name: "Купленный продукт" }];
    respond(
      "PUT",
      `/authoring/materials/${materialId}`,
      {
        code: "product_removal_confirmation_required",
        products,
        status: 409,
      },
      409,
    );
    await expect(
      executeSaveMaterial(validSaveInput(), "access-token"),
    ).resolves.toEqual({ products, kind: "removal_confirmation_required" });

    saved();
    const input = validSaveInput({ confirmedProductRemovals: [productId] });
    await executeSaveMaterial(input, "access-token");
    expect(await requestBody(1)).toMatchObject({
      confirmedProductRemovals: [productId],
    });
  });

  it("retries dependency failure with the same idempotency key", async () => {
    respond(
      "PUT",
      `/authoring/materials/${materialId}`,
      { code: "dependency_unavailable", status: 503 },
      503,
    );

    respond(
      "PUT",
      `/authoring/materials/${materialId}`,
      { code: "dependency_unavailable", status: 503 },
      503,
    );
    await executeSaveMaterial(validSaveInput(), "access-token");
    await executeSaveMaterial(validSaveInput(), "access-token");

    expect(backend).toHaveBeenCalledTimes(2);
    expect(requestKey(0)).toBe("web-save-94000000-0000-4000-8000-000000000011");
    expect(requestKey(1)).toBe("web-save-94000000-0000-4000-8000-000000000011");
  });

  it("throws protocol failures into the route error boundary", async () => {
    respond("PUT", `/authoring/materials/${materialId}`, savedMaterial(), 201);
    await expect(
      executeSaveMaterial(validSaveInput(), "access-token"),
    ).rejects.toMatchObject({
      name: "BackendConnectionError",
      code: "invalid-response",
    });
  });
});

function validDraftInput(
  overrides: Partial<CreateMaterialDraftInput> = {},
): z.output<typeof createMaterialDraftInputSchema> {
  return createMaterialDraftInputSchema.parse({
    access: "free",
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Current из PostgreSQL." }],
        },
      ],
    },
    difficulty: "basic",
    outcomes: ["Собрать один production path", "Проверить его одним прогоном"],
    formatId,
    submissionId,
    productIds: [productId],
    summary: "Проверяем create, validation и current Preview.",
    tagIds: [tagId],
    title: "Один production path",
    topicId,
    ...overrides,
  } satisfies CreateMaterialDraftInput);
}

function createdDraft() {
  return {
    contentVersion: 1,
    materialId,
    publicationState: "draft",
    publishedAt: null,
  };
}

function previewFacts() {
  return {
    body: {
      blocks: [
        {
          kind: "paragraph",
          content: [
            { kind: "text", marks: [], text: "Current из PostgreSQL." },
          ],
        },
      ],
      schemaVersion: 1,
    },
    cacheScope: "private-no-store",
    contentVersion: 1,
    materialId,
    metadata: {
      access: "free",
      difficulty: "intermediate",
      outcomes: [
        "Understand the saved lesson",
        "Apply the documented workflow",
      ],
      formatId,
      productMemberships: [],
      slug: "one-production-path",
      summary: "Проверяем create, validation и current Preview.",
      tagIds: [tagId],
      title: "Один production path",
      topicId,
    },
    publicationState: "draft",
  };
}

function referenceFacts() {
  return {
    formats: [{ archived: false, id: formatId, name: "Гайд" }],
    products: [{ archived: false, id: productId, name: "Build" }],
    tags: [{ archived: false, id: tagId, name: "delivery" }],
    topics: [{ archived: false, id: topicId, name: "Platform" }],
  };
}

function validSaveInput(
  overrides: Partial<SaveMaterialInput> = {},
): z.output<typeof saveMaterialInputSchema> {
  return saveMaterialInputSchema.parse({
    access: "closed",
    deleteVideoId: null,
    detachVideoIds: [],
    document: {
      content: [
        {
          content: [{ text: "Local full state", type: "text" }],
          type: "paragraph",
        },
      ],
      type: "doc",
    },
    expectedContentVersion: 3,
    difficulty: "basic",
    outcomes: ["Собрать один production path", "Проверить его одним прогоном"],
    formatId,
    materialId,
    primaryVideoId: null,
    publicationState: "published",
    productIds: [productId],
    submissionId,
    summary: "Saved summary",
    tagIds: [tagId],
    title: "Saved Material",
    topicId,
    ...overrides,
  } satisfies SaveMaterialInput);
}

function savedMaterial() {
  return {
    contentVersion: 4,
    materialId,
    publicationState: "published",
    publishedAt: "2026-08-30T08:00:00.000Z",
  };
}
