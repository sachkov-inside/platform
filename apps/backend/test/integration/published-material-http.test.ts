import { createHash } from "node:crypto";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import {
  PrismaClientProvider,
  type PlatformPrisma,
} from "../../src/infrastructure/prisma/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe("published Material HTTP contract", () => {
  let app: NestFastifyApplication;
  let appPrisma: PlatformPrisma;
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    await seedLocalDevelopment(testDatabase.prisma);
    app = await createApiApplication(
      parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: testDatabase.url,
        MEMBERSHIP_ACQUISITION_URL:
          "https://t.me/tribute/app?startapp=inside",
      }),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    appPrisma = app.get(PrismaClientProvider);
  });

  test("returns an indexable locked teaser without protected body bytes", async () => {
    const bodyRead = vi.spyOn(appPrisma.material, "findFirst");
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/materials/developer-pipeline-bez-poteri-konteksta",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toMatchObject({
      kind: "teaser",
      cacheScope: "private-no-store",
      projection: {
        slug: "developer-pipeline-bez-poteri-konteksta",
        title: "Developer Pipeline без потери контекста",
        access: "membership",
      },
      access: {
        availability: "locked",
        cta: {
          label: "Получить доступ",
          url: "https://t.me/tribute/app?startapp=inside",
        },
      },
    });
    expect(response.body).not.toContain("schemaVersion");
    expect(response.body).not.toContain("blocks");
    expect(response.body).not.toContain("membership_required");
    expect(bodyRead).not.toHaveBeenCalled();
    bodyRead.mockRestore();
  });

  afterAll(async () => {
    await app.close();
    await testDatabase.dispose();
  });

  test("returns the current published Material for an anonymous reader", async () => {
    const bodyRead = vi.spyOn(appPrisma.material, "findFirst");
    const accountRead = vi.spyOn(appPrisma.account, "findUnique");
    const permissionRead = vi.spyOn(appPrisma.accountPermission, "findUnique");
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/materials/kak-ustroen-inside-platform",
    });

    const representativeBlocks: unknown = expect.arrayContaining([
      {
        kind: "heading",
        level: 2,
        content: [{ kind: "text", text: "Первый вертикальный срез", marks: [] }],
      },
      {
        kind: "paragraph",
        content: [
          {
            kind: "text",
            text: "Этот материал создаётся идемпотентным local seed через application interface.",
            marks: [],
          },
        ],
      },
    ]);

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
    expect(response.json()).toMatchObject({
      kind: "available",
      cacheScope: "public",
      projection: {
        slug: "kak-ustroen-inside-platform",
        title: "Как устроен Inside Platform",
        topic: {
          name: "Platform",
          slug: "platform",
        },
        format: {
          name: "Guide",
          slug: "guide",
        },
        tags: [{ name: "Full stack" }],
        seriesMemberships: [
          {
            ordinal: 1,
            series: { name: "Создание Platform Inside", slug: "platform-inside" },
          },
        ],
      },
      body: {
        schemaVersion: 1,
        blocks: representativeBlocks,
      },
    });
    expect(bodyRead).toHaveBeenCalledOnce();
    expect(accountRead).not.toHaveBeenCalled();
    expect(permissionRead).not.toHaveBeenCalled();
    bodyRead.mockRestore();
    accountRead.mockRestore();
    permissionRead.mockRestore();
  });

  test("returns the published catalog without Material body bytes", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/library/materials",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=30, stale-while-revalidate=60",
    );
    const catalog = response.json<{
      readonly items: readonly {
        readonly access: string;
        readonly availability: string;
        readonly slug: string;
      }[];
      readonly nextCursor: string | null;
    }>();
    expect(catalog.items).toHaveLength(12);
    expect(catalog.items.slice(0, 2)).toMatchObject([
      {
        slug: "developer-pipeline-bez-poteri-konteksta",
        access: "membership",
        availability: "locked",
      },
      {
        slug: "kak-ustroen-inside-platform",
        access: "free",
        availability: "available",
      },
    ]);
    expect(typeof catalog.nextCursor).toBe("string");
    expect(response.body).not.toContain("schemaVersion");
    expect(response.body).not.toContain("blocks");
  });

  test("searches the catalog with canonical URL facets and sort", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/library/materials?q=developer%20pipeline&topic=platform&format=guide&sort=relevance",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        {
          slug: "developer-pipeline-bez-poteri-konteksta",
          availability: "locked",
        },
      ],
      totalCount: 1,
      facets: {
        topics: [expect.objectContaining({ slug: "platform" })],
        formats: [expect.objectContaining({ slug: "guide" })],
        series: [expect.objectContaining({ slug: "platform-inside" })],
      },
    });
    expect(response.body).not.toContain("schemaVersion");
    expect(response.body).not.toContain("blocks");
    expect(response.body).not.toContain("Закрытое содержимое для участников");
  });

  test("returns Topic, ordered Series and related generated views", async () => {
    const topic = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/library/topics/platform",
    });
    const series = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/library/series/platform-inside",
    });
    const related = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/library/materials/kak-ustroen-inside-platform/related",
    });

    expect(topic.statusCode).toBe(200);
    const topicBody = topic.json<{
      readonly kind: string;
      readonly reference: { readonly name: string; readonly slug: string };
      readonly items: readonly {
        readonly availability: string;
        readonly slug: string;
      }[];
    }>();
    expect(topicBody).toMatchObject({
      kind: "topic",
      reference: { name: "Platform", slug: "platform" },
    });
    expect(
      topicBody.items.find(
        ({ slug }) => slug === "developer-pipeline-bez-poteri-konteksta",
      ),
    ).toMatchObject({ availability: "locked" });
    expect(series.statusCode).toBe(200);
    const seriesBody = series.json<{
      readonly kind: string;
      readonly items: readonly { readonly slug: string }[];
    }>();
    expect(seriesBody.kind).toBe("series");
    expect(seriesBody.items.map(({ slug }) => slug)).toEqual([
      "kak-ustroen-inside-platform",
      "developer-pipeline-bez-poteri-konteksta",
    ]);
    expect(related.statusCode).toBe(200);
    const relatedBody = related.json<{
      readonly kind: string;
      readonly items: readonly { readonly slug: string }[];
    }>();
    expect(relatedBody.kind).toBe("related");
    expect(relatedBody.items.slice(0, 2)).toEqual([
      expect.objectContaining({ slug: "arkhitekturnaya-zametka-01" }),
      expect.objectContaining({
        slug: "developer-pipeline-bez-poteri-konteksta",
      }),
    ]);
    for (const response of [topic, series, related]) {
      expect(response.headers["cache-control"]).toBe(
        "public, max-age=30, stale-while-revalidate=60",
      );
      expect(response.body).not.toContain("Закрытое содержимое для участников");
      expect(response.body).not.toContain("schemaVersion");
    }
  });

  test("returns stable missing and invalid discovery outcomes", async () => {
    const missing = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/library/topics/missing-topic",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      type: "urn:inside:problem:discovery-not-found",
      title: "Discovery not found",
      status: 404,
      code: "discovery_not_found",
    });

    const invalid = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/library/series/INVALID",
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "invalid_request_shape" });
  });

  test("returns a stable 404 outcome for an unpublished slug", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/materials/not-published",
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toEqual({
      type: "urn:inside:problem:material-not-found",
      title: "Material not found",
      status: 404,
      code: "material_not_found",
    });
  });

  test("rejects an invalid slug at the Materials boundary", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/materials/Invalid%20Slug",
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toEqual({
      type: "urn:inside:problem:invalid-request-shape",
      title: "Invalid request shape",
      status: 400,
      code: "invalid_request_shape",
    });
  });

  test("rejects a malformed catalog cursor", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/library/materials?after=not-a-cursor",
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toEqual({
      type: "urn:inside:problem:invalid-request-shape",
      title: "Invalid request shape",
      status: 400,
      code: "invalid_request_shape",
    });
  });

  test("rejects a catalog cursor whose kind does not match its sort", async () => {
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          formatSlugs: [],
          seriesSlugs: ["platform-inside"],
          sort: "series",
          topicSlugs: [],
        }),
      )
      .digest("base64url");
    const after = Buffer.from(
      JSON.stringify({
        v: 2,
        fingerprint,
        cursor: {
          kind: "newest",
          materialId: "72000000-0000-4000-8000-000000000001",
          publishedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
      "utf8",
    ).toString("base64url");

    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/library/materials?series=platform-inside&sort=series&after=${after}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toEqual({
      type: "urn:inside:problem:invalid-request-shape",
      title: "Invalid request shape",
      status: 400,
      code: "invalid_request_shape",
    });
  });

  test("returns a retryable 503 outcome when PostgreSQL is unavailable", async () => {
    const unavailableApp = await createApiApplication(
      parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://inside:inside@127.0.0.1:1/inside",
      }),
      { logger: false },
    );
    await unavailableApp.init();
    await unavailableApp.getHttpAdapter().getInstance().ready();

    try {
      for (const url of [
        "/library/materials",
        "/library/topics/platform",
        "/library/series/platform-inside",
        "/library/materials/kak-ustroen-inside-platform/related",
        "/materials/kak-ustroen-inside-platform",
      ]) {
        const response = await unavailableApp.getHttpAdapter().getInstance().inject({
          method: "GET",
          url,
        });

        expect(response.statusCode).toBe(503);
        expect(response.headers["content-type"]).toContain("application/problem+json");
        expect(response.json()).toEqual({
          type: "urn:inside:problem:dependency-unavailable",
          title: "Dependency unavailable",
          status: 503,
          code: "dependency_unavailable",
          retryable: true,
        });
      }
    } finally {
      await unavailableApp.close();
    }
  });
});
