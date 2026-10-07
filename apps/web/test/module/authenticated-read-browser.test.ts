import { expect, it, vi } from "vitest";
import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";

it.each([
  [401, { kind: "authentication_required" }],
  [503, { kind: "identity_unavailable" }],
  [503, { kind: "dependency_unavailable" }],
  [502, null],
] as const)(
  "decodes the shared read failure at HTTP %s",
  async (status, body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(body, { status })),
    );
    expect(await requestAuthenticatedRead("/api/account/presentation")).toEqual(
      body ?? { kind: "rejected", status: 502, body: null },
    );
  },
);

it("passes a successful body as unknown for the feature schema and forwards cancellation", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ profile: "reader" }));
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal;
  expect(
    await requestAuthenticatedRead("/api/account/presentation", signal),
  ).toEqual({ kind: "ready", value: { profile: "reader" } });
  expect(fetch).toHaveBeenCalledWith("/api/account/presentation", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal,
  });
});

it("keeps a backend correlation reference even when its error body is empty", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(null, {
        status: 503,
        headers: { "x-correlation-id": "read-42" },
      }),
    ),
  );
  expect(await requestAuthenticatedRead("/api/account")).toEqual({
    kind: "dependency_unavailable",
    reference: "read-42",
  });
});

it("lets billing retain a validated forbidden outcome from its read capability", async () => {
  const { readBillingEndpoint } =
    await import("@/entities/subscription/api/billing-result.browser");
  const { z } = await import("zod");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ ok: false, code: "forbidden" }, { status: 403 }),
      ),
  );
  expect(
    await readBillingEndpoint("/api/account/billing/current", z.unknown()),
  ).toEqual({ ok: false, code: "forbidden" });
});

it.each([
  [403, "forbidden"],
  [404, "not_found"],
  [409, "link_required"],
] as const)(
  "communications keeps a feature rejection at HTTP %s",
  async (status, code) => {
    const { readBroadcasts, readBroadcast } =
      await import("@/_pages/communications/api/broadcasts.browser");
    const failure = { kind: "error", code };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(Response.json(failure, { status })),
        ),
    );
    expect(await readBroadcasts()).toEqual(failure);
    expect(await readBroadcast("missing-broadcast")).toEqual(failure);
  },
);
