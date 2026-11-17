import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UnsecuredJWT } from "jose";
import { realBffSession } from "../support/real-bff-session";
import { sessionAdapter } from "@/shared/auth/session-adapter.server";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;

import {
  handleStartBillingContact as realStart,
  handleConfirmBillingContact as realConfirm,
  handleReadBillingContact as realRead,
} from "@/features/billing-contact.server";
const handleStartBillingContact = (request: Request) =>
  session(() => realStart(request));
const handleConfirmBillingContact = (request: Request) =>
  session(() => realConfirm(request));
const handleReadBillingContact = () => session(() => realRead());

const operationId = "20000000-0000-4000-8000-000000000001";
const challengeRef = "30000000-0000-4000-8000-000000000001";
function request(
  input: Record<string, unknown>,
  origin = "https://inside.example.test",
) {
  return new Request(
    "https://inside.example.test/api/account/billing/contact/start",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(input),
    },
  );
}
beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-08T10:00:00Z"));
  session = await realBffSession();
  vi.stubGlobal("fetch", backend);
});

afterEach(() => vi.useRealTimers());

it("prefills the authenticated email without creating a verified billing contact", async () => {
  const token = new UnsecuredJWT({
    inside_verified_email: "login@example.test",
  }).encode();
  session = await realBffSession(token);
  backend.mockResolvedValueOnce(
    Response.json({ ok: true, contact: null, documents: [] }),
  );
  const response = await handleReadBillingContact();
  expect(await response.json()).toEqual({
    ok: true,
    contact: null,
    documents: [],
    initialEmail: "login@example.test",
  });
  expectBackendRequest(0, "GET", "", token);
  expect(backend).toHaveBeenCalledOnce();
});
it("preserves command identity, validates results and uses the authenticated token", async () => {
  const result = {
    ok: true,
    challengeRef,
    delivery: "unknown",
    expiresAt: "2026-09-08T12:00:00.000Z",
  };
  backend.mockResolvedValueOnce(Response.json(result));
  const response = await handleStartBillingContact(
    request({
      operationId,
      email: "buyer@example.test",
      expectedRevision: 0,
    }),
  );
  expect(await response.json()).toEqual(result);
  expect(await expectBackendRequest(0, "POST", "/start").json()).toEqual({
    operationId,
    email: "buyer@example.test",
    expectedRevision: 0,
  });
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  backend.mockResolvedValueOnce(Response.json({ ok: true, revision: 1 }));
  expect(
    await (
      await handleConfirmBillingContact(
        request({ operationId, challengeRef, code: "123456" }),
      )
    ).json(),
  ).toEqual({ ok: true, revision: 1 });
  expect(await expectBackendRequest(1, "POST", "/confirm").json()).toEqual({
    operationId,
    challengeRef,
    code: "123456",
  });
});
it("rejects cross-origin mutations and injected Account IDs before backend calls", async () => {
  const tokenReads = vi.spyOn(sessionAdapter, "accessToken");
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
          expectedRevision: 0,
          accountId: operationId,
        }),
      )
    ).json(),
  ).toEqual({ ok: false, code: "invalid_input" });
  expect(backend).not.toHaveBeenCalled();
  expect(tokenReads).toHaveBeenCalledTimes(1);
});
it("never maps malformed or failed provider responses to confirmation", async () => {
  backend
    .mockResolvedValueOnce(Response.json({ ok: true }))
    .mockRejectedValueOnce(new Error("lost"));
  for (let index = 0; index < 2; index++)
    expect(
      await (
        await handleConfirmBillingContact(
          request({ operationId, challengeRef, code: "123456" }),
        )
      ).json(),
    ).toEqual({ ok: false, code: "unavailable" });
  backend.mockResolvedValueOnce(
    Response.json(
      { code: "rate_limited", email: "private@example.test" },
      { status: 429 },
    ),
  );
  expect(
    await (
      await handleStartBillingContact(
        request({
          operationId,
          email: "buyer@example.test",
          expectedRevision: 0,
        }),
      )
    ).json(),
  ).toEqual({ ok: false, code: "rate_limited" });
});
it("only returns the contact presentation with no-store", async () => {
  backend.mockResolvedValueOnce(
    Response.json({
      ok: true,
      contact: null,
      documents: [],
      internal: "hidden",
    }),
  );
  const response = await handleReadBillingContact();
  // Каталог применимых документов входит в тот же ответ: его редакции нужны checkout #411.
  expect(await response.json()).toEqual({
    ok: true,
    contact: null,
    documents: [],
  });
  expect(response.headers.get("cache-control")).toBe("no-store, private");
});

it("maps an unknown backend code to the bounded unavailable outcome", async () => {
  backend.mockResolvedValueOnce(
    Response.json({ code: "new_unsupported_error" }, { status: 409 }),
  );
  expect(
    await (
      await handleStartBillingContact(
        request({
          operationId,
          email: "buyer@example.test",
          expectedRevision: 0,
        }),
      )
    ).json(),
  ).toEqual({ ok: false, code: "unavailable" });
});

it("keeps the exact document editions the checkout must present", async () => {
  const documents = [
    {
      kind: "terms",
      appliesTo: ["one_time"],
      documentId: "recurring",
      version: "2026-09-01",
      digest: "b".repeat(64),
      url: "https://inside.example.test/legal/recurring",
      text: "Текст",
    },
  ];
  backend.mockResolvedValueOnce(
    Response.json({ ok: true, contact: null, documents, secret: "hidden" }),
  );
  expect(await (await handleReadBillingContact()).json()).toEqual({
    ok: true,
    contact: null,
    documents,
  });
});

function expectBackendRequest(
  index: number,
  method: string,
  suffix: string,
  token = "trusted-token",
): Request {
  const request = backend.mock.calls[index]?.[0];
  if (request === undefined) throw new Error("Expected backend request");
  expect(request.method).toBe(method);
  expect(request.url).toBe(
    `https://platform-api.example.test/accounts/current/billing/contact${suffix}`,
  );
  expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
  return request;
}
