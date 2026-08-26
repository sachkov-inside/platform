import { getAccessToken } from "@logto/next/server-actions";
import { NextResponse } from "next/server";

import { AudienceBoundLogtoClient } from "@/shared/auth/audience-bound-logto-client.server";
import { completePlatformSignIn } from "@/shared/auth/complete-platform-sign-in.server";
import {
  clearLogtoSessionCookie,
  clearPlatformSession,
  clearSignInAttempt,
  providerCallbackUrl,
  readLogtoBffConfig,
  readSignInAttempt,
  writeSignInAttempt,
} from "@/shared/auth/index.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const config = readLogtoBffConfig();
  const attempt = await readSignInAttempt();

  if (attempt?.kind !== "sign_in") {
    await clearPartialAuthentication(config);
    return localRedirect(config.baseUrl, "invalid");
  }

  if (attempt.phase === "backend_pending") {
    return retryPlatformCompletion(config, attempt.id);
  }

  try {
    const client = new AudienceBoundLogtoClient(config);
    await client.handleSignInCallback(
      providerCallbackUrl(request.url, config.baseUrl, "/callback"),
    );
    const accessToken = await getAccessToken(config);
    await writeSignInAttempt({
      ...attempt,
      phase: "backend_pending",
    });
    const response = await finishPlatformCompletion(config, accessToken, attempt.id);
    return response;
  } catch {
    await clearPartialAuthentication(config);
    return localRedirect(config.baseUrl, "failed");
  }
}

async function retryPlatformCompletion(
  config: ReturnType<typeof readLogtoBffConfig>,
  attemptId: string,
): Promise<Response> {
  try {
    const response = await finishPlatformCompletion(
      config,
      await getAccessToken(config, config.audience),
      attemptId,
    );
    return response;
  } catch {
    await clearPartialAuthentication(config);
    return localRedirect(config.baseUrl, "failed");
  }
}

async function finishPlatformCompletion(
  config: ReturnType<typeof readLogtoBffConfig>,
  accessToken: string,
  attemptId: string,
): Promise<Response> {
  const outcome = await completePlatformSignIn({ accessToken, attemptId });
  return localRedirect(
    config.baseUrl,
    outcome === "retryable" ? "retryable" : undefined,
  );
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
