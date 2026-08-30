import { describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getPlatformAccessToken: vi.fn(),
}));

vi.mock("@/shared/auth/index.server", () => {
  class LogtoSessionUnavailableError extends Error {}
  return {
    getPlatformAccessToken: authMocks.getPlatformAccessToken,
    LogtoSessionUnavailableError,
    readLogtoBffConfig: vi.fn().mockReturnValue({}),
  };
});

import { createMaterialDraftAction } from "@/_pages/material-authoring/api/create-material-draft.action";
import {
  executeCreateMaterialDraft,
  type MaterialDraftWorkflowDependencies,
} from "@/_pages/material-authoring/api/create-material-draft";
import { getCurrentMaterialPreview } from "@/_pages/material-authoring/api/get-current-material-preview";
import { LogtoSessionUnavailableError } from "@/shared/auth/index.server";

const materialId = "94000000-0000-4000-8000-000000000010";
const submissionId = "94000000-0000-4000-8000-000000000011";
const formatId = "94000000-0000-4000-8000-000000000012";
const topicId = "94000000-0000-4000-8000-000000000013";
const tagId = "94000000-0000-4000-8000-000000000014";

describe("Material Authoring action workflow", () => {
  it("maps a missing session in the actual server action", async () => {
    authMocks.getPlatformAccessToken.mockRejectedValueOnce(
      new LogtoSessionUnavailableError(),
    );

    await expect(
      createMaterialDraftAction({ kind: "idle" }, validFormData()),
    ).resolves.toEqual({ kind: "unauthorized" });
  });

  it("maps an unexpected identity failure in the actual server action", async () => {
    authMocks.getPlatformAccessToken.mockRejectedValueOnce(new TypeError("invalid session"));

    await expect(
      createMaterialDraftAction({ kind: "idle" }, validFormData()),
    ).resolves.toEqual({ kind: "unexpected_error", reference: "identity-session" });
  });

  it("creates one idempotent draft and maps its current safe Preview", async () => {
    const dependencies = successfulDependencies();

    await expect(
      executeCreateMaterialDraft(validFormData(), "access-token", dependencies),
    ).resolves.toMatchObject({
      kind: "created",
      draft: {
        contentVersion: 1,
        materialId,
        preview: {
          contentVersion: 1,
          format: "Гайд",
          tags: ["delivery"],
          title: "Один production path",
          topic: "Platform",
          blocks: [
            {
              kind: "paragraph",
              content: [{ kind: "text", marks: [], text: "Current из PostgreSQL." }],
            },
          ],
        },
        validation: { kind: "valid" },
      },
    });

    expect(dependencies.create).toHaveBeenCalledOnce();
    expect(dependencies.create).toHaveBeenCalledWith(
      expect.objectContaining({
        formatId,
        idempotencyKey: `web-create-${submissionId}`,
        tagIds: [tagId],
        topicId,
      }),
      "access-token",
    );
    expect(dependencies.validate).toHaveBeenCalledWith(materialId, 1, "access-token");
    expect(dependencies.preview).toHaveBeenCalledWith(materialId, "access-token");
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
    expect(dependencies.validate).not.toHaveBeenCalled();
    expect(dependencies.preview).not.toHaveBeenCalled();
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
    expect(dependencies.preview).not.toHaveBeenCalled();
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
    preview: vi.fn().mockResolvedValue({
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
    }),
    references: successfulReferences(),
    validate: vi.fn().mockResolvedValue({
      ok: true,
      body: {
        contentVersion: 1,
        extraction: { headings: [], plainText: "Current из PostgreSQL.", resources: [] },
        materialId,
        projectionDigest: "digest",
      },
      response: Response.json({}),
    }),
  };
}

function successfulReferences() {
  return vi.fn().mockResolvedValue({
    ok: true,
    body: {
      formats: [{ id: formatId, name: "Гайд" }],
      tags: [{ id: tagId, name: "delivery" }],
      topics: [{ id: topicId, name: "Platform" }],
    },
    response: Response.json({}),
  });
}
