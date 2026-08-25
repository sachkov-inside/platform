import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { resolveIdentitySubject } from "@/shared/api/backend/index.server";
import { getPlatformAccessToken } from "@/shared/auth/platform-access-token.server";
import {
  clearPlatformSession,
  logtoSessionCookieName,
  readLogtoBffConfig,
  readPlatformSession,
} from "@/shared/auth/index.server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await readPlatformSession();
  if (session === undefined) {
    return statusResponse("guest");
  }

  try {
    const config = readLogtoBffConfig();
    const subject = await resolveIdentitySubject({
      accessToken: await getPlatformAccessToken(config),
      sessionRef: session.sessionRef,
    });
    return statusResponse(
      subject.sessionRef === session.sessionRef ? "authenticated" : "unavailable",
    );
  } catch (error) {
    if (isInvalidGrant(error)) {
      await clearPlatformSession();
      const config = readLogtoBffConfig();
      (await cookies()).set(logtoSessionCookieName(config.appId), "", {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: config.cookieSecure,
        expires: new Date(0),
        maxAge: 0,
      });
      return statusResponse("guest");
    }
    return statusResponse("unavailable");
  }
}

function isInvalidGrant(error: unknown): error is Error & { readonly code: "invalid_grant" } {
  return (
    error instanceof Error &&
    error.name === "LogtoRequestError" &&
    "code" in error &&
    error.code === "invalid_grant"
  );
}

function statusResponse(state: "authenticated" | "guest" | "unavailable"): NextResponse {
  return NextResponse.json(
    { state },
    { headers: { "cache-control": "no-store, private" } },
  );
}
