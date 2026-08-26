import LogtoClient, { getAccessToken } from "@logto/next/server-actions";
import { NextResponse } from "next/server";

import { completePlatformSignIn } from "@/shared/auth/complete-platform-sign-in.server";
import {
  clearSignInAttempt,
  createSignInAttempt,
  isSameOriginMutation,
  readLogtoBffConfig,
  readSignInAttempt,
  writeSignInAttempt,
} from "@/shared/auth/index.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const config = readLogtoBffConfig();
  if (!isSameOriginMutation(request, config.baseUrl)) {
    return new Response(null, { status: 403, headers: privateHeaders() });
  }

  const currentAttempt = await readSignInAttempt();
  if (currentAttempt?.kind === "sign_in" && currentAttempt.phase === "provider_pending") {
    return redirect(`${config.baseUrl}/?authentication=in-progress`);
  }
  if (currentAttempt?.kind === "sign_in" && currentAttempt.phase === "backend_pending") {
    try {
      const outcome = await completePlatformSignIn({
        accessToken: await getAccessToken(config, config.audience),
        attemptId: currentAttempt.id,
      });
      return redirect(
        `${config.baseUrl}/${outcome === "retryable" ? "?authentication=retryable" : ""}`,
      );
    } catch {
      await clearSignInAttempt();
      return redirect(`${config.baseUrl}/?authentication=failed`);
    }
  }

  await writeSignInAttempt(createSignInAttempt());

  try {
    const client = new LogtoClient(config);
    const { url } = await client.handleSignIn({
      redirectUri: `${config.baseUrl}/callback`,
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
