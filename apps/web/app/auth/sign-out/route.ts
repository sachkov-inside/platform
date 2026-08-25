import { randomUUID } from "node:crypto";

import LogtoClient, { getAccessToken } from "@logto/next/server-actions";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { endIdentitySession } from "@/shared/api/backend/index.server";
import {
  clearPlatformSession,
  isSameOriginMutation,
  logtoSessionCookieName,
  readLogtoBffConfig,
  readPlatformSession,
} from "@/shared/auth/index.server";

export const dynamic = "force-dynamic";
const BEST_EFFORT_TIMEOUT_MS = 1_000;

export async function POST(request: Request): Promise<Response> {
  const config = readLogtoBffConfig();
  if (!isSameOriginMutation(request, config.baseUrl)) {
    return new Response(null, { status: 403, headers: privateHeaders() });
  }

  const session = await readPlatformSession();

  // Local authority is revoked first. Provider/backend cleanup is best-effort afterwards.
  await clearPlatformSession();
  const accessToken = await readAccessToken(config);

  if (session !== undefined && accessToken !== undefined) {
    try {
      await withinBestEffort(
        endIdentitySession({
          accessToken,
          idempotencyKey: randomUUID(),
          sessionRef: session.sessionRef,
        }),
      );
    } catch {
      // The already-cleared browser session is the fail-closed boundary.
    }
  }

  try {
    const client = new LogtoClient(config);
    const url = await withinBestEffort(client.handleSignOut(config.baseUrl));
    if (url !== undefined) {
      return signOutRedirect(url);
    }
  } catch {
    // The provider session is best-effort after local authority is revoked.
  }
  await clearLogtoCookie(config);
  return signOutRedirect(incompleteLogoutUrl(config.baseUrl));
}

async function readAccessToken(
  config: ReturnType<typeof readLogtoBffConfig>,
): Promise<string | undefined> {
  try {
    return await withinBestEffort(getAccessToken(config, config.audience));
  } catch {
    return undefined;
  }
}

async function withinBestEffort<T>(operation: Promise<T>): Promise<T | undefined> {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<undefined>((resolve) => {
        timeoutId = setTimeout(resolve, BEST_EFFORT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

async function clearLogtoCookie(
  config: ReturnType<typeof readLogtoBffConfig>,
): Promise<void> {
  (await cookies()).set(logtoSessionCookieName(config.appId), "", {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: config.cookieSecure,
    expires: new Date(0),
    maxAge: 0,
  });
}

function signOutRedirect(url: string): NextResponse {
  return NextResponse.redirect(url, {
    status: 303,
    headers: {
      ...privateHeaders(),
      "clear-site-data": '"storage"',
    },
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
