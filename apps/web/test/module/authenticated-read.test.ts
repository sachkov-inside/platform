import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sessionAdapter } from "@/shared/auth/session-adapter.server";
import { realBffSession } from "../support/real-bff-session";
import {
  interceptIdentityOutage,
  expectIdentityOutage,
} from "../support/identity-http";
let scope: Awaited<ReturnType<typeof realBffSession>>;
import { handleAuthenticatedRead as realHandleAuthenticatedRead } from "@/shared/auth/authenticated-read.server";

const handleAuthenticatedRead = (
  ...args: Parameters<typeof realHandleAuthenticatedRead>
) => scope(() => realHandleAuthenticatedRead(...args));
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  scope = await realBffSession("reader-token");
});
afterEach(() => vi.useRealTimers());

it("keeps a reader response private while preserving its body, status and correlation reference", async () => {
  const tokenReads = vi.spyOn(sessionAdapter, "accessToken");
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
  expect(tokenReads).toHaveBeenCalledWith("route");
});

it.each([
  ["authentication_required", 401],
  ["identity_unavailable", 503],
] as const)(
  "classifies %s before calling the backend",
  async (kind, status) => {
    scope = await realBffSession(
      kind === "authentication_required"
        ? null
        : { refreshToken: "failed-reader-identity" },
    );
    const identity = interceptIdentityOutage();
    const execute = vi.fn();
    const response = await handleAuthenticatedRead(execute);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ kind });
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("vary")).toBe("cookie");
    expect(execute).not.toHaveBeenCalled();
    if (kind === "identity_unavailable") expectIdentityOutage(identity);
    else expect(identity).not.toHaveBeenCalled();
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
  const tokenReads = vi.spyOn(sessionAdapter, "accessToken");
  expect(await scope(() => readAuthenticatedSession("rsc"))).toEqual({
    kind: "ready",
    value: "reader-token",
  });
  expect(tokenReads).toHaveBeenCalledWith("rsc");
  const interruption = new Error("prefetch stopped");
  vi.spyOn(await import("next/server"), "connection").mockRejectedValueOnce(
    interruption,
  );
  tokenReads.mockClear();
  await expect(scope(() => readAuthenticatedSession("rsc"))).rejects.toBe(
    interruption,
  );
  expect(tokenReads).not.toHaveBeenCalled();
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
