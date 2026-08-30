import { describe, expect, it, vi } from "vitest";

import {
  getAuthoringMaterials,
  type AuthoringMaterialsDependencies,
} from "@/_pages/authoring-materials/api/get-authoring-materials";
import { parseAuthoringMaterialsQuery } from "@/_pages/authoring-materials/model/authoring-materials-query";
import {
  executeMaterialLifecycleMutation,
  type MaterialLifecycleDependencies,
} from "@/features/material-authoring/api/material-lifecycle";
import {
  parseAuthoringReturnHref,
  withAuthoringReturnHref,
} from "@/features/material-authoring";
import { BackendConnectionError } from "@/shared/api/backend/index.server";

const materialId = "96000000-0000-4000-8000-000000000001";
const submissionId = "96000000-0000-4000-8000-000000000004";

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

  it("maps one protected corpus page to the presentation contract", async () => {
    const dependencies = {
      list: vi.fn().mockResolvedValue({
        body: {
          items: [
            {
              canDelete: false,
              contentVersion: 7,
              format: { id: "96000000-0000-4000-8000-000000000002", name: "Гайд" },
              materialId,
              publicationState: "published",
              title: "Управляемый Material",
              topic: { id: "96000000-0000-4000-8000-000000000003", name: "Platform" },
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
        page: 2,
        publicationState: "published",
        search: "Управляемый",
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
        page: 2,
        publicationState: "published",
        search: "Управляемый",
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
  ])("maps HTTP $status to $expected.kind", async ({ expected, problem, status }) => {
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
  });

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
        list: vi.fn().mockRejectedValue(
          new BackendConnectionError("unavailable", "backend offline"),
        ),
      }),
    ).resolves.toEqual({ kind: "unavailable", reference: "unavailable" });
    await expect(
      getAuthoringMaterials({ page: 1 }, "access-token", {
        list: vi.fn().mockRejectedValue(
          new BackendConnectionError("invalid-response", "bad json"),
        ),
      }),
    ).resolves.toEqual({ kind: "malformed_response" });
  });

  it("publishes from the list through one optimistic full-state Save", async () => {
    const dependencies = lifecycleDependencies();

    await expect(
      executeMaterialLifecycleMutation(
        lifecycleFormData("publish"),
        "access-token",
        dependencies,
      ),
    ).resolves.toMatchObject({
      contentVersion: 8,
      kind: "saved",
      publicationState: "published",
    });
    expect(dependencies.load).toHaveBeenCalledWith(materialId, "access-token");
    expect(dependencies.save).toHaveBeenCalledWith(
      {
        access: "membership",
        document: {
          content: [
            {
              content: [{ text: "Current full state", type: "text" }],
              type: "paragraph",
            },
          ],
          type: "doc",
        },
        expectedContentVersion: 7,
        formatId: "96000000-0000-4000-8000-000000000002",
        idempotencyKey: `web-lifecycle-${submissionId}`,
        materialId,
        publicationState: "published",
        seriesIds: ["96000000-0000-4000-8000-000000000006"],
        summary: "Current summary",
        tagIds: ["96000000-0000-4000-8000-000000000005"],
        title: "Управляемый Material",
        topicId: "96000000-0000-4000-8000-000000000003",
      },
      "access-token",
    );
  });

  it("deletes a draft with the list version and preserves its key across retry", async () => {
    const dependencies = lifecycleDependencies();
    const formData = lifecycleFormData("delete");

    await expect(
      executeMaterialLifecycleMutation(formData, "access-token", dependencies),
    ).resolves.toEqual({ kind: "deleted", materialId });
    await expect(
      executeMaterialLifecycleMutation(formData, "access-token", dependencies),
    ).resolves.toEqual({ kind: "deleted", materialId });
    expect(dependencies.delete).toHaveBeenCalledTimes(2);
    expect(dependencies.delete).toHaveBeenNthCalledWith(
      2,
      {
        expectedContentVersion: 7,
        idempotencyKey: `web-lifecycle-${submissionId}`,
        materialId,
      },
      "access-token",
    );
    expect(dependencies.load).not.toHaveBeenCalled();
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
      target: "save" as const,
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
      target: "save" as const,
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
      target: "load" as const,
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
      target: "save" as const,
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
        executeMaterialLifecycleMutation(
          lifecycleFormData(operation),
          "access-token",
          dependencies,
        ),
      ).resolves.toEqual(expected);
    },
  );
});

function lifecycleFormData(operation: "delete" | "publish" | "unpublish") {
  const formData = new FormData();
  formData.set("expectedContentVersion", "7");
  formData.set("materialId", materialId);
  formData.set("operation", operation);
  formData.set("submissionId", submissionId);
  return formData;
}

function lifecycleDependencies() {
  return {
    delete: vi.fn().mockResolvedValue({
      body: { materialId },
      ok: true,
      response: Response.json({}),
    }),
    load: vi.fn().mockResolvedValue({
      body: {
        body: {
          doc: {
            content: [
              {
                content: [{ text: "Current full state", type: "text" }],
                type: "paragraph",
              },
            ],
            type: "doc",
          },
          schemaVersion: 1,
        },
        contentVersion: 7,
        firstPublishedAt: null,
        materialId,
        metadata: {
          access: "membership",
          formatId: "96000000-0000-4000-8000-000000000002",
          seriesMemberships: [
            {
              ordinal: 1,
              seriesId: "96000000-0000-4000-8000-000000000006",
            },
          ],
          slug: null,
          summary: "Current summary",
          tagIds: ["96000000-0000-4000-8000-000000000005"],
          title: "Управляемый Material",
          topicId: "96000000-0000-4000-8000-000000000003",
        },
        publicationState: "draft",
        publishedAt: null,
      },
      ok: true,
      response: Response.json({}),
    }),
    save: vi.fn().mockResolvedValue({
      body: {
        contentVersion: 8,
        materialId,
        publicationState: "published",
        publishedAt: "2026-08-30T11:00:00.000Z",
      },
      ok: true,
      response: Response.json({}),
    }),
  } satisfies MaterialLifecycleDependencies;
}

function problemResult(status: number, problem: Record<string, unknown>) {
  return {
    ok: false as const,
    problem,
    response: Response.json(problem, { status }),
  };
}
