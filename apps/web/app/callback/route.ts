import { getAccessToken } from "@logto/next/server-actions";
import { connection, NextResponse } from "next/server";

import { AudienceBoundLogtoClient } from "@/shared/auth/audience-bound-logto-client.server";
import { readTermsGate } from "@/features/terms-acceptance.server";
import { welcomePath } from "@/features/terms-acceptance";
import { completePlatformSignIn } from "@/shared/auth/complete-platform-sign-in.server";
import {
  clearLogtoSessionCookie,
  providerCallbackUrl,
  readLogtoBffConfig,
  safePostSignInReturnUri,
} from "@/shared/auth/index.server";

export async function GET(request: Request): Promise<Response> {
  // Вне `try`: отказ от предсборки приходит исключением, и перехват стёр бы cookie сессии.
  await connection();
  const config = readLogtoBffConfig();
  try {
    const client = new AudienceBoundLogtoClient(config);
    const postRedirectUri = await client.handleSignInCallback(
      providerCallbackUrl(request.url, config.baseUrl),
    );
    // The pinned SDK stores the authorization-code token under its default cache key even when
    // the exchange is audience-bound. Read that exact fresh token before later resource refreshes.
    const accessToken = await getAccessToken(config);
    const outcome = await completePlatformSignIn(accessToken);
    if (outcome === "retryable") return localRedirect(config.baseUrl, "retryable");
    const returnUri = safePostSignInReturnUri(postRedirectUri, config.baseUrl);
    // Until the terms of use in force are accepted, every sign-in lands on the first sign-in screen.
    const gate = await readTermsGate(accessToken);
    if (gate.kind === "required") {
      const target = returnUri === undefined ? "/" : new URL(returnUri);
      return localRedirect(
        config.baseUrl,
        undefined,
        welcomePath(typeof target === "string" ? target : `${target.pathname}${target.search}`),
      );
    }
    return localRedirect(config.baseUrl, undefined, returnUri);
  } catch {
    await clearLogtoSessionCookie(config);
    return localRedirect(config.baseUrl, "failed");
  }
}

function localRedirect(
  baseUrl: string,
  error?: string,
  postRedirectUri?: string,
): NextResponse {
  const target = new URL(postRedirectUri ?? "/", baseUrl);
  if (error !== undefined) target.searchParams.set("authentication", error);
  return NextResponse.redirect(target, {
    status: 303,
    headers: { "cache-control": "no-store, private" },
  });
}
