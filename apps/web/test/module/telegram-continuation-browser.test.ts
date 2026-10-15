import { afterEach, describe, expect, it, vi } from "vitest";
import { requestTelegramContinuation } from "@/_pages/telegram-continuation/api/telegram-continuation.browser";

afterEach(() => vi.unstubAllGlobals());
describe("Telegram continuation authenticated browser read", () => {
  for (const kind of [
    "identity_unavailable",
    "dependency_unavailable",
  ] as const) {
    it(`preserves ${kind} and its diagnostic reference`, async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json(
            { kind },
            {
              status: 503,
              headers: { "x-correlation-id": "read-reference" },
            },
          ),
        ),
      );
      expect(await requestTelegramContinuation("attempt")).toEqual({
        state: kind,
        reference: "read-reference",
      });
    });
  }
  it("preserves missing authentication", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );
    expect(await requestTelegramContinuation("attempt")).toEqual({
      state: "unauthorized",
    });
  });
  it("validates ready Product data and forwards cancellation", async () => {
    const value = {
      state: "pending",
      product: {
        id: "11111111-1111-4111-8111-111111111111",
        slug: "ai-engineering",
        name: "AI Engineering",
      },
    };
    const fetch = vi.fn().mockResolvedValue(Response.json(value));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect(await requestTelegramContinuation("attempt", signal)).toEqual(value);
    expect(fetch).toHaveBeenCalledWith(
      "/api/account/telegram-activation/attempt",
      expect.objectContaining({
        signal,
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });
  it("rejects malformed ready data without treating it as a Product", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ state: "active" })),
    );
    expect(await requestTelegramContinuation("attempt")).toEqual({
      state: "dependency_unavailable",
      reference: "telegram-continuation-contract",
    });
  });
  it("preserves business identity conflicts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ state: "identity_conflict" })),
    );
    expect(await requestTelegramContinuation("attempt")).toEqual({
      state: "identity_conflict",
    });
  });
  it("normalizes network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await requestTelegramContinuation("attempt")).toEqual({
      state: "dependency_unavailable",
    });
  });
});
