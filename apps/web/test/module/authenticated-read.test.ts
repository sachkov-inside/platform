import { beforeEach, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ accessToken: vi.fn() }));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: { accessToken: session.accessToken },
  LogtoSessionUnavailableError: class extends Error {},
}));
import { handleAuthenticatedRead } from "@/shared/auth/authenticated-read.server";

beforeEach(() => {
  vi.clearAllMocks();
  session.accessToken.mockResolvedValue("reader-token");
});

it("keeps a reader response private while preserving its body, status and correlation reference", async () => {
  const response = await handleAuthenticatedRead((token) => {
    expect(token).toBe("reader-token");
    return Promise.resolve(
      Response.json(
        { profile: "reader" },
        {
          status: 202,
          headers: {
            "cache-control": "public, max-age=300",
            vary: "accept",
            "x-correlation-id": "reader-42",
          },
        },
      ),
    );
  });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ profile: "reader" });
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  expect(response.headers.get("vary")).toBe("accept, cookie");
  expect(response.headers.get("x-correlation-id")).toBe("reader-42");
  expect(session.accessToken).toHaveBeenCalledWith("route");
});

it.each([
  ["authentication_required", 401],
  ["identity_unavailable", 503],
] as const)(
  "classifies %s before calling the backend",
  async (kind, status) => {
    const { LogtoSessionUnavailableError } =
      await import("@/shared/auth/session-adapter.server");
    session.accessToken.mockRejectedValue(
      kind === "authentication_required"
        ? new LogtoSessionUnavailableError()
        : new Error("private provider detail"),
    );
    const execute = vi.fn();
    const response = await handleAuthenticatedRead(execute);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ kind });
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("vary")).toBe("cookie");
    expect(execute).not.toHaveBeenCalled();
  },
);

it("closes a thrown backend failure without exposing exception details", async () => {
  const response = await handleAuthenticatedRead(() =>
    Promise.reject(new Error("private backend detail")),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ kind: "dependency_unavailable" });
});

it.each([401, 503])(
  "normalizes backend HTTP %s while retaining the diagnostic header",
  async (status) => {
    const response = await handleAuthenticatedRead(() =>
      Promise.resolve(
        new Response(null, {
          status,
          headers: { "x-correlation-id": "backend-reference" },
        }),
      ),
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      kind:
        status === 401 ? "authentication_required" : "dependency_unavailable",
    });
    expect(response.headers.get("x-correlation-id")).toBe("backend-reference");
  },
);

it("selects the render session mode and leaves prefetch interruption outside failure mapping", async () => {
  const { readAuthenticatedSession } =
    await import("@/shared/auth/authenticated-read.server");
  expect(await readAuthenticatedSession("rsc")).toEqual({
    kind: "ready",
    value: "reader-token",
  });
  expect(session.accessToken).toHaveBeenCalledWith("rsc");
  const interruption = new Error("prefetch stopped");
  vi.spyOn(await import("next/server"), "connection").mockRejectedValueOnce(
    interruption,
  );
  session.accessToken.mockClear();
  await expect(readAuthenticatedSession("rsc")).rejects.toBe(interruption);
  expect(session.accessToken).not.toHaveBeenCalled();
});

it("replaces body metadata when normalizing a backend failure", async () => {
  const response = await handleAuthenticatedRead(() =>
    Promise.resolve(
      new Response("old body", {
        status: 503,
        headers: {
          "content-type": "text/plain",
          "content-length": "8",
          "content-encoding": "gzip",
        },
      }),
    ),
  );
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.has("content-length")).toBe(false);
  expect(response.headers.has("content-encoding")).toBe(false);
  expect(await response.json()).toEqual({ kind: "dependency_unavailable" });
});
