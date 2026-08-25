import { randomUUID } from "node:crypto";

import { Prompt } from "@logto/next";
import LogtoClient, { getAccessToken } from "@logto/next/server-actions";
import { NextResponse } from "next/server";

import { beginIdentityReauthentication } from "@/shared/api/backend/index.server";
import {
  clearSignInAttempt,
  isSameOriginMutation,
  readLogtoBffConfig,
  readPlatformSession,
  writeSignInAttempt,
} from "@/shared/auth/index.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const config = readLogtoBffConfig();
  if (!isSameOriginMutation(request, config.baseUrl)) {
    return new Response(null, { status: 403, headers: privateHeaders() });
  }

  try {
    const session = await readPlatformSession();
    if (session === undefined) {
      return redirect(`${config.baseUrl}/?authentication=required`);
    }
    const accessToken = await getAccessToken(config, config.audience);
    const attempt = await beginIdentityReauthentication({
      accessToken,
      idempotencyKey: randomUUID(),
      sessionRef: session.sessionRef,
    });
    await writeSignInAttempt({
      id: attempt.attemptId,
      expiresAt: attempt.expiresAt,
      kind: "reauthentication",
      sessionRef: session.sessionRef,
    });

    const client = new LogtoClient(config);
    const { url } = await client.handleSignIn({
      clearTokens: false,
      prompt: Prompt.Login,
      redirectUri: `${config.baseUrl}/reauthentication-callback`,
    });
    return redirect(url);
  } catch {
    await clearSignInAttempt();
    return redirect(`${config.baseUrl}/?authentication=unavailable`);
  }
}

function redirect(url: string): NextResponse {
  return NextResponse.redirect(url, { status: 303, headers: privateHeaders() });
}

function privateHeaders(): HeadersInit {
  return { "cache-control": "no-store, private" };
}
