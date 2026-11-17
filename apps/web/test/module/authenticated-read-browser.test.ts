import { afterEach, expect, it, vi } from "vitest";
import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import { privateAuthenticatedResponse } from "@/shared/auth/private-response.server";
import { routeBrowserMutations } from "../support/mutation-operation-route";

const contractPath = "/__test/generic-authenticated-read";

// https://github.com/sachkov-inside/platform/issues/2292#issuecomment-6937746149 permits an isolated generic decoder/factory contract without replacing a product endpoint or session.
function genericResponse(response: Response) {
  return routeBrowserMutations({
    [contractPath]: {
      GET: () => privateAuthenticatedResponse(response),
    },
  });
}

function expectGenericRequest(
  transport: ReturnType<typeof genericResponse>,
  status: number,
) {
  expect(transport.statuses).toEqual([status]);
  expect(transport.requests).toHaveLength(1);
  expect(transport.requests[0]?.url).toBe(
    "https://inside.example.test/__test/generic-authenticated-read",
  );
  expect(transport.requests[0]?.method).toBe("GET");
}

afterEach(() => vi.unstubAllGlobals());

it.each([
  [401, { kind: "authentication_required" }],
  [503, { kind: "identity_unavailable" }],
  [503, { kind: "dependency_unavailable" }],
  [502, null],
] as const)(
  "decodes the isolated generic read contract failure at HTTP %s",
  async (status, body) => {
    const transport = genericResponse(Response.json(body, { status }));
    expect(await requestAuthenticatedRead(contractPath)).toEqual(
      body ?? { kind: "rejected", status: 502, body: null },
    );
    expectGenericRequest(transport, status);
  },
);

it("passes a successful body as unknown for the feature schema and forwards cancellation", async () => {
  const transport = genericResponse(Response.json({ profile: "reader" }));
  const signal = new AbortController().signal;
  expect(await requestAuthenticatedRead(contractPath, signal)).toEqual({
    kind: "ready",
    value: { profile: "reader" },
  });
  expect(transport.fetch).toHaveBeenCalledWith(contractPath, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal,
  });
  expectGenericRequest(transport, 200);
});

it("keeps a correlation reference from the isolated generic contract's empty error body", async () => {
  const transport = genericResponse(
    new Response(null, {
      status: 503,
      headers: { "x-correlation-id": "read-42" },
    }),
  );
  expect(await requestAuthenticatedRead(contractPath)).toEqual({
    kind: "dependency_unavailable",
    reference: "read-42",
  });
  expectGenericRequest(transport, 503);
});

it.each([
  [403, "forbidden"],
  [404, "not_found"],
] as const)(
  "billing keeps a validated isolated generic rejection at HTTP %s",
  async (status, code) => {
    const { readBillingEndpoint } =
      await import("@/entities/subscription/api/billing-result.browser");
    const { z } = await import("zod");
    const transport = genericResponse(
      Response.json({ ok: false, code }, { status }),
    );
    expect(await readBillingEndpoint(contractPath, z.unknown())).toEqual({
      ok: false,
      code,
    });
    expectGenericRequest(transport, status);
  },
);
