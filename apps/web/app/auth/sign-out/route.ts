import LogtoClient from "@logto/next/server-actions";
import { authNavigationResponse } from "@/shared/auth/auth-navigation-response.server";

import {
  clearLogtoSessionCookie,
  isSameOriginMutation,
  readLogtoBffConfig,
  safePostSignInReturnUri,
} from "@/shared/auth/index.server";

export async function POST(request: Request): Promise<Response> {
  const config = readLogtoBffConfig();
  if (!isSameOriginMutation(request, config.baseUrl)) {
    return new Response(null, { status: 403, headers: privateHeaders() });
  }
  const contentType = request.headers.get("content-type") ?? "";
  const returnTo =
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
      ? (await request.formData()).get("returnTo")
      : undefined;
  const returnUri =
    safePostSignInReturnUri(returnTo, config.baseUrl) ?? config.baseUrl;
  try {
    const url = await new LogtoClient(config).handleSignOut(config.baseUrl);
    // The SDK destroys its storage, but that implicit mutation is not carried by
    // the explicit NextResponse returned from this Route Handler. Expire the exact
    // application cookie on our response path as well.
    await clearLogtoSessionCookie(config);
    return signOutRedirect(url, returnUri, config.baseUrl);
  } catch {
    await clearLogtoSessionCookie(config);
    return signOutRedirect(incompleteLogoutUrl(returnUri));
  }
}

function signOutRedirect(
  url: string,
  returnUri?: string,
  baseUrl?: string,
): Response {
  const headers: Record<string, string> = { "clear-site-data": '"storage"' };
  if (returnUri !== undefined && returnUri !== baseUrl) {
    const target = new URL(returnUri);
    headers["set-cookie"] =
      `inside.logout-return=${encodeURIComponent(`${target.pathname}${target.search}`)}; Path=/; Max-Age=300; HttpOnly; SameSite=Lax${target.protocol === "https:" ? "; Secure" : ""}`;
  }
  return authNavigationResponse(url, headers);
}

function incompleteLogoutUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("authentication", "logout-incomplete");
  return url.toString();
}

function privateHeaders(): Record<string, string> {
  return { "cache-control": "no-store, private" };
}
