import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { afterEach } from "vitest";
import { sessionAdapter } from "@/shared/auth/session-adapter.server";
import { realBffSession } from "../support/real-bff-session";
import { interceptBackendHttp } from "../support/backend-http";
import {
  interceptIdentityOutage,
  expectIdentityOutage,
} from "../support/identity-http";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let scope: Awaited<ReturnType<typeof realBffSession>>;
import { requireAuthoringEntry as realRequireAuthoringEntry } from "@/_app/authoring-entry.server";
const requireAuthoringEntry = () => scope(realRequireAuthoringEntry);

function permissions(body: unknown) {
  return Response.json(body);
}

function backendFailure(status: number) {
  return Response.json({ code: "rejected" }, { status });
}

/** Адреса, которые только отвечают 404 или перенаправляют на проверенную страницу. */
const rendersNothing = new Set([
  "communications/page.tsx",
  "communications/broadcasts/page.tsx",
  "playlists/page.tsx",
  "playlists/[productId]/page.tsx",
]);

/** `notFound()` бросает ошибку с этим digest; по нему Next.js отвечает страницей 404. */
const notFoundDigest = "NEXT_HTTP_ERROR_FALLBACK;404";

beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  scope = await realBffSession();
  interceptBackendHttp(backend);
});
afterEach(() => vi.useRealTimers());

describe("Authoring entry", () => {
  it("opens the admin to an Account with any platform permission", async () => {
    const tokenReads = vi.spyOn(sessionAdapter, "accessToken");
    for (const granted of [["materials:manage"], ["billing:manage"]]) {
      backend.mockResolvedValueOnce(permissions({ permissions: granted }));
      await expect(requireAuthoringEntry()).resolves.toBeUndefined();
    }
    expect(backend).toHaveBeenCalledTimes(2);
    for (const [request] of backend.mock.calls) {
      expect(request.method).toBe("GET");
      expect(request.url).toBe(
        "https://platform-api.example.test/accounts/current/permissions",
      );
      expect(request.headers.get("authorization")).toBe("Bearer trusted-token");
    }
    expect(tokenReads).toHaveBeenCalledWith("rsc");
  });

  it("answers 404 to an Account without permissions", async () => {
    backend.mockResolvedValue(permissions({ permissions: [] }));
    await expect(requireAuthoringEntry()).rejects.toMatchObject({
      digest: notFoundDigest,
    });
  });

  it("answers 404 to a guest without asking the backend", async () => {
    scope = await realBffSession(null);
    await expect(requireAuthoringEntry()).rejects.toMatchObject({
      digest: notFoundDigest,
    });
    expect(backend).not.toHaveBeenCalled();
  });

  it("answers 404 when the backend knows no Account for the session", async () => {
    backend.mockResolvedValue(backendFailure(401));
    await expect(requireAuthoringEntry()).rejects.toMatchObject({
      digest: notFoundDigest,
    });
  });

  it("keeps the admin closed when the check fails", async () => {
    let identity: ReturnType<typeof interceptIdentityOutage> | undefined;
    const failures = [
      () => backend.mockResolvedValueOnce(backendFailure(503)),
      () =>
        backend.mockResolvedValueOnce(
          permissions({ permissions: "platform:admin" }),
        ),
      () => backend.mockRejectedValueOnce(new Error("offline")),
      async () => {
        scope = await realBffSession({
          refreshToken: "failed-authoring-entry-identity",
        });
        identity = interceptIdentityOutage();
      },
    ];
    for (const fail of failures) {
      await fail();
      const outcome = requireAuthoringEntry();
      await expect(outcome).rejects.toBeInstanceOf(Error);
      await expect(outcome).rejects.not.toMatchObject({
        digest: notFoundDigest,
      });
    }
    if (identity === undefined)
      throw new Error("Expected identity outage fixture");
    expectIdentityOutage(identity);
  });

  it("is checked by every admin page, since the layout does not stop a page from rendering", () => {
    const root = fileURLToPath(new URL("../../app/authoring", import.meta.url));
    const pages = readdirSync(root, {
      recursive: true,
      encoding: "utf8",
    }).filter((path) => path.endsWith("page.tsx"));
    const unchecked = pages.filter(
      (path) =>
        !rendersNothing.has(path) &&
        !readFileSync(join(root, path), "utf8").includes(
          "await requireAuthoringEntry();",
        ),
    );
    expect(pages.length).toBeGreaterThan(10);
    expect(unchecked).toEqual([]);
  });
});
