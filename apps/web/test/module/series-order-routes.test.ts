import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { realBffSession } from "../support/real-bff-session";
import {
  interceptBackendHttp,
  expectSingleBackendRequest,
} from "../support/backend-http";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let scope: Awaited<ReturnType<typeof realBffSession>>;
import { PUT as productOrder } from "../../app/api/authoring/products/order/route";

const productId = "96000000-0000-4000-8000-000000000001";
const materialId = "96000000-0000-4000-8000-000000000002";
const orderVersion = "a".repeat(64);

beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  scope = await realBffSession();
  interceptBackendHttp(backend);
  backend.mockResolvedValueOnce(Response.json({ productId, orderVersion }));
});
afterEach(() => vi.useRealTimers());

it.each([["products", productOrder]] as const)(
  "saves composition through the %s route with the authenticated identity",
  async (segment, save) => {
    const body = JSON.stringify({
      productId,
      expectedOrderVersion: orderVersion,
      orderedMaterialIds: [materialId],
    });
    const response = await scope(() =>
      save(
        new Request(
          `https://inside.example.test/api/authoring/${segment}/order`,
          {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              origin: "https://inside.example.test",
            },
            body,
          },
        ),
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "saved", orderVersion });
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(
      await expectSingleBackendRequest(
        backend,
        "PUT",
        "/authoring/products/96000000-0000-4000-8000-000000000001/order",
      ).json(),
    ).toEqual({
      expectedOrderVersion:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      orderedMaterialIds: ["96000000-0000-4000-8000-000000000002"],
    });
  },
);
