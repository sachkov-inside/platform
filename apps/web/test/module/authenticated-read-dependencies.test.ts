import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { realBffSession } from "../support/real-bff-session";
import {
  interceptBackendHttp,
  expectSingleBackendRequest,
} from "../support/backend-http";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let scope: Awaited<ReturnType<typeof realBffSession>>;
import { handleAuthoringMaterialsRequest } from "@/_pages/authoring-materials/api/authoring-materials-route.server";
import { handleHomePinReadRequest } from "@/features/product-order/api/home-pin-route.server";
const request = () => new Request("https://inside.example.test/api/read");
const capabilities = [
  [
    "authoring materials",
    "/authoring/materials?page=1",
    () => scope(() => handleAuthoringMaterialsRequest(request())),
  ],
  ["home pin", "/authoring/home-pin", () => scope(handleHomePinReadRequest)],
] as const;
beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  scope = await realBffSession("reader-token");
  interceptBackendHttp(backend);
});
afterEach(() => vi.useRealTimers());

it("keeps the authoring materials denial and private response policy", async () => {
  backend.mockResolvedValueOnce(
    Response.json({ code: "forbidden" }, { status: 403 }),
  );

  const response = await scope(() =>
    handleAuthoringMaterialsRequest(request()),
  );
  expectSingleBackendRequest(
    backend,
    "GET",
    "/authoring/materials?page=1",
    "reader-token",
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ kind: "forbidden" });
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  expect(response.headers.get("vary")).toBe("cookie");
});

it.each(capabilities)(
  "%s reports a failed backend as 503 rather than a successful read",
  async (_name, path, read) => {
    backend.mockResolvedValueOnce(
      Response.json({ code: "dependency_unavailable" }, { status: 503 }),
    );
    const response = await read();
    expect(
      expectSingleBackendRequest(backend, "GET", path, "reader-token").body,
    ).toBeNull();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ kind: "dependency_unavailable" });
  },
);

it.each(capabilities)(
  "%s reports a lost backend connection with the same protocol",
  async (_name, path, read) => {
    backend.mockRejectedValueOnce(new TypeError("fetch failed"));
    const response = await read();
    expect(
      expectSingleBackendRequest(backend, "GET", path, "reader-token").body,
    ).toBeNull();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ kind: "dependency_unavailable" });
  },
);

it.each(capabilities)(
  "%s reports a backend-rejected session as 401",
  async (_name, path, read) => {
    backend.mockResolvedValueOnce(
      Response.json({ code: "authentication_required" }, { status: 401 }),
    );
    const response = await read();
    expect(
      expectSingleBackendRequest(backend, "GET", path, "reader-token").body,
    ).toBeNull();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ kind: "authentication_required" });
  },
);
