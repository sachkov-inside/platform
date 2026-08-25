import { afterEach, describe, expect, it, vi } from "vitest";

import { getMaterialReader } from "@/_pages/material-reader.server";

const publishedProjection = {
  materialId: "72000000-0000-4000-8000-000000000020",
  revisionId: "72000000-0000-4000-8000-000000000021",
  slug: "inside-platform-overview",
  title: "Как устроен Inside Platform",
  summary: "Один реальный published Material.",
  access: "free",
  publishedAt: "2026-08-25T05:00:00.000Z",
  topic: {
    id: "72000000-0000-4000-8000-000000000002",
    name: "Platform",
    slug: "platform",
  },
  format: {
    id: "72000000-0000-4000-8000-000000000003",
    name: "Гайд",
    slug: "guide",
  },
  tags: [{ id: "72000000-0000-4000-8000-000000000004", name: "Architecture" }],
  seriesMemberships: [
    {
      ordinal: 3,
      series: {
        id: "72000000-0000-4000-8000-000000000005",
        name: "Создание Platform Inside",
        slug: "platform-inside",
      },
    },
  ],
} as const;

const renderedBody = {
  schemaVersion: 1,
  blocks: [
    {
      kind: "heading",
      level: 2,
      content: [{ kind: "text", text: "Первый срез", marks: [] }],
    },
    {
      kind: "paragraph",
      content: [{ kind: "text", text: "Содержимое из PostgreSQL.", marks: [] }],
    },
  ],
} as const;

describe("Material Reader server adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("maps a valid published Material response to the presentation contract", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          kind: "available",
          cacheScope: "public",
          projection: publishedProjection,
          body: renderedBody,
        }),
      ),
    );

    await expect(getMaterialReader("inside-platform-overview")).resolves.toEqual({
      kind: "available",
      material: {
        slug: "inside-platform-overview",
        title: "Как устроен Inside Platform",
        summary: "Один реальный published Material.",
        access: "free",
        publishedAt: "2026-08-25T05:00:00.000Z",
        topic: { name: "Platform", slug: "platform" },
        format: { name: "Гайд", slug: "guide" },
        tags: [{ name: "Architecture" }],
        seriesMemberships: [
          {
            ordinal: 3,
            series: { name: "Создание Platform Inside", slug: "platform-inside" },
          },
        ],
      },
      body: [
        {
          kind: "heading",
          level: 2,
          content: [{ kind: "text", text: "Первый срез", marks: [] }],
        },
        {
          kind: "paragraph",
          content: [{ kind: "text", text: "Содержимое из PostgreSQL.", marks: [] }],
        },
      ],
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://platform-api.example.test/materials/inside-platform-overview",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("returns an expected access state without protected body bytes", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          kind: "teaser",
          cacheScope: "public",
          projection: { ...publishedProjection, access: "membership" },
          access: { allowed: false, reason: "membership_required" },
        }),
      ),
    );

    await expect(getMaterialReader("inside-platform-overview")).resolves.toMatchObject({
      kind: "access",
      reason: "membership_required",
      material: { title: "Как устроен Inside Platform", access: "membership" },
    });
  });

  it("returns a not-found value for the stable API 404", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ code: "material_not_found" }, { status: 404 })),
    );

    await expect(getMaterialReader("missing")).resolves.toEqual({ kind: "not-found" });
  });

  it("rejects a successful response outside the runtime contract", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          kind: "available",
          cacheScope: "public",
          projection: publishedProjection,
          body: { schemaVersion: 1, blocks: [{ kind: "paragraph" }] },
        }),
      ),
    );

    await expect(getMaterialReader("inside-platform-overview")).rejects.toMatchObject({
      code: "invalid-response",
    });
  });

  it("keeps backend failures distinct from contract drift", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ code: "dependency_unavailable", retryable: true }, { status: 503 }),
      ),
    );

    await expect(getMaterialReader("inside-platform-overview")).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
