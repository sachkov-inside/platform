import "next/dist/server/node-environment";
import { NextRequest } from "next/server";
import type { ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies";
import { appendMutableCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { createRequestStoreForAPI } from "next/dist/server/async-storage/request-store";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realBffSession } from "../support/real-bff-session";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

import { runSignInCallbackOnce } from "@/shared/auth/sign-in-callback-once.server";

function routeHandlerStore(request: Request) {
  return createRequestStoreForAPI(
    new NextRequest(request),
    new URL(request.url),
    { tags: [], expirationsByCacheKind: new Map() },
    undefined,
    undefined,
    undefined,
  );
}

/** The Set-Cookie headers Next.js appends to the route handler response. */
function responseSetCookies(store: ResponseCookies): string[] {
  const headers = new Headers();
  appendMutableCookies(headers, store);
  return headers.getSetCookie();
}

describe("runSignInCallbackOnce", () => {
  it("gives a repeated request the changed cookies of the first, with their attributes", async () => {
    const scope = await realBffSession(null);
    const request = () =>
      new Request("https://inside.example.test/callback?code=c&state=s", {
        headers: {
          cookie: "logto_web=transaction; waitlist=intent; theme=dark",
        },
      });
    const firstStore = routeHandlerStore(request());
    const secondStore = routeHandlerStore(request());
    let finish: (() => void) | undefined;
    const handle = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = () => {
            firstStore.mutableCookies.set("logto_web", "session", {
              httpOnly: true,
              sameSite: "lax",
              secure: true,
              maxAge: 1209600,
              path: "/",
            });
            firstStore.mutableCookies.delete("waitlist");
            resolve("https://inside.example.test/");
          };
        }),
    );

    const first = scope(() =>
      workUnitAsyncStorage.run(firstStore, () =>
        runSignInCallbackOnce(request(), "logto_web", handle),
      ),
    );
    const second = scope(() =>
      workUnitAsyncStorage.run(secondStore, () =>
        runSignInCallbackOnce(request(), "logto_web", handle),
      ),
    );
    await vi.waitFor(() => {
      expect(handle).toHaveBeenCalledOnce();
    });
    finish?.();

    await expect(first).resolves.toBe("https://inside.example.test/");
    await expect(second).resolves.toBe("https://inside.example.test/");
    expect(handle).toHaveBeenCalledOnce();
    const replayed = responseSetCookies(secondStore.mutableCookies);
    expect(replayed).toHaveLength(2);
    expect(replayed).toContainEqual(
      expect.stringMatching(
        /^logto_web=session; Path=\/; Expires=[^;]+; Max-Age=1209600; Secure; HttpOnly; SameSite=lax$/u,
      ),
    );
    expect(replayed).toContainEqual(
      expect.stringMatching(
        /^waitlist=; Path=\/; Expires=Thu, 01 Jan 1970 00:00:00 GMT/u,
      ),
    );
  });
});
