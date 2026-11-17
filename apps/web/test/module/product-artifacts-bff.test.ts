import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionAdapter } from "@/shared/auth/session-adapter.server";
import {
  interceptBackendHttp,
  expectSingleBackendRequest,
} from "../support/backend-http";
import { realBffSession } from "../support/real-bff-session";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;

import {
  handleCreateProductArtifactFile as realhandleCreateProductArtifactFile,
  handleCreateProductArtifactLink as realhandleCreateProductArtifactLink,
  handleReadProductArtifactsRequest as realhandleReadProductArtifactsRequest,
  handleRemoveProductArtifact as realhandleRemoveProductArtifact,
  handleSetProductArtifactProducts as realhandleSetProductArtifactProducts,
} from "@/features/product-artifacts/api/product-artifacts-bff.server";
import {
  describeArtifactContent,
  formatArtifactSize,
} from "@/features/product-artifacts/model/product-artifacts";

const handleCreateProductArtifactFile = (
  ...args: Parameters<typeof realhandleCreateProductArtifactFile>
) => session(() => realhandleCreateProductArtifactFile(...args));
const handleCreateProductArtifactLink = (
  ...args: Parameters<typeof realhandleCreateProductArtifactLink>
) => session(() => realhandleCreateProductArtifactLink(...args));
const handleReadProductArtifactsRequest = (
  ...args: Parameters<typeof realhandleReadProductArtifactsRequest>
) => session(() => realhandleReadProductArtifactsRequest(...args));
const handleRemoveProductArtifact = (
  ...args: Parameters<typeof realhandleRemoveProductArtifact>
) => session(() => realhandleRemoveProductArtifact(...args));
const handleSetProductArtifactProducts = (
  ...args: Parameters<typeof realhandleSetProductArtifactProducts>
) => session(() => realhandleSetProductArtifactProducts(...args));

const productId = "10000000-0000-4000-8000-000000000001";
const artifactId = "20000000-0000-4000-8000-000000000001";
const artifact = {
  access: "closed",
  archived: false,
  artifactId,
  content: {
    contentType: "text/markdown",
    filename: "checklist.md",
    kind: "file",
    size: 2048,
  },
  productIds: [productId],
  materialIds: [],
  origin: "platform",
  purpose: "Проверка перед выпуском",
  sourceId: null,
  title: "Чек-лист",
  updatedAt: "2026-09-09T00:00:00.000Z",
  version: 2 as const,
};

describe("Product artifacts BFF", () => {
  beforeEach(async () => {
    backend.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
    session = await realBffSession();
    interceptBackendHttp(backend);
  });
  afterEach(() => vi.useRealTimers());

  it("reads one product artifact list and keeps it out of every shared cache", async () => {
    backend.mockResolvedValue(Response.json({ artifacts: [artifact] }));

    const response = await handleReadProductArtifactsRequest(productId);

    expectSingleBackendRequest(
      backend,
      "GET",
      `/authoring/products/${productId}/artifacts`,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      artifacts: [
        {
          access: "closed",
          archived: false,
          artifactId: "20000000-0000-4000-8000-000000000001",
          content: {
            contentType: "text/markdown",
            filename: "checklist.md",
            kind: "file",
            size: 2048,
          },
          productIds: ["10000000-0000-4000-8000-000000000001"],
          materialIds: [],
          origin: "platform",
          purpose: "Проверка перед выпуском",
          sourceId: null,
          title: "Чек-лист",
          updatedAt: "2026-09-09T00:00:00.000Z",
          version: 2,
        },
      ],
      kind: "ready",
    });
  });

  it("reports an absent session and an absent Product as separate reader states", async () => {
    session = await realBffSession(null);
    await expect(
      (await handleReadProductArtifactsRequest(productId)).json(),
    ).resolves.toEqual({ kind: "unauthorized" });

    expect(backend).not.toHaveBeenCalled();
    session = await realBffSession();
    backend.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(
      (await handleReadProductArtifactsRequest(productId)).json(),
    ).resolves.toEqual({ kind: "not_found" });
  });

  it("streams one upload and normalizes a refused file into a reader-facing rejection", async () => {
    backend.mockResolvedValue(
      Response.json(
        { code: "invalid_content", status: 422, title: "not accepted" },
        { status: 422 },
      ),
    );

    const response = await handleCreateProductArtifactFile(
      new Request(
        "https://inside.example.test/api/authoring/product-artifacts/uploads",
        {
          body: "--boundary--",
          headers: {
            "content-type": "multipart/form-data; boundary=boundary",
            origin: "https://inside.example.test",
          },
          method: "POST",
        },
      ),
    );

    await expect(response.json()).resolves.toEqual({
      kind: "rejected",
      reason:
        "Такой файл нельзя приложить: он выглядит как программа или скрипт.",
    });
    const outgoing = expectSingleBackendRequest(
      backend,
      "POST",
      "/authoring/product-artifacts/files",
    );
    expect(outgoing.headers.get("content-type")).toBe(
      "multipart/form-data; boundary=boundary",
    );
    expect(await outgoing.text()).toBe("--boundary--");
  });

  it("carries the 25 MiB artifact envelope and refuses anything above it", async () => {
    backend.mockResolvedValue(Response.json({}, { status: 200 }));
    const upload = (bytes: number) =>
      new Request(
        "https://inside.example.test/api/authoring/product-artifacts/uploads",
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
    const accepted = await handleCreateProductArtifactFile(upload(26_279_936));
    expect(accepted.status).toBe(200);
    expect(backend).toHaveBeenCalledTimes(1);

    const refused = await handleCreateProductArtifactFile(upload(26_279_937));
    expect(refused.status).toBe(413);
    await expect(refused.json()).resolves.toMatchObject({
      code: "invalid_content",
    });
    expect(backend).toHaveBeenCalledTimes(1);
  });

  it("keeps the Products that still reference an artifact in the removal outcome", async () => {
    backend.mockResolvedValue(
      Response.json(
        { code: "artifact_referenced", productIds: [productId] },
        { status: 409 },
      ),
    );
    const response = await handleRemoveProductArtifact(
      artifactRequest("/removal", { artifactId }, "DELETE"),
    );

    expect(
      expectSingleBackendRequest(
        backend,
        "DELETE",
        `/authoring/product-artifacts/${artifactId}`,
      ).body,
    ).toBeNull();
    await expect(response.json()).resolves.toEqual({
      productIds: ["10000000-0000-4000-8000-000000000001"],
      kind: "referenced",
    });
  });

  it("creates a link artifact with an empty purpose when the author leaves it out", async () => {
    backend.mockResolvedValue(
      Response.json(
        {
          ...artifact,
          content: { externalUrl: "https://example.test/board", kind: "link" },
          purpose: "",
        },
        { status: 201 },
      ),
    );

    const response = await handleCreateProductArtifactLink(
      artifactRequest(
        "/links",
        {
          access: "free",
          externalUrl: "https://example.test/board",
          productId,
          title: "Доска",
        },
        "POST",
      ),
    );

    await expect(response.json()).resolves.toMatchObject({ kind: "saved" });
    expect(
      await expectSingleBackendRequest(
        backend,
        "POST",
        "/authoring/product-artifacts/links",
      ).json(),
    ).toEqual({
      access: "free",
      externalUrl: "https://example.test/board",
      productId,
      purpose: "",
      title: "Доска",
    });
  });

  it("answers an invalid placement with its own refusal before any backend call", async () => {
    const response = await handleSetProductArtifactProducts(
      artifactRequest(
        "/placements",
        { artifactId, productIds: ["not-a-product"] },
        "PUT",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      kind: "rejected",
      reason: "Не удалось изменить размещение артефакта.",
    });
    expect(backend).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin artifact mutation before reading any session", async () => {
    const tokenReads = vi.spyOn(sessionAdapter, "accessToken");
    const response = await handleRemoveProductArtifact(
      artifactRequest(
        "/removal",
        { artifactId },
        "DELETE",
        "https://attacker.example.test",
      ),
    );

    expect(response.status).toBe(403);
    expect(tokenReads).not.toHaveBeenCalled();
    expect(backend).not.toHaveBeenCalled();
  });

  it("describes artifact content for the author list", () => {
    expect(formatArtifactSize(512)).toBe("512 Б");
    expect(formatArtifactSize(2048)).toBe("2.0 КБ");
    expect(formatArtifactSize(5 * 1024 * 1024)).toBe("5.0 МБ");
    expect(
      describeArtifactContent({
        ...artifact,
        access: "closed",
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

function artifactRequest(
  path: string,
  input: Readonly<Record<string, unknown>>,
  method: "DELETE" | "POST" | "PUT",
  origin = "https://inside.example.test",
): Request {
  return new Request(
    `https://inside.example.test/api/authoring/product-artifacts${path}`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json", origin },
      method,
    },
  );
}
