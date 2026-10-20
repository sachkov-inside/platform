import { randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { deliverWaitlistConfirmation } from "../../src/modules/sales-funnel/adapters/nest/waitlist-confirmation-pump.js";
const command = {
  contractVersion: "inside.waitlist-confirmation.v1" as const,
  eventId: randomUUID(),
  intakeId: randomUUID(),
  accountRef: "private-account",
  telegramIdentityRef: "private-identity",
  linkRevision: 1,
};
const config = {
  endpoint: "https://telegram.test/integrations/platform/v1/communications",
  secret: "private-service-secret",
};
afterEach(() => vi.restoreAllMocks());
test.each([
  {
    response: () =>
      Response.json({ private: "private-response" }, { status: 401 }),
    reason: "HTTP 401",
  },
  {
    response: () =>
      Response.json({ private: "private-response" }, { status: 403 }),
    reason: "HTTP 403",
  },
  {
    response: () =>
      Response.json({ private: "private-response" }, { status: 500 }),
    reason: "HTTP 500",
  },
  {
    response: () => Response.json({ private: "private-response" }),
    reason: "malformed response",
  },
  {
    response: () =>
      Response.json({ eventId: randomUUID(), status: "accepted" }),
    reason: "event mismatch",
  },
])(
  "relay diagnoses $reason without exposing recipient or provider payload",
  async ({ response, reason }) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      await deliverWaitlistConfirmation(config, command, () =>
        Promise.resolve(response()),
      ),
    ).toBe("unavailable");
    expect(log).toHaveBeenCalledTimes(1);
    const rendered = JSON.stringify(log.mock.calls);
    expect(rendered).toContain(reason);
    expect(rendered).not.toContain("private-account");
    expect(rendered).not.toContain("private-identity");
    expect(rendered).not.toContain("private-service-secret");
    expect(rendered).not.toContain("private-response");
  },
);
