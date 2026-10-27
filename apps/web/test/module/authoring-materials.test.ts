import { describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ accessToken: vi.fn() }));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  LogtoSessionUnavailableError: class extends Error {},
  sessionAdapter: { accessToken: session.accessToken },
}));

import {
  handleAuthoringMaterialFiltersRequest,
  materialFilterOptions,
} from "@/_pages/authoring-materials/api/authoring-material-filters-route.server";
import {
  getAuthoringMaterials,
  type AuthoringMaterialsDependencies,
} from "@/_pages/authoring-materials/api/get-authoring-materials";
import type {
  AuthoringMaterialFilterOptions,
  AuthoringMaterialListItem,
} from "@/_pages/authoring-materials/model/authoring-materials-presentation";
import {
  authoringMaterialsFilterChips,
  authoringMaterialsHref,
  authoringMaterialsPageSummary,
  hasAuthoringMaterialsFilters,
  parseAuthoringMaterialsQuery,
  parseAuthoringMaterialsUrlSearchParams,
  resetAuthoringMaterialsQuery,
  serializeAuthoringMaterialsQuery,
  withAuthoringMaterialsFilter,
  withPublicationReceipt,
} from "@/_pages/authoring-materials/model/authoring-materials-query";
import {
  deleteMaterialDraftOperation,
  executeDeleteMaterialDraft,
  executeTransitionMaterialPublication,
  transitionMaterialPublicationOperation,
} from "@/features/material-lifecycle.operations.server";
import {
  authoringMaterialPreviewHref,
  authoringProductEditorHref,
  authoringReturnActionLabel,
  authoringReturnLabel,
  parseAuthoringReturnHref,
  withAuthoringReturnHref,
} from "@/shared/routing/authoring";
import { BackendConnectionError } from "@/shared/api/backend/index.server";

const materialId = "96000000-0000-4000-8000-000000000001";
const submissionId = "96000000-0000-4000-8000-000000000004";
const topicId = "96000000-0000-4000-8000-000000000020";

describe("Authoring Materials list address", () => {
  it("reads the Topic and format filters and drops values the server would reject", () => {
    expect(
      parseAuthoringMaterialsQuery({
        format: "video",
        page: "3",
        state: "draft",
        topic: topicId,
      }),
    ).toEqual({
      format: "video",
      page: 3,
      publicationState: "draft",
      topicId,
    });
    expect(
      parseAuthoringMaterialsQuery({
        format: "podcast",
        topic: "platform",
      }),
    ).toEqual({ page: 1 });
    expect(
      parseAuthoringMaterialsQuery({
        format: ["video", "note"],
        topic: [topicId],
      }),
    ).toEqual({ page: 1 });
  });

  it("writes every filter to the address and reads the same query back", () => {
    const query = {
      format: "guide",
      page: 2,
      publicationState: "published",
      search: "агент",
      topicId,
    } as const;
    const serialized = serializeAuthoringMaterialsQuery(query);
    expect(serialized).toBe(
      `search=%D0%B0%D0%B3%D0%B5%D0%BD%D1%82&state=published&topic=${topicId}&format=guide&page=2`,
    );
    expect(
      parseAuthoringMaterialsUrlSearchParams(new URLSearchParams(serialized)),
    ).toEqual(query);
    expect(authoringMaterialsHref({ page: 1 })).toBe("/authoring/materials");
    expect(authoringMaterialsHref(query, 1)).toBe(
      `/authoring/materials?search=%D0%B0%D0%B3%D0%B5%D0%BD%D1%82&state=published&topic=${topicId}&format=guide`,
    );
    // The editor accepts the full list address as its return destination.
    expect(parseAuthoringReturnHref(authoringMaterialsHref(query))).toBe(
      authoringMaterialsHref(query),
    );
  });

  it("returns to the first page when a filter changes and keeps the other filters", () => {
    const query = {
      format: "note",
      page: 4,
      publicationState: "unpublished",
      search: "ревью",
    } as const;
    expect(withAuthoringMaterialsFilter(query, "topicId", topicId)).toEqual({
      ...query,
      page: 1,
      topicId,
    });
    expect(withAuthoringMaterialsFilter(query, "format", undefined)).toEqual({
      page: 1,
      publicationState: "unpublished",
      search: "ревью",
    });
    expect(withAuthoringMaterialsFilter(query, "search", "")).toEqual({
      format: "note",
      page: 1,
      publicationState: "unpublished",
    });
    // The field keeps the typed text; the request normalises it.
    expect(
      withAuthoringMaterialsFilter({ page: 1 }, "search", " два  слова"),
    ).toEqual({ page: 1, search: " два  слова" });
    // A value outside the closed choices removes the filter instead of sending it.
    expect(withAuthoringMaterialsFilter(query, "format", "podcast")).toEqual({
      page: 1,
      publicationState: "unpublished",
      search: "ревью",
    });
    expect(hasAuthoringMaterialsFilters({ page: 3 })).toBe(false);
    expect(hasAuthoringMaterialsFilters({ format: "video", page: 1 })).toBe(
      true,
    );
    expect(resetAuthoringMaterialsQuery).toEqual({ page: 1 });
  });

  it("names one chip per choice filter and removes only that filter", () => {
    const options: AuthoringMaterialFilterOptions = {
      formats: [{ label: "Видео", value: "video" }],
      kind: "ready",
      topics: [{ label: "Разработка с агентами", value: topicId }],
    };
    const query = {
      format: "video",
      page: 2,
      publicationState: "draft",
      search: "агент",
      topicId,
    } as const;
    expect(authoringMaterialsFilterChips(query, options)).toEqual([
      {
        id: "publicationState",
        label: "Черновики",
        next: { format: "video", page: 1, search: "агент", topicId },
      },
      {
        id: "topicId",
        label: "Разработка с агентами",
        next: {
          format: "video",
          page: 1,
          publicationState: "draft",
          search: "агент",
        },
      },
      {
        id: "format",
        label: "Видео",
        next: { page: 1, publicationState: "draft", search: "агент", topicId },
      },
    ]);
    expect(
      authoringMaterialsFilterChips(
        { format: "note", page: 1, topicId },
        { kind: "pending" },
      ).map((chip) => chip.label),
    ).toEqual(["Выбранная тема", "Выбранный формат"]);
    expect(
      authoringMaterialsFilterChips({ page: 1, search: "x" }, options),
    ).toEqual([]);
  });

  it("summarises the visible range of a page", () => {
    expect(
      authoringMaterialsPageSummary({
        items: Array.from({ length: 17 }),
        page: 3,
        pageSize: 20,
        totalItems: 57,
      }),
    ).toBe("41–57 из 57");
    expect(
      authoringMaterialsPageSummary({
        items: [],
        page: 4,
        pageSize: 20,
        totalItems: 57,
      }),
    ).toBeUndefined();
  });

  it("shows a publication receipt only until the list brings that version", () => {
    const item: AuthoringMaterialListItem = {
      canDelete: true,
      contentVersion: 3,
      format: "Гайд",
      materialId,
      publicationState: "draft",
      submissionId,
      title: "Черновик",
      topic: "Platform",
      updatedAt: "2026-08-30T10:00:00.000Z",
    };
    const receipt = {
      contentVersion: 4,
      publicationState: "published",
      submissionId: "96000000-0000-4000-8000-000000000044",
    } as const;
    expect(withPublicationReceipt(item, undefined)).toBe(item);
    expect(withPublicationReceipt(item, receipt)).toEqual({
      ...item,
      canDelete: false,
      contentVersion: 4,
      publicationState: "published",
      submissionId: receipt.submissionId,
    });
    const reread = {
      ...item,
      contentVersion: 4,
      publicationState: "published" as const,
    };
    expect(withPublicationReceipt(reread, receipt)).toBe(reread);
  });
});

describe("Authoring Materials filter choices", () => {
  it("offers every Topic, marks archived ones and keeps only known formats", () => {
    expect(
      materialFilterOptions({
        formats: [
          { label: "Видео", value: "video" },
          { label: "Подкаст", value: "podcast" },
        ],
        topics: [
          { archived: false, label: "AI Engineering", value: topicId },
          {
            archived: true,
            label: "Тестирование",
            value: "96000000-0000-4000-8000-000000000021",
          },
        ],
      }),
    ).toEqual({
      formats: [{ label: "Видео", value: "video" }],
      kind: "ready",
      topics: [
        { label: "AI Engineering", value: topicId },
        {
          label: "Тестирование (в архиве)",
          value: "96000000-0000-4000-8000-000000000021",
        },
      ],
    });
  });

  it("answers the browser with private choices, a refusal or an unavailable read", async () => {
    session.accessToken.mockResolvedValue("author-token");
    const references = vi.fn().mockResolvedValue({
      kind: "ready",
      references: {
        formats: [{ archived: false, label: "Гайд", value: "guide" }],
        products: [{ archived: false, label: "Продукт", value: materialId }],
        tags: [],
        topics: [{ archived: false, label: "Platform", value: topicId }],
      },
    });
    const ready = await handleAuthoringMaterialFiltersRequest({ references });
    expect(ready.status).toBe(200);
    expect(ready.headers.get("cache-control")).toContain("no-store");
    expect(references).toHaveBeenCalledWith("author-token");
    expect(await ready.json()).toEqual({
      formats: [{ label: "Гайд", value: "guide" }],
      kind: "ready",
      topics: [{ label: "Platform", value: topicId }],
    });

    const forbidden = await handleAuthoringMaterialFiltersRequest({
      references: vi.fn().mockResolvedValue({ kind: "unauthorized" }),
    });
    expect(forbidden.status).toBe(403);
    const unavailable = await handleAuthoringMaterialFiltersRequest({
      references: vi
        .fn()
        .mockResolvedValue({ kind: "unexpected_error", reference: "pg" }),
    });
    expect(unavailable.status).toBe(503);
  });
});

describe("Authoring Materials server adapter", () => {
  it("normalizes URL search, filter, and pagination without trusting repeated values", () => {
    expect(
      parseAuthoringMaterialsQuery({
        page: "2",
        search: "  platform   inside ",
        state: "unpublished",
      }),
    ).toEqual({
      page: 2,
      publicationState: "unpublished",
      search: "platform inside",
    });
    expect(
      parseAuthoringMaterialsQuery({
        page: "not-a-page",
        search: ["ignored", "repeated"],
        state: "all",
      }),
    ).toEqual({ page: 1 });
  });

  it("accepts only the bounded Materials list as an Editor return destination", () => {
    expect(
      parseAuthoringReturnHref(
        "/authoring/materials?search=Platform&state=draft&page=2",
      ),
    ).toBe("/authoring/materials?search=Platform&state=draft&page=2");
    expect(
      parseAuthoringReturnHref(
        "/authoring/materials?topic=96000000-0000-4000-8000-000000000020&format=guide",
      ),
    ).toBe(
      "/authoring/materials?topic=96000000-0000-4000-8000-000000000020&format=guide",
    );
    expect(parseAuthoringReturnHref("/authoring/materials?tab=program")).toBe(
      "/authoring/materials",
    );
    expect(parseAuthoringReturnHref("https://attacker.example/materials")).toBe(
      "/authoring/materials",
    );
    expect(parseAuthoringReturnHref("/authoring/materials/new")).toBe(
      "/authoring/materials",
    );
    expect(
      withAuthoringReturnHref(
        `/authoring/materials/${materialId}/preview`,
        "/authoring/materials?state=unpublished&page=2",
      ),
    ).toBe(
      `/authoring/materials/${materialId}/preview?from=%2Fauthoring%2Fmaterials%3Fstate%3Dunpublished%26page%3D2`,
    );
  });

  it("returns from a Preview to the product editor that opened it", () => {
    const productId = "96000000-0000-4000-8000-000000000010";
    const editorHref = authoringProductEditorHref(productId);
    expect(editorHref).toBe(`/authoring/products/${productId}`);
    expect(parseAuthoringReturnHref(editorHref)).toBe(editorHref);
    // Возврат из программы ведёт обратно в «Программу», а не на первую вкладку «Обзор» (#1719).
    const programHref = authoringProductEditorHref(productId, "program");
    expect(programHref).toBe(`/authoring/products/${productId}?tab=program`);
    expect(parseAuthoringReturnHref(programHref)).toBe(programHref);
    expect(authoringReturnLabel(programHref)).toBe("К продукту");
    expect(authoringMaterialPreviewHref(materialId, programHref)).toBe(
      `/authoring/materials/${materialId}/preview?from=%2Fauthoring%2Fproducts%2F${productId}%3Ftab%3Dprogram&product=${productId}`,
    );
    expect(authoringReturnLabel(editorHref)).toBe("К продукту");
    expect(authoringReturnLabel("/authoring/materials?page=2")).toBe(
      "К материалам",
    );
    for (const rejected of [
      "/authoring/products",
      "/authoring/products/not-a-product",
      `/authoring/products/${productId}/preview`,
      `/authoring/products/${productId}?tab=order`,
      `/authoring/products/${productId}?tab=program&x=1`,
      `https://attacker.example/authoring/products/${productId}`,
    ]) {
      expect(parseAuthoringReturnHref(rejected)).toBe("/authoring/materials");
    }
    const previewHref = authoringMaterialPreviewHref(
      materialId,
      editorHref,
      productId,
    );
    const preview = new URL(previewHref, "https://inside.local");
    expect(parseAuthoringReturnHref(preview.searchParams.get("from"))).toBe(
      editorHref,
    );
    expect(preview.searchParams.get("product")).toBe(productId);
    // Предпросмотр → редактор → предпросмотр не теряет продукт: он записан в адресе возврата.
    expect(
      new URL(
        authoringMaterialPreviewHref(materialId, editorHref),
        "https://inside.local",
      ).searchParams.get("product"),
    ).toBe(productId);
    expect(authoringReturnActionLabel(editorHref)).toBe("Вернуться к продукту");
    expect(authoringReturnActionLabel("/authoring/materials")).toBe(
      "Вернуться к материалам",
    );
  });

  it("maps one protected corpus page to the presentation contract", async () => {
    const dependencies = {
      list: vi.fn().mockResolvedValue({
        body: {
          items: [
            {
              canDelete: false,
              contentVersion: 7,
              format: { id: "guide", name: "Гайд" },
              materialId,
              publicationState: "published",
              title: "Управляемый Material",
              topic: {
                id: "96000000-0000-4000-8000-000000000003",
                name: "Platform",
              },
              updatedAt: "2026-08-30T10:00:00.000Z",
            },
          ],
          page: 2,
          pageSize: 20,
          totalItems: 21,
          totalPages: 2,
        },
        ok: true,
        response: Response.json({}),
      }),
    } satisfies AuthoringMaterialsDependencies;

    const result = await getAuthoringMaterials(
      {
        format: "guide",
        page: 2,
        publicationState: "published",
        search: "Управляемый",
        topicId,
      },
      "access-token",
      dependencies,
    );
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    const [item] = result.items;
    expect(item).toBeDefined();
    if (item === undefined) return;
    const { submissionId: actualSubmissionId, ...presentationItem } = item;
    expect(actualSubmissionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect({ ...result, items: [presentationItem] }).toEqual({
      kind: "ready",
      items: [
        {
          canDelete: false,
          contentVersion: 7,
          format: "Гайд",
          materialId,
          publicationState: "published",
          title: "Управляемый Material",
          topic: "Platform",
          updatedAt: "2026-08-30T10:00:00.000Z",
        },
      ],
      page: 2,
      pageSize: 20,
      totalItems: 21,
      totalPages: 2,
    });
    expect(dependencies.list).toHaveBeenCalledWith(
      {
        format: "guide",
        page: 2,
        publicationState: "published",
        search: "Управляемый",
        topicId,
      },
      "access-token",
    );
  });

  it("assigns a fresh lifecycle submission key to each independent list response", async () => {
    const dependencies = {
      list: vi.fn().mockResolvedValue({
        body: {
          items: [
            {
              canDelete: true,
              contentVersion: 1,
              format: null,
              materialId,
              publicationState: "draft",
              title: "Безопасный черновик",
              topic: null,
              updatedAt: "2026-08-30T10:00:00.000Z",
            },
          ],
          page: 1,
          pageSize: 20,
          totalItems: 1,
          totalPages: 1,
        },
        ok: true,
        response: Response.json({}),
      }),
    } satisfies AuthoringMaterialsDependencies;

    const first = await getAuthoringMaterials(
      { page: 1 },
      "access-token",
      dependencies,
    );
    const second = await getAuthoringMaterials(
      { page: 1 },
      "access-token",
      dependencies,
    );

    expect(first.kind).toBe("ready");
    expect(second.kind).toBe("ready");
    if (first.kind !== "ready" || second.kind !== "ready") return;
    expect(first.items[0]?.submissionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(second.items[0]?.submissionId).not.toBe(
      first.items[0]?.submissionId,
    );
  });

  it.each([
    {
      expected: { kind: "signed_out" },
      problem: { code: "unauthorized" },
      status: 401,
    },
    {
      expected: { kind: "forbidden" },
      problem: { code: "forbidden" },
      status: 403,
    },
    {
      expected: { kind: "unavailable", reference: "pg-offline" },
      problem: { code: "dependency_unavailable", correlationId: "pg-offline" },
      status: 503,
    },
    {
      expected: { kind: "unexpected_error", reference: "read-failed" },
      problem: { code: "internal_error", correlationId: "read-failed" },
      status: 500,
    },
    {
      expected: { kind: "malformed_response" },
      problem: { code: "teapot" },
      status: 418,
    },
  ])(
    "maps HTTP $status to $expected.kind",
    async ({ expected, problem, status }) => {
      const dependencies = {
        list: vi.fn().mockResolvedValue({
          ok: false,
          problem,
          response: Response.json(problem, { status }),
        }),
      } satisfies AuthoringMaterialsDependencies;

      await expect(
        getAuthoringMaterials({ page: 1 }, "access-token", dependencies),
      ).resolves.toEqual(expected);
    },
  );

  it("fails closed for malformed success bodies and typed transport failures", async () => {
    await expect(
      getAuthoringMaterials({ page: 1 }, "access-token", {
        list: vi.fn().mockResolvedValue({
          body: { items: "not-an-array" },
          ok: true,
          response: Response.json({}),
        }),
      }),
    ).resolves.toEqual({ kind: "malformed_response" });
    await expect(
      getAuthoringMaterials({ page: 1 }, "access-token", {
        list: vi
          .fn()
          .mockRejectedValue(
            new BackendConnectionError("unavailable", "backend offline"),
          ),
      }),
    ).resolves.toEqual({ kind: "unavailable", reference: "unavailable" });
    await expect(
      getAuthoringMaterials({ page: 1 }, "access-token", {
        list: vi
          .fn()
          .mockRejectedValue(
            new BackendConnectionError("invalid-response", "bad json"),
          ),
      }),
    ).resolves.toEqual({ kind: "malformed_response" });
  });

  it("publishes from the list through one intent request", async () => {
    const dependencies = lifecycleDependencies();

    await expect(
      executeTransitionMaterialPublication(
        publicationInput("published"),
        "access-token",
        dependencies.transition,
      ),
    ).resolves.toMatchObject({
      contentVersion: 8,
      kind: "saved",
      publicationState: "published",
    });
    expect(dependencies.transition).toHaveBeenCalledWith(
      {
        expectedContentVersion: 7,
        idempotencyKey: `web-transition-material-publication-${submissionId}`,
        materialId,
        publicationState: "published",
      },
      "access-token",
    );
  });

  it("deletes a draft with the list version and preserves its key across retry", async () => {
    const dependencies = lifecycleDependencies();
    const input = deletionInput();

    await expect(
      executeDeleteMaterialDraft(input, "access-token", dependencies.delete),
    ).resolves.toEqual({ kind: "deleted", materialId });
    await expect(
      executeDeleteMaterialDraft(input, "access-token", dependencies.delete),
    ).resolves.toEqual({ kind: "deleted", materialId });
    expect(dependencies.delete).toHaveBeenCalledTimes(2);
    expect(dependencies.delete).toHaveBeenNthCalledWith(
      2,
      {
        deleteVideoId: null,
        expectedContentVersion: 7,
        idempotencyKey: `web-delete-material-draft-${submissionId}`,
        materialId,
      },
      "access-token",
    );
    expect(dependencies.transition).not.toHaveBeenCalled();
  });

  it("passes an explicitly selected owned Video through draft hard-delete", async () => {
    const dependencies = lifecycleDependencies();
    const videoId = "96000000-0000-4000-8000-000000000009";

    await executeDeleteMaterialDraft(
      deletionInput(videoId),
      "access-token",
      dependencies.delete,
    );

    expect(dependencies.delete).toHaveBeenCalledWith(
      expect.objectContaining({ deleteVideoId: videoId }),
      "access-token",
    );
  });

  it.each([
    {
      expected: {
        currentContentVersion: 8,
        kind: "conflict",
        reason: "stale_content_version",
      },
      operation: "publish" as const,
      response: problemResult(409, {
        code: "stale_content_version",
        currentContentVersion: 8,
        status: 409,
      }),
      target: "transition" as const,
    },
    {
      expected: {
        issues: [{ code: "required", path: "/metadata/title" }],
        kind: "invalid_input",
      },
      operation: "publish" as const,
      response: problemResult(422, {
        code: "invalid_content",
        issues: [{ code: "required", path: "/metadata/title" }],
        status: 422,
      }),
      target: "transition" as const,
    },
    {
      expected: {
        kind: "conflict",
        reason: "draft_deletion_forbidden",
      },
      operation: "delete" as const,
      response: problemResult(409, {
        code: "draft_deletion_forbidden",
        status: 409,
      }),
      target: "delete" as const,
    },
    {
      expected: { kind: "forbidden" },
      operation: "publish" as const,
      response: problemResult(403, { code: "forbidden", status: 403 }),
      target: "transition" as const,
    },
    {
      expected: { kind: "not_found" },
      operation: "delete" as const,
      response: problemResult(404, { code: "material_not_found", status: 404 }),
      target: "delete" as const,
    },
    {
      expected: {
        kind: "infrastructure_error",
        reference: "materials-offline",
      },
      operation: "unpublish" as const,
      response: problemResult(503, {
        code: "dependency_unavailable",
        correlationId: "materials-offline",
        status: 503,
      }),
      target: "transition" as const,
    },
    {
      expected: {
        kind: "conflict",
        reason: "idempotency_key_reused",
      },
      operation: "delete" as const,
      response: problemResult(409, {
        code: "idempotency_key_reused",
        status: 409,
      }),
      target: "delete" as const,
    },
  ])(
    "maps $target $response.response.status to $expected.kind",
    async ({ expected, operation, response, target }) => {
      const dependencies = lifecycleDependencies();
      dependencies[target].mockResolvedValue(response);

      await expect(
        operation === "delete"
          ? executeDeleteMaterialDraft(
              deletionInput(),
              "access-token",
              dependencies.delete,
            )
          : executeTransitionMaterialPublication(
              publicationInput(
                operation === "publish" ? "published" : "unpublished",
              ),
              "access-token",
              dependencies.transition,
            ),
      ).resolves.toEqual(expected);
    },
  );
});

function publicationInput(publicationState: "published" | "unpublished") {
  return transitionMaterialPublicationOperation.input.parse({
    expectedContentVersion: 7,
    materialId,
    publicationState,
    submissionId,
  });
}

function deletionInput(deleteVideoId?: string) {
  return deleteMaterialDraftOperation.input.parse({
    deleteVideoId,
    expectedContentVersion: 7,
    materialId,
    submissionId,
  });
}

function lifecycleDependencies() {
  return {
    delete: vi.fn().mockResolvedValue({
      body: { materialId },
      ok: true,
      response: Response.json({}),
    }),
    transition: vi.fn().mockResolvedValue({
      body: {
        contentVersion: 8,
        materialId,
        publicationState: "published",
        publishedAt: "2026-08-30T11:00:00.000Z",
      },
      ok: true,
      response: Response.json({}),
    }),
  };
}

function problemResult(status: number, problem: Record<string, unknown>) {
  return {
    ok: false as const,
    problem,
    response: Response.json(problem, { status }),
  };
}
