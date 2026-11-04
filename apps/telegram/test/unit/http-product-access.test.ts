import { expect, test, vi } from "vitest";
import { HttpProductAccessAdapter } from "../../src/adapters/platform/http-product-access.adapter.js";
import { contractValidator } from "../../src/modules/communications/communications-contract.js";

const validRequest = contractValidator<{
  requestId: string;
  telegramIdentityRefs: string[];
}>("productAccessRequest");

test("product access binds the Platform answer to its request and refuses a malformed one", async () => {
  const fetcher = vi.fn<typeof fetch>((_url, init) => {
    if (typeof init?.body !== "string")
      throw new Error("Expected JSON request body");
    const request: unknown = JSON.parse(init.body);
    if (!validRequest(request))
      throw new Error("Invalid product access request envelope");
    return Promise.resolve(
      Response.json({
        contractVersion: "inside-communications-v2",
        requestId: request.requestId,
        withAccess: request.telegramIdentityRefs.slice(0, 1),
      }),
    );
  });
  const adapter = new HttpProductAccessAdapter(
    "https://platform.test/integrations/telegram/v2/communications/authorize",
    "synthetic-secret",
    fetcher,
  );
  expect(await adapter.read(["buyer", "reader"])).toEqual({
    status: "ok",
    withAccess: ["buyer"],
  });
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    "https://platform.test/integrations/telegram/v2/communications/product-access",
  );
  const init = fetcher.mock.calls[0]?.[1];
  expect(init?.redirect).toBe("error");
  expect(new Headers(init?.headers).get("authorization")).toBe(
    "Bearer synthetic-secret",
  );

  fetcher.mockResolvedValueOnce(
    Response.json({
      contractVersion: "inside-communications-v2",
      requestId: "a6e2e7a4-35a8-4c5e-9d7e-0a0c0f2f5d11",
      withAccess: [],
    }),
  );
  expect(await adapter.read(["buyer"])).toEqual({ status: "unavailable" });
  fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
  expect(await adapter.read(["buyer"])).toEqual({ status: "unavailable" });
});
