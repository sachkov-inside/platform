import { afterEach, describe, expect, test, vi } from "vitest";

import { HttpTelegramContactsProvider } from "../../src/modules/telegram-membership/infrastructure/http/http-telegram-contacts-provider.js";

const endpoint =
  "https://telegram.example.test/integrations/platform/v1/identity-links";
const contacts = [
  {
    accountRef: "synthetic-account",
    telegramIdentityRef: "synthetic-identity",
  },
];

afterEach(() => vi.restoreAllMocks());

describe("Telegram contact HTTP contract", () => {
  test("reads the authenticated sibling endpoint and parses the versioned projection", async () => {
    const answer = contacts.map((contact) => ({
      ...contact,
      status: "available",
      displayName: "Synthetic learner",
      username: null,
    }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        contractVersion: "inside.telegram-contact.v1",
        contacts: answer,
      }),
    );
    const provider = new HttpTelegramContactsProvider(
      endpoint,
      "synthetic-secret",
      fetcher,
    );
    await expect(provider.read(contacts)).resolves.toEqual({
      ok: true,
      contacts: answer,
    });
    const request = fetcher.mock.calls[0];
    const url = request?.[0];
    expect(
      url instanceof URL ? url.href : url instanceof Request ? url.url : url,
    ).toBe(
      "https://telegram.example.test/integrations/platform/v1/telegram-contacts",
    );
    expect(request?.[1]).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        authorization: "Bearer synthetic-secret",
        "content-type": "application/json",
      },
    });
    expect(request?.[1]?.signal).toBeInstanceOf(AbortSignal);
    const body = request?.[1]?.body;
    if (typeof body !== "string")
      throw new TypeError("Expected a JSON request body");
    expect(JSON.parse(body)).toEqual({
      contractVersion: "inside.telegram-contact.v1",
      contacts,
    });
  });

  test.each([401, 503, 404])(
    "HTTP %i keeps submissions available and records unexpected failures",
    async (status) => {
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status }));
      await expect(
        new HttpTelegramContactsProvider(
          endpoint,
          "synthetic-secret",
          fetcher,
        ).read(contacts),
      ).resolves.toEqual({ ok: false });
      if (status === 404) expect(log).not.toHaveBeenCalled();
      else {
        expect(log).toHaveBeenCalledOnce();
        expect(String(log.mock.calls[0]?.[0])).toContain(
          `HTTP ${String(status)}`,
        );
        expect(String(log.mock.calls[0]?.[0])).not.toContain(
          "synthetic-secret",
        );
        expect(String(log.mock.calls[0]?.[0])).not.toContain(
          "synthetic-account",
        );
      }
    },
  );

  test("rejects a malformed answer without logging its personal data", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        contractVersion: "inside.telegram-contact.v1",
        contacts: [{ privateData: "synthetic-private-data" }],
      }),
    );
    await expect(
      new HttpTelegramContactsProvider(
        endpoint,
        "synthetic-secret",
        fetcher,
      ).read(contacts),
    ).resolves.toEqual({ ok: false });
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]?.[0])).toContain("ZodError");
    expect(String(log.mock.calls[0]?.[0])).not.toContain(
      "synthetic-private-data",
    );
  });
});
