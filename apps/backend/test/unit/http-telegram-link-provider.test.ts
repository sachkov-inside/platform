import { describe, expect, test, vi } from "vitest";

import { HttpTelegramLinkProvider } from "../../src/modules/telegram-membership/infrastructure/http/http-telegram-link-provider.js";

const endpoint =
  "https://telegram.example.test/integrations/platform/v1/identity-links";
const secret = "synthetic-telegram-linking-secret";

describe("HttpTelegramLinkProvider", () => {
  test("registers only the digest and parses the strict v1 challenge", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        contractVersion: "inside.identity-linking.v1",
        expiresAt: "2030-01-01T00:05:00.000Z",
        linkTransactionRef: "provider-link-ref-a",
        returnCorrelation: "return-ref-a",
        status: "pending",
      }),
    );
    const provider = new HttpTelegramLinkProvider(endpoint, secret, fetcher);

    await expect(
      provider.register({
        accountRef: "principal-ref-a",
        expiresAt: new Date("2030-01-01T00:05:00.000Z"),
        returnCorrelation: "return-ref-a",
        tokenDigest: "jKKh9RnjKMdeJyPGrUz3N7LTyO3qlo7dUNRlIji0Qk8",
      }),
    ).resolves.toEqual({
      expiresAt: new Date("2030-01-01T00:05:00.000Z"),
      kind: "registered",
      linkTransactionRef: "provider-link-ref-a",
      returnCorrelation: "return-ref-a",
    });
    const request = fetcher.mock.calls[0];
    expect(request?.[0]).toBe(endpoint);
    expect(request?.[1]).toMatchObject({ method: "POST" });
    expect(request?.[1]?.headers).toEqual({
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    });
    const requestBody = request?.[1]?.body;
    if (typeof requestBody !== "string") {
      throw new TypeError("Expected a JSON request body");
    }
    const body: unknown = JSON.parse(requestBody);
    expect(body).toEqual({
      accountRef: "principal-ref-a",
      contractVersion: "inside.identity-linking.v1",
      expiresAt: "2030-01-01T00:05:00.000Z",
      returnCorrelation: "return-ref-a",
      tokenDigest: "jKKh9RnjKMdeJyPGrUz3N7LTyO3qlo7dUNRlIji0Qk8",
    });
    expect(JSON.stringify(body)).not.toContain("start=");
  });

  test("confirms with the original opaque Account binding", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        contractVersion: "inside.identity-linking.v1",
        linkTransactionRef: "provider-link-ref-a",
        returnCorrelation: "return-ref-a",
        status: "linked",
        telegramIdentityRef: "telegram-identity-ref-a",
      }),
    );
    const provider = new HttpTelegramLinkProvider(endpoint, secret, fetcher);

    await expect(
      provider.confirm({
        accountRef: "principal-ref-a",
        linkTransactionRef: "provider-link-ref-a",
        returnCorrelation: "return-ref-a",
      }),
    ).resolves.toEqual({
      kind: "linked",
      linkTransactionRef: "provider-link-ref-a",
      returnCorrelation: "return-ref-a",
      telegramIdentityRef: "telegram-identity-ref-a",
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `${endpoint}/provider-link-ref-a/confirm`,
    );
  });

  test("maps transport, conflict and malformed responses to fail-closed states", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("connection failed"))
      .mockResolvedValueOnce(
        jsonResponse({
          contractVersion: "inside.identity-linking.v1",
          linkTransactionRef: "provider-link-ref-a",
          returnCorrelation: "return-ref-a",
          status: "recovery-required",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ contractVersion: "inside.identity-linking.v2" }),
      );
    const provider = new HttpTelegramLinkProvider(endpoint, secret, fetcher);
    const confirmation = {
      accountRef: "principal-ref-a",
      linkTransactionRef: "provider-link-ref-a",
      returnCorrelation: "return-ref-a",
    } as const;

    await expect(provider.confirm(confirmation)).resolves.toEqual({
      kind: "unavailable",
    });
    await expect(provider.confirm(confirmation)).resolves.toEqual({
      kind: "recovery_required",
    });
    await expect(provider.confirm(confirmation)).resolves.toEqual({
      kind: "recovery_required",
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}
