import LogtoClient from "@logto/next/server-actions";
import { NextResponse } from "next/server";

import {
  isSameOriginMutation,
  readLogtoBffConfig,
  safePostSignInReturnUri,
} from "@/shared/auth/index.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const config = readLogtoBffConfig();
  if (!isSameOriginMutation(request, config.baseUrl)) {
    return new Response(null, { status: 403, headers: privateHeaders() });
  }

  try {
    const client = new LogtoClient(config);
    const postRedirectUri = safePostSignInReturnUri(
      await readReturnTo(request),
      config.baseUrl,
    );
    const { url } = await client.handleSignIn({
      redirectUri: `${config.baseUrl}/callback`,
      ...(postRedirectUri === undefined ? {} : { postRedirectUri }),
    });
    return redirect(url);
  } catch {
    return redirect(`${config.baseUrl}/?authentication=unavailable`);
  }
}

async function readReturnTo(request: Request): Promise<FormDataEntryValue | undefined> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded") && !contentType.includes("multipart/form-data")) {
    return undefined;
  }
  return (await request.formData()).get("returnTo") ?? undefined;
}

function redirect(url: string): NextResponse {
  return NextResponse.redirect(url, { status: 303, headers: privateHeaders() });
}

function privateHeaders(): HeadersInit {
  return { "cache-control": "no-store, private" };
}
