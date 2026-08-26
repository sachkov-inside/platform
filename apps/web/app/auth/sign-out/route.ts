import LogtoClient from "@logto/next/server-actions";
import { NextResponse } from "next/server";

import {
  clearLogtoSessionCookie,
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
    const url = await new LogtoClient(config).handleSignOut(config.baseUrl);
    return signOutRedirect(url);
  } catch {
    await clearLogtoSessionCookie(config);
    return signOutRedirect(incompleteLogoutUrl(config.baseUrl));
  }
}

function signOutRedirect(url: string): NextResponse {
  return NextResponse.redirect(url, {
    status: 303,
    headers: { ...privateHeaders(), "clear-site-data": '"storage"' },
  });
}

function incompleteLogoutUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("authentication", "logout-incomplete");
  return url.toString();
}

function privateHeaders(): Record<string, string> {
  return { "cache-control": "no-store, private" };
}
