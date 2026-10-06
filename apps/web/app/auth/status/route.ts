import { connection, NextResponse } from "next/server";

import {
  requestMaterialAuthoringReferences,
  resolveAccount,
} from "@/shared/api/backend/index.server";
import {
  getPlatformAccessToken,
  LogtoSessionUnavailableError,
} from "@/shared/auth/platform-access-token.server";
import { readLogtoBffConfig } from "@/shared/auth/index.server";

export async function GET(): Promise<Response> {
  // Вне `try`: отказ от предсборки приходит исключением, и перехват выдал бы его за «unavailable».
  await connection();
  try {
    const accessToken = await getPlatformAccessToken(readLogtoBffConfig());
    const [account, authoringAccess] = await Promise.all([
      resolveAccount(accessToken),
      requestMaterialAuthoringReferences(accessToken).catch(() => undefined),
    ]);
    return statusResponse(
      "authenticated",
      authoringAccess?.ok === true,
      account.accountId,
    );
  } catch (error) {
    if (error instanceof LogtoSessionUnavailableError) {
      return statusResponse("guest");
    }
    return statusResponse("unavailable");
  }
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
