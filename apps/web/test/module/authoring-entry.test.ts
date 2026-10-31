import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({ token: vi.fn(), permissions: vi.fn() }));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestCurrentAccountPermissions: fakes.permissions,
}));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: fakes.token,
    baseUrl: () => "https://inside.example.test",
  },
  LogtoSessionUnavailableError: class LogtoSessionUnavailableError extends Error {},
}));

import { requireAuthoringEntry } from "@/_app/authoring-entry.server";
import { LogtoSessionUnavailableError } from "@/shared/auth/session-adapter.server";

function permissions(body: unknown) {
  return { ok: true, body, response: new Response(null, { status: 200 }) };
}

function backendFailure(status: number) {
  return {
    ok: false,
    problem: { code: "rejected" },
    response: new Response(null, { status }),
  };
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

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("trusted-token");
});

describe("Authoring entry", () => {
  it("opens the admin to an Account with any platform permission", async () => {
    for (const granted of [["materials:manage"], ["billing:manage"]]) {
      fakes.permissions.mockResolvedValueOnce(
        permissions({ permissions: granted }),
      );
      await expect(requireAuthoringEntry()).resolves.toBeUndefined();
    }
    expect(fakes.permissions).toHaveBeenCalledWith("trusted-token");
    expect(fakes.token).toHaveBeenCalledWith("rsc");
  });

  it("answers 404 to an Account without permissions", async () => {
    fakes.permissions.mockResolvedValue(permissions({ permissions: [] }));
    await expect(requireAuthoringEntry()).rejects.toMatchObject({
      digest: notFoundDigest,
    });
  });

  it("answers 404 to a guest without asking the backend", async () => {
    fakes.token.mockRejectedValue(new LogtoSessionUnavailableError());
    await expect(requireAuthoringEntry()).rejects.toMatchObject({
      digest: notFoundDigest,
    });
    expect(fakes.permissions).not.toHaveBeenCalled();
  });

  it("answers 404 when the backend knows no Account for the session", async () => {
    fakes.permissions.mockResolvedValue(backendFailure(401));
    await expect(requireAuthoringEntry()).rejects.toMatchObject({
      digest: notFoundDigest,
    });
  });

  it("keeps the admin closed when the check fails", async () => {
    const failures = [
      () => fakes.permissions.mockResolvedValueOnce(backendFailure(503)),
      () =>
        fakes.permissions.mockResolvedValueOnce(
          permissions({ permissions: "platform:admin" }),
        ),
      () => fakes.permissions.mockRejectedValueOnce(new Error("offline")),
      () => fakes.token.mockRejectedValueOnce(new Error("identity down")),
    ];
    for (const fail of failures) {
      fail();
      const outcome = requireAuthoringEntry();
      await expect(outcome).rejects.toBeInstanceOf(Error);
      await expect(outcome).rejects.not.toMatchObject({
        digest: notFoundDigest,
      });
    }
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
