import { contractValidator } from "../../src/modules/communications/communications-contract.js";
import type { WaitlistQuery } from "../../src/modules/communications/waitlist-authorization.js";
import { expect, test, vi } from "vitest";
import { HttpWaitlistAuthorizationAdapter } from "../../src/adapters/platform/http-waitlist-authorization.adapter.js";
const validRequest = contractValidator<WaitlistQuery & { requestId: string }>(
  "waitlistAudienceRequest",
);
const query = {
  actorAccountRef: "author",
  intakeId: "d4f674dc-a1a9-4f86-8855-e4d904d2845f",
};
test("waitlist authorization binds a service response to its request and refuses malformed membership", async () => {
  const fetcher = vi.fn<typeof fetch>((_url, init) => {
    if (typeof init?.body !== "string")
      throw new Error("Expected JSON request body");
    const request: unknown = JSON.parse(init.body);
    if (!validRequest(request))
      throw new Error("Invalid waitlist request envelope");
    return Promise.resolve(
      Response.json({
        contractVersion: "inside-communications-v1",
        requestId: request.requestId,
        status: "ok",
        saleOpen: true,
        purchaseUrl: "https://platform.test/products/ai-engineering/buy",
        active: 1,
        members: [{ accountRef: "account", telegramIdentityRef: "identity" }],
      }),
    );
  });
  const adapter = new HttpWaitlistAuthorizationAdapter(
    "https://platform.test/integrations/telegram/v1/communications/authorize",
    "synthetic-secret",
    fetcher,
  );
  expect(await adapter.read(query)).toMatchObject({ status: "ok", active: 1 });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    "https://platform.test/integrations/telegram/v1/communications/waitlist",
  );
  const init = fetcher.mock.calls[0]?.[1];
  expect(init?.redirect).toBe("error");
  expect(new Headers(init?.headers).get("authorization")).toBe(
    "Bearer synthetic-secret",
  );
  fetcher.mockResolvedValue(
    Response.json({ status: "ok", members: ["arbitrary"] }),
  );
  expect(await adapter.read(query)).toEqual({ status: "unavailable" });
});
