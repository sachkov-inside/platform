import "server-only";

import { createHash } from "node:crypto";

import { cookies } from "next/headers";

/** Cookie with its attributes, as Next.js keeps it after `cookies().set()` in a route handler. */
type ChangedCookie = Parameters<
  Awaited<ReturnType<typeof cookies>>["set"]
>[0] & { readonly name: string; readonly value: string };

interface CallbackOutcome {
  readonly location: string;
  readonly changedCookies: readonly ChangedCookie[];
}

// A browser repeats the callback within a second; the result stays available a little longer.
const settledOutcomeLifetimeMilliseconds = 60_000;
// Entry rate limits bound the map in practice. Under a flood the oldest outcome leaves first, so
// the protection keeps working for fresh attempts instead of switching off.
const maximumOutcomes = 1_000;
const outcomes = new Map<string, Promise<CallbackOutcome>>();

/**
 * Runs one sign-in callback per browser attempt. iOS WebKit can send the same callback request
 * twice (production logs, 2026-11-02). The authorization code is single-use: a second exchange fails, and Logto then revokes the
 * tokens of the first one. A repeated request with the same `state`, `code` and session cookie
 * waits for the first, then receives its redirect and its changed cookies. The key holds the
 * session cookie, so only the browser that started the attempt receives the result. Outcomes live
 * in memory: like the entry rate limit, they assume a single web process (ADR 0028).
 */
export async function runSignInCallbackOnce(
  request: Request,
  sessionCookieName: string,
  completeSignIn: () => Promise<string>,
): Promise<string> {
  // Read before the callback runs: afterwards the store also holds the cookies it set.
  const originalCookies = new Map(
    (await cookies()).getAll().map(({ name, value }) => [name, value]),
  );
  const key = attemptKey(request, originalCookies.get(sessionCookieName));
  if (key === undefined) return completeSignIn();

  const running = outcomes.get(key);
  if (running !== undefined) {
    const outcome = await running;
    const store = await cookies();
    for (const cookie of outcome.changedCookies) store.set(cookie);
    return outcome.location;
  }
  if (outcomes.size >= maximumOutcomes) {
    const oldest = outcomes.keys().next().value;
    if (oldest !== undefined) outcomes.delete(oldest);
  }

  const outcome = (async (): Promise<CallbackOutcome> => {
    const location = await completeSignIn();
    return { location, changedCookies: await changedCookies(originalCookies) };
  })();
  outcomes.set(key, outcome);
  outcome.then(
    () => {
      setTimeout(() => {
        forget(key, outcome);
      }, settledOutcomeLifetimeMilliseconds).unref();
    },
    () => {
      forget(key, outcome);
    },
  );
  return (await outcome).location;
}

function forget(key: string, outcome: Promise<CallbackOutcome>): void {
  if (outcomes.get(key) === outcome) outcomes.delete(key);
}

function attemptKey(
  request: Request,
  session: string | undefined,
): string | undefined {
  const parameters = new URL(request.url).searchParams;
  const state = parameters.get("state");
  const code = parameters.get("code");
  // Without the cookie there is no sign-in transaction, and the SDK rejects the callback anyway.
  if ([state, code, session].some((value) => value == null || value === "")) {
    return undefined;
  }
  return createHash("sha256")
    .update(JSON.stringify([state, code, session]))
    .digest("base64url");
}

/** Cookies whose value the callback changed, deletions included, with their attributes. */
async function changedCookies(
  original: ReadonlyMap<string, string>,
): Promise<ChangedCookie[]> {
  // In a route handler Next.js returns response cookies: set and deleted entries keep attributes.
  const current = (await cookies()).getAll() as ChangedCookie[];
  return current.filter((cookie) => original.get(cookie.name) !== cookie.value);
}
