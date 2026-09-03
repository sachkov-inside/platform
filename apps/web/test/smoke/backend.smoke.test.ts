import { describe, expect, it } from "vitest";

import {
  getBackendHealth,
  readBackendBaseUrl,
} from "@/shared/api/backend/index.server";

describe("real backend connection", () => {
  it("reads health and the OpenAPI contract from the Nest process", async () => {
    const health = await getBackendHealth();
    expect(health).toEqual({
      database: "reachable",
      process: "api",
      release: {
        release: "development",
        sourceSha: "0000000000000000000000000000000000000000",
      },
      schema: {
        identity: health.schema.identity,
        migrationCount: 20,
      },
      status: "ready",
    });
    expect(health.schema.identity).toMatch(/^sha256:[0-9a-f]{64}$/u);

    const response = await fetch(`${readBackendBaseUrl()}/openapi-json`);
    expect(response.status).toBe(200);

    const document = (await response.json()) as unknown;
    expect(isRecord(document)).toBe(true);
    if (!isRecord(document)) {
      return;
    }

    expect(isRecord(document.info)).toBe(true);
    if (!isRecord(document.info)) {
      return;
    }

    expect(document.info.title).toBe("Inside Platform API");
    expect(document.info.version).toBe("1.0.0");
    expect(isRecord(document.paths)).toBe(true);
    if (!isRecord(document.paths)) {
      return;
    }

    const healthPath = document.paths["/health"];
    expect(isRecord(healthPath)).toBe(true);
    if (!isRecord(healthPath)) {
      return;
    }

    expect(isRecord(healthPath.get)).toBe(true);
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
