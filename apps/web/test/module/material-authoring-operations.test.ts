import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { z } from "zod";

import * as materialsRoute from "../../app/api/authoring/materials/route";

import { createMaterialDraftOperation } from "@/_pages/material-authoring/api/create-material-draft.operation";
import { saveMaterialOperation } from "@/_pages/material-authoring/api/save-material.operation";
import type { CreateMaterialDraftInput } from "@/_pages/material-authoring/model/create-material-draft";
import type { SaveMaterialInput } from "@/_pages/material-authoring/model/save-material";
import { sessionAdapter } from "@/shared/auth/session-adapter.server";
import { realBffSession } from "../support/real-bff-session";

import { routeBrowserMutations as connectBrowserMutations } from "../support/mutation-operation-route";

const materialId = "94000000-0000-4000-8000-000000000010";
const submissionId = "94000000-0000-4000-8000-000000000011";
const topicId = "94000000-0000-4000-8000-000000000013";
const tagId = "94000000-0000-4000-8000-000000000014";
const productId = "94000000-0000-4000-8000-000000000015";
const document = {
  content: [
    {
      content: [{ text: "Local full state", type: "text" }],
      type: "paragraph",
    },
  ],
  type: "doc",
};

interface BackendReply {
  readonly method: string;
  readonly path: string;
  readonly response: Response | Error;
}
let scope: Awaited<ReturnType<typeof realBffSession>>;
let sessionRead: MockInstance<typeof sessionAdapter.accessToken>;
let replies: BackendReply[];
const backend = vi.fn<(request: Request) => Promise<Response>>();
const saved = {
  contentVersion: 4,
  materialId,
  publicationState: "published",
  publishedAt: "2026-08-30T08:00:00.000Z",
};
const created = {
  contentVersion: 1,
  materialId,
  publicationState: "draft",
  publishedAt: null,
};
function reply(
  method: string,
  path: string,
  body: unknown,
  status = 200,
): void {
  replies.push({ method, path, response: Response.json(body, { status }) });
}
function outgoing(index = 0): Request {
  const request = backend.mock.calls[index]?.[0];
  if (request === undefined)
    throw new Error("Expected external backend request");
  return request;
}
function routeBrowserMutations(
  routes: Parameters<typeof connectBrowserMutations>[0],
  origin = "https://inside.example.test",
) {
  return connectBrowserMutations(routes, origin, {
    externalFetch: backend,
    run: scope,
  });
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
  scope = await realBffSession();
  sessionRead = vi.spyOn(sessionAdapter, "accessToken");
  replies = [];
  backend.mockReset();
  backend.mockImplementation(() => {
    const response = replies[backend.mock.calls.length - 1]?.response;
    return response === undefined
      ? Promise.reject(new Error("Unexpected backend request"))
      : response instanceof Error
        ? Promise.reject(response)
        : Promise.resolve(response);
  });
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
      expect(request.headers.get("authorization")).toBe("Bearer trusted-token");
    });
  } finally {
    vi.useRealTimers();
  }
});

describe("Save Material through its browser adapter and Route Handler", () => {
  it("sends the declared editor state through its real BFF and backend transport", async () => {
    reply("PUT", `/authoring/materials/${materialId}`, saved);
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
    expect(sessionRead).toHaveBeenCalledWith("route");
    expect(outgoing().headers.get("idempotency-key")).toBe(
      `web-save-${submissionId}`,
    );
    expect(await outgoing().json()).toEqual({
      body: { doc: document, schemaVersion: 1 },
      deleteVideoId: null,
      detachVideoIds: [],
      expectedContentVersion: 3,
      metadata: {
        access: "closed",
        difficulty: "basic",
        formatId: "guide",
        outcomes: ["Собрать один production path"],
        productIds: [productId],
        summary: null,
        tagIds: [tagId],
        title: "Saved Material",
        topicId: null,
      },
      notifyTelegram: true,
      primaryVideoId: null,
      publicationState: "published",
    });
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
    expect(backend).not.toHaveBeenCalled();
  });

  it("asks for a malformed document again with the editor's structure message", async () => {
    routeBrowserMutations({ "/api/authoring/materials": materialsRoute });

    await expect(
      saveMaterialOperation.send(
        saveInput({ productIds: ["not-a-product-id"] }),
      ),
    ).resolves.toEqual({
      issues: [
        {
          message: "Данные редактора имеют неверную структуру.",
          path: "/document",
        },
      ],
      kind: "invalid_input",
    });
    expect(backend).not.toHaveBeenCalled();
  });

  it("treats a missing session as unauthorized before reading the body", async () => {
    scope = await realBffSession(null);
    routeBrowserMutations({ "/api/authoring/materials": materialsRoute });

    await expect(saveMaterialOperation.send(saveInput())).resolves.toEqual({
      kind: "unauthorized",
    });
    expect(backend).not.toHaveBeenCalled();
  });

  it("rejects another origin before authentication", async () => {
    routeBrowserMutations(
      { "/api/authoring/materials": materialsRoute },
      "https://outside.test",
    );

    await expect(saveMaterialOperation.send(saveInput())).resolves.toEqual({
      kind: "unauthorized",
    });
    expect(sessionRead).not.toHaveBeenCalled();
  });

  it("keeps an unavailable Nest retryable and a lost answer as a numbered failure", async () => {
    routeBrowserMutations({ "/api/authoring/materials": materialsRoute });
    replies.push({
      method: "PUT",
      path: `/authoring/materials/${materialId}`,
      response: new Error("external backend offline"),
    });
    await expect(saveMaterialOperation.send(saveInput())).resolves.toEqual({
      kind: "infrastructure_error",
      reference: "unavailable",
    });

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    reply("PUT", `/authoring/materials/${materialId}`, saved, 201);
    await expect(saveMaterialOperation.send(saveInput())).resolves.toEqual({
      kind: "infrastructure_error",
      reference: "save-material-bff-503",
    });
  });
});

describe("Create Material draft through its browser adapter and Route Handler", () => {
  it("creates one idempotent draft from the JSON editor state", async () => {
    reply("POST", "/authoring/materials", created, 201);
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
    expect(outgoing().headers.get("idempotency-key")).toBe(
      `web-create-${submissionId}`,
    );
    expect(await outgoing().json()).toMatchObject({
      body: { doc: document, schemaVersion: 1 },
      metadata: { productIds: [productId], topicId },
    });
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
    expect(backend).not.toHaveBeenCalled();
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
    productIds: [productId],
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
    productIds: [productId],
    submissionId,
    summary: "",
    tagIds: [],
    title: "Новый материал",
    topicId,
    ...overrides,
  };
}
