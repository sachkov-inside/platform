import { expect, test, vi } from "vitest";
import { HttpWaitlistAuthorizationAdapter } from "../../src/adapters/platform/http-waitlist-authorization.adapter.js";
const query = {
  actorAccountRef: "author",
  intakeId: "d4f674dc-a1a9-4f86-8855-e4d904d2845f",
};
test("waitlist authorization binds a service response to its request and refuses malformed membership", async () => {
  const fetcher = vi.fn<typeof fetch>((_url, init) => {
    const request = JSON.parse(String(init?.body));
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
  expect(fetcher).toHaveBeenCalledWith(
    "https://platform.test/integrations/telegram/v1/communications/waitlist",
    expect.objectContaining({
      redirect: "error",
      headers: expect.objectContaining({
        authorization: "Bearer synthetic-secret",
      }),
    }),
  );
  fetcher.mockResolvedValue(
    Response.json({ status: "ok", members: ["arbitrary"] }),
  );
  expect(await adapter.read(query)).toEqual({ status: "unavailable" });
});
