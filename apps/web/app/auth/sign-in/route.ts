import LogtoClient from "@logto/next/server-actions";
import { NextResponse } from "next/server";

import {
  isSameOriginMutation,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const config = readLogtoBffConfig();
  if (!isSameOriginMutation(request, config.baseUrl)) {
    return new Response(null, { status: 403, headers: privateHeaders() });
  }

  try {
    const client = new LogtoClient(config);
    const { url } = await client.handleSignIn({
      redirectUri: `${config.baseUrl}/callback`,
    });
    return redirect(url);
  } catch {
    return redirect(`${config.baseUrl}/?authentication=unavailable`);
  }
}

function redirect(url: string): NextResponse {
  return NextResponse.redirect(url, { status: 303, headers: privateHeaders() });
}

function privateHeaders(): HeadersInit {
  return { "cache-control": "no-store, private" };
}
