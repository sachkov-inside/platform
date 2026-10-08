import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({ token: vi.fn(), save: vi.fn() }));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestSeriesReorder: fakes.save,
  BackendConnectionError: class extends Error {},
}));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: fakes.token,
    baseUrl: () => "https://inside.example.test",
  },
  LogtoSessionUnavailableError: class extends Error {},
}));

import { PUT as productOrder } from "../../app/api/authoring/products/order/route";
import { PUT as legacyOrder } from "../../app/api/authoring/series/order/route";

const seriesId = "96000000-0000-4000-8000-000000000001";
const materialId = "96000000-0000-4000-8000-000000000002";
const orderVersion = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("trusted-token");
  fakes.save.mockResolvedValue({
    ok: true,
    body: { seriesId, orderVersion },
    response: new Response(),
  });
});

it.each([
  ["products", productOrder],
  ["series", legacyOrder],
] as const)(
  "saves composition through the %s route with the authenticated identity",
  async (segment, save) => {
    const body = new FormData();
    body.set("seriesId", seriesId);
    body.set("expectedOrderVersion", orderVersion);
    body.set("orderedMaterialIds", JSON.stringify([materialId]));
    const response = await save(
      new Request(
        `https://inside.example.test/api/authoring/${segment}/order`,
        {
          method: "PUT",
          headers: { origin: "https://inside.example.test" },
          body,
        },
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "saved", orderVersion });
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(fakes.save).toHaveBeenCalledWith(
      {
        seriesId,
        expectedOrderVersion: orderVersion,
        orderedMaterialIds: [materialId],
      },
      "trusted-token",
    );
  },
);
