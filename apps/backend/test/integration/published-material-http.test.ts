import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe("published Material HTTP contract", () => {
  let app: NestFastifyApplication;
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    await seedLocalDevelopment(testDatabase.prisma);
    app = await createApiApplication(
      parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: testDatabase.url,
      }),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await testDatabase.dispose();
  });

  test("returns the current published Material for an anonymous reader", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/materials/inside-platform-overview",
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
        slug: "inside-platform-overview",
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
      readonly items: readonly { readonly access: string; readonly slug: string }[];
      readonly nextCursor: string | null;
    }>();
    expect(catalog.items).toHaveLength(12);
    expect(catalog.items.slice(0, 2)).toMatchObject([
      {
        slug: "membership-delivery-guide",
        access: "membership",
      },
      {
        slug: "inside-platform-overview",
        access: "free",
      },
    ]);
    expect(typeof catalog.nextCursor).toBe("string");
    expect(response.body).not.toContain("schemaVersion");
    expect(response.body).not.toContain("blocks");
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
        "/materials/inside-platform-overview",
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
