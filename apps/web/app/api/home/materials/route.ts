import { connection } from "next/server";

import { handleHomeFeedRequest } from "@/features/library-catalog.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleHomeFeedRequest(request, await getOptionalPlatformAccessToken(request));
}
