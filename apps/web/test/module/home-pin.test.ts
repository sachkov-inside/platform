import { beforeEach, expect, it, vi } from "vitest";
const fakes = vi.hoisted(() => ({
  token: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestAuthoringHomePin: fakes.load,
  requestHomePinUpdate: fakes.save,
  BackendConnectionError: class extends Error {},
}));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: fakes.token,
    baseUrl: () => "https://inside.example.test",
  },
  LogtoSessionUnavailableError: class extends Error {},
}));

import {
  handleHomePinReadRequest,
  handleHomePinWriteRequest,
} from "@/features/product-order/api/home-pin-route.server";
const productId = "10000000-0000-4000-8000-000000000001";
function request(
  input: Record<string, unknown>,
  origin = "https://inside.example.test",
) {
  return new Request("https://inside.example.test/api/authoring/home-pin", {
    method: "PUT",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(input),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("trusted-token");
});
it("authenticates selection and removal and keeps both reads and writes private", async () => {
  fakes.load.mockResolvedValue({
    ok: true,
    body: { productId: null, version: 1 },
    response: new Response(),
  });
  const read = await handleHomePinReadRequest();
  expect(await read.json()).toEqual({
    kind: "ready",
    pin: { productId: null, version: 1 },
  });
  expect(read.headers.get("cache-control")).toBe("no-store, private");
  for (const id of [productId, null]) {
    fakes.save.mockResolvedValue({
      ok: true,
      body: { productId: id, version: 2 },
      response: new Response(),
    });
    const response = await handleHomePinWriteRequest(
      request({ productId: id, expectedVersion: 1, actor: "untrusted" }),
    );
    expect(await response.json()).toEqual({
      kind: "ready",
      pin: { productId: id, version: 2 },
    });
    expect(fakes.save).toHaveBeenLastCalledWith(
      { productId: id, expectedVersion: 1 },
      "trusted-token",
    );
    expect(response.headers.get("cache-control")).toBe("no-store, private");
  }
});
it("rejects cross-origin and malformed writes before backend access", async () => {
  expect(
    (await handleHomePinWriteRequest(request({}, "https://outside.test")))
      .status,
  ).toBe(403);
  expect(
    await (
      await handleHomePinWriteRequest(
        request({ productId: "bad", expectedVersion: 0 }),
      )
    ).json(),
  ).toEqual({ kind: "invalid_input" });
  expect(fakes.save).not.toHaveBeenCalled();
});
it.each([
  [403, "forbidden", "forbidden"],
  [409, "stale_home_pin", "conflict"],
  [422, "invalid_reference", "invalid_input"],
  [503, "dependency_unavailable", "unavailable"],
])(
  "maps a %s failure without reporting success",
  async (status, code, kind) => {
    fakes.save.mockResolvedValue({
      ok: false,
      problem: { code },
      response: new Response(null, { status }),
    });
    expect(
      await (
        await handleHomePinWriteRequest(
          request({ productId, expectedVersion: 1 }),
        )
      ).json(),
    ).toEqual({ kind });
  },
);
it("does not accept a malformed success body", async () => {
  fakes.save.mockResolvedValue({
    ok: true,
    body: { productId, version: 0 },
    response: new Response(),
  });
  expect(
    await (
      await handleHomePinWriteRequest(
        request({ productId, expectedVersion: 1 }),
      )
    ).json(),
  ).toEqual({ kind: "unavailable" });
});
