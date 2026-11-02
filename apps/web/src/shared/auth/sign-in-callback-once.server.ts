import "server-only";

import { createHash } from "node:crypto";

import { cookies } from "next/headers";
import { NextRequest } from "next/server";

/** Cookie with its attributes, as Next.js keeps it after `cookies().set()` in a route handler. */
type ChangedCookie = Parameters<
  Awaited<ReturnType<typeof cookies>>["set"]
>[0] & { readonly name: string; readonly value: string };

interface CallbackOutcome {
  readonly location: string;
  readonly cookies: readonly ChangedCookie[];
}

// A browser repeats the callback within a second; the result stays available a little longer.
const settledOutcomeLifetimeMilliseconds = 60_000;
// Entry rate limits bound the map in practice; this cap keeps memory bounded under any load.
const maximumOutcomes = 1_000;
const outcomes = new Map<string, Promise<CallbackOutcome>>();

/**
 * Runs one sign-in callback per browser attempt. iOS WebKit can send the same callback request
 * twice. The authorization code is single-use: a second exchange fails, and Logto then revokes the
 * tokens of the first one. A repeated request with the same `state`, `code` and session cookie
 * waits for the first, then receives its redirect and its changed cookies. The key holds the
 * session cookie, so only the browser that started the attempt receives the result. Outcomes live
 * in memory: ADR 0028 keeps web as a single process.
 */
export async function runSignInCallbackOnce(
  request: Request,
  sessionCookieName: string,
  handle: () => Promise<string>,
): Promise<string> {
  const key = attemptKey(request, sessionCookieName);
  if (key === undefined) return handle();

  const running = outcomes.get(key);
  if (running !== undefined) {
    const outcome = await running;
    const store = await cookies();
    for (const cookie of outcome.cookies) store.set(cookie);
    return outcome.location;
  }
  if (outcomes.size >= maximumOutcomes) return handle();

  const outcome = (async (): Promise<CallbackOutcome> => {
    const location = await handle();
    return { location, cookies: await changedCookies(request) };
  })();
  outcomes.set(key, outcome);
  outcome.then(
    () => {
      setTimeout(() => {
        outcomes.delete(key);
      }, settledOutcomeLifetimeMilliseconds).unref();
    },
    () => {
      outcomes.delete(key);
    },
  );
  return (await outcome).location;
}

function attemptKey(
  request: Request,
  sessionCookieName: string,
): string | undefined {
  const parameters = new URL(request.url).searchParams;
  const state = parameters.get("state");
  const code = parameters.get("code");
  // Without the cookie there is no sign-in transaction, and the SDK rejects the callback anyway.
  const session = new NextRequest(request).cookies.get(
    sessionCookieName,
  )?.value;
  if ([state, code, session].some((value) => value == null || value === "")) {
    return undefined;
  }
  return createHash("sha256")
    .update(JSON.stringify([state, code, session]))
    .digest("base64url");
}

/** Cookies whose value the callback changed, deletions included, with their attributes. */
async function changedCookies(request: Request): Promise<ChangedCookie[]> {
  const original = new NextRequest(request).cookies;
  // In a route handler Next.js returns response cookies: set and deleted entries keep attributes.
  const current = (await cookies()).getAll() as ChangedCookie[];
  return current.filter(
    (cookie) => original.get(cookie.name)?.value !== cookie.value,
  );
}
