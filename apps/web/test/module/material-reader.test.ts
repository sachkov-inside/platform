import { afterEach, describe, expect, it, vi } from "vitest";

import { getMaterialReader } from "@/_pages/material-reader.server";

const publishedProjection = {
  materialId: "72000000-0000-4000-8000-000000000020",
  contentVersion: 3,
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
        materialId: "72000000-0000-4000-8000-000000000020",
        contentVersion: 3,
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
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("returns an expected access state without protected body bytes", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          kind: "teaser",
          cacheScope: "private-no-store",
          projection: { ...publishedProjection, access: "membership" },
          access: {
            availability: "locked",
            cta: {
              label: "Получить доступ",
              url: "https://t.me/tribute/app?startapp=inside",
            },
          },
        }),
      ),
    );

    await expect(
      getMaterialReader("inside-platform-overview"),
    ).resolves.toMatchObject({
      kind: "access",
      cta: {
        label: "Получить доступ",
        url: "https://t.me/tribute/app?startapp=inside",
      },
      material: {
        title: "Как устроен Inside Platform",
        access: "membership",
      },
    });
  });

  it("returns a not-found value for the stable API 404", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            type: "urn:inside:problem:material-not-found",
            title: "Material not found",
            status: 404,
            code: "material_not_found",
          },
          { status: 404 },
        ),
      ),
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

  it("maps the known dependency Problem Details to the unavailable state", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            type: "urn:inside:problem:dependency-unavailable",
            title: "Dependency unavailable",
            status: 503,
            code: "dependency_unavailable",
            retryable: true,
          },
          {
            status: 503,
            headers: { "Content-Type": "application/problem+json" },
          },
        ),
      ),
    );

    await expect(getMaterialReader("inside-platform-overview")).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("maps a failed backend request to the unavailable state", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("connection refused")));

    await expect(getMaterialReader("inside-platform-overview")).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("keeps an internal backend error distinct from an infrastructure outage", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            type: "urn:inside:problem:internal-error",
            title: "Internal error",
            status: 500,
            code: "internal_error",
            correlationId: "72000000-0000-4000-8000-000000000099",
          },
          { status: 500 },
        ),
      ),
    );

    await expect(getMaterialReader("inside-platform-overview")).rejects.toMatchObject({
      code: "backend-error",
    });
  });
});
