import { afterEach, describe, expect, test, vi } from "vitest";

import {
  telegramContactSearchRequestSchema,
  telegramContactsV2RequestSchema,
} from "@inside/contracts/telegram-contact-v2";
import corpus from "@inside/contracts/runtime/telegram-contact-v2.fixtures.json" with { type: "json" };
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

describe("Telegram contact v2 HTTP contract", () => {
  const provider = (fetcher: typeof fetch) =>
    new HttpTelegramContactsProvider(endpoint, "synthetic-secret", fetcher);
  const requestOf = (fetcher: ReturnType<typeof vi.fn<typeof fetch>>) => {
    const request = fetcher.mock.calls[0];
    const url = request?.[0];
    const body = request?.[1]?.body;
    if (typeof body !== "string")
      throw new TypeError("Expected a JSON request body");
    return {
      url:
        url instanceof URL ? url.href : url instanceof Request ? url.url : url,
      init: request?.[1],
      body: JSON.parse(body) as unknown,
    };
  };

  test.each(corpus.search.validResponses)(
    "searches the sibling v2 path with the normalized query: $case",
    async ({ body }) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(body));
      await expect(provider(fetcher).search("  @Анна ", 50)).resolves.toEqual({
        ok: true,
        matches: body.matches,
        truncated: body.truncated,
      });
      const request = requestOf(fetcher);
      expect(request.url).toBe(
        "https://telegram.example.test/integrations/platform/v2/telegram-contacts/search",
      );
      expect(request.init).toMatchObject({
        method: "POST",
        redirect: "error",
        headers: { authorization: "Bearer synthetic-secret" },
      });
      expect(request.init?.signal).toBeInstanceOf(AbortSignal);
      expect(request.body).toEqual({
        contractVersion: "inside.telegram-contact.v2",
        query: "Анна",
        limit: 50,
      });
    },
  );

  test("sends only requests the corpus accepts", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        Response.json({
          contractVersion: "inside.telegram-contact.v2",
          matches: [],
          truncated: false,
        }),
      ),
    );
    for (const valid of corpus.search.validRequests) {
      fetcher.mockClear();
      await provider(fetcher).search(valid.body.query, valid.body.limit);
      expect(
        telegramContactSearchRequestSchema.parse(requestOf(fetcher).body),
      ).toEqual({ ...valid.body, query: valid.normalizedQuery });
    }
  });

  test("a Telegram release without v2 answers 404: not supported, nothing logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 404 })),
      );
    await expect(provider(fetcher).search("анна", 10)).resolves.toEqual({
      ok: false,
      reason: "not_supported",
    });
    await expect(
      provider(fetcher).readWithMarketing(contacts),
    ).resolves.toEqual({ ok: false, reason: "not_supported" });
    expect(log).not.toHaveBeenCalled();
  });

  test.each([401, 503])(
    "HTTP %i is unavailable and the log carries neither the query nor the secret",
    async (status) => {
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status }));
      await expect(
        provider(fetcher).search("synthetic-private-query", 10),
      ).resolves.toEqual({ ok: false, reason: "unavailable" });
      expect(log).toHaveBeenCalledOnce();
      const line = String(log.mock.calls[0]?.[0]);
      expect(line).toContain(`HTTP ${String(status)}`);
      expect(line).not.toContain("synthetic-private-query");
      expect(line).not.toContain("synthetic-secret");
    },
  );

  test.each(corpus.search.invalidResponses)(
    "rejects a malformed search answer without logging it: $case",
    async ({ body }) => {
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(body));
      await expect(provider(fetcher).search("анна", 10)).resolves.toEqual({
        ok: false,
        reason: "unavailable",
      });
      expect(log).toHaveBeenCalledOnce();
      expect(String(log.mock.calls[0]?.[0])).not.toContain("anna_example");
    },
  );

  test("rejects more matches than requested", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const body = corpus.search.validResponses[0]?.body;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(body));
    await expect(provider(fetcher).search("анна", 1)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  test("never sends a query outside the contract", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(provider(fetcher).search("  @ ", 10)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("reads v2 contacts aligned with the request", async () => {
    const body = corpus.read.validResponses[0]?.body;
    if (body === undefined) throw new Error("Missing corpus response");
    const queries = body.contacts.map(
      ({ accountRef, telegramIdentityRef }) => ({
        accountRef,
        telegramIdentityRef,
      }),
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(Response.json(body)));
    await expect(provider(fetcher).readWithMarketing(queries)).resolves.toEqual(
      { ok: true, contacts: body.contacts },
    );
    const request = requestOf(fetcher);
    expect(request.url).toBe(
      "https://telegram.example.test/integrations/platform/v2/telegram-contacts/read",
    );
    expect(telegramContactsV2RequestSchema.parse(request.body)).toEqual({
      contractVersion: "inside.telegram-contact.v2",
      contacts: queries,
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      provider(fetcher).readWithMarketing([...queries].reverse()),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  test.each(corpus.read.invalidResponses)(
    "rejects a malformed v2 read answer: $case",
    async ({ body }) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(body));
      await expect(
        provider(fetcher).readWithMarketing(contacts),
      ).resolves.toEqual({ ok: false, reason: "unavailable" });
    },
  );
});
