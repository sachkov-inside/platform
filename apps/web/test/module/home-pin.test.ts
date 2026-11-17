import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readingProduct } from "../../../../scenarios/reading.mjs";
import { realBffSession } from "../support/real-bff-session";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;

import {
  handleHomePinReadRequest as realHandleHomePinReadRequest,
  handleHomePinWriteRequest as realHandleHomePinWriteRequest,
} from "@/features/product-order/api/home-pin-route.server";
const handleHomePinReadRequest = () =>
  session(() => realHandleHomePinReadRequest());
const handleHomePinWriteRequest = (request: Request) =>
  session(() => realHandleHomePinWriteRequest(request));
const productId = readingProduct.id;
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
beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  session = await realBffSession();
  vi.stubGlobal("fetch", backend);
});
afterEach(() => vi.useRealTimers());

it("authenticates selection and removal and keeps both reads and writes private", async () => {
  backend.mockResolvedValueOnce(Response.json({ productId: null, version: 1 }));
  const read = await handleHomePinReadRequest();
  expect(await read.json()).toEqual({
    kind: "ready",
    pin: { productId: null, version: 1 },
  });
  expect(read.headers.get("cache-control")).toBe("no-store, private");
  expectBackendRequest("GET", "/authoring/home-pin");
  for (const id of [productId, null]) {
    backend.mockResolvedValueOnce(Response.json({ productId: id, version: 2 }));
    const response = await handleHomePinWriteRequest(
      request({ productId: id, expectedVersion: 1, actor: "untrusted" }),
    );
    expect(await response.json()).toEqual({
      kind: "ready",
      pin: { productId: id, version: 2 },
    });
    expect(
      await expectBackendRequest("PUT", "/authoring/home-pin").json(),
    ).toEqual({ productId: id, expectedVersion: 1 });
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
  expect(backend).not.toHaveBeenCalled();
});
it.each([
  [403, "forbidden", "forbidden"],
  [409, "stale_home_pin", "conflict"],
  [422, "invalid_reference", "invalid_input"],
  [503, "dependency_unavailable", "unavailable"],
])(
  "maps a %s failure without reporting success",
  async (status, code, kind) => {
    backend.mockResolvedValueOnce(Response.json({ code }, { status }));
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
  backend.mockResolvedValueOnce(Response.json({ productId, version: 0 }));
  expect(
    await (
      await handleHomePinWriteRequest(
        request({ productId, expectedVersion: 1 }),
      )
    ).json(),
  ).toEqual({ kind: "unavailable" });
});

function expectBackendRequest(method: string, path: string): Request {
  const request = backend.mock.calls.at(-1)?.[0];
  if (request === undefined) throw new Error("Expected backend request");
  expect(request.method).toBe(method);
  expect(request.url).toBe(`https://platform-api.example.test${path}`);
  expect(request.headers.get("authorization")).toBe("Bearer trusted-token");
  return request;
}
