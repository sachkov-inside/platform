import { beforeEach, expect, it, vi } from "vitest";
const fakes = vi.hoisted(() => ({
  token: vi.fn(),
  read: vi.fn(),
  start: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestBillingContact: fakes.read,
  requestStartBillingContact: fakes.start,
  requestConfirmBillingContact: fakes.confirm,
}));
vi.mock("@/shared/auth/platform-access-token.server", () => ({
  getPlatformAccessToken: fakes.token,
  LogtoSessionUnavailableError: class extends Error {},
}));
vi.mock("@/shared/auth/logto-bff-config.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
}));
import {
  handleStartBillingContact,
  handleConfirmBillingContact,
  handleReadBillingContact,
} from "@/features/billing-contact.server";
const operationId = "20000000-0000-4000-8000-000000000001";
const challengeRef = "30000000-0000-4000-8000-000000000001";
function request(
  input: Record<string, string>,
  origin = "https://inside.example.test",
) {
  const body = new FormData();
  for (const [key, value] of Object.entries(input)) body.set(key, value);
  return new Request(
    "https://inside.example.test/api/account/billing/contact/start",
    { method: "POST", headers: { origin }, body },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("trusted-token");
});
it("preserves command identity, validates results and uses the authenticated token", async () => {
  const result = {
    ok: true,
    challengeRef,
    delivery: "unknown",
    expiresAt: "2026-09-08T12:00:00.000Z",
  };
  fakes.start.mockResolvedValue({
    ok: true,
    body: result,
    response: new Response(),
  });
  const response = await handleStartBillingContact(
    request({
      operationId,
      email: "buyer@example.test",
      expectedRevision: "0",
    }),
  );
  expect(await response.json()).toEqual(result);
  expect(fakes.start).toHaveBeenCalledWith(
    { operationId, email: "buyer@example.test", expectedRevision: 0 },
    "trusted-token",
  );
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  fakes.confirm.mockResolvedValue({
    ok: true,
    body: { ok: true, revision: 1 },
    response: new Response(),
  });
  expect(
    await (
      await handleConfirmBillingContact(
        request({ operationId, challengeRef, code: "123456" }),
      )
    ).json(),
  ).toEqual({ ok: true, revision: 1 });
  expect(fakes.confirm).toHaveBeenCalledWith(
    { operationId, challengeRef, code: "123456" },
    "trusted-token",
  );
});
it("rejects cross-origin mutations and injected Account IDs before backend calls", async () => {
  expect(
    (await handleStartBillingContact(request({}, "https://outside.test")))
      .status,
  ).toBe(403);
  expect(
    await (
      await handleStartBillingContact(
        request({
          operationId,
          email: "buyer@example.test",
          expectedRevision: "0",
          accountId: operationId,
        }),
      )
    ).json(),
  ).toEqual({ ok: false, code: "invalid_input" });
  expect(fakes.start).not.toHaveBeenCalled();
  expect(fakes.token).toHaveBeenCalledTimes(1);
});
it("never maps malformed or failed provider responses to confirmation", async () => {
  fakes.confirm
    .mockResolvedValueOnce({
      ok: true,
      body: { ok: true },
      response: new Response(),
    })
    .mockRejectedValueOnce(new Error("lost"));
  for (let index = 0; index < 2; index++)
    expect(
      await (
        await handleConfirmBillingContact(
          request({ operationId, challengeRef, code: "123456" }),
        )
      ).json(),
    ).toEqual({ ok: false, code: "unavailable" });
  fakes.start.mockResolvedValue({
    ok: false,
    problem: { code: "rate_limited", email: "private@example.test" },
    response: new Response(null, { status: 429 }),
  });
  expect(
    await (
      await handleStartBillingContact(
        request({
          operationId,
          email: "buyer@example.test",
          expectedRevision: "0",
        }),
      )
    ).json(),
  ).toEqual({ ok: false, code: "rate_limited" });
});
it("only returns the contact presentation with no-store", async () => {
  fakes.read.mockResolvedValue({
    ok: true,
    body: { ok: true, contact: null, documents: [], internal: "hidden" },
    response: new Response(),
  });
  const response = await handleReadBillingContact();
  // Каталог применимых документов входит в тот же ответ: его редакции нужны checkout #411.
  expect(await response.json()).toEqual({
    ok: true,
    contact: null,
    documents: [],
  });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("maps an unknown backend code to the bounded unavailable outcome", async () => {
  fakes.start.mockResolvedValue({ ok: false, problem: { code: "new_unsupported_error" }, response: new Response(null, { status: 409 }) });
  expect(await (await handleStartBillingContact(request({ operationId, email: "buyer@example.test", expectedRevision: "0" }))).json()).toEqual({ ok: false, code: "unavailable" });
});

it("keeps the exact document editions the checkout must present", async () => {
  const documents = [
    {
      kind: "recurring",
      documentId: "recurring",
      version: "2026-09-01",
      digest: "b".repeat(64),
      url: "https://inside.example.test/legal/recurring",
      text: "Текст",
    },
  ];
  fakes.read.mockResolvedValue({
    ok: true,
    body: { ok: true, contact: null, documents, secret: "hidden" },
    response: new Response(),
  });
  expect(await (await handleReadBillingContact()).json()).toEqual({
    ok: true,
    contact: null,
    documents,
  });
});
