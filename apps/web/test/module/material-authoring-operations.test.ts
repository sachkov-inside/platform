import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const fakes = vi.hoisted(() => ({
  create: vi.fn(),
  save: vi.fn(),
  token: vi.fn(),
  LogtoSessionUnavailableError: class extends Error {},
}));

vi.mock("@/shared/api/backend/index.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestMaterialDraftCreation: fakes.create,
  requestMaterialSave: fakes.save,
}));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: fakes.token,
    baseUrl: () => "https://inside.example.test",
  },
  LogtoSessionUnavailableError: fakes.LogtoSessionUnavailableError,
}));

import * as materialsRoute from "../../app/api/authoring/materials/route";

import { createMaterialDraftOperation } from "@/_pages/material-authoring/api/create-material-draft.operation";
import { saveMaterialOperation } from "@/_pages/material-authoring/api/save-material.operation";
import type { CreateMaterialDraftInput } from "@/_pages/material-authoring/model/create-material-draft";
import type { SaveMaterialInput } from "@/_pages/material-authoring/model/save-material";
import { BackendConnectionError } from "@/shared/api/backend/index.server";

import { routeBrowserMutations } from "../support/mutation-operation-route";

const materialId = "94000000-0000-4000-8000-000000000010";
const submissionId = "94000000-0000-4000-8000-000000000011";
const topicId = "94000000-0000-4000-8000-000000000013";
const tagId = "94000000-0000-4000-8000-000000000014";
const seriesId = "94000000-0000-4000-8000-000000000015";
const document = {
  content: [
    {
      content: [{ text: "Local full state", type: "text" }],
      type: "paragraph",
    },
  ],
  type: "doc",
};

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("trusted-token");
  fakes.save.mockResolvedValue({
    body: {
      contentVersion: 4,
      materialId,
      publicationState: "published",
      publishedAt: "2026-08-30T08:00:00.000Z",
    },
    ok: true,
    response: Response.json({}),
  });
  fakes.create.mockResolvedValue({
    body: {
      contentVersion: 1,
      materialId,
      publicationState: "draft",
      publishedAt: null,
    },
    ok: true,
    response: Response.json({}, { status: 201 }),
  });
});

describe("Save Material through its browser adapter and Route Handler", () => {
  it("sends the declared editor state as JSON and saves it in Nest", async () => {
    const { requests } = routeBrowserMutations({
      "/api/authoring/materials": materialsRoute,
    });

    const result = await saveMaterialOperation.send({
      ...saveInput(),
      // Состояние редактора шире команды; на сервер уходит только объявленное схемой.
      readOnly: false,
    } as SaveMaterialInput);

    expect(result).toMatchObject({
      contentVersion: 4,
      kind: "saved",
      publicationState: "published",
    });
    const [request] = requests;
    expect(request?.method).toBe("PUT");
    expect(request?.headers.get("content-type")).toBe("application/json");
    expect(
      Object.keys(
        z.record(z.string(), z.unknown()).parse(await request?.json()),
      ),
    ).not.toContain("readOnly");
    expect(fakes.token).toHaveBeenCalledWith("route");
    expect(fakes.save).toHaveBeenCalledWith(
      {
        access: "closed",
        deleteVideoId: null,
        detachVideoIds: [],
        difficulty: "basic",
        document,
        expectedContentVersion: 3,
        formatId: "guide",
        idempotencyKey: `web-save-${submissionId}`,
        materialId,
        notifyTelegram: true,
        outcomes: ["Собрать один production path"],
        primaryVideoId: null,
        publicationState: "published",
        seriesIds: [seriesId],
        summary: null,
        tagIds: [tagId],
        title: "Saved Material",
        topicId: null,
      },
      "trusted-token",
    );
  });

  it("answers an over-long title with the editor's message and no Nest call", async () => {
    routeBrowserMutations({ "/api/authoring/materials": materialsRoute });

    await expect(
      saveMaterialOperation.send(saveInput({ title: "Н".repeat(161) })),
    ).resolves.toEqual({
      issues: [
        {
          message: "Название должно быть не длиннее 160 символов.",
          path: "/title",
        },
      ],
      kind: "invalid_input",
    });
    expect(fakes.save).not.toHaveBeenCalled();
  });

  it("asks for a malformed document again with the editor's structure message", async () => {
    routeBrowserMutations({ "/api/authoring/materials": materialsRoute });

    await expect(
      saveMaterialOperation.send(saveInput({ seriesIds: ["not-a-series-id"] })),
    ).resolves.toEqual({
      issues: [
        {
          message: "Данные редактора имеют неверную структуру.",
          path: "/document",
        },
      ],
      kind: "invalid_input",
    });
    expect(fakes.save).not.toHaveBeenCalled();
  });

  it("rejects a document nested beyond the schema's stack as a bad request", async () => {
    // Такое тело может прислать только не браузерный адаптер: его JSON.stringify не дойдёт до сети.
    const response = await materialsRoute.PUT(
      new Request("https://inside.example.test/api/authoring/materials", {
        body: `{"document":{"type":"doc","x":${"[".repeat(200_000)}${"]".repeat(200_000)}}}`,
        headers: {
          "content-type": "application/json",
          origin: "https://inside.example.test",
        },
        method: "PUT",
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(fakes.save).not.toHaveBeenCalled();
  });

  it("treats a missing session as unauthorized before reading the body", async () => {
    fakes.token.mockRejectedValue(new fakes.LogtoSessionUnavailableError());
    routeBrowserMutations({ "/api/authoring/materials": materialsRoute });

    await expect(saveMaterialOperation.send(saveInput())).resolves.toEqual({
      kind: "unauthorized",
    });
    expect(fakes.save).not.toHaveBeenCalled();
  });

  it("rejects another origin before authentication", async () => {
    routeBrowserMutations(
      { "/api/authoring/materials": materialsRoute },
      "https://outside.test",
    );

    await expect(saveMaterialOperation.send(saveInput())).resolves.toEqual({
      kind: "unauthorized",
    });
    expect(fakes.token).not.toHaveBeenCalled();
  });

  it("keeps an unavailable Nest retryable and a lost answer as a numbered failure", async () => {
    routeBrowserMutations({ "/api/authoring/materials": materialsRoute });
    fakes.save.mockRejectedValueOnce(
      new BackendConnectionError("unavailable", "connection refused"),
    );
    await expect(saveMaterialOperation.send(saveInput())).resolves.toEqual({
      kind: "infrastructure_error",
      reference: "unavailable",
    });

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fakes.save.mockRejectedValueOnce(
      new BackendConnectionError("invalid-response", "Malformed response"),
    );
    await expect(saveMaterialOperation.send(saveInput())).resolves.toEqual({
      kind: "infrastructure_error",
      reference: "save-material-bff-503",
    });
  });
});

describe("Create Material draft through its browser adapter and Route Handler", () => {
  it("creates one idempotent draft from the JSON editor state", async () => {
    const { requests } = routeBrowserMutations({
      "/api/authoring/materials": materialsRoute,
    });

    await expect(
      createMaterialDraftOperation.send(draftInput()),
    ).resolves.toEqual({
      draft: { contentVersion: 1, materialId },
      kind: "created",
    });
    expect(requests[0]?.method).toBe("POST");
    expect(fakes.create).toHaveBeenCalledWith(
      expect.objectContaining({
        document,
        idempotencyKey: `web-create-${submissionId}`,
        seriesIds: [seriesId],
        topicId,
      }),
      "trusted-token",
    );
  });

  it("asks for a title before creating a draft", async () => {
    routeBrowserMutations({ "/api/authoring/materials": materialsRoute });

    await expect(
      createMaterialDraftOperation.send(draftInput({ title: " " })),
    ).resolves.toEqual({
      issues: [
        { message: "Укажите название до 160 символов.", path: "/title" },
      ],
      kind: "invalid_input",
    });
    expect(fakes.create).not.toHaveBeenCalled();
  });
});

function saveInput(
  overrides: Partial<SaveMaterialInput> = {},
): SaveMaterialInput {
  return {
    access: "closed",
    deleteVideoId: null,
    detachVideoIds: [],
    difficulty: "basic",
    document,
    expectedContentVersion: 3,
    formatId: "guide",
    materialId,
    notifyTelegram: true,
    outcomes: ["Собрать один production path", ""],
    primaryVideoId: null,
    publicationState: "published",
    seriesIds: [seriesId],
    submissionId,
    summary: "",
    tagIds: [tagId],
    title: "Saved Material",
    topicId: "unassigned",
    ...overrides,
  };
}

function draftInput(
  overrides: Partial<CreateMaterialDraftInput> = {},
): CreateMaterialDraftInput {
  return {
    access: "free",
    difficulty: "unassigned",
    document,
    formatId: "unassigned",
    outcomes: [],
    seriesIds: [seriesId],
    submissionId,
    summary: "",
    tagIds: [],
    title: "Новый материал",
    topicId,
    ...overrides,
  };
}
