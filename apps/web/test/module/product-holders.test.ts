import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as productHoldersRoute } from "../../app/api/authoring/products/[productId]/holders/route";
import { realBffSession } from "../support/real-bff-session";
import { interceptBackendHttp } from "../support/backend-http";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let scope: Awaited<ReturnType<typeof realBffSession>>;
let expectedBackendReads = 0;
let controller: AbortController;
import { handleProductHoldersRequest as realHandleProductHoldersRequest } from "@/features/product-holders/api/product-holders-route.server";
import { requestProductHolders } from "@/features/product-holders/api/product-holders.browser";
import {
  holdersAddressSearch,
  parseProductHoldersSearch,
  productHoldersSearch,
  readHoldersAddress,
} from "@/features/product-holders/model/product-holders";
import { productHoldersQueryOptions } from "@/features/product-holders/model/product-holders-query-options";

const handleProductHoldersRequest = (request: Request, id: string) =>
  scope(() => realHandleProductHoldersRequest(request, id));
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

const expectedHolder = {
  accountId: "10000000-0000-4000-8000-000000000001",
  access: "active",
  firstIssuedAt: "2026-10-01T09:30:00.000Z",
  learning: {
    readCount: 12,
    totalCount: 40,
    startedAt: "2026-10-02T10:00:00.000Z",
    lastActivityAt: "2026-10-24T18:05:00.000Z",
  },
};

function holdersRequest(search = "") {
  return new Request(
    `https://inside.example.test/api/authoring/products/${productId}/holders${search}`,
  );
}

function replyBackend(body: unknown, status = 200): void {
  expectedBackendReads += 1;
  backend.mockResolvedValueOnce(Response.json(body, { status }));
}

beforeEach(async () => {
  backend.mockReset();
  expectedBackendReads = 0;
  controller = new AbortController();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  scope = await realBffSession();
  interceptBackendHttp(backend);
});
afterEach(() => {
  controller.abort();
  vi.useRealTimers();
  expect(backend).toHaveBeenCalledTimes(expectedBackendReads);
  for (const [request] of backend.mock.calls) {
    const url = new URL(request.url);
    expect(url.origin).toBe("https://platform-api.example.test");
    expect(url.pathname).toBe(
      "/admin/products/20000000-0000-4000-8000-000000000001/holders",
    );
    expect(request.method).toBe("GET");
    expect(request.body).toBeNull();
    expect(request.headers.get("authorization")).toBe("Bearer trusted-token");
  }
});

describe("holders BFF route", () => {
  it("reads one page privately and passes only the contract filters", async () => {
    replyBackend({
      items: [{ ...holder, revision: 3 }],
      nextCursor: "next_page-1",
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
      items: [expectedHolder],
      nextCursor: "next_page-1",
    });
    const outgoing = backend.mock.calls[0]?.[0];
    if (outgoing === undefined) throw new Error("Expected holder HTTP request");
    const params = new URL(outgoing.url).searchParams;
    expect(Array.from(new Set(params.keys())).sort()).toEqual([
      "access",
      "accountIds",
      "cursor",
    ]);
    expect(params.get("cursor")).toBe("abc_DEF-1");
    expect(params.get("access")).toBe("active");
    expect(params.getAll("accountIds")).toEqual([
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
    ]);
  });

  it.each([
    [403, "forbidden", 403, { kind: "forbidden" }],
    [404, "product_not_found", 404, { kind: "not_found" }],
    [400, "invalid_request", 400, { kind: "invalid_request" }],
  ])(
    "maps backend %s to its own outcome, never to an empty page",
    async (status, code, expectedStatus, body) => {
      replyBackend({ code, correlationId: `ref-${code}` }, status);
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
    replyBackend(
      {
        code: "dependency_unavailable",
        correlationId: "ref-dependency_unavailable",
      },
      503,
    );
    const response = await handleProductHoldersRequest(
      holdersRequest(),
      productId,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(await response.json()).toEqual({ kind: "dependency_unavailable" });
  });

  it("does not pass on a body outside the contract", async () => {
    replyBackend({ items: [{ ...holder, email: "reader@example.test" }] });
    const response = await handleProductHoldersRequest(
      holdersRequest(),
      productId,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ kind: "dependency_unavailable" });
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
    expect(backend).not.toHaveBeenCalled();
  });
});

describe("holders browser adapter", () => {
  it("keeps a refusal from the real handler a refusal", async () => {
    replyBackend({ code: "forbidden" }, 403);
    const bridge = routeHoldersRead(`?accountIds=${accountId}`);
    await expect(
      requestProductHolders(
        { productId, accountIds: [accountId] },
        controller.signal,
      ),
    ).resolves.toEqual({ kind: "forbidden" });
    expect(bridge.fetch).toHaveBeenCalledWith(
      `/api/authoring/products/${productId}/holders?accountIds=${accountId}`,
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(bridge.statuses).toEqual([403]);
    expect(bridge.corruptions()).toBe(0);
  });

  it("reads a validated ready page through the real route without transport corruption", async () => {
    replyBackend({ items: [{ ...holder, revision: 3 }], nextCursor: null });
    const bridge = routeHoldersRead();
    await expect(
      requestProductHolders({ productId }, controller.signal),
    ).resolves.toEqual({
      kind: "ready",
      items: [expectedHolder],
      nextCursor: null,
    });
    expect(bridge.statuses).toEqual([200]);
    expect(bridge.corruptions()).toBe(0);
  });

  it("rejects a malformed successful wire response after a validated real handler response (transport corruption)", async () => {
    replyBackend({ items: [{ ...holder, revision: 3 }], nextCursor: null });
    const bridge = routeHoldersRead("", "missing-items");
    await expect(
      requestProductHolders({ productId }, controller.signal),
    ).resolves.toEqual({
      kind: "unavailable",
      reference: "malformed-response",
    });
    expect(bridge.statuses).toEqual([200]);
    expect(bridge.corruptions()).toBe(1);
    expect(
      bridge.requests.map((request) => ({
        method: request.method,
        url: request.url,
      })),
    ).toEqual([
      {
        method: "GET",
        url: "https://inside.example.test/api/authoring/products/20000000-0000-4000-8000-000000000001/holders",
      },
    ]);
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

/** Only this exact holders read may receive the named, post-handler wire fault. */
function routeHoldersRead(search = "", transportCorruption?: "missing-items") {
  const statuses: number[] = [];
  const requests: Request[] = [];
  let corruptions = 0;
  const expectedUrl = `https://inside.example.test/api/authoring/products/${productId}/holders${search}`;
  const fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(
        input instanceof Request
          ? input
          : new URL(input.toString(), "https://inside.example.test"),
        init,
      );
      if (new URL(request.url).origin === "https://platform-api.example.test") {
        expect(request.method).toBe("GET");
        expect(new URL(request.url).pathname).toBe(
          "/admin/products/20000000-0000-4000-8000-000000000001/holders",
        );
        expect(new URL(request.url).search).toBe(search);
        return backend(request);
      }
      expect(request.method).toBe("GET");
      expect(request.url).toBe(expectedUrl);
      requests.push(request.clone());
      const response = await scope(() =>
        productHoldersRoute(request, {
          params: Promise.resolve({ productId }),
        }),
      );
      statuses.push(response.status);
      if (transportCorruption === undefined) return response;
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        kind: "ready",
        items: [expectedHolder],
        nextCursor: null,
      });
      expect(response.bodyUsed).toBe(true);
      corruptions += 1;
      return new Response('{"kind":"ready"}', {
        status: response.status,
        headers: response.headers,
      });
    },
  );
  vi.stubGlobal("fetch", fetch);
  return { fetch, requests, statuses, corruptions: () => corruptions };
}
