import { getAccessToken } from "@logto/next/server-actions";
import { NextResponse } from "next/server";

import { AudienceBoundLogtoClient } from "@/shared/auth/audience-bound-logto-client.server";
import { completePlatformSignIn } from "@/shared/auth/complete-platform-sign-in.server";
import {
  clearLogtoSessionCookie,
  providerCallbackUrl,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const config = readLogtoBffConfig();
  try {
    const client = new AudienceBoundLogtoClient(config);
    await client.handleSignInCallback(
      providerCallbackUrl(request.url, config.baseUrl),
    );
    const outcome = await completePlatformSignIn(
      // The pinned SDK stores the authorization-code token under its default cache key even when
      // the exchange is audience-bound. Read that exact fresh token before later resource refreshes.
      await getAccessToken(config),
    );
    return localRedirect(
      config.baseUrl,
      outcome === "retryable" ? "retryable" : undefined,
    );
  } catch {
    await clearLogtoSessionCookie(config);
    return localRedirect(config.baseUrl, "failed");
  }
}

function localRedirect(baseUrl: string, error?: string): NextResponse {
  const target = new URL("/", baseUrl);
  if (error !== undefined) target.searchParams.set("authentication", error);
  return NextResponse.redirect(target, {
    status: 303,
    headers: { "cache-control": "no-store, private" },
  });
}
