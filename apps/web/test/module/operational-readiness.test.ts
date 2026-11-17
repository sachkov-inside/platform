import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  webLiveness,
  webReadiness,
} from "@/shared/config/operational-readiness.server";
import type { WebRuntimeConfig } from "@/shared/config/runtime-config.server";
import { configureWebRuntime } from "../support/web-runtime";
import {
  interceptBackendHttp,
  expectSingleBackendRequest,
} from "../support/backend-http";

const config: WebRuntimeConfig = {
  backendBaseUrl: "https://platform-api.example.test",
  identity: {
    appId: "test",
    appSecret: "test-secret-at-least-16",
    audience: "https://api.example.test",
    baseUrl: "https://inside.example.test",
    cookieSecret: "test-cookie-secret-at-least-32-characters",
    endpoint: "https://identity.example.test",
  },
  learnerMcp: { url: "https://inside.example.test/mcp/learning" },
  mode: "test",
  runtime: { release: "v7", sourceSha: "7".repeat(40) },
};

const backend = vi.fn<(request: Request) => Promise<Response>>();
let expectedReads: number;
beforeEach(() => {
  configureWebRuntime();
  expectedReads = 0;
  backend.mockReset();
  interceptBackendHttp(backend);
});
afterEach(() => {
  expect(backend).toHaveBeenCalledTimes(expectedReads);
  if (expectedReads === 1)
    expectSingleBackendRequest(backend, "GET", "/health/ready", null);
});
describe("Web operational readiness", () => {
  it("reports liveness without checking a dependency", () => {
    expect(webLiveness(config)).toEqual({
      process: "web",
      release: config.runtime,
      status: "alive",
    });
  });

  it("requires the API to report the same release and a valid schema", async () => {
    expectedReads = 1;
    backend.mockResolvedValue(
      Response.json({
        database: "reachable" as const,
        process: "api" as const,
        release: config.runtime,
        schema: { identity: `sha256:${"a".repeat(64)}`, migrationCount: 20 },
        status: "ready" as const,
      }),
    );

    await expect(webReadiness(config)).resolves.toEqual({
      dependencies: { api: "ready" },
      process: "web",
      release: config.runtime,
      schema: { identity: `sha256:${"a".repeat(64)}`, migrationCount: 20 },
      status: "ready",
    });
  });

  it("fails closed when API belongs to another release", async () => {
    expectedReads = 1;
    backend.mockResolvedValue(
      Response.json({
        database: "reachable" as const,
        process: "api" as const,
        release: { release: "v6", sourceSha: "6".repeat(40) },
        schema: { identity: `sha256:${"a".repeat(64)}`, migrationCount: 20 },
        status: "ready" as const,
      }),
    );

    await expect(webReadiness(config)).rejects.toThrow(
      "Web and API release identities do not match",
    );
  });
});
