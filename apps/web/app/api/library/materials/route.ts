import { connection } from "next/server";

import { handleLibraryCatalogRequest } from "@/features/library-catalog.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleLibraryCatalogRequest(
    request,
    await getOptionalPlatformAccessToken(request),
  );
}
