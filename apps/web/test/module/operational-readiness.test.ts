import { describe, expect, it, vi } from "vitest";

import { webLiveness, webReadiness } from "@/shared/config/operational-readiness.server";
import type { WebRuntimeConfig } from "@/shared/config/runtime-config.server";

const config: WebRuntimeConfig = {
  backendBaseUrl: "http://api:3001",
  identity: {
    appId: "test",
    appSecret: "test-secret-at-least-16",
    audience: "https://api.example.test",
    baseUrl: "https://inside.example.test",
    cookieSecret: "test-cookie-secret-at-least-32-characters",
    endpoint: "https://identity.example.test",
  },
  mode: "test",
  runtime: { release: "v7", sourceSha: "7".repeat(40) },
};

describe("Web operational readiness", () => {
  it("reports liveness without checking a dependency", () => {
    expect(webLiveness(config)).toEqual({
      process: "web",
      release: config.runtime,
      status: "alive",
    });
  });

  it("requires the API to report the same release and a valid schema", async () => {
    const readApiReadiness = vi.fn().mockResolvedValue({
      database: "reachable" as const,
      process: "api" as const,
      release: config.runtime,
      schema: { identity: `sha256:${"a".repeat(64)}`, migrationCount: 20 },
      status: "ready" as const,
    });

    await expect(webReadiness(config, readApiReadiness)).resolves.toEqual({
      dependencies: { api: "ready" },
      process: "web",
      release: config.runtime,
      schema: { identity: `sha256:${"a".repeat(64)}`, migrationCount: 20 },
      status: "ready",
    });
  });

  it("fails closed when API belongs to another release", async () => {
    const readApiReadiness = vi.fn().mockResolvedValue({
      database: "reachable" as const,
      process: "api" as const,
      release: { release: "v6", sourceSha: "6".repeat(40) },
      schema: { identity: `sha256:${"a".repeat(64)}`, migrationCount: 20 },
      status: "ready" as const,
    });

    await expect(webReadiness(config, readApiReadiness)).rejects.toThrow(
      "Web and API release identities do not match",
    );
  });
});
