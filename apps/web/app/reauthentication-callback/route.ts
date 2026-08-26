import { getAccessToken } from "@logto/next/server-actions";
import { NextResponse } from "next/server";

import { completeIdentityReauthentication } from "@/shared/api/backend/index.server";
import { AudienceBoundLogtoClient } from "@/shared/auth/audience-bound-logto-client.server";
import {
  clearLogtoSessionCookie,
  clearPlatformSession,
  clearSignInAttempt,
  providerCallbackUrl,
  readLogtoBffConfig,
  readPlatformSession,
  readSignInAttempt,
  writePlatformSession,
} from "@/shared/auth/index.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const config = readLogtoBffConfig();
  const attempt = await readSignInAttempt();
  const session = await readPlatformSession();
  if (
    attempt?.kind !== "reauthentication" ||
    session?.sessionRef !== attempt.sessionRef
  ) {
    await clearPartialAuthentication(config);
    return localRedirect(config.baseUrl, "invalid");
  }

  try {
    const client = new AudienceBoundLogtoClient(config);
    await client.handleSignInCallback(
      providerCallbackUrl(
        request.url,
        config.baseUrl,
        "/reauthentication-callback",
      ),
    );
    const accessToken = await getAccessToken(config);
    const subject = await completeIdentityReauthentication({
      accessToken,
      attemptId: attempt.id,
      idempotencyKey: attempt.id,
      sessionRef: session.sessionRef,
    });
    if (subject.sessionRef !== session.sessionRef) {
      throw new Error("Re-authentication changed Platform Session ownership");
    }
    await writePlatformSession({
      sessionRef: subject.sessionRef,
      expiresAt: subject.expiresAt,
    });
    await clearSignInAttempt();
    return localRedirect(config.baseUrl);
  } catch {
    await clearPartialAuthentication(config);
    return localRedirect(config.baseUrl, "failed");
  }
}

async function clearPartialAuthentication(
  config: ReturnType<typeof readLogtoBffConfig>,
): Promise<void> {
  await clearPlatformSession();
  await clearSignInAttempt();
  await clearLogtoSessionCookie(config);
}

function localRedirect(baseUrl: string, error?: string): NextResponse {
  const target = new URL("/", baseUrl);
  if (error !== undefined) {
    target.searchParams.set("authentication", error);
  }
  return NextResponse.redirect(target, {
    status: 303,
    headers: { "cache-control": "no-store, private" },
  });
}
