import type { INestApplicationContext } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PLATFORM_CONFIG,
  parsePlatformConfig,
} from "../src/config/platform-config.js";
import { createApiApplication } from "../src/entrypoints/api/create-api-application.js";
import { createMcpApplication } from "../src/entrypoints/create-mcp-application.js";
import { OperationalReadiness } from "../src/infrastructure/operational-readiness.js";
import {
  PLATFORM_DATABASE,
  type PlatformDatabase,
} from "../src/infrastructure/postgres/index.js";
import { CONTENT_LIBRARY } from "../src/modules/content-library/index.js";
import {
  MATERIAL_AUTHORING,
  PUBLISHED_MATERIAL_READER,
} from "../src/modules/materials/index.js";

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
    const database = api.get<PlatformDatabase>(PLATFORM_DATABASE);
    expect(api.get<PlatformDatabase>(PLATFORM_DATABASE)).toBe(database);
    expect(api.get(OperationalReadiness)).toBeInstanceOf(OperationalReadiness);
    expect(api.get(CONTENT_LIBRARY)).toBeDefined();
    expect(api.get(MATERIAL_AUTHORING)).toBeDefined();
    expect(api.get(PUBLISHED_MATERIAL_READER)).toBeDefined();

    const destroy = vi.spyOn(database, "destroy");
    await api.close();
    application = undefined;

    expect(destroy).toHaveBeenCalledOnce();
  });

  it("uses the same required bindings for the MCP context", async () => {
    const mcp = await createMcpApplication(config, { logger: false });
    application = mcp;

    expect(mcp.get(PLATFORM_CONFIG)).toBe(config);
    const database = mcp.get<PlatformDatabase>(PLATFORM_DATABASE);
    expect(mcp.get<PlatformDatabase>(PLATFORM_DATABASE)).toBe(database);
    expect(mcp.get(OperationalReadiness)).toBeInstanceOf(
      OperationalReadiness,
    );

    const destroy = vi.spyOn(database, "destroy");
    await mcp.close();
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
    const database = api.get<PlatformDatabase>(PLATFORM_DATABASE);
    const getExecutor = vi.spyOn(database, "getExecutor");

    const response = await api.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(500);
    expect(getExecutor).toHaveBeenCalled();
  });
});
