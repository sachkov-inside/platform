import type { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PLATFORM_CONFIG,
  parsePlatformConfig,
  type PlatformConfig,
} from "../src/config/platform-config.js";
import { createApiApplication } from "../src/entrypoints/api/create-api-application.js";
import { createMcpApplication } from "../src/entrypoints/create-mcp-application.js";
import { MaterialAssetsWorkerModule } from "../src/entrypoints/material-assets-worker/material-assets-worker.module.js";
import { ProfileAvatarsWorkerModule } from "../src/entrypoints/profile-avatars-worker/profile-avatars-worker.module.js";
import { OperationalReadiness } from "../src/infrastructure/operational-readiness.js";
import {
  PrismaClientProvider,
  type PlatformPrisma,
} from "../src/infrastructure/prisma/index.js";
import {
  ACCOUNTS,
  LOGTO_ACCESS_TOKEN_VERIFIER,
} from "../src/modules/accounts/index.js";
import {
  MATERIAL_AUTHORING,
  PUBLISHED_MATERIAL_READER,
} from "../src/modules/materials/index.js";
import { MEMBERSHIP_ENTITLEMENTS } from "../src/modules/membership-entitlements/index.js";
import { PROFILE_AVATAR_MAINTENANCE } from "../src/modules/member-profiles/index.js";

const config = parsePlatformConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://inside:inside@127.0.0.1:1/inside",
});

describe("backend process composition", () => {
  let application: INestApplicationContext | undefined;

  afterEach(async () => {
    await application?.close();
    vi.unstubAllEnvs();
  });

  it("loads and validates the process environment through Nest composition", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://inside:inside@127.0.0.1:1/inside",
    );

    const api = await createApiApplication(undefined, { logger: false });
    application = api;

    expect(api.get<PlatformConfig>(PLATFORM_CONFIG)).toEqual(config);
  });

  it("binds one immutable config and one Prisma lifecycle in the API", async () => {
    const api = await createApiApplication(config, { logger: false });
    application = api;

    expect(api.get(PLATFORM_CONFIG)).toBe(config);
    const prisma = api.get<PlatformPrisma>(PrismaClientProvider);
    expect(api.get<PlatformPrisma>(PrismaClientProvider)).toBe(prisma);
    expect(api.get(OperationalReadiness)).toBeInstanceOf(OperationalReadiness);
    expect(api.get(MEMBERSHIP_ENTITLEMENTS)).toBeDefined();
    expect(api.get(PUBLISHED_MATERIAL_READER)).toBeDefined();

    const disconnect = vi.spyOn(prisma, "$disconnect");
    await api.close();
    application = undefined;

    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("uses the same required bindings for the MCP context", async () => {
    const mcp = await createMcpApplication(config, { logger: false });
    application = mcp;

    expect(mcp.get(PLATFORM_CONFIG)).toBe(config);
    const prisma = mcp.get<PlatformPrisma>(PrismaClientProvider);
    expect(mcp.get<PlatformPrisma>(PrismaClientProvider)).toBe(prisma);
    expect(mcp.get(OperationalReadiness)).toBeInstanceOf(
      OperationalReadiness,
    );
    expect(mcp.get(ACCOUNTS)).toBeDefined();
    expect(mcp.get(LOGTO_ACCESS_TOKEN_VERIFIER)).toBeDefined();
    expect(mcp.get(MATERIAL_AUTHORING)).toBeDefined();

    const disconnect = vi.spyOn(prisma, "$disconnect");
    await mcp.close();
    application = undefined;

    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("loads and validates worker config through Nest composition", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://inside:inside@127.0.0.1:1/inside",
    );

    application = await NestFactory.createApplicationContext(
      MaterialAssetsWorkerModule.forRoot(),
      { logger: false },
    );

    expect(application.get<PlatformConfig>(PLATFORM_CONFIG)).toEqual(config);
  });

  it("binds the Avatar maintenance worker to the same typed config", async () => {
    application = await NestFactory.createApplicationContext(
      ProfileAvatarsWorkerModule.forRoot(config),
      { logger: false },
    );

    expect(application.get<PlatformConfig>(PLATFORM_CONFIG)).toBe(config);
    expect(application.get(PROFILE_AVATAR_MAINTENANCE)).toBeDefined();
  });

  it("keeps the API running while health reports an unreachable database", async () => {
    const api: NestFastifyApplication = await createApiApplication(config, {
      logger: false,
    });
    application = api;
    await api.init();
    await api.getHttpAdapter().getInstance().ready();
    const prisma = api.get<PlatformPrisma>(PrismaClientProvider);
    const queryRaw = vi
      .spyOn(prisma, "$queryRaw")
      .mockRejectedValueOnce(new Error("database unavailable"));

    const response = await api.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual({
      type: "about:blank",
      title: "Service unavailable",
      status: 503,
      code: "dependency_unavailable",
    });
    expect(queryRaw).toHaveBeenCalled();
  });
});
