import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { HttpWaitlistConfirmationAdapter } from "../../src/adapters/platform/http-waitlist-confirmation.adapter.js";
const command = {
  contractVersion: "inside.waitlist-confirmation.v1" as const,
  eventId: randomUUID(),
  intakeId: randomUUID(),
  accountRef: "synthetic-account",
  telegramIdentityRef: "synthetic-identity",
  linkRevision: 1,
};
test("receipt dispatch authorization binds the service response to its exact event and fails closed", async () => {
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      Response.json({ eventId: command.eventId, status: "accepted" }),
    ),
  );
  const adapter = new HttpWaitlistConfirmationAdapter(
    "https://platform.test/integrations/telegram/v1/communications/authorize",
    "synthetic-secret",
    fetcher,
  );
  expect(await adapter.current(command)).toBe("accepted");
  expect(fetcher.mock.calls[0]?.[0]).toEqual(
    new URL(
      "https://platform.test/integrations/telegram/v1/communications/waitlist",
    ),
  );
  expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("error");
  fetcher.mockResolvedValueOnce(
    Response.json({ eventId: randomUUID(), status: "accepted" }),
  );
  expect(await adapter.current(command)).toBe("unavailable");
  fetcher.mockResolvedValueOnce(
    Response.json({
      eventId: command.eventId,
      status: "accepted",
      members: [],
    }),
  );
  expect(await adapter.current(command)).toBe("unavailable");
  fetcher.mockResolvedValueOnce(
    Response.json({ status: "accepted" }, { status: 401 }),
  );
  expect(await adapter.current(command)).toBe("unavailable");
  fetcher.mockResolvedValueOnce(
    Response.json({ eventId: command.eventId, status: "suppressed" }),
  );
  expect(await adapter.current(command)).toBe("suppressed");
});
