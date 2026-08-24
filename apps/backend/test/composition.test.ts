import type { INestApplicationContext } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PLATFORM_CONFIG,
  parsePlatformConfig,
} from "../src/config/platform-config.js";
import { createApiApplication } from "../src/entrypoints/api/create-api-application.js";
import { createRuntimeApplication } from "../src/entrypoints/create-runtime-application.js";
import { PLATFORM_DATABASE } from "../src/infrastructure/postgres/index.js";
import { DATABASE_PROBE } from "../src/modules/readiness/database-probe.js";
import { PlatformDatabaseProbe } from "../src/modules/readiness/platform-database-probe.js";

const config = parsePlatformConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://inside:inside@127.0.0.1:1/inside",
});

describe("backend process composition", () => {
  let application: INestApplicationContext | undefined;

  afterEach(async () => {
    await application?.close();
  });

  it("binds one immutable config and one Platform database lifecycle in the API", async () => {
    const api = await createApiApplication(config, { logger: false });
    application = api;

    expect(api.get(PLATFORM_CONFIG)).toBe(config);
    const database = api.get(PLATFORM_DATABASE);
    expect(api.get(PLATFORM_DATABASE)).toBe(database);
    const databaseProbe = api.get<PlatformDatabaseProbe>(DATABASE_PROBE);
    expect(databaseProbe.database).toBe(database);

    const destroy = vi.spyOn(database, "destroy");
    await api.close();
    application = undefined;

    expect(destroy).toHaveBeenCalledOnce();
  });

  it("uses the same required bindings for MCP and worker runtime contexts", async () => {
    const runtime = await createRuntimeApplication(config, { logger: false });
    application = runtime;

    expect(runtime.get(PLATFORM_CONFIG)).toBe(config);
    const database = runtime.get(PLATFORM_DATABASE);
    expect(runtime.get(PLATFORM_DATABASE)).toBe(database);
    const databaseProbe = runtime.get<PlatformDatabaseProbe>(DATABASE_PROBE);
    expect(databaseProbe.database).toBe(database);

    const destroy = vi.spyOn(database, "destroy");
    await runtime.close();
    application = undefined;

    expect(destroy).toHaveBeenCalledOnce();
  });

  it("keeps the API running while health reports an unreachable database", async () => {
    const api: NestFastifyApplication = await createApiApplication(config, {
      logger: false,
    });
    application = api;
    await api.init();
    await api.getHttpAdapter().getInstance().ready();

    const response = await api.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(500);
  });
});
