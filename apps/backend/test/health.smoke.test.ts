import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it } from "vitest";

import { loadPlatformConfig } from "../src/config/load-platform-config.js";
import { createApiApplication } from "../src/entrypoints/api/create-api-application.js";
import { platformMigrations } from "../src/migrations/index.js";
import { stringMatching } from "./support/matchers.js";

describe("API health smoke", () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("boots the API and reaches local PostgreSQL", async () => {
    app = await createApiApplication(loadPlatformConfig(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual({
      database: "reachable",
      process: "api",
      release: {
        release: "test",
        sourceSha: "0000000000000000000000000000000000000000",
      },
      schema: {
        identity: stringMatching(/^sha256:[0-9a-f]{64}$/u),
        migrationCount: platformMigrations.length,
      },
      status: "ready",
    });
  });
});
