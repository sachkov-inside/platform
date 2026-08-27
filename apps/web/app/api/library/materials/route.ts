import { handleLibraryCatalogRequest } from "@/_pages/library.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

export async function GET(request: Request): Promise<Response> {
  return handleLibraryCatalogRequest(
    request,
    await getOptionalPlatformAccessToken(request),
  );
}
