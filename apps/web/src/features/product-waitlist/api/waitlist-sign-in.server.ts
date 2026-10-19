import "server-only";
import { cookies } from "next/headers";
import { resolveAccount } from "@/shared/api/backend/index.server";
import { readLogtoBffConfig } from "@/shared/auth/index.server";
import {
  progressWaitlistIntent,
  verifyWaitlistIntent,
  WAITLIST_INTENT_COOKIE,
  type WaitlistIntent,
} from "../model/product-waitlist-intent";
function matches(
  returnUri: string | undefined,
  intent: WaitlistIntent,
  baseUrl: string,
): boolean {
  if (returnUri === undefined) return false;
  const target = URL.parse(returnUri, baseUrl);
  return (
    target !== null &&
    target.origin === new URL(baseUrl).origin &&
    target.pathname === "/products/ai-engineering" &&
    target.searchParams.get("waitlist") === intent.operationId
  );
}
export async function discardWaitlistSignIn(): Promise<void> {
  (await cookies()).delete(WAITLIST_INTENT_COOKIE);
}
/** Ordinary sign-in cancels an abandoned action; only the exact intent starts its continuation. */
export async function beginWaitlistSignIn(
  returnUri: string | undefined,
): Promise<void> {
  const config = readLogtoBffConfig();
  const store = await cookies();
  const now = new Date();
  const intent = verifyWaitlistIntent(
    store.get(WAITLIST_INTENT_COOKIE)?.value,
    config.cookieSecret,
    now,
  );
  if (intent === null) return;
  if (
    intent.phase !== "pending" ||
    !matches(returnUri, intent, config.baseUrl)
  ) {
    store.delete(WAITLIST_INTENT_COOKIE);
    return;
  }
  store.set(
    WAITLIST_INTENT_COOKIE,
    progressWaitlistIntent(intent, "signing-in", null, config.cookieSecret),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: config.cookieSecure,
      path: "/",
      maxAge: intent.expiresAt - Math.floor(now.getTime() / 1000),
    },
  );
}
/** A successful SDK callback enables continuation for its current Account. It never joins a waitlist. */
export async function finishWaitlistSignIn(
  returnUri: string | undefined,
  accessToken: string,
): Promise<void> {
  const config = readLogtoBffConfig();
  const store = await cookies();
  const now = new Date();
  const intent = verifyWaitlistIntent(
    store.get(WAITLIST_INTENT_COOKIE)?.value,
    config.cookieSecret,
    now,
  );
  if (intent === null) return;
  if (
    intent.phase !== "signing-in" ||
    !matches(returnUri, intent, config.baseUrl)
  ) {
    store.delete(WAITLIST_INTENT_COOKIE);
    return;
  }
  const account = await resolveAccount(accessToken);
  store.set(
    WAITLIST_INTENT_COOKIE,
    progressWaitlistIntent(
      intent,
      "ready",
      account.accountId,
      config.cookieSecret,
    ),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: config.cookieSecure,
      path: "/",
      maxAge: intent.expiresAt - Math.floor(now.getTime() / 1000),
    },
  );
}
