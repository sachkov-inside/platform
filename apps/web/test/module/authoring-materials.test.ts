import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleAuthoringMaterialFiltersRequest,
  materialFilterOptions,
} from "@/_pages/authoring-materials/api/authoring-material-filters-route.server";
import { getAuthoringMaterials } from "@/_pages/authoring-materials/api/get-authoring-materials";
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
import { realBffSession } from "../support/real-bff-session";
import { interceptBackendHttp } from "../support/backend-http";

const materialId = "96000000-0000-4000-8000-000000000001";
const submissionId = "96000000-0000-4000-8000-000000000004";
const topicId = "96000000-0000-4000-8000-000000000020";

interface BackendReply {
  readonly method: string;
  readonly path: string;
  readonly token: string;
  readonly response: Response | Error;
}
let scope: Awaited<ReturnType<typeof realBffSession>>;
let replies: BackendReply[];
const backend = vi.fn<(request: Request) => Promise<Response>>();
function respond(
  method: string,
  path: string,
  body: unknown,
  status = 200,
  token = "access-token",
): void {
  replies.push({
    method,
    path,
    token,
    response: Response.json(body, { status }),
  });
}
function outgoing(index = 0): Request {
  const request = backend.mock.calls[index]?.[0];
  if (request === undefined)
    throw new Error("Expected external backend request");
  return request;
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
  scope = await realBffSession("author-token");
  replies = [];
  backend.mockReset();
  backend.mockImplementation(() => {
    const response = replies[backend.mock.calls.length - 1]?.response;
    if (response === undefined)
      return Promise.reject(new Error("Unexpected backend request"));
    return response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve(response);
  });
  interceptBackendHttp(backend);
});
afterEach(() => {
  try {
    expect(backend).toHaveBeenCalledTimes(replies.length);
    replies.forEach((reply, index) => {
      const request = outgoing(index);
      expect(request.method).toBe(reply.method);
      expect(request.url).toBe(
        `https://platform-api.example.test${reply.path}`,
      );
      expect(request.headers.get("authorization")).toBe(
        `Bearer ${reply.token}`,
      );
      if (reply.method === "GET") expect(request.body).toBeNull();
    });
  } finally {
    vi.useRealTimers();
  }
});

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
    respond(
      "GET",
      "/authoring/materials/references",
      {
        formats: [{ archived: false, name: "Гайд", id: "guide" }],
        products: [{ archived: false, name: "Продукт", id: materialId }],
        tags: [],
        topics: [{ archived: false, name: "Platform", id: topicId }],
      },
      200,
      "author-token",
    );
    const ready = await scope(() => handleAuthoringMaterialFiltersRequest());
    expect(ready.status).toBe(200);
    expect(ready.headers.get("cache-control")).toContain("no-store");
    expect(await ready.json()).toEqual({
      formats: [{ label: "Гайд", value: "guide" }],
      kind: "ready",
      topics: [{ label: "Platform", value: topicId }],
    });

    respond(
      "GET",
      "/authoring/materials/references",
      { code: "forbidden" },
      403,
      "author-token",
    );
    const forbidden = await scope(() =>
      handleAuthoringMaterialFiltersRequest(),
    );
    expect(forbidden.status).toBe(403);
    respond(
      "GET",
      "/authoring/materials/references",
      { code: "dependency_unavailable" },
      503,
      "author-token",
    );
    const unavailable = await scope(() =>
      handleAuthoringMaterialFiltersRequest(),
    );
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
    respond(
      "GET",
      "/authoring/materials?format=guide&topicId=96000000-0000-4000-8000-000000000020&search=%D0%A3%D0%BF%D1%80%D0%B0%D0%B2%D0%BB%D1%8F%D0%B5%D0%BC%D1%8B%D0%B9&publicationState=published&page=2",
      {
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
    );

    const result = await getAuthoringMaterials(
      {
        format: "guide",
        page: 2,
        publicationState: "published",
        search: "Управляемый",
        topicId,
      },
      "access-token",
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
  });

  it("assigns a fresh lifecycle submission key to each independent list response", async () => {
    const page = {
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
    };
    respond("GET", "/authoring/materials?page=1", page);
    respond("GET", "/authoring/materials?page=1", page);

    const first = await getAuthoringMaterials({ page: 1 }, "access-token");
    const second = await getAuthoringMaterials({ page: 1 }, "access-token");

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
      respond("GET", "/authoring/materials?page=1", problem, status);

      await expect(
        getAuthoringMaterials({ page: 1 }, "access-token"),
      ).resolves.toEqual(expected);
    },
  );

  it("fails closed for malformed success bodies and typed transport failures", async () => {
    respond("GET", "/authoring/materials?page=1", { items: "not-an-array" });
    await expect(
      getAuthoringMaterials({ page: 1 }, "access-token"),
    ).resolves.toEqual({ kind: "malformed_response" });
    replies.push({
      method: "GET",
      path: "/authoring/materials?page=1",
      token: "access-token",
      response: new Error("external backend offline"),
    });
    await expect(
      getAuthoringMaterials({ page: 1 }, "access-token"),
    ).resolves.toEqual({ kind: "unavailable", reference: "unavailable" });
    replies.push({
      method: "GET",
      path: "/authoring/materials?page=1",
      token: "access-token",
      // A non-contract success status makes the real transport raise invalid-response.
      response: Response.json({}, { status: 201 }),
    });
    await expect(
      getAuthoringMaterials({ page: 1 }, "access-token"),
    ).resolves.toEqual({ kind: "malformed_response" });
  });

  it("publishes from the list through one intent request", async () => {
    respond("PATCH", `/authoring/materials/${materialId}/publication`, {
      contentVersion: 8,
      materialId,
      publicationState: "published",
      publishedAt: "2026-08-30T11:00:00.000Z",
    });

    await expect(
      executeTransitionMaterialPublication(
        publicationInput("published"),
        "access-token",
      ),
    ).resolves.toMatchObject({
      contentVersion: 8,
      kind: "saved",
      publicationState: "published",
    });
    expect(outgoing().headers.get("idempotency-key")).toBe(
      `web-transition-material-publication-${submissionId}`,
    );
    expect(await outgoing().json()).toEqual({
      expectedContentVersion: 7,
      publicationState: "published",
    });
  });

  it("deletes a draft with the list version and preserves its key across retry", async () => {
    respond("DELETE", `/authoring/materials/${materialId}`, { materialId });
    respond("DELETE", `/authoring/materials/${materialId}`, { materialId });
    const input = deletionInput();

    await expect(
      executeDeleteMaterialDraft(input, "access-token"),
    ).resolves.toEqual({ kind: "deleted", materialId });
    await expect(
      executeDeleteMaterialDraft(input, "access-token"),
    ).resolves.toEqual({ kind: "deleted", materialId });
    expect(backend).toHaveBeenCalledTimes(2);
    for (const [request] of backend.mock.calls)
      expect(request.headers.get("idempotency-key")).toBe(
        `web-delete-material-draft-${submissionId}`,
      );
    expect(await outgoing(1).json()).toEqual({
      deleteVideoId: null,
      expectedContentVersion: 7,
    });
  });

  it("passes an explicitly selected owned Video through draft hard-delete", async () => {
    respond("DELETE", `/authoring/materials/${materialId}`, { materialId });
    const videoId = "96000000-0000-4000-8000-000000000009";

    await executeDeleteMaterialDraft(deletionInput(videoId), "access-token");

    expect(await outgoing().json()).toMatchObject({ deleteVideoId: videoId });
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
    "maps $target $response.status to $expected.kind",
    async ({ expected, operation, response, target }) => {
      respond(
        target === "transition" ? "PATCH" : "DELETE",
        `/authoring/materials/${materialId}${target === "transition" ? "/publication" : ""}`,
        response.body,
        response.status,
      );

      await expect(
        operation === "delete"
          ? executeDeleteMaterialDraft(deletionInput(), "access-token")
          : executeTransitionMaterialPublication(
              publicationInput(
                operation === "publish" ? "published" : "unpublished",
              ),
              "access-token",
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

function problemResult(status: number, problem: Record<string, unknown>) {
  return { status, body: problem };
}
