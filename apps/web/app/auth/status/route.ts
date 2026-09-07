import { NextResponse } from "next/server";

import {
  requestMaterialAuthoringReferences,
  resolveAccount,
} from "@/shared/api/backend/index.server";
import {
  getPlatformAccessToken,
  LogtoSessionUnavailableError,
} from "@/shared/auth/platform-access-token.server";
import {
  clearLogtoSessionCookie,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const config = readLogtoBffConfig();
  try {
    const accessToken = await getPlatformAccessToken(config);
    const [account, authoringAccess] = await Promise.all([
      resolveAccount(accessToken),
      requestMaterialAuthoringReferences(accessToken).catch(() => undefined),
    ]);
    return statusResponse("authenticated", authoringAccess?.ok === true, account.accountId);
  } catch (error) {
    if (error instanceof LogtoSessionUnavailableError) {
      return statusResponse("guest");
    }
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
  canManageMaterials = false,
  accountId: string | null = null,
): NextResponse {
  return NextResponse.json(
    { accountId, canManageMaterials, state },
    { headers: { "cache-control": "no-store, private" } },
  );
}
