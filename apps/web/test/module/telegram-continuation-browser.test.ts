import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestTelegramContinuation } from "@/_pages/telegram-continuation/api/telegram-continuation.browser";
import { GET } from "../../app/api/account/telegram-activation/[attemptId]/route";
import { realBffSession } from "../support/real-bff-session";
import { routeBrowserMutations } from "../support/mutation-operation-route";
import { useProductionRuntimeImage } from "../support/web-runtime";

const path = "/api/account/telegram-activation/attempt";
const origin = "https://inside.example.test";
const pending = {
  state: "pending",
  product: {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "ai-engineering",
    name: "AI Engineering",
  },
};
type Fault =
  | "identity_unavailable"
  | "dependency_unavailable"
  | "malformed-ready"
  | "offline-ready";
let scope: Awaited<ReturnType<typeof realBffSession>>;
let cleanupImage: () => void;
let backendReply: { body: unknown; status: number };
let backendRequests: Request[];
let identityRequests: Request[];
let originalReferences: (string | null)[];
let unexpectedRequests: string[];
let bridge: ReturnType<typeof routeBrowserMutations>;
let deliveries: {
  status: number;
  body: unknown;
  bodyUsed: boolean;
  referenceBefore: string | null;
  referenceAfter: string | null;
}[];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
  cleanupImage = useProductionRuntimeImage();
  scope = await realBffSession();
  backendReply = { body: pending, status: 200 };
  backendRequests = [];
  identityRequests = [];
  originalReferences = [];
  unexpectedRequests = [];
  deliveries = [];
});
afterEach(() => {
  cleanupImage();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  expect(unexpectedRequests).toEqual([]);
  for (const request of bridge.requests) {
    expect(request.method).toBe("GET");
    expect(request.url).toBe(`${origin}${path}`);
  }
  for (const request of backendRequests) {
    expect(request.method).toBe("GET");
    expect(request.url).toBe(
      "https://platform-api.example.test/accounts/current/telegram-activation/attempt",
    );
    expect(request.headers.get("authorization")).toBe("Bearer trusted-token");
  }
  for (const request of identityRequests) {
    expect(request.method).toBe("GET");
    expect(request.url).toBe(
      "https://identity.example.test/oidc/.well-known/openid-configuration",
    );
  }
});

function connectTelegramWire(fault?: Fault) {
  bridge = routeBrowserMutations(
    {
      [path]: {
        GET: (request) =>
          GET(request, { params: Promise.resolve({ attemptId: "attempt" }) }),
      },
    },
    origin,
    {
      run: (handler) =>
        scope(async () => {
          const response = await handler();
          originalReferences.push(response.headers.get("x-correlation-id"));
          return response;
        }),
      externalFetch: (request) => {
        if (
          request.url ===
            "https://identity.example.test/oidc/.well-known/openid-configuration" &&
          request.method === "GET"
        ) {
          identityRequests.push(request);
          return Promise.reject(new Error("private identity provider outage"));
        }
        if (
          request.url ===
            "https://platform-api.example.test/accounts/current/telegram-activation/attempt" &&
          request.method === "GET"
        ) {
          backendRequests.push(request);
          return Promise.resolve(
            Response.json(backendReply.body, {
              status: backendReply.status,
            }),
          );
        }
        unexpectedRequests.push(`${request.method} ${request.url}`);
        return Promise.reject(new Error("Unexpected external service request"));
      },
    },
  );
  if (fault === undefined) return;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(
        input instanceof Request ? input : new URL(input, origin),
        init,
      );
      // deterministic-test-allow unit-io: #2292, audit2 worker 7e1496b5; this bridge calls real handlers in process, with only the named, validated wire faults below.
      const response = await bridge.fetch(input, init);
      if (new URL(request.url).origin !== origin) return response;
      if (request.method !== "GET" || request.url !== `${origin}${path}`) {
        unexpectedRequests.push(`${request.method} ${request.url}`);
        await response.body?.cancel();
        throw new Error("Unexpected Telegram wire fault request");
      }
      const bytes = await response.arrayBuffer();
      const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
      const referenceBefore = response.headers.get("x-correlation-id");
      if (
        fault === "identity_unavailable" ||
        fault === "dependency_unavailable"
      ) {
        expect(response.status).toBe(503);
        expect(body).toEqual({ kind: fault });
        expect(referenceBefore).toBeNull();
        const headers = new Headers(response.headers);
        headers.set("x-correlation-id", "read-reference");
        const delivered = new Response(bytes, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
        deliveries.push({
          status: response.status,
          body,
          bodyUsed: response.bodyUsed,
          referenceBefore,
          referenceAfter: delivered.headers.get("x-correlation-id"),
        });
        return delivered;
      }
      expect(response.status).toBe(200);
      expect(body).toEqual({
        state: "pending",
        product: {
          id: "11111111-1111-4111-8111-111111111111",
          slug: "ai-engineering",
          name: "AI Engineering",
        },
      });
      deliveries.push({
        status: response.status,
        body,
        bodyUsed: response.bodyUsed,
        referenceBefore,
        referenceAfter: referenceBefore,
      });
      if (fault === "offline-ready")
        throw new TypeError("synthetic transport delivery interrupted");
      return Response.json(
        { state: "active" },
        { status: response.status, headers: response.headers },
      );
    },
  );
}

async function failRead(
  kind: "identity_unavailable" | "dependency_unavailable",
) {
  if (kind === "identity_unavailable")
    scope = await realBffSession({ refreshToken: "expired-telegram-browser" });
  else backendReply = { status: 503, body: { error: "backend unavailable" } };
}

function expectFailureService(
  kind: "identity_unavailable" | "dependency_unavailable",
) {
  if (kind === "identity_unavailable") {
    expect(identityRequests).toHaveLength(1);
    expect(backendRequests).toHaveLength(0);
  } else {
    expect(identityRequests).toHaveLength(0);
    expect(backendRequests).toHaveLength(1);
  }
}

describe("Telegram continuation authenticated browser read", () => {
  for (const kind of [
    "identity_unavailable",
    "dependency_unavailable",
  ] as const) {
    it(`preserves ${kind} and its diagnostic reference under named synthetic wire metadata fault`, async () => {
      await failRead(kind);
      connectTelegramWire(kind);
      expect(await requestTelegramContinuation("attempt")).toEqual({
        state: kind,
        reference: "read-reference",
      });
      expect(deliveries).toEqual([
        {
          status: 503,
          body: { kind },
          bodyUsed: true,
          referenceBefore: null,
          referenceAfter: "read-reference",
        },
      ]);
      expect(bridge.statuses).toEqual([503]);
      expectFailureService(kind);
    });
    it(`preserves the ordinary real ${kind} without a diagnostic header`, async () => {
      await failRead(kind);
      connectTelegramWire();
      expect(await requestTelegramContinuation("attempt")).toEqual({
        state: kind,
      });
      expect(bridge.statuses).toEqual([503]);
      expect(deliveries).toHaveLength(0);
      expect(originalReferences).toEqual([null]);
      expectFailureService(kind);
    });
  }
  it("preserves missing authentication", async () => {
    scope = await realBffSession(null);
    connectTelegramWire();
    expect(await requestTelegramContinuation("attempt")).toEqual({
      state: "unauthorized",
    });
    expect(bridge.statuses).toEqual([401]);
    expect(backendRequests).toHaveLength(0);
  });
  it("validates ready Product data and forwards cancellation", async () => {
    connectTelegramWire();
    const signal = new AbortController().signal;
    expect(await requestTelegramContinuation("attempt", signal)).toEqual({
      state: "pending",
      product: {
        id: "11111111-1111-4111-8111-111111111111",
        slug: "ai-engineering",
        name: "AI Engineering",
      },
    });
    expect(bridge.fetch).toHaveBeenCalledWith(
      path,
      expect.objectContaining({
        signal,
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    expect(bridge.statuses).toEqual([200]);
    expect(backendRequests).toHaveLength(1);
  });
  it("rejects malformed ready data under named synthetic wire corruption", async () => {
    connectTelegramWire("malformed-ready");
    expect(await requestTelegramContinuation("attempt")).toEqual({
      state: "dependency_unavailable",
      reference: "telegram-continuation-contract",
    });
    expect(deliveries).toHaveLength(1);
    expect(bridge.statuses).toEqual([200]);
    expect(backendRequests).toHaveLength(1);
  });
  it("keeps malformed external backend data separate from wire corruption", async () => {
    backendReply = { status: 200, body: { state: "active" } };
    connectTelegramWire();
    expect(await requestTelegramContinuation("attempt")).toEqual({
      state: "dependency_unavailable",
    });
    expect(bridge.statuses).toEqual([503]);
    expect(deliveries).toHaveLength(0);
    expect(backendRequests).toHaveLength(1);
  });
  it("preserves business identity conflicts", async () => {
    backendReply = { status: 200, body: { state: "identity_conflict" } };
    connectTelegramWire();
    expect(await requestTelegramContinuation("attempt")).toEqual({
      state: "identity_conflict",
    });
    expect(bridge.statuses).toEqual([200]);
    expect(backendRequests).toHaveLength(1);
  });
  it("normalizes network failure under named synthetic interrupted delivery", async () => {
    connectTelegramWire("offline-ready");
    expect(await requestTelegramContinuation("attempt")).toEqual({
      state: "dependency_unavailable",
    });
    expect(deliveries).toHaveLength(1);
    expect(bridge.statuses).toEqual([200]);
    expect(backendRequests).toHaveLength(1);
  });
});
