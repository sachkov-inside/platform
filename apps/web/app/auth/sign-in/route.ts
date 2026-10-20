import {
  beginWaitlistSignIn,
  discardWaitlistSignIn,
} from "@/features/product-waitlist.sign-in.server";
import { Prompt } from "@logto/next";
import LogtoClient from "@logto/next/server-actions";
import { authNavigationResponse } from "@/shared/auth/auth-navigation-response.server";

import {
  isSameOriginMutation,
  readLogtoBffConfig,
  safePostSignInReturnUri,
} from "@/shared/auth/index.server";

export async function POST(request: Request): Promise<Response> {
  const config = readLogtoBffConfig();
  if (!isSameOriginMutation(request, config.baseUrl)) {
    return new Response(null, { status: 403, headers: privateHeaders() });
  }

  try {
    const client = new LogtoClient(config);
    const form = await readSignInForm(request);
    const postRedirectUri = safePostSignInReturnUri(
      form?.get("returnTo"),
      config.baseUrl,
    );
    await beginWaitlistSignIn(postRedirectUri);
    const options = {
      redirectUri: `${config.baseUrl}/callback`,
      // Account establishment needs a fresh email or Telegram verification after a failed callback.
      // Preserve consent as well: Logto needs it to issue the refresh token used by the BFF.
      prompt: [Prompt.Login, Prompt.Consent],
      ...(postRedirectUri === undefined ? {} : { postRedirectUri }),
    };
    const { url } = await client.handleSignIn(
      form?.get("entry") === "account-choice"
        ? options
        : {
            ...options,
            directSignIn: { method: "social", target: "inside-telegram" },
          },
    );
    return redirect(url);
  } catch {
    await discardWaitlistSignIn();
    return redirect(`${config.baseUrl}/?authentication=unavailable`);
  }
}

async function readSignInForm(request: Request): Promise<FormData | undefined> {
  const contentType = request.headers.get("content-type") ?? "";
  if (
    !contentType.includes("application/x-www-form-urlencoded") &&
    !contentType.includes("multipart/form-data")
  ) {
    return undefined;
  }
  return request.formData();
}

function redirect(url: string): Response {
  return authNavigationResponse(url);
}

function privateHeaders(): HeadersInit {
  return { "cache-control": "no-store, private" };
}
