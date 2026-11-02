import { AsyncLocalStorage } from "node:async_hooks";

import {
  RequestCookies,
  type ResponseCookies,
} from "next/dist/compiled/@edge-runtime/cookies";
import {
  appendMutableCookies,
  MutableRequestCookiesAdapter,
} from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { describe, expect, it, vi } from "vitest";

// Each request gets the cookie container Next.js gives a route handler, so the test holds the
// framework behaviour the replay depends on: set and deleted cookies keep their attributes.
const requestScope = new AsyncLocalStorage<ResponseCookies>();
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve(requestScope.getStore()),
}));

import { runSignInCallbackOnce } from "@/shared/auth/sign-in-callback-once.server";

function routeHandlerCookies(request: Request): ResponseCookies {
  return MutableRequestCookiesAdapter.wrap(new RequestCookies(request.headers));
}

/** The Set-Cookie headers Next.js appends to the route handler response. */
function responseSetCookies(store: ResponseCookies): string[] {
  const headers = new Headers();
  appendMutableCookies(headers, store);
  return headers.getSetCookie();
}

describe("runSignInCallbackOnce", () => {
  it("gives a repeated request the changed cookies of the first, with their attributes", async () => {
    const request = () =>
      new Request("https://inside.example.test/callback?code=c&state=s", {
        headers: {
          cookie: "logto_web=transaction; waitlist=intent; theme=dark",
        },
      });
    const firstStore = routeHandlerCookies(request());
    const secondStore = routeHandlerCookies(request());
    let finish: (() => void) | undefined;
    const handle = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = () => {
            firstStore.set("logto_web", "session", {
              httpOnly: true,
              sameSite: "lax",
              secure: true,
              maxAge: 1209600,
              path: "/",
            });
            firstStore.delete("waitlist");
            resolve("https://inside.example.test/");
          };
        }),
    );

    const first = requestScope.run(firstStore, () =>
      runSignInCallbackOnce(request(), "logto_web", handle),
    );
    const second = requestScope.run(secondStore, () =>
      runSignInCallbackOnce(request(), "logto_web", handle),
    );
    finish?.();

    await expect(first).resolves.toBe("https://inside.example.test/");
    await expect(second).resolves.toBe("https://inside.example.test/");
    expect(handle).toHaveBeenCalledOnce();
    const replayed = responseSetCookies(secondStore);
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
