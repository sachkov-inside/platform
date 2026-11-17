import { z } from "zod";
import { cookies } from "next/headers";
import { afterEach, beforeEach, expect, test as runTest, vi } from "vitest";
import { realBffSession } from "../support/real-bff-session";
import { interceptBackendHttp } from "../support/backend-http";
import {
  commerceScenario,
  commerceFixtureFacts,
} from "../../../../scenarios/commerce.mjs";
import { WAITLIST_INTENT_COOKIE } from "@/features/product-waitlist.intent.server";
import {
  beginWaitlistSignIn,
  finishWaitlistSignIn,
} from "@/features/product-waitlist.sign-in.server";
import {
  handleWaitlistIntent,
  handleWaitlistJoin,
  handleWaitlistRead,
} from "@/_pages/library-discovery/api/product-waitlist-route.server";
const productId = commerceScenario.product.id;
const intakeId = commerceScenario.waitlist.intakeId;
const accountId = commerceFixtureFacts.buyerAccountId;
function request(source?: string, origin = "https://inside.example.test") {
  return new Request(
    "https://inside.example.test/api/product-waitlist/intent",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        ...(authCookieHeader === null ? {} : { cookie: authCookieHeader }),
      },
      body: JSON.stringify({
        productId,
        productSlug: commerceScenario.product.slug,
        source,
      }),
    },
  );
}
let authCookieHeader: string | null;
let authenticatedCookie: string;
let currentAccountId: string;
let joinFailure: { code: string; status: number } | null;
const backend = vi.fn<(request: Request) => Promise<Response>>();
const unexpected: string[] = [];
const intake = { intakeId, name: commerceScenario.waitlist.name };
function test(name: string, run: () => Promise<void>): void {
  runTest(name, async () => {
    const scope = await realBffSession();
    if (scope.cookieHeader === null)
      throw new Error("Expected real encrypted session cookie");
    authenticatedCookie = scope.cookieHeader;
    authCookieHeader = authenticatedCookie;
    await scope(run);
  });
}
async function guest(): Promise<void> {
  (await cookies()).delete("logto_web-module-integration");
  authCookieHeader = null;
}
async function signIn(): Promise<void> {
  const value = authenticatedCookie.slice(
    "logto_web-module-integration=".length,
  );
  (await cookies()).set("logto_web-module-integration", value);
  authCookieHeader = authenticatedCookie;
}
function joins(): Request[] {
  return backend.mock.calls
    .map(([request]) => request)
    .filter(
      (request) => new URL(request.url).pathname === "/product-waitlists/join",
    );
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
  currentAccountId = accountId;
  joinFailure = null;
  unexpected.length = 0;
  backend.mockReset();
  backend.mockImplementation((request) => {
    const path = new URL(request.url).pathname;
    switch (path) {
      case `/product-waitlists/${productId}/intake`:
        return Promise.resolve(Response.json(intake));
      case `/product-waitlists/${productId}/membership`:
        return Promise.resolve(Response.json({ ...intake, active: false }));
      case "/accounts/current":
        return Promise.resolve(
          Response.json({ account: { accountId: currentAccountId } }),
        );
      case "/product-waitlists/join": {
        const failure = joinFailure;
        joinFailure = null;
        return Promise.resolve(
          failure === null
            ? Response.json({ ...intake, active: true })
            : Response.json({ code: failure.code }, { status: failure.status }),
        );
      }
      default:
        unexpected.push(request.url);
        return Promise.reject(
          new Error(`Unexpected backend request ${request.url}`),
        );
    }
  });
  interceptBackendHttp(backend);
});
afterEach(() => {
  try {
    expect(unexpected).toEqual([]);
    for (const [request] of backend.mock.calls) {
      const url = new URL(request.url);
      expect(url.origin).toBe("https://platform-api.example.test");
      expect(url.search).toBe("");
      const publicIntake =
        url.pathname === `/product-waitlists/${productId}/intake`;
      expect(request.headers.get("authorization")).toBe(
        publicIntake ? null : "Bearer trusted-token",
      );
      expect(request.method).toBe(
        url.pathname === "/product-waitlists/join" ? "POST" : "GET",
      );
      if (request.method === "GET") expect(request.body).toBeNull();
    }
  } finally {
    vi.useRealTimers();
  }
});
test("ordinary sign-in and a fabricated return address never create a membership", async () => {
  expect(await (await handleWaitlistJoin(request())).json()).toEqual({
    kind: "expired",
  });
  expect(joins()).toHaveLength(0);
});
test("explicit guest intent retains source through sign-in and consumes only after durable confirmation", async () => {
  await guest();
  const started = z
    .object({ kind: z.literal("sign-in"), returnTo: z.string() })
    .parse(await (await handleWaitlistIntent(request("youtube"))).json());
  expect(started).toMatchObject({ kind: "sign-in" });
  await signIn();
  expect(await (await handleWaitlistJoin(request())).json()).toEqual({
    kind: "expired",
  });
  await beginWaitlistSignIn(started.returnTo);
  await finishWaitlistSignIn(started.returnTo, "trusted-token");
  expect(joins()).toHaveLength(0);
  const read = await handleWaitlistRead(
    new Request(
      `https://inside.example.test/api/product-waitlist?productId=${productId}`,
    ),
  );
  expect(await read.json()).toMatchObject({
    kind: "ready",
    active: false,
    continuation: true,
    accountId: "97000000-0000-4000-8000-000000000502",
  });
  expect(await (await handleWaitlistJoin(request())).json()).toMatchObject({
    kind: "saved",
    active: true,
  });
  expect(await joins()[0]?.clone().json()).toMatchObject({
    intakeId: "97000000-0000-4000-8000-000000000301",
    source: "youtube",
  });
  expect(joins()[0]?.headers.get("authorization")).toBe("Bearer trusted-token");
  expect(await (await handleWaitlistJoin(request())).json()).toEqual({
    kind: "expired",
  });
  expect(joins()).toHaveLength(1);
});
test("email Account links Telegram to that Account and preserves pending source; failure is never success", async () => {
  await handleWaitlistIntent(request("channel"));
  joinFailure = { code: "telegram_required", status: 409 };
  expect(await (await handleWaitlistJoin(request())).json()).toEqual({
    kind: "telegram-required",
  });
  expect((await cookies()).has(WAITLIST_INTENT_COOKIE)).toBe(true);
  expect(await (await handleWaitlistJoin(request())).json()).toMatchObject({
    kind: "saved",
    active: true,
  });
  expect(await joins()[1]?.clone().json()).toMatchObject({
    intakeId: "97000000-0000-4000-8000-000000000301",
    source: "channel",
  });
});
test("cross-origin and Account switching reject a pending continuation", async () => {
  expect(
    (await handleWaitlistIntent(request("channel", "https://foreign.test")))
      .status,
  ).toBe(403);
  expect((await cookies()).has(WAITLIST_INTENT_COOKIE)).toBe(false);
  await handleWaitlistIntent(request("channel"));
  currentAccountId = "10000000-0000-4000-8000-000000000004";
  expect(await (await handleWaitlistJoin(request())).json()).toEqual({
    kind: "expired",
  });
  expect(joins()).toHaveLength(0);
});
test("server errors retain retryable intent and never claim durable success", async () => {
  await handleWaitlistIntent(request());
  joinFailure = { code: "dependency_unavailable", status: 503 };
  expect(await (await handleWaitlistJoin(request())).json()).toEqual({
    kind: "unavailable",
  });
  expect((await cookies()).has(WAITLIST_INTENT_COOKIE)).toBe(true);
});

test("ordinary new sign-in cancels an abandoned guest intent instead of later completing it", async () => {
  await guest();
  await handleWaitlistIntent(request("youtube"));
  await beginWaitlistSignIn("https://inside.example.test/");
  await signIn();
  expect(await (await handleWaitlistJoin(request())).json()).toEqual({
    kind: "expired",
  });
  expect(joins()).toHaveLength(0);
});

test("an explicit intake continuation returns to its own Product without a special course slug", async () => {
  await guest();
  const result = await handleWaitlistIntent(
    new Request("https://inside.example.test/api/product-waitlist/intent", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://inside.example.test",
      },
      body: JSON.stringify({
        productId,
        productSlug: "systems-design",
        source: "youtube",
      }),
    }),
  );
  const body = z.object({ returnTo: z.string() }).parse(await result.json());
  expect(body.returnTo).toMatch(/^\/products\/systems-design\?waitlist=/u);
  await beginWaitlistSignIn(body.returnTo);
  await signIn();
  await finishWaitlistSignIn(body.returnTo, "trusted-token");
  expect(await (await handleWaitlistJoin(request())).json()).toMatchObject({
    kind: "saved",
    intakeId: "97000000-0000-4000-8000-000000000301",
  });
});
