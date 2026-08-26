import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it } from "vitest";

import { loadPlatformConfig } from "../src/config/load-platform-config.js";
import { createApiApplication } from "../src/entrypoints/api/create-api-application.js";

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
      process: "api",
      status: "ok",
      database: "reachable",
    });
  });
});
