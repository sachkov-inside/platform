import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BackendConnectionError,
  getBackendHealth,
  readBackendBaseUrl,
} from "@/shared/api/backend/index.server";

describe("backend server interface", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the local API URL outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BACKEND_BASE_URL", "");

    expect(readBackendBaseUrl()).toBe("http://127.0.0.1:3001");
  });

  it("normalizes an explicit HTTP backend URL", () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test/internal/");

    expect(readBackendBaseUrl()).toBe("https://platform-api.example.test/internal");
  });

  it("requires an explicit backend URL in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BACKEND_BASE_URL", "");

    expect(() => readBackendBaseUrl()).toThrow(
      new BackendConnectionError(
        "configuration",
        "BACKEND_BASE_URL is required in production",
      ),
    );
  });

  it("rejects non-HTTP backend URLs", () => {
    vi.stubEnv("BACKEND_BASE_URL", "file:///tmp/platform-api");

    expect(() => readBackendBaseUrl()).toThrow(
      new BackendConnectionError(
        "configuration",
        "BACKEND_BASE_URL must use HTTP or HTTPS",
      ),
    );
  });

  it("preserves configuration errors before making a request", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BACKEND_BASE_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getBackendHealth()).rejects.toMatchObject({
      code: "configuration",
    } satisfies Partial<BackendConnectionError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps the exact API health response", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ process: "api", status: "ok", database: "reachable" }),
          { status: 200 },
        ),
      ),
    );

    await expect(getBackendHealth()).resolves.toEqual({
      process: "api",
      status: "ok",
      database: "reachable",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects a response outside the health contract", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            process: "api",
            status: "ok",
            database: "reachable",
            undocumented: true,
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(getBackendHealth()).rejects.toMatchObject({
      code: "invalid-response",
    } satisfies Partial<BackendConnectionError>);
  });

  it("maps only validated health Problem Details to unavailable", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    const unavailableProblem = {
      type: "about:blank",
      title: "Service unavailable",
      status: 503,
      code: "dependency_unavailable",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json(unavailableProblem, {
            status: 503,
            headers: { "Content-Type": "application/problem+json" },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({ ...unavailableProblem, status: 500 }, {
            status: 503,
            headers: { "Content-Type": "application/problem+json" },
          }),
        ),
    );

    await expect(getBackendHealth()).rejects.toMatchObject({
      code: "unavailable",
    } satisfies Partial<BackendConnectionError>);
    await expect(getBackendHealth()).rejects.toMatchObject({
      code: "backend-error",
    } satisfies Partial<BackendConnectionError>);
  });
});
