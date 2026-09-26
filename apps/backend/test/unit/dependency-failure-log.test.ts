import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";

const unreachableDatabase = parsePlatformConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://inside:inside-password@127.0.0.1:1/inside",
});

const logRecord = z.record(z.string(), z.unknown());

function loggedRecords(spy: {
  mock: { calls: unknown[][] };
}): Record<string, unknown>[] {
  return spy.mock.calls.flatMap(([line]) => {
    if (typeof line !== "string" || !line.startsWith("{")) return [];
    const record = logRecord.safeParse(JSON.parse(line));
    return record.success ? [record.data] : [];
  });
}

describe("dependency failure log", () => {
  let api: NestFastifyApplication | undefined;

  afterEach(async () => {
    await api?.close();
    api = undefined;
    vi.restoreAllMocks();
  });

  it("names the failed dependency, its cause and the request that met it", async () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const infos = vi.spyOn(console, "info").mockImplementation(() => undefined);
    api = await createApiApplication(unreachableDatabase, { logger: false });
    await api.init();
    await api.getHttpAdapter().getInstance().ready();

    const response = await api.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/billing/offers?limit=5",
    });

    expect(response.statusCode).toBe(503);
    const failure = loggedRecords(errors).find(
      (record) => record.event === "dependency_failure",
    );
    expect(failure).toMatchObject({
      level: "error",
      process: "api",
      module: "billing",
      operation: "listOffers",
      method: "GET",
      route: "/billing/offers",
      outcome: "dependency_unavailable",
      error: {
        type: "PrismaClientKnownRequestError",
        code: "P1001",
        cause: {
          type: "DriverAdapterError",
          cause: { code: "DatabaseNotReachable" },
        },
      },
    });
    expect(failure?.requestId).toEqual(expect.any(String));
    const completed = loggedRecords(infos).find(
      (record) => record.event === "request_completed",
    );
    expect(completed).toMatchObject({
      requestId: failure?.requestId,
      route: "/billing/offers",
      statusCode: 503,
    });
    expect(
      JSON.stringify([...errors.mock.calls, ...infos.mock.calls]),
    ).not.toContain("inside-password");
  });
});
