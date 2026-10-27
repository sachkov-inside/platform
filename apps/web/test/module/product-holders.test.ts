import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({ token: vi.fn(), list: vi.fn() }));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestProductHolders: fakes.list,
  BackendConnectionError: class extends Error {},
}));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: fakes.token,
    baseUrl: () => "https://inside.example.test",
  },
  LogtoSessionUnavailableError: class extends Error {},
}));

import { handleProductHoldersRequest } from "@/features/product-holders/api/product-holders-route.server";
import { requestProductHolders } from "@/features/product-holders/api/product-holders.browser";
import {
  holdersAddressSearch,
  parseProductHoldersSearch,
  productHoldersSearch,
  readHoldersAddress,
} from "@/features/product-holders/model/product-holders";
import { productHoldersQueryOptions } from "@/features/product-holders/model/product-holders-query-options";

const productId = "20000000-0000-4000-8000-000000000001";
const accountId = "10000000-0000-4000-8000-000000000001";
const otherAccountId = "10000000-0000-4000-8000-000000000002";

const holder = {
  accountId,
  access: "active",
  firstIssuedAt: "2026-10-01T09:30:00.000Z",
  learning: {
    readCount: 12,
    totalCount: 40,
    startedAt: "2026-10-02T10:00:00.000Z",
    lastActivityAt: "2026-10-24T18:05:00.000Z",
  },
} as const;

function holdersRequest(search = "") {
  return new Request(
    `https://inside.example.test/api/authoring/products/${productId}/holders${search}`,
  );
}

function backendFailure(status: number, code: string) {
  return {
    ok: false,
    problem: { code, correlationId: `ref-${code}` },
    response: new Response(null, { status }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("trusted-token");
});

describe("holders BFF route", () => {
  it("reads one page privately and passes only the contract filters", async () => {
    fakes.list.mockResolvedValue({
      ok: true,
      body: {
        items: [{ ...holder, revision: 3 }],
        nextCursor: "next_page-1",
      },
      response: new Response(),
    });
    const response = await handleProductHoldersRequest(
      holdersRequest(
        `?cursor=abc_DEF-1&access=active&accountIds=${accountId}&accountIds=${otherAccountId}`,
      ),
      productId,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("vary")).toContain("cookie");
    expect(await response.json()).toEqual({
      kind: "ready",
      items: [holder],
      nextCursor: "next_page-1",
    });
    expect(fakes.list).toHaveBeenCalledWith(
      {
        productId,
        cursor: "abc_DEF-1",
        access: "active",
        accountIds: [accountId, otherAccountId],
      },
      "trusted-token",
    );
  });

  it.each([
    [403, "forbidden", 403, { kind: "forbidden" }],
    [404, "product_not_found", 404, { kind: "not_found" }],
    [400, "invalid_request", 400, { kind: "invalid_request" }],
  ])(
    "maps backend %s to its own outcome, never to an empty page",
    async (status, code, expectedStatus, body) => {
      fakes.list.mockResolvedValue(backendFailure(status, code));
      const response = await handleProductHoldersRequest(
        holdersRequest(),
        productId,
      );
      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get("cache-control")).toBe("no-store, private");
      expect(await response.json()).toEqual(body);
    },
  );

  it("answers an unavailable owner as a dependency failure", async () => {
    fakes.list.mockResolvedValue(backendFailure(503, "dependency_unavailable"));
    const response = await handleProductHoldersRequest(
      holdersRequest(),
      productId,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(await response.json()).toEqual({ kind: "dependency_unavailable" });
  });

  it("does not pass on a body outside the contract", async () => {
    fakes.list.mockResolvedValue({
      ok: true,
      body: { items: [{ ...holder, email: "reader@example.test" }] },
      response: new Response(),
    });
    const response = await handleProductHoldersRequest(
      holdersRequest(),
      productId,
    );
    expect(response.status).toBe(503);
  });

  it.each([
    ["an unknown parameter", "?search=anna"],
    ["a broken cursor", "?cursor=a%20b"],
    ["an account that is not an id", "?accountIds=anna"],
    [
      "more than 50 accounts",
      `?${Array.from({ length: 51 }, () => `accountIds=${accountId}`).join("&")}`,
    ],
  ])("refuses %s before the backend", async (_name, search) => {
    const response = await handleProductHoldersRequest(
      holdersRequest(search),
      productId,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ kind: "invalid_request" });
    expect(fakes.list).not.toHaveBeenCalled();
  });
});

describe("holders browser adapter", () => {
  it("keeps a refusal a refusal", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(Response.json({ kind: "forbidden" }, { status: 403 })),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      requestProductHolders(
        { productId, accountIds: [accountId] },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ kind: "forbidden" });
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/authoring/products/${productId}/holders?accountIds=${accountId}`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("reads a ready page and treats a broken one as unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({ kind: "ready", items: [holder], nextCursor: null }),
        ),
      ),
    );
    await expect(
      requestProductHolders({ productId }, new AbortController().signal),
    ).resolves.toEqual({ kind: "ready", items: [holder], nextCursor: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ kind: "ready" }))),
    );
    await expect(
      requestProductHolders({ productId }, new AbortController().signal),
    ).resolves.toEqual({
      kind: "unavailable",
      reference: "malformed-response",
    });
  });
});

describe("holders address and query", () => {
  it("keeps the page and filter in the product page address", () => {
    expect(
      readHoldersAddress(
        new URLSearchParams("tab=learners&cursor=abc_1&access=revoked"),
      ),
    ).toEqual({ cursor: "abc_1", access: "revoked" });
    // A value that is not ours opens the first page unfiltered.
    expect(
      readHoldersAddress(new URLSearchParams("cursor=a b&access=all")),
    ).toEqual({});
  });

  it("writes the tab, page and filter and keeps other parameters", () => {
    expect(
      holdersAddressSearch("from=%2Fauthoring&tab=sale", {
        cursor: "abc_1",
      }),
    ).toBe("?from=%2Fauthoring&tab=learners&cursor=abc_1");
    // A filter change starts from the first page: the cursor belongs to the old filter.
    expect(
      holdersAddressSearch("tab=learners&cursor=abc_1", { access: "active" }),
    ).toBe("?tab=learners&access=active");
    expect(
      holdersAddressSearch("tab=learners&cursor=abc_1&access=active", {}),
    ).toBe("?tab=learners");
  });

  it("round-trips a read through the BFF address", () => {
    const query = {
      productId,
      cursor: "abc_1",
      access: "active",
      accountIds: [accountId, otherAccountId],
    } as const;
    expect(
      parseProductHoldersSearch(
        productId,
        new URLSearchParams(productHoldersSearch(query)),
      ),
    ).toEqual(query);
  });

  it("keys every page and pre-check under one Product prefix", () => {
    const first = productHoldersQueryOptions({ productId }).queryKey;
    const next = productHoldersQueryOptions({
      productId,
      cursor: "abc_1",
    }).queryKey;
    const precheck = productHoldersQueryOptions({
      productId,
      accountIds: [accountId],
    }).queryKey;
    expect(first).not.toEqual(next);
    expect(next).not.toEqual(precheck);
    for (const key of [first, next, precheck])
      expect(key.slice(0, 3)).toEqual([
        "authoring",
        "product-holders",
        productId,
      ]);
  });
});
