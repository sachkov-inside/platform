import { describe, expect, it } from "vitest";

import {
  getBackendHealth,
  readBackendBaseUrl,
} from "@/shared/api/backend/index.server";

describe("real backend connection", () => {
  it("reads health and the OpenAPI contract from the Nest process", async () => {
    await expect(getBackendHealth()).resolves.toEqual({
      process: "api",
      status: "ok",
      database: "reachable",
    });

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
    expect(document.info.version).toBe("0.0.0");
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
