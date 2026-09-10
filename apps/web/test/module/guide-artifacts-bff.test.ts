import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as BackendModule from "@/shared/api/backend/index.server";

const fakes = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  getOptionalAccessToken: vi.fn(),
  requestCreateFile: vi.fn(),
  requestListForGuide: vi.fn(),
  requestRemove: vi.fn(),
  requestSetGuides: vi.fn(),
}));

vi.mock("@/shared/api/backend/index.server", async (importOriginal) => {
  const original = await importOriginal<typeof BackendModule>();
  return {
    ...original,
    requestCreateGuideArtifactFile: fakes.requestCreateFile,
    requestGuideArtifactsForGuide: fakes.requestListForGuide,
    requestRemoveGuideArtifact: fakes.requestRemove,
    requestSetGuideArtifactGuides: fakes.requestSetGuides,
  };
});

vi.mock("@/shared/auth/platform-access-token.server", () => ({
  getPlatformAccessToken: fakes.getAccessToken,
  LogtoSessionUnavailableError: class extends Error {},
}));

vi.mock("@/shared/auth/logto-bff-config.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
}));

vi.mock("@/shared/auth/same-origin-mutation.server", () => ({
  isSameOriginMutation: (request: Request, baseUrl: string) =>
    request.headers.get("origin") === new URL(baseUrl).origin,
}));

vi.mock("@/shared/auth/index.server", async () => {
  const handler = await import(
    "@/shared/auth/authenticated-mutation-handler.server"
  );
  return {
    getOptionalPlatformAccessToken: fakes.getOptionalAccessToken,
    handleAuthenticatedMutation: handler.handleAuthenticatedMutation,
  };
});

import {
  handleCreateGuideArtifactFile,
  handleReadGuideArtifactsRequest,
  handleRemoveGuideArtifact,
} from "@/features/guide-artifacts/api/guide-artifacts-bff.server";
import {
  describeArtifactContent,
  formatArtifactSize,
} from "@/features/guide-artifacts/model/guide-artifacts";
import { MAX_GUIDE_ARTIFACT_MUTATION_BYTES } from "@/shared/api/mutation-limits";

const guideId = "10000000-0000-4000-8000-000000000001";
const artifactId = "20000000-0000-4000-8000-000000000001";
const artifact = {
  access: "membership",
  archived: false,
  artifactId,
  content: {
    contentType: "text/markdown",
    filename: "checklist.md",
    kind: "file",
    size: 2048,
  },
  guideIds: [guideId],
  materialIds: [],
  origin: "platform",
  purpose: "Проверка перед выпуском",
  sourceId: null,
  title: "Чек-лист",
  updatedAt: "2026-09-09T00:00:00.000Z",
  version: 2,
};

describe("Guide artifacts BFF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.getAccessToken.mockResolvedValue("access-token");
    fakes.getOptionalAccessToken.mockResolvedValue("access-token");
  });

  it("reads one guide artifact list and keeps it out of every shared cache", async () => {
    fakes.requestListForGuide.mockResolvedValue({
      body: { artifacts: [artifact] },
      ok: true,
      response: new Response(null, { status: 200 }),
    });

    const response = await handleReadGuideArtifactsRequest(guideId);

    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      artifacts: [artifact],
      kind: "ready",
    });
  });

  it("reports an absent session and an absent Guide as separate reader states", async () => {
    fakes.getOptionalAccessToken.mockResolvedValueOnce(undefined);
    await expect(
      (await handleReadGuideArtifactsRequest(guideId)).json(),
    ).resolves.toEqual({ kind: "unauthorized" });

    fakes.requestListForGuide.mockResolvedValue({
      ok: false,
      problem: null,
      response: new Response(null, { status: 404 }),
    });
    await expect(
      (await handleReadGuideArtifactsRequest(guideId)).json(),
    ).resolves.toEqual({ kind: "not_found" });
  });

  it("streams one upload and normalizes a refused file into a reader-facing rejection", async () => {
    fakes.requestCreateFile.mockResolvedValue(
      Response.json(
        { code: "invalid_content", status: 422, title: "not accepted" },
        { status: 422 },
      ),
    );

    const response = await handleCreateGuideArtifactFile(
      new Request("https://inside.example.test/api/authoring/guide-artifacts/uploads", {
        body: "--boundary--",
        headers: {
          "content-type": "multipart/form-data; boundary=boundary",
          origin: "https://inside.example.test",
        },
        method: "POST",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      kind: "rejected",
      reason: "Такой файл нельзя приложить: он выглядит как программа или скрипт.",
    });
    expect(fakes.requestCreateFile).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "access-token" }),
    );
  });

  it("carries the 25 MiB artifact envelope and refuses anything above it", async () => {
    fakes.requestCreateFile.mockResolvedValue(Response.json({}, { status: 200 }));
    const upload = (bytes: number) =>
      new Request(
        "https://inside.example.test/api/authoring/guide-artifacts/uploads",
        {
          body: "--boundary--",
          headers: {
            "content-length": String(bytes),
            "content-type": "multipart/form-data; boundary=boundary",
            origin: "https://inside.example.test",
          },
          method: "POST",
        },
      );

    // The shared 2 MiB browser-mutation limit would refuse a normal artifact.
    const accepted = await handleCreateGuideArtifactFile(
      upload(MAX_GUIDE_ARTIFACT_MUTATION_BYTES),
    );
    expect(accepted.status).toBe(200);
    expect(fakes.requestCreateFile).toHaveBeenCalledTimes(1);

    const refused = await handleCreateGuideArtifactFile(
      upload(MAX_GUIDE_ARTIFACT_MUTATION_BYTES + 1),
    );
    expect(refused.status).toBe(413);
    await expect(refused.json()).resolves.toMatchObject({
      code: "invalid_content",
    });
    expect(fakes.requestCreateFile).toHaveBeenCalledTimes(1);
  });

  it("keeps the Guides that still reference an artifact in the removal outcome", async () => {
    fakes.requestRemove.mockResolvedValue({
      ok: false,
      problem: { code: "artifact_referenced", guideIds: [guideId] },
      response: new Response(null, { status: 409 }),
    });
    const body = new FormData();
    body.set("artifactId", artifactId);

    const response = await handleRemoveGuideArtifact(
      new Request("https://inside.example.test/api/authoring/guide-artifacts/removal", {
        body,
        headers: { origin: "https://inside.example.test" },
        method: "DELETE",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      guideIds: [guideId],
      kind: "referenced",
    });
  });

  it("refuses a cross-origin artifact mutation before reading any session", async () => {
    const body = new FormData();
    body.set("artifactId", artifactId);
    const response = await handleRemoveGuideArtifact(
      new Request("https://inside.example.test/api/authoring/guide-artifacts/removal", {
        body,
        headers: { origin: "https://attacker.example.test" },
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(403);
    expect(fakes.requestRemove).not.toHaveBeenCalled();
  });

  it("describes artifact content for the author list", () => {
    expect(formatArtifactSize(512)).toBe("512 Б");
    expect(formatArtifactSize(2048)).toBe("2.0 КБ");
    expect(formatArtifactSize(5 * 1024 * 1024)).toBe("5.0 МБ");
    expect(
      describeArtifactContent({
        ...artifact,
        access: "membership",
        content: {
          contentType: "text/markdown",
          filename: "checklist.md",
          kind: "file",
          size: 2048,
        },
        origin: "platform",
      }),
    ).toBe("checklist.md · 2.0 КБ");
    expect(
      describeArtifactContent({
        ...artifact,
        access: "free",
        content: { externalUrl: "https://example.test/board", kind: "link" },
        origin: "authoring",
      }),
    ).toBe("https://example.test/board");
  });
});
