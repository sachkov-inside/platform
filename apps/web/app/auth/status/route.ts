import { NextResponse } from "next/server";

import { resolveAccount } from "@/shared/api/backend/index.server";
import { getPlatformAccessToken } from "@/shared/auth/platform-access-token.server";
import {
  clearLogtoSessionCookie,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const config = readLogtoBffConfig();
  try {
    await resolveAccount(await getPlatformAccessToken(config));
    return statusResponse("authenticated");
  } catch (error) {
    if (isInvalidGrant(error)) {
      await clearLogtoSessionCookie(config);
      return statusResponse("guest");
    }
    return statusResponse("unavailable");
  }
}

function isInvalidGrant(error: unknown): error is Error & {
  readonly code: "invalid_grant";
} {
  return (
    error instanceof Error &&
    error.name === "LogtoRequestError" &&
    "code" in error &&
    error.code === "invalid_grant"
  );
}

function statusResponse(
  state: "authenticated" | "guest" | "unavailable",
): NextResponse {
  return NextResponse.json(
    { state },
    { headers: { "cache-control": "no-store, private" } },
  );
}
